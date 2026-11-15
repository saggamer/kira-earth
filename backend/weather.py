"""Real ECMWF AIFS fields, decoded server-side. Never supplies synthetic weather."""
from datetime import datetime, timezone
from pathlib import Path
import json
import threading
import time
import numpy as np
from scipy.ndimage import maximum_filter, minimum_filter
import contourpy

_lock = threading.Lock()
PARAMS = ["10u", "10v", "2t", "msl", "tcc", "tp"]

def pressure_geometry(longitudes, latitudes, pressure):
    """4 hPa isolines and separated modeled pressure extrema from a real grid."""
    p = np.asarray(pressure, dtype=float)
    generator = contourpy.contour_generator(x=longitudes, y=latitudes, z=np.ma.masked_invalid(p))
    valid = p[np.isfinite(p)]
    if valid.size == 0:
        return [], []
    contours = []
    for level in np.arange(np.ceil(valid.min() / 4) * 4, min(valid.max(), 1080) + 1, 4):
        for line in generator.lines(float(level)):
            if len(line) >= 5:
                contours.append({"value": float(level), "coordinates": np.round(line[::2] if len(line) > 400 else line, 3).tolist()})
    centers = []
    for label, comparison, order in [("H", maximum_filter(np.nan_to_num(p, nan=-1e6), size=19, mode=("nearest", "wrap")), -1), ("L", minimum_filter(np.nan_to_num(p, nan=1e6), size=19, mode=("nearest", "wrap")), 1)]:
        candidates = np.argwhere(np.isfinite(p) & (p == comparison))
        candidates = sorted(candidates, key=lambda ij: order * p[tuple(ij)])
        chosen = []
        for i, j in candidates:
            if abs(latitudes[i]) > 75:
                continue
            if any(abs(latitudes[i] - c["latitude"]) < 15 and min(abs(longitudes[j] - c["longitude"]), 360 - abs(longitudes[j] - c["longitude"])) < 20 for c in chosen):
                continue
            y0, y1 = max(0, i - 8), min(len(latitudes), i + 9)
            neighborhood=p[y0:y1][:, (np.arange(j-8,j+9) % p.shape[1])]
            if np.nanmax(neighborhood) - np.nanmin(neighborhood) < 2:
                continue
            chosen.append({"kind": label, "latitude": float(latitudes[i]), "longitude": float(longitudes[j]), "value": round(float(p[i, j]), 1)})
            if len(chosen) == 8:
                break
        centers.extend(chosen)
    return contours, centers

