"""Plate-scoped analog retrieval, significance ranking and analog outcomes.

This is the transparent, deterministic half of the AI layer. It narrows the library to
historically significant episodes on the selected location's tectonic plate (and the
plates across a nearby boundary), ranks them, and summarises what followed them. The
System-1 model (laya_system1.py) then scores those candidates.
"""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
import json
import math
import numpy as np
from . import signatures as S
from .tectonics import tectonic_context

DATA = Path(__file__).parent / "data"
TOP_K = 5
ESCALATE_PERCENTILE = 90.0


@lru_cache(maxsize=1)
def library() -> dict:
    eps = json.loads((DATA / "episodes.json").read_text())
    anchors = json.loads((DATA / "anchors.json").read_text())
    by_id = {a["id"]: a for a in anchors["anchors"]}
    episodes = eps["episodes"]
    return {
        "episodes": episodes,
        "anchors": by_id,
        "vectors": np.array([e["vector"] for e in episodes], dtype=float),
        "magnitude": np.array([e["magnitude"] for e in episodes], dtype=float),
        "plates": np.array([e["plate"] for e in episodes]),
        "end": np.array([e["end"] for e in episodes]),
        "significant": np.array([e["n_significant"] > 0 for e in episodes]),
        "has_outcome": np.array([e["outcome"] is not None for e in episodes]),
        "lat": np.array([e["latitude"] for e in episodes], dtype=float),
        "lon": np.array([e["longitude"] for e in episodes], dtype=float),
        "t_base": np.array([by_id[e["anchor"]]["baseline"]["t_mean"] for e in episodes], dtype=float),
        "r_base": np.array([by_id[e["anchor"]]["baseline"]["rain"] for e in episodes], dtype=float),
        "anchor": np.array([e["anchor"] for e in episodes]),
        "built_at": eps["built_at"],
        "end_year": anchors["end_year"],
    }


def _gc_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def similarity(vector, t_base, r_base, lat, lon, lib, mask) -> np.ndarray:
    """0–1 analog similarity: trend-signature shape and size, climate type and distance."""
    v = np.asarray(vector, dtype=float)
    V = lib["vectors"][mask]
    nv, nV = np.linalg.norm(v), np.linalg.norm(V, axis=1)
    cos = (V @ v) / np.maximum(nV * nv, 1e-9)
    size = np.exp(-np.abs(np.log((nV + .05) / (nv + .05))))            # similar overall magnitude
    climate = np.exp(-np.abs(lib["t_base"][mask] - t_base) / 8 - np.abs(np.log((lib["r_base"][mask] + 50) / (r_base + 50))) / .8)
    geo = np.exp(-_gc_km(lat, lon, lib["lat"][mask], lib["lon"][mask]) / 3000)
    return .55 * np.clip(cos, 0, 1) + .15 * size + .2 * climate + .1 * geo


def candidates(vector, t_base, r_base, lat, lon, plates, before_year=None, exclude_anchor=None, k=TOP_K):
    lib = library()
    mask = np.isin(lib["plates"], plates) & lib["significant"] & lib["has_outcome"]
    if before_year is not None:
        mask &= lib["end"] + S.OUTCOME <= before_year       # outcome fully observed before the query window ends
    if exclude_anchor is not None:
        mask &= lib["anchor"] != exclude_anchor
    idx = np.flatnonzero(mask)
    if not len(idx):
        return []
    score = similarity(vector, t_base, r_base, lat, lon, lib, mask)
    order = np.argsort(-score)
    chosen, seen = [], set()
    for o in order:                                     # one episode per anchor keeps analogs independent
        e = lib["episodes"][idx[o]]
        if e["anchor"] in seen:
            continue
        seen.add(e["anchor"])
        chosen.append((int(idx[o]), float(score[o])))
        if len(chosen) == k:
            break
    return chosen


def plate_percentile(magnitude: float, plates: list[str]) -> tuple[float, int]:
    lib = library()
    pool = lib["magnitude"][np.isin(lib["plates"], plates)]
    if not len(pool):
        return float("nan"), 0
    return float((pool < magnitude).mean() * 100), int(len(pool))


def severity_label(percentile: float, n_significant: int) -> int:
    level = 0 if percentile < 50 else 1 if percentile < 80 else 2 if percentile < 95 else 3
    if n_significant >= 4:
        level = max(level, 2)
    if n_significant == 0:
        level = min(level, 1)
    return level


