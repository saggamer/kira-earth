"""Build the plate-scoped historical analog library from NASA POWER daily records.

    backend/.venv/bin/python -m backend.ai.build_library [--end 2024] [--max-per-plate 14]

1. Spread anchor grid points across every PB2002 plate (farthest-point sampling on a 3° grid).
2. Download each anchor's full 1981–END daily NASA POWER record (shared on-disk cache).
3. Compute locally calibrated annual indices and overlapping 15-year trend episodes,
   each with the 5 years that followed it ("what happened next").
Outputs backend/ai/data/anchors.json and backend/ai/data/episodes.json.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
import httpx
import numpy as np
from .tectonics import plate_at, plate_names
from . import signatures as S

DATA = Path(__file__).parent / "data"
CACHE = Path(os.getenv("EARTH_CACHE_DIR", str(Path(__file__).parents[1] / ".cache")))
POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
# The library needs only temperature and rain. Keeping the original request keeps its cached
# downloads valid (the app's own requests now include humidity, wind, pressure and soil moisture).
PARAMETERS = "PRECTOTCORR,T2M,T2M_MAX,T2M_MIN"
FIRST_YEAR = 1981


def power_params(lat: float, lon: float, start: int, end: int) -> dict:
    return {"parameters": PARAMETERS, "community": "AG", "latitude": round(lat, 4), "longitude": round(lon, 4),
            "start": f"{start}0101", "end": f"{end}1231", "format": "JSON", "time-standard": "UTC"}


def cache_file(params: dict) -> Path:
    return CACHE / f"power-{hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()}.json"


async def fetch(client: httpx.AsyncClient, lat: float, lon: float, start: int, end: int) -> dict:
    params = power_params(lat, lon, start, end)
    file = cache_file(params)
    if file.exists():
        return json.loads(file.read_text())
    for attempt in range(4):
        try:
            r = await client.get(POWER, params=params)
            r.raise_for_status()
            payload = r.json()
            if "properties" not in payload:
                raise ValueError("POWER returned no data")
            cached = {"payload": payload, "source_url": str(r.url), "retrieved_at": datetime.now(timezone.utc).isoformat()}
            tmp = file.with_suffix(".tmp")
            tmp.write_text(json.dumps(cached))
            tmp.replace(file)
            return cached
        except (httpx.HTTPError, ValueError):
            await asyncio.sleep(3 * (attempt + 1))
    raise RuntimeError(f"POWER unavailable for {lat},{lon}")


def choose_anchors(max_per_plate: int, step: float = 3.0) -> list[dict]:
    grid = [(lat, lon) for lat in np.arange(-66, 79, step) for lon in np.arange(-178.5, 180, step)]
    by_plate: dict[str, list] = {}
    for lat, lon in grid:
        code = plate_at(float(lat), float(lon))
        if code:
            by_plate.setdefault(code, []).append((float(lat), float(lon)))
    # Small plates may contain no 3° grid point: refine to 1° for them.
    for code in plate_names():
        if code not in by_plate:
            fine = [(float(a), float(o)) for a in np.arange(-70, 80, 1.0) for o in np.arange(-179.5, 180, 1.0)]
            pts = [p for p in fine if plate_at(*p) == code]
            if pts:
                by_plate[code] = pts
    anchors = []
    for code, pts in by_plate.items():
        n = int(np.clip(round(math.sqrt(len(pts)) * 1.6), 3, max_per_plate))
        pts_arr = np.radians(np.array(pts))
        chosen = [len(pts) // 2]
        def gc(i, j):
            a, b = pts_arr[i], pts_arr[j]
            return math.acos(np.clip(math.sin(a[0]) * math.sin(b[0]) + math.cos(a[0]) * math.cos(b[0]) * math.cos(a[1] - b[1]), -1, 1))
        dist = np.array([gc(i, chosen[0]) for i in range(len(pts))])
        while len(chosen) < min(n, len(pts)):
            nxt = int(np.argmax(dist))
            chosen.append(nxt)
            dist = np.minimum(dist, [gc(i, nxt) for i in range(len(pts))])
        for i in chosen:
            anchors.append({"id": f"{code}-{len(anchors)}", "plate": code, "latitude": pts[i][0], "longitude": pts[i][1]})
    return anchors


def episodes_for(anchor: dict, df, sigma: dict, last_year: int) -> list[dict]:
    out = []
    for end in range(FIRST_YEAR + S.WINDOW - 1, last_year + 1, 2):
        # Causal scaling: σ uses only years up to the window end, so no episode sees its own future.
        local = S.scales(df.loc[:end])
        if any(not np.isfinite(v) or v <= 1e-9 for v in local.values()):
            continue
        sig = S.window_signature(df, end, local)
        if sig is None:
            continue
        nxt = S.outcome(df, end, local) if end + S.OUTCOME <= last_year else None
        out.append({"anchor": anchor["id"], "plate": anchor["plate"], "latitude": anchor["latitude"], "longitude": anchor["longitude"],
                    **sig, "regime": S.classify(sig), "outcome": nxt, "sigma": {k: round(float(v), 5) for k, v in local.items()}})
    return out


async def main(end_year: int, max_per_plate: int, concurrency: int):
    CACHE.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    anchors = choose_anchors(max_per_plate)
    print(f"{len(anchors)} anchors across {len({a['plate'] for a in anchors})} plates", flush=True)
    sem = asyncio.Semaphore(concurrency)
    done = 0
    started = time.time()
    async with httpx.AsyncClient(timeout=180, headers={"User-Agent": "EarthSystemTrendDetective/1.0 NASA-Space-Apps-Research"}) as client:
        async def one(a):
            nonlocal done
            async with sem:
                try:
                    rec = await fetch(client, a["latitude"], a["longitude"], FIRST_YEAR, end_year)
                except RuntimeError as exc:
                    print("skip", exc, flush=True)
                    return a, None
            done += 1
            if done % 20 == 0:
                print(f"  {done}/{len(anchors)} records · {time.time() - started:.0f}s", flush=True)
            return a, rec
        results = await asyncio.gather(*(one(a) for a in anchors))
    kept, episodes = [], []
    for a, rec in results:
        if rec is None:
            continue
        df = S.annual_indices(rec["payload"], FIRST_YEAR, end_year)
        sigma = S.scales(df)
        if any(not np.isfinite(v) for v in sigma.values()):
            continue
        a = {**a, "sigma": sigma, "baseline": S.climate_baseline(df), "source_url": rec["source_url"], "retrieved_at": rec["retrieved_at"],
             "annual": {k: [None if not np.isfinite(v) else round(float(v), 3) for v in df[k]] for k in S.KEYS}, "years": [int(y) for y in df.index]}
        kept.append(a)
        episodes.extend(episodes_for(a, df, sigma, end_year))
    (DATA / "anchors.json").write_text(json.dumps({"built_at": datetime.now(timezone.utc).isoformat(), "end_year": end_year, "anchors": kept}))
    (DATA / "episodes.json").write_text(json.dumps({"built_at": datetime.now(timezone.utc).isoformat(), "window": S.WINDOW, "outcome_years": S.OUTCOME,
                                                   "episodes": episodes}))
    sig = sum(e["n_significant"] > 0 for e in episodes)
    print(f"saved {len(kept)} anchors, {len(episodes)} episodes ({sig} with ≥1 significant index)", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--end", type=int, default=2024)
    p.add_argument("--max-per-plate", type=int, default=14)
    p.add_argument("--concurrency", type=int, default=4)
    args = p.parse_args()
    asyncio.run(main(args.end, args.max_per_plate, args.concurrency))