def decode_grib(path: Path, source_urls: list[str]) -> dict:
    import eccodes as ec
    arrays, units, initialization, valid_time, step, grid = {}, {}, None, None, None, None
    with path.open("rb") as file:
        while (gid := ec.codes_grib_new_from_file(file)) is not None:
            try:
                name = ec.codes_get(gid, "shortName")
                ni, nj = ec.codes_get(gid, "Ni"), ec.codes_get(gid, "Nj")
                if ni != 1440 or nj != 721:
                    raise ValueError(f"Unexpected AIFS grid: {ni}×{nj}; expected regular 0.25° grid")
                lat = np.asarray(ec.codes_get_array(gid, "latitudes")).reshape(nj, ni)
                lon = np.asarray(ec.codes_get_array(gid, "longitudes")).reshape(nj, ni)
                values = np.asarray(ec.codes_get_values(gid), dtype=float).reshape(nj, ni)
                if ec.codes_get(gid, "bitmapPresent"):
                    values[values == ec.codes_get(gid, "missingValue")] = np.nan
                values[~np.isfinite(values) | (np.abs(values) > 1e15)] = np.nan
                lat_idx = np.argsort(-lat[:, 0])[::4]
                normalized_lon = (lon[0] + 180) % 360 - 180
                lon_idx = np.argsort(normalized_lon)[::4]
                field = values[np.ix_(lat_idx, lon_idx)]
                native_unit = ec.codes_get(gid, "units")
                if name == "2t":
                    if native_unit != "K": raise ValueError("Unexpected temperature unit")
                    field -= 273.15
                elif name == "msl":
                    if native_unit != "Pa": raise ValueError("Unexpected pressure unit")
                    field /= 100
                elif name == "tp":
                    if native_unit in ("m", "m of water equivalent"): field *= 1000
                    elif native_unit not in ("kg m**-2", "kg m-2", "mm"): raise ValueError(f"Unexpected precipitation unit {native_unit}")
                    if ec.codes_get(gid, "stepType") != "accum" or int(ec.codes_get(gid, "startStep")) != 0:
                        raise ValueError("Precipitation is not an accumulation since initialization")
                    field = np.maximum(field, 0)
                elif name == "tcc":
                    if native_unit == "%": field /= 100
                    elif native_unit not in ("(0 - 1)", "Proportion", "1"): raise ValueError(f"Unexpected cloud fraction unit {native_unit}")
                    field = np.clip(field, 0, 1)
                if name in ("10u", "10v") and native_unit not in ("m s**-1", "m s-1", "m/s"):
                    raise ValueError("Unexpected wind unit")
                current_init = datetime.strptime(str(ec.codes_get(gid, "dataDate")) + f'{int(ec.codes_get(gid, "dataTime")):04d}', "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
                current_valid = datetime.strptime(str(ec.codes_get(gid, "validityDate")) + f'{int(ec.codes_get(gid, "validityTime")):04d}', "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
                if initialization is not None and (initialization != current_init or valid_time != current_valid):
                    raise ValueError("Mixed forecast initialization or valid time in GRIB")
                initialization, valid_time = current_init, current_valid
                step = int((valid_time - initialization).total_seconds() / 3600)
                arrays[name] = field
                units[name] = native_unit
                grid = {"width": len(lon_idx), "height": len(lat_idx), "west": float(normalized_lon[lon_idx[0]]), "north": float(lat[lat_idx[0], 0]), "dx": 1, "dy": 1}
            finally:
                ec.codes_release(gid)
    if set(PARAMS) - set(arrays):
        raise ValueError("AIFS GRIB is missing required fields: " + ", ".join(set(PARAMS) - set(arrays)))
    longitudes = grid["west"] + np.arange(grid["width"])
    latitudes = grid["north"] - np.arange(grid["height"])
    contours, centers = pressure_geometry(longitudes, latitudes, arrays["msl"])
    def serial(a):
        return [round(float(v), 3) if np.isfinite(v) else None for v in a.ravel()]
    names = {"10u": "u", "10v": "v", "2t": "temperature", "msl": "pressure", "tcc": "cloud", "tp": "precipitation"}
    return {"schema_version": 2, "model": "ECMWF AIFS Single", "category": "weather forecast", "initialization": initialization.isoformat(), "valid_time": valid_time.isoformat(), "lead_hours": step, "native_resolution": "0.25° regular grid", "display_resolution": "1° (every fourth source grid point; no added spatial detail)", "grid": grid, "fields": {names[k]: serial(a) for k, a in arrays.items()}, "units": {"u": "m/s", "v": "m/s", "temperature": "°C", "pressure": "hPa", "cloud": "fraction", "precipitation": "mm accumulated since initialization"}, "contours": contours, "centers": centers, "provenance": {"source_urls": source_urls, "native_units": units, "retrieved_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(), "processed_at": datetime.now(timezone.utc).isoformat(), "license": "ECMWF open data, CC BY 4.0", "processing": "Decode GRIB2 with ecCodes; temperature K→°C, pressure Pa→hPa, precipitation from declared GRIB units to mm; nearest source sampling to a 1° display grid", "animation": "Particles visualize an instantaneous modeled 10 m vector field at a visually accelerated speed. They are not observed trajectories.", "precipitation": "Accumulation since initialization; do not interpret as instantaneous rainfall rate."}}

def latest_initialization(cache: Path, lead: int, refresh: bool = False):
    """The pointer expires from the last provider check, never from a cache read."""
    from ecmwf.opendata import Client
    pointer = cache / "aifs-latest.json"
    if not refresh and pointer.exists() and time.time() - pointer.stat().st_mtime < 300:
        return datetime.strptime(json.loads(pointer.read_text())["run"], "%Y%m%d%H"), datetime.fromtimestamp(pointer.stat().st_mtime, timezone.utc).isoformat()
    client = Client(source="ecmwf", model="aifs-single", resol="0p25", maximum_retries=2, retry_after=2, use_server_retry_after=False)
    initialization = client.latest(type="fc", step=lead, param=PARAMS)
    temporary = pointer.with_suffix(".tmp")
    temporary.write_text(json.dumps({"run": initialization.strftime("%Y%m%d%H")}))
    temporary.replace(pointer)
    return initialization, datetime.now(timezone.utc).isoformat()

def fetch_weather(cache: Path, lead: int = 6, run: str | None = None, refresh: bool = False) -> dict:
    from ecmwf.opendata import Client
    if lead not in range(0, 73, 6):
        raise ValueError("Forecast lead must be 0–72 hours in 6-hour increments")
    with _lock:
        cache.mkdir(parents=True, exist_ok=True)
        checked_at = None
        if run:
            initialization = datetime.strptime(run, "%Y%m%d%H")
        else:
            initialization, checked_at = latest_initialization(cache, lead, refresh)
        stamp = initialization.strftime("%Y%m%d%H")
        processed = cache / f"aifs-{stamp}-{lead:03d}.json"
        if processed.exists():
            existing = json.loads(processed.read_text())
            if existing.get("schema_version") == 2:
                return {**existing, "latest_checked_at": checked_at}
        target = cache / f"aifs-{stamp}-{lead:03d}.grib2"
        client = Client(source="ecmwf", model="aifs-single", resol="0p25", maximum_retries=2, retry_after=2, use_server_retry_after=False)
        if not target.exists():
            partial = target.with_suffix(".partial")
            result = client.retrieve(date=initialization.date(), time=initialization.hour, step=lead, type="fc", param=PARAMS, target=str(partial))
            source_urls = [str(u) for u in result.urls]
            partial.replace(target)
        else:
            source_urls = [f"https://data.ecmwf.int/forecasts/{initialization:%Y%m%d}/{initialization:%H}z/aifs-single/0p25/oper/{initialization:%Y%m%d%H}0000-{lead}h-oper-fc.grib2"]
        output = decode_grib(target, source_urls)
        if output["lead_hours"] != lead or datetime.fromisoformat(output["initialization"]).strftime("%Y%m%d%H") != stamp:
            raise ValueError("Requested and decoded forecast times do not match")
        temporary = processed.with_suffix(".tmp")
        temporary.write_text(json.dumps(output, separators=(",", ":"), allow_nan=False))
        temporary.replace(processed)
        return {**output, "latest_checked_at": checked_at}
