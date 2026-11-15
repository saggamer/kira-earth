"""Point forecasts from real providers, normalised to one schema, plus climate context.

Providers
  weathernext2    keyless: Google DeepMind WeatherNext 2, a 64-member AI ensemble (median shown), via Open-Meteo
  open-meteo      keyless (best-match NWP blend: ECMWF IFS, GFS, ICON, … chosen per location)
  openweathermap  One Call 3.0 (key)
  weatherapi      WeatherAPI.com (key)
  tomorrow        Tomorrow.io (key)
Probabilistic layer: Open-Meteo ensemble API — WeatherNext 2 (64 AI members) when that provider is
selected, otherwise ECMWF IFS 0.25° ENS (51 physics members).
Climate context: the selected place's own NASA POWER 1991–2020 record (the WMO standard normal
period), ±7-day calendar window. Temperature thresholds are shifted by a 6.5 °C/km lapse rate for
the height difference between the POWER grid cell and the forecast point.

Nothing here invents weather: a failed provider returns an error, never a substitute.
Units everywhere: °C, mm, m/s, hPa (mean sea level), %, UV index. Times: unix seconds (UTC) plus the
location's utc_offset_seconds; daily rows carry the local calendar date.
"""
from __future__ import annotations
import math
import re
import time
from datetime import date, datetime, timezone
import numpy as np
import pandas as pd
from . import keystore

TTL = 15 * 60
_cache: dict[tuple, tuple[float, dict]] = {}
LAPSE = 6.5 / 1000  # °C per metre, standard atmosphere
NORMAL = (1991, 2020)

PUBLIC = {
    "weathernext2": {"label": "Google WeatherNext 2 (AI ensemble)", "key": None, "docs": "https://open-meteo.com/en/docs/google-weathernext-api",
                     "license": "Google DeepMind WeatherNext 2 data via Open-Meteo.com (CC BY 4.0); free for non-commercial use"},
    "open-meteo": {"label": "Open-Meteo (best-match models)", "key": None, "docs": "https://open-meteo.com/en/docs",
                   "license": "CC BY 4.0 · Open-Meteo.com; non-commercial use"},
    "openweathermap": {"label": "OpenWeather One Call 3.0", "key": "openweathermap", "docs": "https://openweathermap.org/api/one-call-3",
                       "license": "OpenWeather terms; CC BY-SA 4.0 data"},
    "weatherapi": {"label": "WeatherAPI.com", "key": "weatherapi", "docs": "https://www.weatherapi.com/docs/",
                   "license": "WeatherAPI.com terms"},
    "tomorrow": {"label": "Tomorrow.io", "key": "tomorrow", "docs": "https://docs.tomorrow.io/reference/weather-forecast",
                 "license": "Tomorrow.io terms"},
}

# ---------------------------------------------------------------- condition codes → one vocabulary
CATEGORIES = ["clear", "partly", "cloudy", "fog", "drizzle", "rain", "snow", "storm"]


def wmo(code):
    if code is None: return None, None
    c = int(code)
    table = {0: ("clear", "Clear sky"), 1: ("partly", "Mainly clear"), 2: ("partly", "Partly cloudy"), 3: ("cloudy", "Overcast"),
             45: ("fog", "Fog"), 48: ("fog", "Depositing rime fog"), 51: ("drizzle", "Light drizzle"), 53: ("drizzle", "Drizzle"),
             55: ("drizzle", "Dense drizzle"), 56: ("drizzle", "Freezing drizzle"), 57: ("drizzle", "Freezing drizzle"),
             61: ("rain", "Light rain"), 63: ("rain", "Rain"), 65: ("rain", "Heavy rain"), 66: ("rain", "Freezing rain"),
             67: ("rain", "Heavy freezing rain"), 71: ("snow", "Light snow"), 73: ("snow", "Snow"), 75: ("snow", "Heavy snow"),
             77: ("snow", "Snow grains"), 80: ("rain", "Light showers"), 81: ("rain", "Showers"), 82: ("rain", "Violent showers"),
             85: ("snow", "Snow showers"), 86: ("snow", "Heavy snow showers"), 95: ("storm", "Thunderstorm"),
             96: ("storm", "Thunderstorm with hail"), 99: ("storm", "Thunderstorm with heavy hail")}
    return table.get(c, (None, f"WMO code {c}"))


def owm(code):
    c = int(code)
    if 200 <= c < 300: return "storm"
    if 300 <= c < 400: return "drizzle"
    if 500 <= c < 600: return "rain"
    if 600 <= c < 700: return "snow"
    if 700 <= c < 800: return "fog"
    if c == 800: return "clear"
    return "partly" if c in (801, 802) else "cloudy"


def wapi(code):
    c = int(code)
    if c == 1000: return "clear"
    if c == 1003: return "partly"
    if c in (1006, 1009): return "cloudy"
    if c in (1030, 1135, 1147): return "fog"
    if c in (1087, 1273, 1276, 1279, 1282): return "storm"
    if 1150 <= c <= 1171 or c == 1072: return "drizzle"
    if c in (1063, 1180, 1183, 1186, 1189, 1192, 1195, 1198, 1201, 1240, 1243, 1246): return "rain"
    return "snow"


