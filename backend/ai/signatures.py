"""Locally calibrated annual climate indices and windowed trend signatures.

Every index is computed from real NASA POWER daily values at one grid point. Percentile
thresholds are calibrated on that point's own record (the reference guide's advice that
thresholds must be calibrated locally), so a "hot day" in Reykjavík and in Chennai are
both the local top 10%, not a fixed 35 °C.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy.stats import kendalltau, theilslopes

WINDOW = 15          # years in one trend episode
OUTCOME = 5          # years after an episode used to describe "what happened next"

INDICES = {
    "t_mean":      {"label": "mean air temperature", "unit": "°C"},
    "t_max":       {"label": "daytime maximum temperature", "unit": "°C"},
    "t_min":       {"label": "night minimum temperature", "unit": "°C"},
    "rain":        {"label": "annual rainfall", "unit": "mm"},
    "hot_days":    {"label": "hot days (local Tmax ≥ p90)", "unit": "days"},
    "warm_nights": {"label": "warm nights (local Tmin ≥ p90)", "unit": "days"},
    "cold_days":   {"label": "cold days (local Tmax ≤ p10)", "unit": "days"},
    "heavy_rain":  {"label": "heavy-rain days (≥ local wet-day p95)", "unit": "days"},
    "dry_spell":   {"label": "longest dry spell (<1 mm)", "unit": "days"},
}
KEYS = list(INDICES)


def _series(payload: dict, key: str, index: pd.DatetimeIndex) -> pd.Series:
    values = payload["properties"]["parameter"][key]
    fill = payload.get("header", {}).get("fill_value", -999)
    s = pd.Series(list(values.values()), index=pd.to_datetime(list(values), format="%Y%m%d"), dtype=float).reindex(index)
    s = s.mask((s == fill) | ~np.isfinite(s))
    if key == "PRECTOTCORR":
        s = s.where(s >= 0)
    return s


def _longest(mask: np.ndarray) -> int:
    best = run = 0
    for v in mask:
        run = run + 1 if v else 0
        best = max(best, run)
    return best


def annual_indices(payload: dict, start: int, end: int) -> pd.DataFrame:
    """One row per complete year; years with <95% daily coverage in any variable are NaN."""
    index = pd.date_range(f"{start}-01-01", f"{end}-12-31", freq="D")
    t, tx, tn, pr = (_series(payload, k, index) for k in ("T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR"))
    tx90, tn90, tx10 = tx.quantile(.9), tn.quantile(.9), tx.quantile(.1)
    wet = pr[pr >= 1]
    pr95 = wet.quantile(.95) if len(wet) > 50 else np.nan
    rows = []
    for year in range(start, end + 1):
        sel = index.year == year
        parts = [s[sel] for s in (t, tx, tn, pr)]
        complete = min(float(p.notna().mean()) for p in parts) >= .95
        if not complete:
            rows.append({"year": year, **{k: np.nan for k in KEYS}})
            continue
        yt, ytx, ytn, ypr = parts
        rows.append({
            "year": year,
            "t_mean": float(yt.mean()), "t_max": float(ytx.mean()), "t_min": float(ytn.mean()),
            "rain": float(ypr.fillna(0).sum() * len(ypr) / max(ypr.notna().sum(), 1)),
            "hot_days": int((ytx >= tx90).sum()), "warm_nights": int((ytn >= tn90).sum()),
            "cold_days": int((ytx <= tx10).sum()),
            "heavy_rain": int((ypr >= pr95).sum()) if np.isfinite(pr95) else np.nan,
            "dry_spell": _longest((ypr.fillna(0) < 1).to_numpy()),
        })
    df = pd.DataFrame(rows).set_index("year")
    return df


def climate_baseline(df: pd.DataFrame) -> dict:
    return {"t_mean": float(df["t_mean"].mean()), "rain": float(df["rain"].mean())}


def _trend(years: np.ndarray, values: np.ndarray, scale: float) -> dict | None:
    ok = np.isfinite(values)
    if ok.sum() < 10:
        return None
    x, y = years[ok].astype(float), values[ok]
    if np.ptp(y) == 0:
        return {"slope": 0.0, "z": 0.0, "p": 1.0, "lag1": None, "significant": False, "recent": 0.0}
    slope, intercept, _, _ = theilslopes(y, x)
    p = float(kendalltau(x, y).pvalue)
    resid = y - (slope * x + intercept)
    lag = None
    if np.std(resid[:-1]) > 1e-9 and np.std(resid[1:]) > 1e-9:
        lag = float(np.corrcoef(resid[:-1], resid[1:])[0, 1])
    autocorrelated = lag is not None and abs(lag) > 1.96 / np.sqrt(len(x))
    return {
        "slope": float(slope * 10),                      # per decade, native unit
        "z": float(slope * 10 / scale) if scale > 1e-9 else 0.0,  # per decade, in local interannual σ
        "p": p, "lag1": lag,
        "significant": bool(p < .05 and not autocorrelated),
        # Where the last five years sit relative to the window's trend line, in local σ (mean-reversion signal).
        "recent": float(resid[-5:].mean() / scale) if scale > 1e-9 else 0.0,
    }


def scales(df: pd.DataFrame) -> dict:
    """Local interannual σ of each index after removing the full-record linear trend."""
    out = {}
    years = df.index.to_numpy(dtype=float)
    for k in KEYS:
        y = df[k].to_numpy(dtype=float)
        ok = np.isfinite(y)
        if ok.sum() < 10:
            out[k] = np.nan
            continue
        coef = np.polyfit(years[ok], y[ok], 1)
        out[k] = float(np.std(y[ok] - np.polyval(coef, years[ok]), ddof=1))
    return out


def window_signature(df: pd.DataFrame, end: int, sigma: dict, window: int = WINDOW) -> dict | None:
    sub = df.loc[end - window + 1:end]
    if len(sub) < window:
        return None
    years = sub.index.to_numpy()
    trends = {}
    for k in KEYS:
        t = _trend(years, sub[k].to_numpy(dtype=float), sigma.get(k, np.nan))
        if t is None:
            return None
        trends[k] = t
    z = np.array([trends[k]["z"] for k in KEYS])
    return {"start": int(end - window + 1), "end": int(end), "trends": trends,
            "vector": [round(float(v), 4) for v in z],
            "magnitude": float(np.sqrt(np.mean(z ** 2))),
            "n_significant": int(sum(trends[k]["significant"] for k in KEYS))}


def outcome(df: pd.DataFrame, end: int, sigma: dict, horizon: int = OUTCOME) -> dict | None:
    """What happened next: mean of the following years vs the episode's last five years, in σ."""
    after = df.loc[end + 1:end + horizon]
    before = df.loc[end - 4:end]
    if len(after) < horizon or after[KEYS].isna().all(axis=None):
        return None
    shift = {}
    for k in KEYS:
        a, b = after[k].mean(), before[k].mean()
        s = sigma.get(k, np.nan)
        shift[k] = float((a - b) / s) if np.isfinite(a) and np.isfinite(b) and s > 1e-9 else 0.0
    peak = {k: float(after[k].max()) for k in ("hot_days", "heavy_rain", "dry_spell", "warm_nights") if after[k].notna().any()}
    return {"years": [int(end + 1), int(end + horizon)], "shift": shift,
            "vector": [round(shift[k], 4) for k in KEYS], "peaks": peak}


