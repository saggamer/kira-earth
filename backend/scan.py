"""Change Scanner: every NASA POWER variable at one place, ranked by how strongly it is changing.

Answers the challenge questions for a single location in one pass:
  what is changing   -> all 8 variables tested with the same method, ranked by standardized change
  how much           -> Theil–Sen slope per decade, total fitted change, and σ/decade (slope divided by
                        the year-to-year variability left after removing the trend)
  is it significant  -> Mann–Kendall test, autocorrelation/length screens (from science.analyze),
                        Benjamini–Hochberg false-discovery-rate control across the 8 tests, and an
                        exact-style permutation test whose null distribution is returned for display
  when in the year   -> a seasonal fingerprint: the same test for each calendar month (FDR across all cells)

Everything is computed from the actual provider record; nothing is gap-filled or simulated except
the permutation shuffles of the observed annual values.
"""
from __future__ import annotations
import numpy as np
from .science import analyze, UNITS

ORDER = ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "RH2M", "WS10M", "PS", "GWETROOT"]
NAMES = {"T2M": "Air temperature", "T2M_MAX": "Maximum temperature", "T2M_MIN": "Minimum temperature",
         "PRECTOTCORR": "Precipitation", "RH2M": "Relative humidity", "WS10M": "Wind speed (10 m)",
         "PS": "Surface pressure", "GWETROOT": "Root-zone soil wetness"}
SHORT = {"T2M": "Air temperature", "T2M_MAX": "Max temperature", "T2M_MIN": "Min temperature", "PRECTOTCORR": "Precipitation",
         "RH2M": "Humidity", "WS10M": "Wind speed", "PS": "Pressure", "GWETROOT": "Soil moisture"}
MONTHLY_UNITS = {**UNITS, "PRECTOTCORR": "mm/month"}
PERMUTATIONS = 2000
BINS = 41
ALPHA = 0.05


def bh(pvalues: list[float | None], alpha: float = ALPHA) -> list[bool | None]:
    """Benjamini–Hochberg: which tests stay significant when controlling the false discovery rate."""
    idx = [i for i, p in enumerate(pvalues) if p is not None and np.isfinite(p)]
    out: list[bool | None] = [None] * len(pvalues)
    if not idx:
        return out
    ps = np.array([pvalues[i] for i in idx])
    order = np.argsort(ps)
    m = len(ps)
    passed = ps[order] <= alpha * (np.arange(1, m + 1) / m)
    k = np.max(np.nonzero(passed)[0]) + 1 if passed.any() else 0
    keep = set(order[:k].tolist())
    for j, i in enumerate(idx):
        out[i] = j in keep
    return out


def mk_s(y: np.ndarray) -> np.ndarray:
    """Mann–Kendall S for each row of y (shape [..., n])."""
    n = y.shape[-1]
    i, j = np.triu_indices(n, 1)
    return np.sign(y[..., j] - y[..., i]).sum(axis=-1)


def permutation(y: np.ndarray, rng: np.random.Generator, n: int = PERMUTATIONS, applicable: bool = True) -> dict:
    """Null distribution of Mann–Kendall S under 'no trend' (years shuffled), with the observed S.
    Shuffling assumes exchangeable (independent) years; when the detrended series fails the lag-1
    autocorrelation screen the result is returned with applicable=False and must not count as evidence."""
    s_obs = float(mk_s(y))
    perms = np.array([rng.permutation(y) for _ in range(n)])
    s_null = mk_s(perms)
    s_max = len(y) * (len(y) - 1) / 2
    edges = np.linspace(-s_max, s_max, BINS + 1)
    counts, _ = np.histogram(s_null, bins=edges)
    p = float((np.sum(np.abs(s_null) >= abs(s_obs)) + 1) / (n + 1))
    return {"s_observed": s_obs, "s_max": s_max, "p_value": p, "permutations": n, "applicable": bool(applicable),
            "assumption": "years are exchangeable (no serial dependence after removing the trend)",
            "histogram": {"edges": [round(float(e), 2) for e in edges], "counts": counts.astype(int).tolist()},
            "share_as_extreme": round(float(np.mean(np.abs(s_null) >= abs(s_obs))), 4)}


def _residual_sigma(x: np.ndarray, y: np.ndarray, slope_per_year: float) -> float | None:
    if len(y) < 4:
        return None
    intercept = np.median(y - slope_per_year * x)
    sd = float(np.std(y - (slope_per_year * x + intercept), ddof=1))
    return sd if sd > 1e-12 else None


