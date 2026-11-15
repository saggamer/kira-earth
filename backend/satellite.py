"""Satellite evidence: NASA MODIS (Terra) time series at a point, via Microsoft Planetary Computer.

NASA POWER is a model-derived (MERRA-2) record. This module adds variables *measured by an Earth
science mission* and an independent check of the POWER trends:

  NDVI        vegetation greenness     modis-13A1-061   16-day, 500 m
  LST_DAY     land surface temp, day   modis-11A2-061    8-day, 1 km
  LST_NIGHT   land surface temp, night modis-11A2-061    8-day, 1 km
  ET          evapotranspiration       modis-16A3GF-061 yearly, 500 m (gap-filled)
  NPP         net primary productivity modis-17A3HGF-061 yearly, 500 m (gap-filled)

Access is anonymous: a STAC search is registered with the Planetary Computer data API and the
`/mosaic/{id}/point/{lon},{lat}` endpoint returns the pixel value from every item at the point.
Only Terra granules are used so the record comes from one sensor (2000–present). Raw integers are
scaled with the product's documented scale/offset; fill and out-of-range values are dropped, never
filled.

Quality policy (QA_POLICY, versioned in the cache key):
  LST   QC_Day / QC_Night bits 0–1 (mandatory QA) = 0 "good"; or = 1 "other quality" with bits 6–7
        (LST error) ≤ 2 K. Cloud / not-produced / larger-error pixels are rejected (MOD11A2 C6.1 spec).
  NDVI  pixel_reliability 0 (good) or 1 (marginal); 2 snow/ice and 3 cloudy are rejected (MOD13 C6.1).
  ET, NPP  provider gap-filled yearly products; their QC percentage is recorded and shown, not used
        as a filter (its meaning is product-specific), and the rows are labelled gap-filled.

Annual values (comparable seasons): accepted composites → calendar-month means → anomalies from each
calendar month's own mean. Months observed in fewer than half the years are masked for every year
(a fixed common-month mask); a year needs ≥ 10 of the remaining months. The annual value is the mean
seasonal cycle plus the mean monthly anomaly, so dropping a cold month cannot raise the annual value.
A complete-year sensitivity trend and per-month coverage are reported, and a warning is raised when
seasonal coverage shifts between the first and second half of the record. Clear-sky selection bias
inside a month (e.g. only cloud-free days observed) is not removed by this and is disclosed.
"""
from __future__ import annotations
import asyncio
import json
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path
import httpx
import numpy as np
from .science import fit_trend
from .scan import _monthly_anomalies, _residual_sigma, _seasonal, _seasonal_fdr, bh, permutation

PC = "https://planetarycomputer.microsoft.com/api"
QA_POLICY = "qa-v1"
FIRST = 2001
CACHE_DAYS = 30
CONCURRENCY = 6

PRODUCTS = {
    "NDVI": {"collection": "modis-13A1-061", "asset": "500m_16_days_NDVI", "scale": 1e-4, "offset": 0.0, "valid": (-2000, 10000),
             "unit": "NDVI", "name": "Vegetation greenness (NDVI)", "short": "NDVI", "mission": "MODIS Terra · 16-day composite · 500 m", "yearly": False,
             "qa": "500m_16_days_pixel_reliability"},
    "LST_DAY": {"collection": "modis-11A2-061", "asset": "LST_Day_1km", "scale": 0.02, "offset": -273.15, "valid": (7500, 65535),
                "unit": "°C", "name": "Land surface temperature (day)", "short": "Surface temp, day", "mission": "MODIS Terra · 8-day · 1 km", "yearly": False,
                "qa": "QC_Day"},
    "LST_NIGHT": {"collection": "modis-11A2-061", "asset": "LST_Night_1km", "scale": 0.02, "offset": -273.15, "valid": (7500, 65535),
                  "unit": "°C", "name": "Land surface temperature (night)", "short": "Surface temp, night", "mission": "MODIS Terra · 8-day · 1 km", "yearly": False,
                  "qa": "QC_Night"},
    "ET": {"collection": "modis-16A3GF-061", "asset": "ET_500m", "scale": 0.1, "offset": 0.0, "valid": (0, 32700),
           "unit": "mm/year", "name": "Evapotranspiration", "short": "Evapotranspiration", "mission": "MODIS Terra · yearly gap-filled · 500 m", "yearly": True,
           "qa": "ET_QC_500m"},
    "NPP": {"collection": "modis-17A3HGF-061", "asset": "Npp_500m", "scale": 0.1, "offset": 0.0, "valid": (-30000, 32700),
            "unit": "g C/m²/yr", "name": "Net primary productivity", "short": "Plant productivity", "mission": "MODIS Terra · yearly gap-filled · 500 m", "yearly": True,
            "qa": "Npp_QC_500m"},
}
# One request per collection and chunk of years (the point endpoint returns at most 100 items).
FETCH = {"modis-13A1-061": 4, "modis-11A2-061": 1, "modis-16A3GF-061": 40, "modis-17A3HGF-061": 40}
# Independent checks: a MODIS series against the NASA POWER variable that measures a related quantity.
CROSS = [("LST_DAY", "T2M_MAX", "Daytime heat: satellite land surface vs model air temperature"),
         ("LST_NIGHT", "T2M_MIN", "Night-time heat: satellite land surface vs model air temperature")]