SEVERITY = ["typical variability", "notable change", "significant change", "exceptional change"]


def analog_card(i: int, sim: float, letter: str) -> dict:
    lib = library()
    e = lib["episodes"][i]
    a = lib["anchors"][e["anchor"]]
    return {
        "option": letter, "anchor": e["anchor"], "plate": e["plate"], "latitude": e["latitude"], "longitude": e["longitude"],
        "period": [e["start"], e["end"]], "regime": e["regime"], "regime_label": S.REGIMES[e["regime"]],
        "similarity": round(sim, 3), "signature": describe_trends(e), "n_significant": e["n_significant"],
        "magnitude": round(e["magnitude"], 3), "outcome": e["outcome"], "baseline": a["baseline"],
        "source_url": a["source_url"],
    }


def describe_trends(e: dict) -> list[dict]:
    return [{"index": k, "label": S.INDICES[k]["label"], "slope": round(e["trends"][k]["slope"], 3), "unit": S.INDICES[k]["unit"],
             "z": round(e["trends"][k]["z"], 2), "p": round(e["trends"][k]["p"], 4), "significant": e["trends"][k]["significant"]}
            for k in S.KEYS]


def option_text(card: dict) -> str:
    t = {d["index"]: d for d in card["signature"]}
    top = sorted(t.values(), key=lambda d: -abs(d["z"]))[:3]
    trend = ", ".join(f"{d['index']} {d['z']:+.1f}{'*' if d['significant'] else ''}" for d in top)
    return f"{card['plate']} {card['period'][0]}-{card['period'][1]} {card['regime']}: {trend}"


def analog_outlook(cards: list[dict], weights: list[float], current: dict) -> dict:
    """Similarity-weighted summary of what followed the analog episodes (no model involved).

    Not used for predictions: on held-out sites it scored worse than predicting the average change
    (RMSE 0.80σ vs 0.72σ), so the app shows analogs only as historical examples."""
    if not cards:
        return {"available": False}
    w = np.array(weights, dtype=float)
    w = w / w.sum() if w.sum() > 0 else np.full(len(w), 1 / len(w))
    rows = []
    for j, k in enumerate(S.KEYS):
        shifts = np.array([c["outcome"]["shift"][k] for c in cards])
        z_now = current["trends"][k]["z"]
        cont = [np.sign(s) == np.sign(c["signature"][j]["z"]) and abs(s) > .1 for s, c in zip(shifts, cards)]
        rows.append({"index": k, "label": S.INDICES[k]["label"], "expected_shift_sigma": round(float(w @ shifts), 3),
                     "spread_sigma": round(float(np.std(shifts)), 3), "analog_continuation": round(float(np.mean(cont)), 2),
                     "current_z": round(z_now, 2), "current_significant": current["trends"][k]["significant"]})
    rows.sort(key=lambda r: -abs(r["expected_shift_sigma"]))
    return {"available": True, "horizon_years": S.OUTCOME, "indices": rows,
            "method": "Similarity-weighted mean of each analog's next-5-year mean minus its final-5-year mean, in the analog site's interannual σ. Continuation = share of analogs whose index kept moving in its episode direction (>0.1σ)."}


def current_state(payload: dict, end: int) -> dict:
    df = S.annual_indices(payload, 1981, end)
    sigma = S.scales(df)
    sig = S.window_signature(df, end, sigma)
    if sig is None:
        raise ValueError("The selected location lacks 15 complete recent years of NASA POWER data.")
    sig["regime"] = S.classify(sig)
    return {"signature": sig, "sigma": sigma, "baseline": S.climate_baseline(df),
            "annual": {k: [None if not math.isfinite(v) else round(float(v), 3) for v in df[k]] for k in S.KEYS},
            "years": [int(y) for y in df.index]}


def retrieve(latitude: float, longitude: float, state: dict) -> dict:
    ctx = tectonic_context(latitude, longitude)
    sig, base = state["signature"], state["baseline"]
    chosen = candidates(sig["vector"], base["t_mean"], base["rain"], latitude, longitude, ctx["searched_plates"])
    letters = "ABCDE"
    cards = [analog_card(i, s, letters[n]) for n, (i, s) in enumerate(chosen)]
    pct, pool = plate_percentile(sig["magnitude"], ctx["searched_plates"])
    return {"tectonics": ctx, "analogs": cards, "percentile": pct, "pool_size": pool,
            "rule_severity": severity_label(pct, sig["n_significant"])}