def classify(sig: dict) -> str:
    """Rule-based regime label following the event detection matrix (heat, drought, flood, cold)."""
    t = sig["trends"]
    up = lambda k: t[k]["significant"] and t[k]["z"] > 0
    down = lambda k: t[k]["significant"] and t[k]["z"] < 0
    heat = up("t_max") or up("hot_days") or up("t_mean")
    nights = up("t_min") or up("warm_nights")
    dry = down("rain") or up("dry_spell")
    flood = up("heavy_rain") or (up("rain") and t["heavy_rain"]["z"] > 0)
    cold = down("t_mean") or up("cold_days") or down("t_max")
    if heat and dry:
        return "heat_drought"
    if dry:
        return "drying"
    if flood and (heat or nights):
        return "warm_wet_extremes"
    if flood:
        return "extreme_rain"
    if heat:
        return "heat"
    if nights:
        return "warm_nights"
    if cold:
        return "cooling"
    if up("rain"):
        return "wetting"
    return "no_clear_regime"


REGIMES = {
    "heat": "warming with more hot days (heatwave-prone)",
    "warm_nights": "warmer nights / reduced night cooling",
    "heat_drought": "hot and drying (drought + wildfire-weather prone)",
    "drying": "rainfall deficit / longer dry spells (drought-prone)",
    "extreme_rain": "more heavy-rain days (flood-prone)",
    "warm_wet_extremes": "warming with heavier rain (intensifying hydrological cycle)",
    "cooling": "cooling / more cold days (cold-wave prone)",
    "wetting": "steadily wetter",
    "no_clear_regime": "no significant directional regime",
}


def describe(sig: dict, limit: int = 3) -> str:
    """Compact text for the System-1 model: strongest standardized trends first, * = significant."""
    t = sig["trends"]
    order = sorted(KEYS, key=lambda k: -abs(t[k]["z"]))[:limit]
    return ", ".join(f"{k} {t[k]['z']:+.1f}σ{'*' if t[k]['significant'] else ''}" for k in order)