TOMORROW = {1000: ("clear", "Clear"), 1100: ("clear", "Mostly clear"), 1101: ("partly", "Partly cloudy"),
            1102: ("cloudy", "Mostly cloudy"), 1001: ("cloudy", "Cloudy"), 2000: ("fog", "Fog"), 2100: ("fog", "Light fog"),
            4000: ("drizzle", "Drizzle"), 4001: ("rain", "Rain"), 4200: ("rain", "Light rain"), 4201: ("rain", "Heavy rain"),
            5000: ("snow", "Snow"), 5001: ("snow", "Flurries"), 5100: ("snow", "Light snow"), 5101: ("snow", "Heavy snow"),
            6000: ("drizzle", "Freezing drizzle"), 6001: ("rain", "Freezing rain"), 6200: ("rain", "Light freezing rain"),
            6201: ("rain", "Heavy freezing rain"), 7000: ("snow", "Ice pellets"), 7101: ("snow", "Heavy ice pellets"),
            7102: ("snow", "Light ice pellets"), 8000: ("storm", "Thunderstorm")}


def tmr(code):
    return TOMORROW.get(int(code), (None, f"Code {code}")) if code is not None else (None, None)


def num(v, scale=1.0):
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v) * scale
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def redact(url: str) -> str:
    url = re.sub(r"(?i)((?:appid|key|apikey|api_key)=)[^&]+", r"\1REDACTED", url)
    return re.sub(r"(/api/area/csv/)[^/]+", r"\1REDACTED", url)


def local_date(ts: int, offset: int) -> str:
    return datetime.fromtimestamp(ts + offset, timezone.utc).date().isoformat()


# ---------------------------------------------------------------- providers
async def _get(client, url, params=None, headers=None):
    r = await client.get(url, params=params, headers=headers, timeout=30)
    if r.status_code in (401, 403):
        raise PermissionError("The provider rejected the API key.")
    if r.status_code == 429:
        raise RuntimeError("The provider's rate limit was reached.")
    r.raise_for_status()
    return r.json(), str(r.url)


async def open_meteo(client, lat, lon):
    hourly = ("temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,"
              "cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index")
    daily = ("weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,"
             "wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset")
    d, url = await _get(client, "https://api.open-meteo.com/v1/forecast", {
        "latitude": lat, "longitude": lon, "hourly": hourly, "daily": daily, "current": hourly.replace("precipitation_probability,", ""),
        "timezone": "auto", "forecast_days": 16, "wind_speed_unit": "ms", "timeformat": "unixtime"})
    off = int(d["utc_offset_seconds"])
    h = d["hourly"]
    hours = [{"time": int(t), "temperature": num(h["temperature_2m"][i]), "feels_like": num(h["apparent_temperature"][i]),
              "humidity": num(h["relative_humidity_2m"][i]), "precip_probability": num(h["precipitation_probability"][i]),
              "precipitation": num(h["precipitation"][i]), "wind_speed": num(h["wind_speed_10m"][i]),
              "wind_gust": num(h["wind_gusts_10m"][i]), "wind_direction": num(h["wind_direction_10m"][i]),
              "pressure": num(h["pressure_msl"][i]), "cloud": num(h["cloud_cover"][i]), "uv": num(h["uv_index"][i]),
              "category": wmo(h["weather_code"][i])[0], "description": wmo(h["weather_code"][i])[1]} for i, t in enumerate(h["time"])]
    dl = d["daily"]
    days = [{"date": local_date(int(t), off), "t_max": num(dl["temperature_2m_max"][i]), "t_min": num(dl["temperature_2m_min"][i]),
             "precip_sum": num(dl["precipitation_sum"][i]), "precip_probability": num(dl["precipitation_probability_max"][i]),
             "wind_max": num(dl["wind_speed_10m_max"][i]), "gust_max": num(dl["wind_gusts_10m_max"][i]), "uv_max": num(dl["uv_index_max"][i]),
             "sunrise": dl["sunrise"][i], "sunset": dl["sunset"][i],
             "category": wmo(dl["weather_code"][i])[0], "description": wmo(dl["weather_code"][i])[1]} for i, t in enumerate(dl["time"])]
    c = d["current"]
    current = {"time": int(c["time"]), "temperature": num(c["temperature_2m"]), "feels_like": num(c["apparent_temperature"]),
               "humidity": num(c["relative_humidity_2m"]), "precipitation": num(c["precipitation"]), "wind_speed": num(c["wind_speed_10m"]),
               "wind_gust": num(c["wind_gusts_10m"]), "wind_direction": num(c["wind_direction_10m"]), "pressure": num(c["pressure_msl"]),
               "cloud": num(c["cloud_cover"]), "uv": num(c.get("uv_index")),
               "category": wmo(c["weather_code"])[0], "description": wmo(c["weather_code"])[1]}
    now = time.time()
    return {"model": "Open-Meteo best match (national and global NWP blend)", "utc_offset_seconds": off, "timezone": d.get("timezone"),
            "elevation": num(d.get("elevation")), "current": current, "hourly": [h for h in hours if h["time"] >= now - 3600], "daily": days, "source_url": url, "alerts": []}


