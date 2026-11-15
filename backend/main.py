# SI disclosure: written with AI assistance (Anthropic Claude Code), reviewed and tested by the team. See AI_USE.md.
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
import asyncio
import hashlib
import json
import os
import time
import math
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from .science import analyze, PARAMETERS, PROVIDER_UNITS

CACHE = Path(os.getenv("EARTH_CACHE_DIR", str(Path(__file__).parent / ".cache")))
POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
locks: dict[str, asyncio.Lock] = {}

@asynccontextmanager
async def lifespan(app):
    CACHE.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=120, follow_redirects=True, headers={"User-Agent": "EarthSystemTrendDetective/1.0 NASA-Space-Apps-Research"}) as client:
        app.state.client = client
        yield

app = FastAPI(title="Earth System Trend Detective", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"], allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["*"])

@app.get("/api/health")
def health():
    return {"status": "ok", "providers": {"power": "connected on request", "gibs": "direct public WMS", "aifs": "official ECMWF open-data client; downloaded on request"}}

@app.get("/api/weather")
async def weather(lead: int = Query(default=6, ge=0, le=72), run: str | None = Query(default=None, pattern=r"^\d{10}$"), refresh: bool = False):
    from .weather import fetch_weather
    if lead % 6:
        raise HTTPException(422, "AIFS is available in six-hour forecast steps.")
    try:
        return await asyncio.to_thread(fetch_weather, CACHE, lead, run, refresh)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("ECMWF weather request failed")
        raise HTTPException(503, "Verified ECMWF AIFS fields are unavailable for this run. No replacement weather was generated. Try another forecast step or retry.") from exc

@app.get("/api/investigate")
async def investigate(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180), start: int = Query(default=2001, ge=1981), end: int = Query(default=2024, ge=1981), parameter: str = "T2M", refresh: bool = False):
    if parameter not in PARAMETERS:
        raise HTTPException(422, "Supported parameters: " + ", ".join(sorted(PARAMETERS)))
    if start > end or end >= date.today().year:
        raise HTTPException(422, "Use an ordered range of complete historical years, ending before the current year.")
    if end - start > 44:
        raise HTTPException(422, "Select at most 45 years per investigation.")
    cached, cache_status = await get_power_record(latitude, longitude, start, end, refresh)
    result = await asyncio.to_thread(analyze, cached["payload"], parameter, start, end)
    return {**result, "request": {"latitude": round(latitude, 4), "longitude": round(longitude, 4), "start": start, "end": end, "parameter": parameter}, "checked_at": datetime.now(timezone.utc).isoformat(), "cache_status": cache_status, "source": "NASA POWER · MERRA-2-derived historical estimates", "source_url": cached["source_url"], "retrieved_at": cached["retrieved_at"]}

@app.get("/api/scan")
async def change_scan(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180), start: int = Query(default=1981, ge=1981), end: int = Query(default=2024, ge=1981)):
    """Change Scanner: all 8 NASA POWER variables at one place, tested and ranked in one pass."""
    from .scan import scan
    if start > end or end >= date.today().year:
        raise HTTPException(422, "Use an ordered range of complete historical years, ending before the current year.")
    if end - start > 44 or end - start < 9:
        raise HTTPException(422, "Select between 10 and 45 years.")
    cached, cache_status = await get_power_record(latitude, longitude, start, end)
    result = await asyncio.to_thread(scan, cached["payload"], start, end)
    return _clean({**result, "request": {"latitude": round(latitude, 4), "longitude": round(longitude, 4), "start": start, "end": end},
                   "checked_at": datetime.now(timezone.utc).isoformat(), "cache_status": cache_status,
                   "source": "NASA POWER · MERRA-2-derived daily estimates", "source_url": cached["source_url"], "retrieved_at": cached["retrieved_at"]})