_ID_DATE = re.compile(r"\.A(\d{4})(\d{3})\.")
MIN_MONTH_YEARS = 0.5      # a calendar month must be observed in ≥ half the years, else it is masked for all years
MIN_MONTHS = 10


def qa_ok(key: str, qa) -> tuple[bool, str]:
    """Product-specific pixel-quality decision. Returns (accepted, reason)."""
    if key.startswith("LST"):
        if qa is None:
            return False, "qa_missing"
        q = int(qa)
        mandatory, lst_err = q & 0b11, (q >> 6) & 0b11
        if mandatory == 0:
            return True, "good"
        if mandatory == 1 and lst_err <= 1:
            return True, "other_quality_err_le_2K"
        return False, "cloud_or_not_produced" if mandatory >= 2 else "lst_error_gt_2K"
    if key == "NDVI":
        if qa is None:
            return False, "qa_missing"
        r = int(qa)
        return (True, "good" if r == 0 else "marginal") if r in (0, 1) else (False, {2: "snow_ice", 3: "cloudy"}.get(r, "fill"))
    return True, "gap_filled_product"


def _item_date(item_id: str) -> date | None:
    m = _ID_DATE.search(item_id)
    if not m:
        return None
    return date.fromordinal(date(int(m[1]), 1, 1).toordinal() + int(m[2]) - 1)


def _search(collection: str, lon: float, lat: float, y0: int, y1: int) -> dict:
    return {"collections": [collection], "filter-lang": "cql2-json", "sortby": [{"field": "datetime", "direction": "asc"}],
            "filter": {"op": "and", "args": [
                {"op": "s_intersects", "args": [{"property": "geometry"}, {"type": "Point", "coordinates": [lon, lat]}]},
                {"op": "=", "args": [{"property": "platform"}, "terra"]},
                {"op": "anyinteracts", "args": [{"property": "datetime"}, {"interval": [f"{y0}-01-01T00:00:00Z", f"{y1}-12-31T23:59:59Z"]}]}]}}


async def _chunk(client: httpx.AsyncClient, sem: asyncio.Semaphore, collection: str, assets: list[str], lon: float, lat: float, y0: int, y1: int):
    async with sem:
        for attempt in range(3):
            try:
                r = await client.post(f"{PC}/data/v1/mosaic/register", json=_search(collection, lon, lat, y0, y1), timeout=60)
                r.raise_for_status()
                sid = r.json()["searchid"]
                q = [("assets", a) for a in assets]
                r = await client.get(f"{PC}/data/v1/mosaic/{sid}/point/{lon},{lat}", params=q, timeout=90)
                if r.status_code == 404:
                    return []          # no items at this point (e.g. open ocean for land products)
                r.raise_for_status()
                return r.json().get("values", [])
            except (httpx.HTTPError, KeyError, ValueError):
                if attempt == 2:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))
    return []