ENSEMBLES = {
    "ecmwf_ifs025": {"label": "ECMWF IFS 0.25° ensemble (ENS) via Open-Meteo", "license": "CC BY 4.0 · ECMWF / Open-Meteo.com", "kind": "physics"},
    "google_weathernext2_ensemble": {"label": "Google DeepMind WeatherNext 2 AI ensemble via Open-Meteo",
                                     "license": "Google DeepMind WeatherNext 2 via Open-Meteo.com (CC BY 4.0); non-commercial", "kind": "ai"},
}


def _members(h: dict, var: str) -> np.ndarray:
    cols = [k for k in h if k == var or re.fullmatch(rf"{var}_member\d+", k)]
    return np.array([[np.nan if v is None else v for v in h[c]] for c in cols], dtype=float)


async def weathernext(client, lat, lon):
    """Google DeepMind WeatherNext 2 (64-member AI ensemble). The deterministic view is the member median;
    daily rain probability is the share of members with ≥ 1 mm. Fields the model does not publish (humidity,
    gusts, feels-like, UV) stay empty rather than being borrowed from another model."""
    d, url = await _get(client, "https://ensemble-api.open-meteo.com/v1/ensemble", {
        "latitude": lat, "longitude": lon, "hourly": "temperature_2m,precipitation,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code",
        "models": "google_weathernext2_ensemble", "timezone": "auto", "forecast_days": 16, "wind_speed_unit": "ms", "timeformat": "unixtime"})
    off = int(d["utc_offset_seconds"])
    h = d["hourly"]
    t = np.array(h["time"], dtype="int64")
    temp, rain, cloud, slp, wind, wdir, code = (_members(h, v) for v in
                                                ("temperature_2m", "precipitation", "cloud_cover", "pressure_msl", "wind_speed_10m", "wind_direction_10m", "weather_code"))
    valid = ~np.isnan(temp).all(axis=0)
    if not valid.any():
        raise ValueError("WeatherNext 2 returned no forecast values.")

    def med(a, i):
        col = a[:, i]
        col = col[~np.isnan(col)]
        return num(float(np.median(col))) if col.size else None

    def mode_code(i):
        col = code[:, i]
        col = col[~np.isnan(col)].astype(int)
        return int(np.bincount(col).argmax()) if col.size else 0
    now = time.time()
    hours = []
    for i in np.nonzero(valid)[0]:
        if t[i] < now - 3600:
            continue
        c = mode_code(i)
        hours.append({"time": int(t[i]), "temperature": med(temp, i), "feels_like": None, "humidity": None, "precip_probability": None,
                      "precipitation": med(rain, i), "wind_speed": med(wind, i), "wind_gust": None, "wind_direction": med(wdir, i),
                      "pressure": med(slp, i), "cloud": med(cloud, i), "uv": None, "category": wmo(c)[0], "description": wmo(c)[1]})
    local = pd.to_datetime(t + off, unit="s").normalize()
    days = []
    for dte in pd.unique(local):
        m = (local == dte) & valid
        if m.sum() < 24:
            continue
        tmax, tmin = np.nanmax(temp[:, m], 1), np.nanmin(temp[:, m], 1)
        psum = np.nansum(rain[:, m], 1)
        wmax = np.nanmax(wind[:, m], 1)
        codes = np.nanmax(code[:, m], 1)
        codes = codes[~np.isnan(codes)].astype(int)
        c = int(np.bincount(codes).argmax()) if codes.size else 0
        days.append({"date": pd.Timestamp(dte).date().isoformat(), "t_max": num(float(np.median(tmax))), "t_min": num(float(np.median(tmin))),
                     "precip_sum": num(float(np.median(psum))), "precip_probability": num(float(np.mean(psum >= 1) * 100)),
                     "wind_max": num(float(np.median(wmax))), "gust_max": None, "uv_max": None, "sunrise": None, "sunset": None,
                     "category": wmo(c)[0], "description": wmo(c)[1],
                     "t_max_range": [num(float(np.percentile(tmax, 10))), num(float(np.percentile(tmax, 90)))]})
    first = hours[0] if hours else None
    current = {**first, "time": first["time"]} if first else None
    return {"model": f"Google DeepMind WeatherNext 2 · {temp.shape[0]}-member AI ensemble, member median (Open-Meteo)",
            "utc_offset_seconds": off, "timezone": d.get("timezone"), "elevation": num(d.get("elevation")), "current": current,
            "hourly": hours, "daily": days, "source_url": url, "alerts": [], "members": int(temp.shape[0]),
            "notes": ["Deterministic values are the median of 64 AI ensemble members; daily rain chance is the share of members with ≥ 1 mm.",
                      "WeatherNext 2 does not publish humidity, gusts, feels-like or UV in this feed, so those stay empty.",
                      "The published horizon is shorter than ECMWF's when a new run is still arriving."]}