@app.get("/api/satellite")
async def satellite_evidence(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180)):
    """NASA MODIS (Terra) series at a point via Microsoft Planetary Computer, tested like the POWER variables,
    plus an independent cross-check of POWER air-temperature trends against satellite land-surface temperature."""
    from .satellite import satellite
    last = date.today().year - 1
    try:
        cached, _ = await get_power_record(latitude, longitude, 1981, last)
        payload = cached["payload"]
    except Exception:
        payload = None
    try:
        result = await satellite(app.state.client, CACHE, round(latitude, 3), round(longitude, 3), last, payload)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Planetary Computer request failed")
        raise HTTPException(503, "NASA MODIS series from Microsoft Planetary Computer are unavailable right now. No replacement values were generated. Retry later.") from exc
    if not result["variables"]:
        raise HTTPException(404, "No MODIS land observations at this point (open water or outside the land products).")
    return _clean({**result, "request": {"latitude": round(latitude, 4), "longitude": round(longitude, 4)},
                   "checked_at": datetime.now(timezone.utc).isoformat(),
                   "source": "NASA MODIS Terra C6.1 · Microsoft Planetary Computer", "source_url": "https://planetarycomputer.microsoft.com/catalog"})

@app.get("/api/pc/tiles")
async def planetary_computer_tiles(kind: str, year: int | None = None):
    """XYZ tile template for a Microsoft Planetary Computer layer (land cover by year, JRC surface water)."""
    from . import pc
    if kind not in pc.LAYERS:
        raise HTTPException(404, "Unknown layer. Use: " + ", ".join(pc.LAYERS))
    try:
        return await pc.tiles(app.state.client, kind, year)
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Microsoft Planetary Computer is unreachable right now. Retry later.") from exc

async def get_power_record(latitude: float, longitude: float, start: int, end: int, refresh: bool = False):
    # Fetch every supported parameter once; switching variables reuses the same original response.
    params = {"parameters": ",".join(sorted(PARAMETERS)), "community": "AG", "latitude": round(latitude, 4), "longitude": round(longitude, 4), "start": f"{start}0101", "end": f"{end}1231", "format": "JSON", "time-standard": "UTC"}
    key = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
    file = CACHE / f"power-{key}.json"
    cache_status = "cached"
    async with locks.setdefault(key, asyncio.Lock()):
        try:
            if not refresh and file.exists() and time.time() - file.stat().st_mtime < 86400 * 30:
                # Parse and validate off the event loop: maps read ~100 multi-MB cached records.
                cached = await asyncio.to_thread(_read_cached_power, file, params)
            else:
                response = await app.state.client.get(POWER, params=params)
                response.raise_for_status()
                payload = response.json()
                await asyncio.to_thread(validate_power, payload, params)
                cached = {"payload": payload, "source_url": str(response.url), "retrieved_at": datetime.now(timezone.utc).isoformat()}
                cache_status = "refreshed"
                temporary = file.with_suffix(".tmp")
                temporary.write_text(json.dumps(cached))
                temporary.replace(file)
        except (httpx.HTTPError, ValueError, OSError, KeyError, TypeError) as exc:
            raise HTTPException(503, "NASA POWER data is unavailable. No substitute data was generated. Please retry later.") from exc
    return cached, cache_status

def _read_cached_power(file: Path, params: dict) -> dict:
    cached = json.loads(file.read_text())
    validate_power(cached["payload"], params)
    return cached

def validate_power(payload: dict, params: dict):
    """Reject wrong locations, dates, units, and non-numeric provider responses before caching."""
    coordinates = payload.get("geometry", {}).get("coordinates", [])
    if len(coordinates) < 2 or abs(coordinates[0] - params["longitude"]) > .001 or abs(coordinates[1] - params["latitude"]) > .001:
        raise ValueError("NASA response location does not match the request")
    if payload.get("header", {}).get("time_standard") != "UTC":
        raise ValueError("NASA response is not UTC")
    if any(str(payload.get("header", {}).get(k)) != params[k] for k in ("start", "end")):
        raise ValueError("NASA response period does not match the request")
    values = payload.get("properties", {}).get("parameter", {})
    for name in PARAMETERS:
        unit = payload.get("parameters", {}).get(name, {}).get("units")
        if unit != PROVIDER_UNITS[name]:
            raise ValueError("Unexpected NASA parameter units")
        series = values.get(name)
        if not isinstance(series, dict) or not series:
            raise ValueError("NASA returned an empty parameter")
        for day, value in series.items():
            datetime.strptime(day, "%Y%m%d")
            if day < params["start"] or day > params["end"] or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError("NASA returned an invalid date or value")