def _seasonal(monthly: list[dict], start: int, end: int) -> list[dict]:
    """Per calendar month: the same decision rule as the annual series (science.fit_trend): Theil–Sen
    slope, Mann–Kendall p, record-length and lag-1 autocorrelation screens. `screened` is None when
    significance is withheld; FDR is applied afterwards only among screened cells (_seasonal_fdr)."""
    from .science import fit_trend
    by = {(int(m["date"][:4]), int(m["date"][5:7])): m["value"] for m in monthly}
    rows = []
    for month in range(1, 13):
        pts = [(y, by.get((y, month))) for y in range(start, end + 1)]
        pts = [(y, v) for y, v in pts if v is not None and np.isfinite(v)]
        if len(pts) < 10:
            rows.append({"month": month, "slope": None, "z": None, "p_value": None, "n": len(pts)})
            continue
        x = np.array([p[0] for p in pts], float)
        y = np.array([p[1] for p in pts], float)
        t = fit_trend(x, y, [])
        sd = _residual_sigma(x, y, t["slope"] / 10)
        rows.append({"month": month, "slope": t["slope"], "z": t["slope"] / sd if sd else None, "p_value": t["p_value"],
                     "n": len(pts), "lag1": t["lag1"], "screened": t["significant"],
                     "withheld": t["significant"] is None})
    return rows


def _seasonal_fdr(rows: list[dict]) -> None:
    """One BH family per record (model or satellite): all month × variable cells that pass the screens.
    Withheld cells are excluded from the family and can never be marked significant."""
    cells = [c for r in rows for c in r["seasonal"]]
    tested = [c for c in cells if c.get("screened") is not None and c.get("p_value") is not None]
    for c in cells:
        c["significant_fdr"] = None if c.get("screened") is None else False
    for c, f in zip(tested, bh([c["p_value"] for c in tested])):
        c["significant_fdr"] = bool(c["screened"] and f)


def _monthly_anomalies(monthly: list[dict], start: int, end: int) -> list[list[float | None]]:
    """years × 12 anomalies from each calendar month's study-period mean (for the climate spiral)."""
    grid = np.full((end - start + 1, 12), np.nan)
    for m in monthly:
        y, mo = int(m["date"][:4]), int(m["date"][5:7])
        if start <= y <= end and m["value"] is not None:
            grid[y - start, mo - 1] = m["value"]
    # Per-month mean only where that month has data; months never observed stay missing (no warning, no invented zero).
    seen = np.isfinite(grid).sum(axis=0)
    clim = np.full(12, np.nan)
    clim[seen > 0] = np.nansum(np.where(np.isfinite(grid), grid, 0.0), axis=0)[seen > 0] / seen[seen > 0]
    anom = grid - clim
    return [[None if not np.isfinite(v) else round(float(v), 4) for v in row] for row in anom]


SPI_SCALE = 3


def spi(monthly: list[dict], scale: int = SPI_SCALE) -> list[dict]:
    """Standardized Precipitation Index (McKee et al. 1993; WMO-recommended drought index) from monthly
    precipitation totals: rolling `scale`-month sums, a gamma distribution fitted per calendar month with a
    point mass at zero, transformed to standard-normal quantiles. Negative = drier than usual for that season.
    Months with a missing total break the rolling sum (no gap filling). Calibration period = the analysis
    period (WMO suggests ≥ 30 years; shorter periods are less stable)."""
    from scipy.stats import gamma, norm
    vals = np.array([np.nan if m["value"] is None else float(m["value"]) for m in monthly])
    roll = np.full(len(vals), np.nan)
    for i in range(scale - 1, len(vals)):
        w = vals[i - scale + 1:i + 1]
        if np.isfinite(w).all():
            roll[i] = w.sum()
    out = np.full(len(vals), np.nan)
    months = np.array([int(m["date"][5:7]) for m in monthly])
    for mo in range(1, 13):
        idx = np.nonzero((months == mo) & np.isfinite(roll))[0]
        if len(idx) < 10:
            continue
        x = roll[idx]
        q = float(np.mean(x <= 0))
        pos = x[x > 0]
        if len(pos) < 8 or np.ptp(pos) <= 0:
            continue
        a, _, b = gamma.fit(pos, floc=0)
        h = q + (1 - q) * gamma.cdf(np.maximum(x, 0), a, 0, b)
        out[idx] = norm.ppf(np.clip(h, 0.001, 0.999))
    return [{"date": m["date"], "value": None if not np.isfinite(v) else float(v)} for m, v in zip(monthly, out)]


