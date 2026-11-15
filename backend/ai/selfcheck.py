"""Command-line check of the AI layer for one location.

    backend/.venv/bin/python -m backend.ai.selfcheck 11.0168 76.9558
"""
import asyncio
import json
import sys
import time
import httpx
from .build_library import fetch
from . import engine, laya_system1 as L, similarity


async def _record(lat, lon, end):
    async with httpx.AsyncClient(timeout=180) as c:
        return await fetch(c, lat, lon, 1981, end)


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: python -m backend.ai.selfcheck LATITUDE LONGITUDE   (e.g. 30.0626 31.2497)")
    lat, lon = float(sys.argv[1]), float(sys.argv[2])
    end = engine.library()["end_year"]
    rec = asyncio.run(_record(lat, lon, end))
    st = engine.current_state(rec["payload"], end)
    r = engine.retrieve(lat, lon, st)
    print("plates searched:", r["tectonics"]["searched_plates"], "| percentile:", round(r["percentile"], 1), "| regime(rule):", st["signature"]["regime"])
    for c in r["analogs"]:
        print(" ", c["option"], engine.option_text(c), "sim", c["similarity"])
    sim = similarity.run(st, lat, lon, r["tectonics"]["searched_plates"])
    if sim["status"] == "ok":
        print(f"Laya similarity: average {sim['average']:.0%} over {len(sim['analogs'])} of {sim['pool']} · gate {'open' if sim['passes'] else 'closed'}")
        for c in sim["analogs"]:
            print(" ", c["option"], c["plate"], c["period"], f"{c['laya_similarity']:.0%}", f"{len(c['matching_indices'])}/9 alike")
    else:
        print("Laya similarity unavailable:", sim["reason"])
    t = time.time()
    out = L.run(r["tectonics"]["plate"], st["baseline"], st["signature"], lat)
    print(f"laya first call {time.time() - t:.1f}s")
    if out["status"] != "ok":
        print(out["reason"])
        return
    t = time.time()
    out = L.run(r["tectonics"]["plate"], st["baseline"], st["signature"], lat)
    print(f"laya warm call {time.time() - t:.2f}s")
    print(json.dumps(out["outlook"], indent=1))


if __name__ == "__main__":
    main()