@app.get("/api/search")
async def search(q: str = Query(min_length=2, max_length=100)):
    try:
        response = await app.state.client.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": q, "count": 6, "language": "en", "format": "json"})
        response.raise_for_status()
        return [{"name": p["name"], "country": p.get("country", ""), "latitude": p["latitude"], "longitude": p["longitude"]} for p in response.json().get("results", [])]
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(503, "Place search is unavailable. Select a saved location or click the globe.") from exc

@app.get("/api/imagery/availability")
async def imagery_availability():
    from .imagery import fetch_catalog
    try:
        async with locks.setdefault("gibs-catalog", asyncio.Lock()):
            return await fetch_catalog(CACHE, app.state.client)
    except Exception as exc:
        raise HTTPException(503, "NASA imagery catalog check failed. Retain the last dated catalog and retry later.") from exc


from .regions import ComparisonRequest, compare_regions

@app.post("/api/regions/compare")
async def regional_comparison(request: ComparisonRequest):
    try:
        return await compare_regions(request, get_power_record)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Regional analysis failed")
        raise HTTPException(503, "Regional source data could not be verified. No replacement values were generated. Retry the calculation.") from exc


from .trendmap import TrendMapRequest, trend_map, progress as trend_map_progress

@app.post("/api/regions/trend-map")
async def regional_trend_map(request: TrendMapRequest):
    try:
        return _clean(await trend_map(request, get_power_record))
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Trend map failed")
        raise HTTPException(503, "The trend map could not be computed from verified source data. No replacement values were generated. Retry the map.") from exc

@app.get("/api/regions/trend-map/progress")
def regional_trend_map_progress(id: str = Query(max_length=64, pattern=r"^[A-Za-z0-9_-]+$")):
    return trend_map_progress.get(id) or {"done": 0, "total": 0, "failed": 0}


# ----------------------------------------------------------------------------- AI layer (on demand only)
from pydantic import BaseModel as _BaseModel, Field as _Field
from typing import Literal as _Literal


class AIRequest(_BaseModel):
    latitude: float = _Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = _Field(ge=-180, le=180, allow_inf_nan=False)
    name: str = _Field(default="Selected location", max_length=120)
    outlook: _Literal["auto", "force", "off"] = "auto"