async def fetch_raw(client: httpx.AsyncClient, lat: float, lon: float, last: int) -> tuple[dict[str, dict[str, float]], list[str]]:
    """{product: {YYYY-MM-DD: scaled value}} plus a list of chunks that failed."""
    sem = asyncio.Semaphore(CONCURRENCY)
    by_collection: dict[str, list[str]] = {}
    for key, p in PRODUCTS.items():
        by_collection.setdefault(p["collection"], []).append(key)
    jobs, meta = [], []
    for col, keys in by_collection.items():
        step = FETCH[col]
        for y0 in range(FIRST, last + 1, step):
            y1 = min(last, y0 + step - 1)
            assets = list(dict.fromkeys([PRODUCTS[k]["asset"] for k in keys] + [PRODUCTS[k]["qa"] for k in keys]))
            jobs.append(_chunk(client, sem, col, assets, lon, lat, y0, y1))
            meta.append((col, keys, y0, y1))
    results = await asyncio.gather(*jobs, return_exceptions=True)
    out: dict[str, dict[str, float]] = {k: {} for k in PRODUCTS}
    qc: dict[str, dict[str, float]] = {k: {} for k in PRODUCTS if PRODUCTS[k]["yearly"]}
    counts = {k: {"granules": 0, "fill_or_range": 0, "qa_rejected": 0, "accepted": 0, "reasons": {}} for k in PRODUCTS}
    failed = []
    for (col, keys, y0, y1), res in zip(meta, results):
        if isinstance(res, Exception):
            failed.append(f"{col} {y0}–{y1}")
            continue
        for item_id, values, names in res:
            d = _item_date(item_id)
            if d is None or not (FIRST <= d.year <= last):
                continue
            by_name = {str(n).removesuffix("_b1"): v for n, v in zip(names, values)}
            for key in keys:
                p = PRODUCTS[key]
                raw, qa = by_name.get(p["asset"]), by_name.get(p["qa"])
                c = counts[key]
                c["granules"] += 1
                lo, hi = p["valid"]
                if raw is None or not (lo <= raw <= hi) or (key.startswith("LST") and raw == 0):
                    c["fill_or_range"] += 1
                    continue
                ok, why = qa_ok(key, qa)
                c["reasons"][why] = c["reasons"].get(why, 0) + 1
                if not ok:
                    c["qa_rejected"] += 1
                    continue
                c["accepted"] += 1
                out[key][d.isoformat()] = raw * p["scale"] + p["offset"]
                if key in qc and qa is not None:
                    qc[key][d.isoformat()] = float(qa)
    return {"values": out, "qc": qc, "counts": counts}, failed


def seasonal_annual(monthly_grid: np.ndarray, first: int) -> dict:
    """Comparable-season annual values from a years × 12 grid of monthly means (NaN = missing)."""
    n_years = monthly_grid.shape[0]
    month_cov = np.isfinite(monthly_grid).sum(axis=0) / max(1, n_years)
    mask = month_cov >= MIN_MONTH_YEARS                       # fixed common-month mask
    clim = np.full(12, np.nan)
    for m in np.nonzero(mask)[0]:
        clim[m] = float(np.mean(monthly_grid[np.isfinite(monthly_grid[:, m]), m]))
    anom = monthly_grid - clim
    annual, complete = [], []
    for i in range(n_years):
        a = anom[i, mask]
        ok = np.isfinite(a)
        if mask.sum() and ok.sum() >= min(MIN_MONTHS, mask.sum()):
            annual.append(float(np.mean(clim[mask]) + np.mean(a[ok])))
        else:
            annual.append(None)
        complete.append(bool(mask.sum()) and bool(ok.all()))
    half = n_years // 2
    early = np.isfinite(monthly_grid[:half]).mean(axis=0) if half else month_cov
    late = np.isfinite(monthly_grid[half:]).mean(axis=0) if half else month_cov
    shift = float(np.max(np.abs(late - early)[mask])) if mask.any() else 0.0
    return {"annual": annual, "complete": complete, "month_coverage": [round(float(c), 3) for c in month_cov],
            "masked_months": [int(m) + 1 for m in np.nonzero(~mask)[0]], "coverage_shift": round(shift, 3)}