async def openweathermap(client, lat, lon, key):
    d, url = await _get(client, "https://api.openweathermap.org/data/3.0/onecall",
                        {"lat": lat, "lon": lon, "appid": key, "units": "metric", "exclude": "minutely"})
    off = int(d.get("timezone_offset", 0))

    def row(x):
        w = (x.get("weather") or [{}])[0]
        rain = (x.get("rain") or {}).get("1h", 0) if isinstance(x.get("rain"), dict) else 0
        snow = (x.get("snow") or {}).get("1h", 0) if isinstance(x.get("snow"), dict) else 0
        return {"time": int(x["dt"]), "temperature": num(x.get("temp")), "feels_like": num(x.get("feels_like")),
                "humidity": num(x.get("humidity")), "precip_probability": num(x.get("pop"), 100) if "pop" in x else None,
                "precipitation": num(rain + snow), "wind_speed": num(x.get("wind_speed")), "wind_gust": num(x.get("wind_gust")),
                "wind_direction": num(x.get("wind_deg")), "pressure": num(x.get("pressure")), "cloud": num(x.get("clouds")),
                "uv": num(x.get("uvi")), "category": owm(w["id"]) if "id" in w else None, "description": (w.get("description") or "").capitalize() or None}
    days = []
    for x in d.get("daily", []):
        w = (x.get("weather") or [{}])[0]
        days.append({"date": local_date(int(x["dt"]), off), "t_max": num(x["temp"]["max"]), "t_min": num(x["temp"]["min"]),
                     "precip_sum": num((x.get("rain") or 0) + (x.get("snow") or 0)), "precip_probability": num(x.get("pop"), 100),
                     "wind_max": num(x.get("wind_speed")), "gust_max": num(x.get("wind_gust")), "uv_max": num(x.get("uvi")),
                     "sunrise": x.get("sunrise"), "sunset": x.get("sunset"),
                     "category": owm(w["id"]) if "id" in w else None, "description": (w.get("description") or "").capitalize() or None})
    alerts = [{"source": a.get("sender_name") or "OpenWeather", "event": a.get("event"), "severity": None,
               "headline": a.get("event"), "description": (a.get("description") or "")[:1200],
               "effective": a.get("start"), "expires": a.get("end"), "url": None} for a in d.get("alerts", [])]
    return {"model": "OpenWeather proprietary model blend", "utc_offset_seconds": off, "timezone": d.get("timezone"), "elevation": None,
            "current": row(d["current"]), "hourly": [row(x) for x in d.get("hourly", [])], "daily": days,
            "source_url": redact(url), "alerts": alerts}


async def weatherapi(client, lat, lon, key):
    d, url = await _get(client, "https://api.weatherapi.com/v1/forecast.json",
                        {"key": key, "q": f"{lat},{lon}", "days": 14, "aqi": "no", "alerts": "yes"})
    loc = d["location"]
    local = datetime.strptime(loc["localtime"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).timestamp()
    off = int(round((local - loc["localtime_epoch"]) / 900) * 900)
    kph = 1 / 3.6

    def row(x, t):
        c = x.get("condition") or {}
        return {"time": int(t), "temperature": num(x.get("temp_c")), "feels_like": num(x.get("feelslike_c")),
                "humidity": num(x.get("humidity")), "precip_probability": num(max(x.get("chance_of_rain", 0) or 0, x.get("chance_of_snow", 0) or 0)) if "chance_of_rain" in x else None,
                "precipitation": num(x.get("precip_mm")), "wind_speed": num(x.get("wind_kph"), kph), "wind_gust": num(x.get("gust_kph"), kph),
                "wind_direction": num(x.get("wind_degree")), "pressure": num(x.get("pressure_mb")), "cloud": num(x.get("cloud")),
                "uv": num(x.get("uv")), "category": wapi(c["code"]) if "code" in c else None, "description": c.get("text")}
    hours, days = [], []
    for fd in d["forecast"]["forecastday"]:
        hours += [row(h, h["time_epoch"]) for h in fd.get("hour", [])]
        day, c = fd["day"], fd["day"].get("condition") or {}
        days.append({"date": fd["date"], "t_max": num(day.get("maxtemp_c")), "t_min": num(day.get("mintemp_c")),
                     "precip_sum": num(day.get("totalprecip_mm")),
                     "precip_probability": num(max(day.get("daily_chance_of_rain", 0) or 0, day.get("daily_chance_of_snow", 0) or 0)),
                     "wind_max": num(day.get("maxwind_kph"), kph), "gust_max": None, "uv_max": num(day.get("uv")),
                     "sunrise": None, "sunset": None, "category": wapi(c["code"]) if "code" in c else None, "description": c.get("text")})
    now = time.time()
    hours = [h for h in hours if h["time"] >= now - 3600]
    alerts = [{"source": "WeatherAPI.com", "event": a.get("event"), "severity": a.get("severity") or None, "headline": a.get("headline"),
               "description": (a.get("desc") or "")[:1200], "effective": a.get("effective"), "expires": a.get("expires"), "url": None}
              for a in (d.get("alerts") or {}).get("alert", [])]
    return {"model": "WeatherAPI.com model blend", "utc_offset_seconds": off, "timezone": loc.get("tz_id"), "elevation": None,
            "current": row(d["current"], d["current"]["last_updated_epoch"]), "hourly": hours, "daily": days,
            "source_url": redact(url), "alerts": alerts}


async def tomorrow(client, lat, lon, key, offset):
    d, url = await _get(client, "https://api.tomorrow.io/v4/weather/forecast",
                        {"location": f"{lat},{lon}", "apikey": key, "units": "metric", "timesteps": "1h,1d"})
    tl = d["timelines"]

    def ts(s):
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())

    def row(x):
        v = x["values"]
        cat, desc = tmr(v.get("weatherCode"))
        return {"time": ts(x["time"]), "temperature": num(v.get("temperature")), "feels_like": num(v.get("temperatureApparent")),
                "humidity": num(v.get("humidity")), "precip_probability": num(v.get("precipitationProbability")),
                "precipitation": num((v.get("rainIntensity") or 0) + (v.get("snowIntensity") or 0) + (v.get("sleetIntensity") or 0)),
                "wind_speed": num(v.get("windSpeed")), "wind_gust": num(v.get("windGust")), "wind_direction": num(v.get("windDirection")),
                "pressure": num(v.get("pressureSeaLevel")), "cloud": num(v.get("cloudCover")), "uv": num(v.get("uvIndex")),
                "category": cat, "description": desc}
    hours = [row(x) for x in tl.get("hourly", [])]
    days = []
    for x in tl.get("daily", []):
        v = x["values"]
        cat, desc = tmr(v.get("weatherCodeMax"))
        days.append({"date": local_date(ts(x["time"]) + 6 * 3600, offset), "t_max": num(v.get("temperatureMax")), "t_min": num(v.get("temperatureMin")),
                     "precip_sum": num((v.get("rainAccumulationSum") or 0) + (v.get("snowAccumulationSum") or 0) + (v.get("sleetAccumulationSum") or 0)),
                     "precip_probability": num(v.get("precipitationProbabilityMax")), "wind_max": num(v.get("windSpeedMax")),
                     "gust_max": num(v.get("windGustMax")), "uv_max": num(v.get("uvIndexMax")),
                     "sunrise": ts(v["sunriseTime"]) if v.get("sunriseTime") else None, "sunset": ts(v["sunsetTime"]) if v.get("sunsetTime") else None,
                     "category": cat, "description": desc})
    now = time.time()
    current = min(hours, key=lambda h: abs(h["time"] - now)) if hours else None
    return {"model": "Tomorrow.io proprietary model blend", "utc_offset_seconds": offset, "timezone": None, "elevation": None,
            "current": current, "hourly": [h for h in hours if h["time"] >= now - 3600], "daily": days,
            "source_url": redact(url), "alerts": []}