def _clean(value):
    """JSON-safe: NaN/inf become null."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return value


@app.get("/api/ai/status")
def ai_status():
    from .ai import engine, laya_system1, outlook, similarity
    try:
        lib = engine.library()
        library = {"episodes": len(lib["episodes"]), "anchors": len(lib["anchors"]), "built_at": lib["built_at"], "end_year": lib["end_year"]}
    except FileNotFoundError:
        library = None
    ok, why = laya_system1.available()
    tuned = (laya_system1.TUNED / "model.safetensors").exists()
    evaluation = None
    if tuned:
        evaluation = json.loads((laya_system1.TUNED / "earth_config.json").read_text()).get("evaluation")
    return {"library": library, "system1": {"available": ok, "reason": why, "weights": "fine-tuned" if tuned else "base",
            "loaded": laya_system1.model.cache_info().currsize > 0, "laya_needed": laya_system1.needs_laya(),
                          "evaluation": evaluation},
            "similarity": {"available": similarity.available()[0], "reason": similarity.available()[1],
                           "loaded": similarity.model.cache_info().currsize > 0,
                           "evaluation": (similarity.config() or {}).get("evaluation")},
            "system2": outlook.public()}


@app.post("/api/ai/warmup")
async def ai_warmup():
    """Load Laya into memory when the user opens the AI panel (it is never loaded at startup)."""
    from .ai import laya_system1, similarity
    ok, why = laya_system1.available()
    if not ok:
        raise HTTPException(503, why)
    if laya_system1.needs_laya():
        await asyncio.to_thread(laya_system1.model)
    if similarity.available()[0]:
        await asyncio.to_thread(similarity.model)
    return {"loaded": True, "laya": laya_system1.needs_laya(), "similarity": similarity.available()[0]}


@app.post("/api/ai/analyze")
async def ai_analyze(request: AIRequest):
    from .ai import engine, laya_system1, outlook, similarity
    try:
        lib = engine.library()
    except FileNotFoundError as exc:
        raise HTTPException(503, "The analog library has not been built. Run: backend/.venv/bin/python -m backend.ai.build_library") from exc
    end = lib["end_year"]
    cached, _ = await get_power_record(request.latitude, request.longitude, 1981, end)
    try:
        state = await asyncio.to_thread(engine.current_state, cached["payload"], end)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    found = await asyncio.to_thread(engine.retrieve, request.latitude, request.longitude, state)
    sig = state["signature"]
    try:
        system1 = await asyncio.to_thread(laya_system1.run, found["tectonics"]["plate"], state["baseline"], sig, request.latitude)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Laya scoring failed")
        system1 = {"status": "unavailable", "reason": f"{type(exc).__name__}: {exc}"[:300]}
    try:
        sim = await asyncio.to_thread(similarity.run, state, request.latitude, request.longitude, found["tectonics"]["searched_plates"])
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Laya similarity failed")
        sim = {"status": "unavailable", "reason": f"{type(exc).__name__}: {exc}"[:300]}
    if sim.get("status") == "ok" and sim["analogs"]:
        found["analogs"] = sim["analogs"]          # Laya re-ranked the 40 nearest; these are its 5 most similar
    reasons, notes = [], []
    if sim.get("status") == "ok":
        if sim["passes"]:
            reasons.append(f"Laya's average resemblance score for the {len(sim['analogs'])} closest past episodes is "
                           f"{sim['average'] * 100:.0f}% (≥ {sim['gate'] * 100:.0f}%), so the larger model explains the skill-verified outlook with these past matches as context.")
        else:
            notes.append(f"Laya's average resemblance score is {sim['average'] * 100:.0f}%, below the {sim['gate'] * 100:.0f}% gate: "
                         "past episodes are not close enough to use as context.")
    if found["percentile"] is not None and math.isfinite(found["percentile"]) and found["percentile"] >= engine.ESCALATE_PERCENTILE:
        reasons.append(f"Trend magnitude exceeds {min(found['percentile'], 99.9):.1f}% of {found['pool_size']} historical episodes on the searched plates.")
    if sig["n_significant"] >= 4:
        reasons.append(f"{sig['n_significant']} of 9 climate indices show significant trends.")
    if system1.get("status") == "ok":
        for key, o in system1["outlook"].items():
            p, base = o["probabilities"]["rise"], o["climatology"]["rise"]
            # Only skill-verified answers can escalate, and only when clearly above the usual rate.
            if o["skilful"] and key != "t_mean" and p >= .5 and p >= 1.5 * base:
                who = "Laya" if o["source"] == "laya" else "The System-1 linear model"
                reasons.append(f"{who} gives a {p * 100:.0f}% chance that {o['label']} rises over the next 5 years (usually {base * 100:.0f}%; skill verified on held-out sites).")
    if sim.get("status") == "ok":
        # The similarity gate decides; the other signals are reported as context only.
        notes += [r for r in reasons if not r.startswith("Laya's average")]
        reasons = [r for r in reasons if r.startswith("Laya's average")]
    escalate = bool(reasons)
    context = {"location": request.name, "latitude": request.latitude, "longitude": request.longitude, "signature": sig,
               **found, "system1": system1, "similarity": sim}
    result = None
    system2 = outlook.public()
    if request.outlook == "force" or (request.outlook == "auto" and escalate and system2["cloud"]):
        result = await asyncio.to_thread(outlook.generate, context)
    elif request.outlook == "auto" and escalate:
        # The gate hands over to the larger cloud model; without one, wait for the user instead of
        # passing a close match to the small local model.
        result = {"status": "needs_cloud", "provider": system2["provider"], "model": system2["model"], "cloud": False,
                  "grounded": outlook.grounded_summary(context), "confidence": outlook.confidence_rating(context)}
    return _clean({"request": request.model_dump(), "checked_at": datetime.now(timezone.utc).isoformat(),
                   "window": [sig["start"], sig["end"]], "signature": {**sig, "trends": engine.describe_trends(sig)},
                   "regime_rule": {"id": sig["regime"], "label": engine.S.REGIMES[sig["regime"]]},
                   "baseline": state["baseline"], "annual": state["annual"], "years": state["years"],
                   "tectonics": found["tectonics"], "analogs": found["analogs"], "percentile": found["percentile"], "pool_size": found["pool_size"],
                   "rule_severity": {"level": found["rule_severity"], "label": engine.SEVERITY[found["rule_severity"]]},
                   "system1": system1, "similarity": {k: v for k, v in sim.items() if k != "analogs"},
                   "escalation": {"escalate": escalate, "reasons": reasons, "notes": notes, "threshold_percentile": engine.ESCALATE_PERCENTILE,
                                  "gate": "laya_similarity" if sim.get("status") == "ok" else "rules", "system2": system2},
                   "outlook": result, "source": "NASA POWER daily (MERRA-2-derived) · PB2002 plates · Laya System-1 · LLM System-2",
                   "source_url": cached["source_url"], "retrieved_at": cached["retrieved_at"],
                   "limitations": ["Analogs are statistical neighbours within a tectonic neighbourhood; plates scope the search, they are not a claimed climate driver.",
                                   "Laya's resemblance score estimates the share of the 9 trend changes that look alike in a past episode; it is resemblance, not forecast skill or a probability. At ≥70% the LLM explains the skill-verified System-1 outlook with those episodes as context; it is told not to derive directions from them, and sentences that give a direction for an unverified question are removed.",
                                   "System-1's 5-year probabilities come from a linear model evaluated on a horizon-purged split (every training outcome observed before the first test forecast; test sites held out). They are shown as outlooks only where their skill beat the climatology baseline on later outcomes (2016–2024) at unseen sites (95% site-bootstrap interval above zero). Skill is modest; they are odds, not certainties, and not a climate projection.",
                                   "The LLM outlook is generated text from the numbers above and must be checked against them.",
                                   "Indices use NASA POWER grid estimates (~0.5°×0.625°), not station observations; thresholds are local percentiles."]})


# ---------------------------------------------------------------- forecasts & API keys
from fastapi import Request
from pydantic import BaseModel as _BaseModel, Field as _Field
from . import forecast as fc, keystore


def _local_only(request: Request):
    """Key management is only served to this computer, never to another host on the network."""
    if os.getenv("EARTH_PUBLIC_MODE", "").lower() in ("1", "true", "yes"):
        raise HTTPException(403, "Key management is disabled on the public demo. Configure server secrets at the host.")
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(403, "API keys can only be managed from this computer.")
    if request.headers.get("x-earth-client") != "1":
        # A custom header forces a CORS preflight, so other websites open in the browser cannot call these endpoints.
        raise HTTPException(403, "Missing client header.")


@app.get("/api/settings/keys")
def list_keys(request: Request):
    _local_only(request)
    return {"providers": keystore.status(), "file": str(keystore.FILE.name),
            "storage": "Saved on this computer only, in backend/.secrets (owner-only permissions). Keys are never sent back to the browser."}


class KeyUpdate(_BaseModel):
    key: str | None = _Field(default=None, max_length=400)
    fields: dict[str, str] = _Field(default_factory=dict)


@app.put("/api/settings/keys/{provider}")
def save_key(provider: str, body: KeyUpdate, request: Request):
    _local_only(request)
    if provider not in keystore.PROVIDERS:
        raise HTTPException(404, "Unknown provider.")
    if body.key is not None and (not body.key.strip() or any(c.isspace() for c in body.key.strip())):
        raise HTTPException(422, "That does not look like an API key.")
    for name, value in body.fields.items():
        if name == "url" and value and not value.startswith(("https://", "http://127.0.0.1", "http://localhost")):
            raise HTTPException(422, "Use an https:// URL, or http:// only for a server on this computer.")
    keystore.put(provider, body.key, body.fields)
    fc._cache.clear()
    return next(p for p in keystore.status() if p["id"] == provider)


@app.delete("/api/settings/keys/{provider}")
def delete_key(provider: str, request: Request):
    _local_only(request)
    if provider not in keystore.PROVIDERS:
        raise HTTPException(404, "Unknown provider.")
    keystore.delete(provider)
    fc._cache.clear()
    return next(p for p in keystore.status() if p["id"] == provider)


@app.post("/api/settings/keys/{provider}/test")
async def test_key(provider: str, request: Request):
    _local_only(request)
    if provider not in keystore.PROVIDERS:
        raise HTTPException(404, "Unknown provider.")
    lat, lon = 51.4779, -0.0015  # Greenwich: a neutral, always-covered test point
    try:
        if provider in fc.PUBLIC:
            data = await fc.provider_forecast(app.state.client, provider, lat, lon, refresh=True)
            return {"ok": True, "message": f"Key works: {len(data['hourly'])} hourly and {len(data['daily'])} daily rows returned."}
        if provider == "nasa_firms":
            data = await fc.fires(app.state.client, lat, lon)
            return {"ok": True, "message": f"Key works: FIRMS answered ({data['count']} detections near the test point)."}
        from .ai import outlook
        cfg = outlook.config_for(provider)
        if cfg is None:
            return {"ok": False, "message": "Nothing saved for this entry yet." if provider == "anthropic"
                    else "Save a base URL and model name first."}
        text, pub = await asyncio.to_thread(outlook.complete, "Reply with the single word: ready", "You are a test endpoint.", 5, cfg)
        where = "cloud" if pub["cloud"] else "this computer"
        return {"ok": True, "message": f"{pub['model']} ({where}) answered: {text[:40]!r}"}
    except LookupError as exc:
        return {"ok": False, "message": str(exc)}
    except PermissionError as exc:
        return {"ok": False, "message": str(exc)}
    except Exception as exc:
        return {"ok": False, "message": f"The provider call failed ({type(exc).__name__}). Check the key, plan and network."}


@app.get("/api/forecast/providers")
def forecast_providers():
    ready = fc.configured()
    return {"providers": [{"id": pid, "label": s["label"], "configured": pid in ready, "needs_key": bool(s["key"]), "docs": s["docs"]}
                          for pid, s in fc.PUBLIC.items()]}


async def _power_context(latitude: float, longitude: float):
    end = date.today().year - 1  # same span as the AI layer, so the cached POWER record is shared
    cached, _ = await get_power_record(latitude, longitude, 1981, end)
    return cached["payload"]


@app.get("/api/forecast")
async def point_forecast(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180),
                         provider: str = "open-meteo", refresh: bool = False):
    client = app.state.client
    try:
        main_fc = await fc.provider_forecast(client, provider, latitude, longitude, refresh)
    except KeyError as exc:
        raise HTTPException(404, "Unknown forecast provider.") from exc
    except LookupError as exc:
        raise HTTPException(409, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(401, str(exc)) from exc
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Forecast provider failed")
        raise HTTPException(503, f"{fc.PUBLIC[provider]['label']} is unavailable right now. No substitute forecast was generated.") from exc
    unavailable = {}

    async def guarded(name, coro):
        try:
            return await coro
        except PermissionError as exc:
            unavailable[name] = str(exc)
        except HTTPException as exc:
            unavailable[name] = exc.detail
        except Exception as exc:
            unavailable[name] = f"{type(exc).__name__}"
        return None
    ens, aq, nws, fire, payload = await asyncio.gather(
        guarded("ensemble", fc.ensemble(client, latitude, longitude, "google_weathernext2_ensemble" if provider == "weathernext2" else "ecmwf_ifs025")),
        guarded("air_quality", fc.air_quality(client, latitude, longitude)),
        guarded("alerts", fc.nws_alerts(client, latitude, longitude)), guarded("fires", fc.fires(client, latitude, longitude)),
        guarded("climate", _power_context(latitude, longitude)))
    context = None
    if payload:
        dates = sorted({d["date"] for d in main_fc["daily"]} | {d["date"] for d in (ens or {}).get("days", [])})
        clim = await asyncio.to_thread(fc.climatology, payload, dates)
        coords = payload.get("geometry", {}).get("coordinates", [])
        power_elev = coords[2] if len(coords) > 2 and isinstance(coords[2], (int, float)) else None
        fc_elev = main_fc.get("elevation") if main_fc.get("elevation") is not None else (ens or {}).get("elevation")
        shift = fc.LAPSE * (power_elev - fc_elev) if power_elev is not None and fc_elev is not None else 0.0
        context = await asyncio.to_thread(fc.detect_events, main_fc["daily"], clim, shift, ens)
        context.update({"normal_period": list(fc.NORMAL), "power_elevation_m": power_elev, "forecast_elevation_m": fc_elev,
                        "lapse_shift_c": round(shift, 2), "method": "Thresholds are percentiles of this place's NASA POWER 1991–2020 daily record "
                        "within ±7 calendar days, shifted by 6.5 °C/km for the height difference between the POWER cell and the forecast point.",
                        "limitation": "POWER (MERRA-2, ~50 km) and forecast models differ in resolution and bias; flags are climate context, "
                        "not official warnings."})
    return _clean({"request": {"latitude": latitude, "longitude": longitude, "provider": provider},
                   "checked_at": datetime.now(timezone.utc).isoformat(), "forecast": main_fc, "ensemble": fc.public_ensemble(ens),
                   "climate_context": context, "air_quality": aq, "alerts": (main_fc.get("alerts") or []) + (nws or []),
                   "fires": fire, "unavailable": unavailable, "configured_providers": fc.configured()})


@app.get("/api/forecast/compare")
async def compare_forecasts(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180)):
    providers = fc.configured()

    async def one(p):
        try:
            d = await fc.provider_forecast(app.state.client, p, latitude, longitude)
            return {"provider": p, "label": d["label"], "daily": [{k: x.get(k) for k in ("date", "t_max", "t_min", "precip_sum", "precip_probability")}
                                                                    for x in d["daily"]]}
        except Exception as exc:
            return {"provider": p, "label": fc.PUBLIC[p]["label"], "error": str(exc) if isinstance(exc, (PermissionError, LookupError)) else type(exc).__name__}
    rows = await asyncio.gather(*(one(p) for p in providers))
    spread = {}
    for r in rows:
        for d in r.get("daily", []):
            if d["t_max"] is not None:
                spread.setdefault(d["date"], []).append(d["t_max"])
    return {"providers": rows, "t_max_spread": {k: {"min": min(v), "max": max(v), "range": round(max(v) - min(v), 2), "n": len(v)}
                                                for k, v in sorted(spread.items()) if len(v) > 1}}


class BriefRequest(_BaseModel):
    latitude: float = _Field(ge=-90, le=90)
    longitude: float = _Field(ge=-180, le=180)
    name: str = _Field(default="Selected place", max_length=120)
    provider: str = "open-meteo"


@app.post("/api/forecast/brief")
async def forecast_brief(body: BriefRequest):
    """On-demand plain-language briefing written by the System-2 LLM from the computed forecast facts only."""
    from .ai import outlook
    data = await point_forecast(body.latitude, body.longitude, body.provider, False)
    if not data.get("climate_context"):
        raise HTTPException(503, "Climate context is unavailable, so no grounded briefing can be written.")
    prompt = fc.brief_prompt(body.name, data["forecast"], data["climate_context"], data.get("air_quality"), data.get("alerts") or [])
    try:
        text, cfg = await asyncio.to_thread(outlook.complete, prompt, fc.BRIEF_SYSTEM, 220)
    except Exception as exc:
        raise HTTPException(503, f"The briefing model is unavailable ({type(exc).__name__}). The computed forecast is unaffected.") from exc
    sections, removed = outlook.guard_numbers(fc.parse_brief(text), prompt)
    return {"sections": sections, "removed_unsupported_sentences": removed, "model": cfg["model"], "provider": cfg["provider"],
            "facts": prompt.splitlines(), "generated_at": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------- production: serve the built frontend
# In development Vite serves the UI and proxies /api. In a single-container deployment the API serves
# dist/ itself (set EARTH_STATIC, default <repo>/dist). Mounted last so every /api route wins.
from fastapi.staticfiles import StaticFiles as _StaticFiles

_static = Path(os.getenv("EARTH_STATIC", str(Path(__file__).resolve().parent.parent / "dist")))
if _static.is_dir() and (_static / "index.html").exists():
    app.mount("/", _StaticFiles(directory=_static, html=True), name="frontend")