def _spi_row(payload: dict, start: int, end: int, rng: np.random.Generator) -> dict | None:
    from .science import fit_trend
    rain = analyze(payload, "PRECTOTCORR", start, end, with_diagnostics=False)
    monthly = spi(rain["monthly"])
    by_year: dict[int, list[float]] = {}
    for m in monthly:
        if m["value"] is not None:
            by_year.setdefault(int(m["date"][:4]), []).append(m["value"])
    annual = [{"year": y, "value": float(np.mean(by_year[y])) if len(by_year.get(y, [])) >= 10 else None, "anomaly": None}
              for y in range(start, end + 1)]
    for a in annual:
        a["anomaly"] = a["value"]           # SPI is already an anomaly in standard-normal units
    usable = [a for a in annual if a["value"] is not None]
    if len(usable) < 6:
        return None
    x = np.array([a["year"] for a in usable], float)
    y = np.array([a["value"] for a in usable], float)
    warnings: list[str] = ["Derived from NASA POWER precipitation; gamma fitted per calendar month over the analysis period."]
    t = fit_trend(x, y, warnings)
    sigma = _residual_sigma(x, y, t["slope"] / 10) if t else None
    return {
        "parameter": "SPI3", "name": f"Drought index (SPI-{SPI_SCALE})", "short": f"Drought (SPI-{SPI_SCALE})", "unit": "SPI",
        "monthly_unit": "SPI", "source": "model", "mission": "Standardized Precipitation Index from NASA POWER precipitation",
        "start": start, "end": end, "trend": t, "sigma": sigma, "z": t["slope"] / sigma if t and sigma else None,
        "coverage": rain["coverage"], "warnings": warnings, "annual": annual,
        "monthly_anomaly": _monthly_anomalies(monthly, start, end), "seasonal": _seasonal(monthly, start, end),
        "permutation": permutation(y, rng, applicable=not (t and t["lag1"] is not None and abs(t["lag1"]) > 1.96 / np.sqrt(t["years"]))),
    }


def scan(payload: dict, start: int, end: int, seed: int = 0) -> dict:
    rng = np.random.default_rng(seed)
    rows = []
    for key in ORDER:
        r = analyze(payload, key, start, end, with_diagnostics=False)
        t = r["trend"]
        usable = [a for a in r["annual"] if a["value"] is not None]
        x = np.array([a["year"] for a in usable], float)
        y = np.array([a["value"] for a in usable], float)
        sigma = _residual_sigma(x, y, t["slope"] / 10) if t else None
        z = (t["slope"] / sigma) if t and sigma else None
        rows.append({
            "parameter": key, "name": NAMES[key], "short": SHORT[key], "unit": UNITS[key], "monthly_unit": MONTHLY_UNITS[key],
            "source": "model", "mission": "NASA POWER · MERRA-2-derived daily estimates", "start": start, "end": end,
            "trend": t, "sigma": sigma, "z": z,
            "coverage": r["coverage"], "warnings": r["warnings"],
            "annual": [{"year": a["year"], "value": a["value"], "anomaly": a["anomaly"]} for a in r["annual"]],
            "monthly_anomaly": _monthly_anomalies(r["monthly"], start, end),
            "seasonal": _seasonal(r["monthly"], start, end),
            "permutation": permutation(y, rng, applicable=not (t and t["lag1"] is not None and abs(t["lag1"]) > 1.96 / np.sqrt(t["years"]))) if len(y) >= 6 else None,
        })
    drought = _spi_row(payload, start, end, rng)
    if drought:
        rows.append(drought)
    # Multiple testing: the 8 variables + drought index at one place, and their month cells.
    fdr = bh([r["trend"]["p_value"] if r["trend"] else None for r in rows])
    for r, f in zip(rows, fdr):
        screened = r["trend"]["significant"] if r["trend"] else None   # None = withheld (short / autocorrelated)
        r["significant_fdr"] = None if screened is None else bool(screened and f)
        r["status"] = ("withheld" if screened is None else
                       "significant" if r["significant_fdr"] else
                       "nominal" if screened else "not_significant")
    _seasonal_fdr(rows)
    ranked = sorted(rows, key=lambda r: (r["status"] != "significant", -(abs(r["z"]) if r["z"] is not None else -1)))
    return {
        "start": start, "end": end, "variables": rows, "ranking": [r["parameter"] for r in ranked],
        "counts": {s: sum(r["status"] == s for r in rows) for s in ("significant", "nominal", "not_significant", "withheld")},
        "methods": {
            "slope": "Theil–Sen slope of annual values, per decade",
            "standardized": "σ/decade = slope ÷ standard deviation of the detrended annual values (year-to-year variability)",
            "test": "Two-sided Mann–Kendall (Kendall tau) on annual values; withheld when < 10 years or lag-1 autocorrelated",
            "multiple_testing": "Benjamini–Hochberg FDR at 5%, four separate families: model annual (8 variables), model seasonal (month × variable cells that pass the screens), satellite annual, satellite seasonal",
            "permutation": f"{PERMUTATIONS} random shuffles of the observed annual values give the null distribution of the Mann–Kendall S statistic. Shuffling assumes independent years, so the result is marked not applicable when the lag-1 autocorrelation screen fails.",
            "drought": f"SPI-{SPI_SCALE}: {SPI_SCALE}-month precipitation sums, gamma fit per calendar month with a zero point mass, standard-normal transform (McKee et al. 1993; WMO-recommended); annual value = mean of the 12 monthly SPI values",
            "seasonal": "Each calendar month's mean (precipitation: total) per year, with the same rule as the annual series: Theil–Sen, Mann–Kendall, ≥ 10 years and lag-1 autocorrelation screen; withheld cells are excluded from FDR and never marked significant",
        },
    }