async def utc_offset(client, lat, lon) -> int:
    key = ("offset", round(lat, 2), round(lon, 2))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 86400:
        return hit[1]
    d, _ = await _get(client, "https://api.open-meteo.com/v1/forecast",
                      {"latitude": lat, "longitude": lon, "current": "temperature_2m", "timezone": "auto"})
    _cache[key] = (time.time(), int(d["utc_offset_seconds"]))
    return _cache[key][1]


def configured() -> list[str]:
    return ["weathernext2", "open-meteo"] + [p for p, s in PUBLIC.items() if s["key"] and keystore.get(s["key"])]


async def provider_forecast(client, provider: str, lat: float, lon: float, refresh: bool = False) -> dict:
    if provider not in PUBLIC:
        raise KeyError(provider)
    spec = PUBLIC[provider]
    key = keystore.get(spec["key"]) if spec["key"] else None
    if spec["key"] and not key:
        raise LookupError(f"Add a {spec['label']} API key in the API keys menu first.")
    ck = (provider, round(lat, 3), round(lon, 3), hash(key))
    hit = _cache.get(ck)
    if hit and not refresh and time.time() - hit[0] < TTL:
        return {**hit[1], "cache": "cached"}
    if provider == "open-meteo":
        data = await open_meteo(client, lat, lon)
    elif provider == "weathernext2":
        data = await weathernext(client, lat, lon)
    elif provider == "openweathermap":
        data = await openweathermap(client, lat, lon, key)
    elif provider == "weatherapi":
        data = await weatherapi(client, lat, lon, key)
    else:
        data = await tomorrow(client, lat, lon, key, await utc_offset(client, lat, lon))
    if not data["hourly"] and not data["daily"]:
        raise ValueError("The provider returned no forecast rows.")
    data.update({"provider": provider, "label": spec["label"], "license": spec["license"], "docs": spec["docs"],
                 "retrieved_at": datetime.now(timezone.utc).isoformat(), "units": UNITS})
    _cache[ck] = (time.time(), data)
    return {**data, "cache": "refreshed"}


UNITS = {"temperature": "°C", "precipitation": "mm", "wind": "m/s", "pressure": "hPa (mean sea level)", "humidity": "%",
         "probability": "%", "uv": "UV index"}