def _row(key: str, series: dict[str, float], last: int, rng: np.random.Generator, qc: dict[str, float] | None = None,
         counts: dict | None = None) -> dict:
    p = PRODUCTS[key]
    warnings: list[str] = []
    monthly: list[dict] = []
    annual: list[dict] = []
    sensitivity = None
    coverage_info: dict = {}
    if p["yearly"]:
        by_year = {int(d[:4]): v for d, v in series.items()}
        for y in range(FIRST, last + 1):
            annual.append({"year": y, "value": by_year.get(y), "anomaly": None})
        if qc:
            q = {int(d[:4]): v for d, v in qc.items()}
            coverage_info["provider_qc_percent"] = {str(y): q[y] for y in sorted(q)}
        warnings.append("Provider gap-filled yearly product: NASA fills cloudy or missing inputs before release; the QC percentage is shown, not used as a filter.")
    else:
        bucket: dict[tuple[int, int], list[float]] = {}
        for d, v in series.items():
            bucket.setdefault((int(d[:4]), int(d[5:7])), []).append(v)
        grid = np.full((last - FIRST + 1, 12), np.nan)
        for (y, m), vals in bucket.items():
            if FIRST <= y <= last:
                grid[y - FIRST, m - 1] = float(np.mean(vals))
        for y in range(FIRST, last + 1):
            for m in range(1, 13):
                v = grid[y - FIRST, m - 1]
                monthly.append({"date": f"{y}-{m:02d}", "value": float(v) if np.isfinite(v) else None})
        sa = seasonal_annual(grid, FIRST)
        annual = [{"year": FIRST + i, "value": v, "anomaly": None} for i, v in enumerate(sa["annual"])]
        coverage_info = {k: sa[k] for k in ("month_coverage", "masked_months", "coverage_shift")}
        if sa["masked_months"]:
            warnings.append(f"Months observed in fewer than half the years are left out for every year: {', '.join(str(m) for m in sa['masked_months'])}.")
        if sa["coverage_shift"] > 0.3:
            warnings.append("Seasonal coverage changes between the first and second half of the record; trends use calendar-month anomalies, but treat them as exploratory.")
        if sum(a["value"] is None for a in annual) > 3:
            warnings.append(f"Some years have fewer than {MIN_MONTHS} usable months (persistent cloud or snow) and are left out.")
        cx = np.array([FIRST + i for i, c in enumerate(sa["complete"]) if c and sa["annual"][i] is not None], float)
        cy = np.array([sa["annual"][i] for i, c in enumerate(sa["complete"]) if c and sa["annual"][i] is not None], float)
        if len(cy) >= 3:
            ct = fit_trend(cx, cy, [])
            sensitivity = {"complete_years": int(len(cy)), "slope": ct["slope"], "significant": ct["significant"]}
        warnings.append("Only clear-sky observations enter each month, so months can still lean toward cloud-free conditions.")
    usable = [a for a in annual if a["value"] is not None]
    base = float(np.mean([a["value"] for a in usable])) if usable else None
    for a in annual:
        if a["value"] is not None and base is not None:
            a["anomaly"] = a["value"] - base
    x = np.array([a["year"] for a in usable], float)
    y = np.array([a["value"] for a in usable], float)
    trend = fit_trend(x, y, warnings) if len(y) else None
    sigma = _residual_sigma(x, y, trend["slope"] / 10) if trend else None
    autocorrelated = bool(trend and trend["lag1"] is not None and abs(trend["lag1"]) > 1.96 / np.sqrt(trend["years"]))
    return {
        "parameter": key, "name": p["name"], "short": p["short"], "unit": p["unit"], "monthly_unit": p["unit"],
        "source": "satellite", "mission": p["mission"], "collection": p["collection"], "gap_filled": p["yearly"],
        "stac_url": f"https://planetarycomputer.microsoft.com/dataset/{p['collection']}",
        "start": FIRST, "end": last, "trend": trend, "sigma": sigma, "z": trend["slope"] / sigma if trend and sigma else None,
        "coverage": round(100 * len(usable) / max(1, len(annual)), 1), "warnings": warnings,
        "quality": {"policy": QA_POLICY, **(counts or {}), **coverage_info, "complete_year_sensitivity": sensitivity},
        "annual": annual, "monthly_anomaly": _monthly_anomalies(monthly, FIRST, last) if monthly else [],
        "seasonal": _seasonal(monthly, FIRST, last) if monthly else [],
        "permutation": permutation(y, rng, applicable=not autocorrelated) if len(y) >= 6 else None,
    }