# ---------------------------------------------------------------- ensemble probabilities
async def ensemble(client, lat, lon, model: str = "ecmwf_ifs025") -> dict:
    ck = ("ens", model, round(lat, 3), round(lon, 3))
    hit = _cache.get(ck)
    if hit and time.time() - hit[0] < TTL * 2:
        return hit[1]
    d, url = await _get(client, "https://ensemble-api.open-meteo.com/v1/ensemble", {
        "latitude": lat, "longitude": lon, "hourly": "temperature_2m,precipitation,wind_speed_10m", "models": model,
        "timezone": "auto", "forecast_days": 15, "wind_speed_unit": "ms", "timeformat": "unixtime"})
    off = int(d["utc_offset_seconds"])
    h = d["hourly"]
    times = pd.to_datetime(np.array(h["time"], dtype="int64") + off, unit="s")

    def members(var):
        cols = [k for k in h if k == var or re.fullmatch(rf"{var}_member\d+", k)]
        return np.array([[np.nan if v is None else v for v in h[c]] for c in cols], dtype=float)
    temp, rain, wind = members("temperature_2m"), members("precipitation"), members("wind_speed_10m")
    day = times.normalize()
    out = []
    for dte in pd.unique(day):
        m = day == dte
        if m.sum() < 24 or np.isnan(temp[:, m]).any():
            continue  # only complete local days (first/last day are often partial)
        tmax, tmin = temp[:, m].max(1), temp[:, m].min(1)
        psum = np.nansum(rain[:, m], 1) if not np.isnan(rain[:, m]).all() else np.full(len(rain), np.nan)
        wmean = wind[:, m].mean(1)
        out.append({"date": pd.Timestamp(dte).date().isoformat(), "members": int(len(tmax)),
                    "t_max": np.percentile(tmax, [10, 50, 90]).round(2).tolist(),
                    "t_min": np.percentile(tmin, [10, 50, 90]).round(2).tolist(),
                    "precip": np.percentile(psum, [10, 50, 90]).round(2).tolist(),
                    "p_precip_1mm": float(np.mean(psum >= 1)), "p_precip_10mm": float(np.mean(psum >= 10)),
                    "_tmax": tmax, "_tmin": tmin, "_psum": psum, "_wind": wmean})
    result = {"model": ENSEMBLES[model]["label"], "model_id": model, "kind": ENSEMBLES[model]["kind"], "members": int(temp.shape[0]), "days": out,
              "source_url": url, "license": ENSEMBLES[model]["license"], "utc_offset_seconds": off,
              "elevation": num(d.get("elevation"))}
    _cache[ck] = (time.time(), result)
    return result


# ---------------------------------------------------------------- climate context from NASA POWER
def climatology(payload: dict, dates: list[str], window: int = 7) -> dict:
    fill = payload.get("header", {}).get("fill_value", -999)
    p = payload["properties"]["parameter"]

    def series(k):
        s = pd.Series(p[k], dtype=float)
        s.index = pd.to_datetime(s.index, format="%Y%m%d")
        s = s.mask((s == fill) | ~np.isfinite(s))
        return s[(s.index.year >= NORMAL[0]) & (s.index.year <= NORMAL[1])]
    tx, tn, pr, ws = series("T2M_MAX"), series("T2M_MIN"), series("PRECTOTCORR").clip(lower=0), series("WS10M")
    doy = tx.index.day_of_year.values
    out = {}
    for d in dates:
        target = date.fromisoformat(d).timetuple().tm_yday
        dist = np.minimum(np.abs(doy - target), 366 - np.abs(doy - target))
        m = dist <= window
        x, n, r, w = tx[m].dropna(), tn[m].dropna(), pr[m].dropna(), ws[m].dropna()
        wet = r[r >= 1]
        if len(x) < 200:
            continue
        out[d] = {"t_max_p10": float(x.quantile(.1)), "t_max_p50": float(x.quantile(.5)), "t_max_p90": float(x.quantile(.9)),
                  "t_min_p10": float(n.quantile(.1)), "t_min_p90": float(n.quantile(.9)),
                  "wet_p95": float(wet.quantile(.95)) if len(wet) >= 20 else None,
                  "wet_p99": float(wet.quantile(.99)) if len(wet) >= 50 else None,
                  "wind_p95": float(w.quantile(.95)) if len(w) else None, "samples": int(len(x))}
    return out


def _runs(flags: list[bool], min_len: int) -> list[tuple[int, int]]:
    runs, start = [], None
    for i, f in enumerate(flags + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start >= min_len:
                runs.append((start, i - 1))
            start = None
    return runs


def detect_events(daily: list[dict], clim: dict, shift: float, ens: dict | None) -> dict:
    """Event-detection matrix applied to the forecast (heatwave, cold wave, heavy rain, strong wind)."""
    rows = []
    for d in daily:
        c = clim.get(d["date"])
        if not c or d.get("t_max") is None:
            continue
        hot = c["t_max_p90"] + shift
        cold = c["t_min_p10"] + shift
        rows.append({**d, "hot_threshold": round(hot, 2), "cold_threshold": round(cold, 2), "normal_t_max": round(c["t_max_p50"] + shift, 2),
                     "wet_threshold": c["wet_p95"], "wet_extreme": c["wet_p99"], "wind_threshold": c["wind_p95"],
                     "hot": d["t_max"] >= hot, "cold": d.get("t_min") is not None and d["t_min"] <= cold,
                     "heavy": c["wet_p95"] is not None and (d.get("precip_sum") or 0) >= c["wet_p95"]})
    events = []
    for a, b in _runs([r["hot"] for r in rows], 3):
        seg = rows[a:b + 1]
        # WMO usage: a heatwave in the warm season, a "warm spell" when the local hot threshold is below 25 °C.
        events.append({"type": "heatwave" if seg[0]["hot_threshold"] >= 25 else "warm_spell", "start": seg[0]["date"], "end": seg[-1]["date"], "days": len(seg),
                       "peak": max(r["t_max"] for r in seg), "threshold": seg[0]["hot_threshold"],
                       "rule": "≥3 consecutive days with daily maximum ≥ local 1991–2020 90th percentile (±7-day window)"})
    for a, b in _runs([r["cold"] for r in rows], 3):
        seg = rows[a:b + 1]
        events.append({"type": "cold_wave" if seg[0]["cold_threshold"] <= 0 else "cold_spell", "start": seg[0]["date"], "end": seg[-1]["date"], "days": len(seg),
                       "peak": min(r["t_min"] for r in seg), "threshold": seg[0]["cold_threshold"],
                       "rule": "≥3 consecutive days with daily minimum ≤ local 1991–2020 10th percentile"})
    for r in rows:
        if r["heavy"]:
            extreme = r["wet_extreme"] is not None and r["precip_sum"] >= r["wet_extreme"]
            events.append({"type": "extreme_rain" if extreme else "heavy_rain", "start": r["date"], "end": r["date"], "days": 1,
                           "peak": r["precip_sum"], "threshold": r["wet_extreme"] if extreme else r["wet_threshold"],
                           "rule": f"Daily total ≥ local wet-day {'99th' if extreme else '95th'} percentile (1991–2020)"})
    probabilities = []
    if ens:
        for e in ens["days"]:
            c = clim.get(e["date"])
            if not c:
                continue
            probabilities.append({"date": e["date"], "p_hot": float(np.mean(e["_tmax"] >= c["t_max_p90"] + shift)),
                                  "p_cold": float(np.mean(e["_tmin"] <= c["t_min_p10"] + shift)),
                                  "p_heavy": float(np.mean(e["_psum"] >= c["wet_p95"])) if c["wet_p95"] is not None else None,
                                  "p_windy": float(np.mean(e["_wind"] >= c["wind_p95"])) if c["wind_p95"] is not None else None})
        # probability of a heatwave = share of members that contain a ≥3-day hot run
        matched = [(e, clim[e["date"]]) for e in ens["days"] if e["date"] in clim]
        if len(matched) >= 3:
            hot = np.array([e["_tmax"] >= c["t_max_p90"] + shift for e, c in matched])  # days × members
            cold = np.array([e["_tmin"] <= c["t_min_p10"] + shift for e, c in matched])
            run = lambda mat: float(np.mean([bool(_runs(list(mat[:, k]), 3)) for k in range(mat.shape[1])]))
            ens_summary = {"p_heatwave": run(hot), "p_cold_wave": run(cold),
                           "hot_label": "heatwave" if matched[0][1]["t_max_p90"] + shift >= 25 else "warm spell",
                           "cold_label": "cold wave" if matched[0][1]["t_min_p10"] + shift <= 0 else "cold spell", "days": len(matched),
                           "window": [matched[0][0]["date"], matched[-1][0]["date"]]}
        else:
            ens_summary = None
    else:
        ens_summary = None
    return {"days": rows, "events": events, "probabilities": probabilities, "ensemble_summary": ens_summary}


# ---------------------------------------------------------------- hazards
async def air_quality(client, lat, lon) -> dict:
    d, url = await _get(client, "https://air-quality-api.open-meteo.com/v1/air-quality", {
        "latitude": lat, "longitude": lon, "current": "us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide",
        "hourly": "us_aqi", "timezone": "auto", "forecast_days": 2, "timeformat": "unixtime"})
    c = d.get("current", {})
    now = time.time()
    nxt = [num(v) for t, v in zip(d["hourly"]["time"], d["hourly"]["us_aqi"]) if now <= t <= now + 86400 and v is not None]
    aqi = num(c.get("us_aqi"))
    band = None if aqi is None else next(label for limit, label in [(50, "Good"), (100, "Moderate"), (150, "Unhealthy for sensitive groups"),
                                                                     (200, "Unhealthy"), (300, "Very unhealthy"), (1e9, "Hazardous")] if aqi <= limit)
    return {"us_aqi": aqi, "band": band, "european_aqi": num(c.get("european_aqi")), "pm2_5": num(c.get("pm2_5")), "pm10": num(c.get("pm10")),
            "ozone": num(c.get("ozone")), "no2": num(c.get("nitrogen_dioxide")), "max_us_aqi_24h": max(nxt) if nxt else None,
            "units": "µg/m³", "model": "CAMS (Copernicus Atmosphere Monitoring Service) via Open-Meteo", "source_url": url,
            "license": "CC BY 4.0 · Copernicus / Open-Meteo.com"}


async def nws_alerts(client, lat, lon) -> list[dict]:
    if not (17 <= lat <= 72 and -180 <= lon <= -64):
        return []  # api.weather.gov covers the United States and its territories only
    try:
        d, _ = await _get(client, "https://api.weather.gov/alerts/active", {"point": f"{lat:.4f},{lon:.4f}"},
                          headers={"Accept": "application/geo+json"})
    except Exception:
        return []
    out = []
    for f in d.get("features", [])[:10]:
        p = f.get("properties", {})
        out.append({"source": "US National Weather Service", "event": p.get("event"), "severity": p.get("severity"),
                    "headline": p.get("headline"), "description": (p.get("description") or "")[:1200],
                    "effective": p.get("effective"), "expires": p.get("expires"), "url": p.get("@id")})
    return out


def _km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


async def fires(client, lat, lon, radius_deg: float = 1.0) -> dict | None:
    key = keystore.get("nasa_firms")
    if not key:
        return None
    w, s, e, n = max(-180, lon - radius_deg), max(-90, lat - radius_deg), min(180, lon + radius_deg), min(90, lat + radius_deg)
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_SNPP_NRT/{w:.3f},{s:.3f},{e:.3f},{n:.3f}/2"
    r = await client.get(url, timeout=30)
    if r.status_code in (401, 403) or r.text.lower().startswith("invalid"):
        raise PermissionError("NASA FIRMS rejected the MAP_KEY.")
    r.raise_for_status()
    lines = [l for l in r.text.strip().splitlines() if l]
    if not lines or "latitude" not in lines[0]:
        raise ValueError("Unexpected FIRMS response.")
    head = lines[0].split(",")
    rows = [dict(zip(head, l.split(","))) for l in lines[1:]]
    pts = []
    for x in rows:
        try:
            la, lo = float(x["latitude"]), float(x["longitude"])
        except (KeyError, ValueError):
            continue
        pts.append({"latitude": la, "longitude": lo, "distance_km": round(_km(lat, lon, la, lo), 1), "frp": num(x.get("frp")),
                    "confidence": x.get("confidence"), "acquired": f"{x.get('acq_date')} {x.get('acq_time')}"})
    pts.sort(key=lambda p: p["distance_km"])
    return {"count": len(pts), "nearest_km": pts[0]["distance_km"] if pts else None,
            "max_frp": max((p["frp"] for p in pts if p["frp"] is not None), default=None), "points": pts[:150],
            "box_deg": radius_deg, "days": 2, "sensor": "VIIRS S-NPP near-real-time 375 m", "source_url": redact(url),
            "license": "NASA FIRMS · LANCE; free and open"}


def public_ensemble(ens: dict | None) -> dict | None:
    if not ens:
        return None
    return {**ens, "days": [{k: v for k, v in d.items() if not k.startswith("_")} for d in ens["days"]]}


BRIEF_SYSTEM = ("You are a careful operational forecaster writing for the public. Use only the facts given. "
                "Never invent numbers, places or warnings. Do not mention data sources or models unless asked. "
                "If no hazard is listed, say conditions look ordinary for the season.")


def brief_prompt(name: str, fc: dict, ctx: dict, aq: dict | None, alerts: list[dict]) -> str:
    # Most important facts first: small models weight the start of the prompt most.
    lines = [f"Place: {name}. Temperatures °C, rain mm, wind m/s."]
    if alerts:
        lines.append("OFFICIAL ALERTS (mention first): " + "; ".join(a.get("event") or a.get("headline") or "alert" for a in alerts[:5]) + ".")
    if ctx["events"]:
        lines.append("UNUSUAL FOR THIS PLACE (compared with its 1991–2020 climate; you must mention these):")
        for e in ctx["events"]:
            what = e["type"].replace("_", " ")
            unit = "mm" if "rain" in e["type"] else "°C"
            lines.append(f"- {what} from {e['start']} to {e['end']} ({e['days']} days), peak {round(e['peak'], 1)} {unit}, "
                         f"above the local threshold of {round(e['threshold'], 1)} {unit}")
    else:
        lines.append("UNUSUAL FOR THIS PLACE: nothing; the forecast is within the normal range for the season.")
    es = ctx.get("ensemble_summary")
    if es:
        lines.append(f"Ensemble chance of a {es['hot_label']} in the next {es['days']} days: {round(es['p_heatwave'] * 100)}%; "
                     f"of a {es['cold_label']}: {round(es['p_cold_wave'] * 100)}%.")
    normal = {r["date"]: r["normal_t_max"] for r in ctx["days"]}
    lines.append("Daily forecast (normal max for the date in brackets):")
    for d in fc["daily"][:7]:
        lines.append(f"- {d['date']}: {d.get('description') or ''}; max {d['t_max']} (normal {normal.get(d['date'], 'n/a')}), "
                     f"min {d['t_min']}, rain {d.get('precip_sum')}, rain chance {d.get('precip_probability')}%, max wind {d.get('wind_max')}")
    if aq and aq.get("us_aqi") is not None:
        lines.append(f"Air quality now: US AQI {round(aq['us_aqi'])} ({aq['band']}).")
    lines += ["", "Write exactly three labelled lines, one or two sentences each:",
              "NEXT 48 HOURS: what to expect.", "THIS WEEK: the main pattern, and whether it is unusual for this place (use the UNUSUAL section).",
              "WATCH: hazards or precautions from the facts above, or say none stand out."]
    return "\n".join(lines)


def parse_brief(text: str) -> dict:
    keys = {"NEXT 48 HOURS": "next_48h", "THIS WEEK": "week", "WATCH": "watch"}
    out, cur = {}, None
    for line in text.replace("**", "").splitlines():
        line = line.strip(" -*#")
        hit = next((k for k in keys if line.upper().startswith(k)), None)
        if hit:
            cur = keys[hit]
            out[cur] = line[len(hit):].lstrip(" :").strip()
        elif cur and line:
            out[cur] = (out[cur] + " " + line).strip()
    return out