def build(raw: dict, last: int, power_payload: dict | None, seed: int = 0) -> dict:
    from .science import analyze
    rng = np.random.default_rng(seed)
    values = raw.get("values", raw)          # tests may pass the bare {product: series} mapping
    rows = [_row(k, values.get(k, {}), last, rng, (raw.get("qc") or {}).get(k), (raw.get("counts") or {}).get(k)) for k in PRODUCTS]
    rows = [r for r in rows if any(a["value"] is not None for a in r["annual"])]
    fdr = bh([r["trend"]["p_value"] if r["trend"] else None for r in rows])
    for r, f in zip(rows, fdr):
        screened = r["trend"]["significant"] if r["trend"] else None
        r["significant_fdr"] = None if screened is None else bool(screened and f)
        r["status"] = ("withheld" if screened is None else "significant" if r["significant_fdr"] else "nominal" if screened else "not_significant")
    _seasonal_fdr(rows)
    by = {r["parameter"]: r for r in rows}
    checks = []
    for sat, power, label in CROSS:
        if sat not in by or power_payload is None:
            continue
        pw = analyze(power_payload, power, FIRST, last, with_diagnostics=False)
        st, pt = by[sat]["trend"], pw["trend"]
        if not st or not pt:
            continue
        same = (st["slope"] > 0) == (pt["slope"] > 0)
        both = bool(st["significant"]) and bool(pt["significant"])
        verdict = "confirmed" if same and both else "consistent" if same else "conflicting"
        checks.append({"label": label, "satellite": sat, "power": power, "verdict": verdict,
                       "note": "Corroborating evidence: land surface and 2 m air temperature are related but different quantities.",
                       "satellite_slope": st["slope"], "satellite_significant": st["significant"],
                       "power_slope": pt["slope"], "power_significant": pt["significant"], "power_unit": pw["unit"],
                       "satellite_unit": by[sat]["unit"], "period": [FIRST, last]})
    ranked = sorted(rows, key=lambda r: (r["status"] != "significant", -(abs(r["z"]) if r["z"] is not None else -1)))
    return {"variables": rows, "ranking": [r["parameter"] for r in ranked], "cross_checks": checks, "start": FIRST, "end": last,
            "methods": {
                "source": "NASA MODIS Terra collection 6.1 via Microsoft Planetary Computer (STAC + data API point sampling, anonymous access)",
                "annual": "Quality-accepted composites → calendar-month means → anomalies from each month's own mean, with a fixed common-month mask (months seen in < half the years are dropped for all years) and ≥ 10 usable months per year; annual value = mean seasonal cycle + mean anomaly. A complete-year sensitivity trend is reported. Yearly products are provider gap-filled and used as published.",
                "quality": f"QA policy {QA_POLICY}: LST mandatory QA good, or other-quality with LST error ≤ 2 K; NDVI pixel reliability good or marginal; fill/out-of-range values dropped, never filled. Granule, rejection and acceptance counts are reported per variable.",
                "test": "Same Theil–Sen + Mann–Kendall + screens as the NASA POWER variables; Benjamini–Hochberg FDR across the satellite variables.",
                "cross_check": "MODIS land surface temperature trend vs NASA POWER air temperature trend over the same years: 'confirmed' = same direction and both significant; 'consistent' = same direction; 'conflicting' = opposite. This is corroborating evidence from two observing systems, not proof that the two quantities are equivalent.",
            }}


async def satellite(client: httpx.AsyncClient, cache: Path, lat: float, lon: float, last: int, power_payload: dict | None) -> dict:
    key = cache / "satellite" / f"{lat:.3f}_{lon:.3f}_{last}_{QA_POLICY}.json"
    raw = None
    if key.exists() and time.time() - key.stat().st_mtime < CACHE_DAYS * 86400:
        cached = json.loads(key.read_text())
        raw, failed, retrieved = cached["raw"], cached["failed"], cached["retrieved_at"]
        status = "cached"
    if raw is None:
        raw, failed = await fetch_raw(client, lat, lon, last)
        retrieved = datetime.now(timezone.utc).isoformat()
        status = "fetched"
        if not failed:
            key.parent.mkdir(parents=True, exist_ok=True)
            key.write_text(json.dumps({"raw": raw, "failed": failed, "retrieved_at": retrieved}))
    result = await asyncio.to_thread(build, raw, last, power_payload)
    return {**result, "failed_chunks": failed, "retrieved_at": retrieved, "cache_status": status, "qa_policy": QA_POLICY}
