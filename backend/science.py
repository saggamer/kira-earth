"""Transparent annual trend analysis; all inputs are actual provider values."""
import numpy as np
import pandas as pd
from scipy.stats import kendalltau, theilslopes
from .analytics import diagnostics

# NASA POWER daily point parameters (MERRA-2-derived). Units are the provider's own labels.
PROVIDER_UNITS = {"T2M": "C", "T2M_MAX": "C", "T2M_MIN": "C", "PRECTOTCORR": "mm/day", "RH2M": "%", "WS10M": "m/s", "PS": "kPa", "GWETROOT": "1"}
PARAMETERS = set(PROVIDER_UNITS)
# Units of the annual values this module reports (precipitation is summed, everything else averaged).
UNITS = {"T2M": "°C", "T2M_MAX": "°C", "T2M_MIN": "°C", "PRECTOTCORR": "mm/year", "RH2M": "%", "WS10M": "m/s", "PS": "kPa", "GWETROOT": "fraction"}
DAILY_UNITS = {**UNITS, "PRECTOTCORR": "mm/day"}
# Physically possible daily ranges; values outside are treated as missing, never clipped.
VALID_RANGE = {"PRECTOTCORR": (0, None), "RH2M": (0, 100), "WS10M": (0, None), "PS": (30, 110), "GWETROOT": (0, 1)}

def clean(series, parameter):
    low, high = VALID_RANGE.get(parameter, (None, None))
    if low is not None: series = series.where(series >= low)
    if high is not None: series = series.where(series <= high)
    return series

def fit_trend(x: np.ndarray, y: np.ndarray, warnings: list[str]) -> dict | None:
    """Theil–Sen slope + Mann–Kendall test on annual values, with the record-length and lag-1 autocorrelation screens.
    Shared by the point investigation, the Change Studio and the satellite (MODIS) series."""
    if len(y) < 3:
        warnings.append("At least three usable years are required to estimate a trend.")
        return None
    slope, intercept, low, high = theilslopes(y, x, alpha=.95)
    p = float(kendalltau(x, y).pvalue) if np.ptp(y) > 0 else 1.
    residual = y - (slope * x + intercept)
    consecutive = np.diff(x) == 1
    lag = None
    if consecutive.sum() >= 3 and np.std(residual[:-1][consecutive]) > 1e-10 and np.std(residual[1:][consecutive]) > 1e-10:
        lag = float(np.corrcoef(residual[:-1][consecutive], residual[1:][consecutive])[0, 1])
    autocorrelated = lag is not None and abs(lag) > 1.96 / np.sqrt(len(x))
    # Withhold inference when independence or sufficient record length is doubtful.
    significant = None if len(x) < 10 or autocorrelated else bool(p < .05)
    if len(x) < 10:
        warnings.append("Fewer than 10 usable annual values: trend is exploratory; significance is withheld.")
    if autocorrelated:
        warnings.append("Detrended lag-1 autocorrelation exceeds an approximate 95% screening threshold. Unadjusted significance and confidence limits are exploratory; no significance claim is made.")
    return {"slope": float(slope * 10), "low": float(low * 10), "high": float(high * 10), "p_value": p, "significant": significant, "lag1": lag, "total_change": float(slope * (x[-1] - x[0])), "years": len(x), "direction": "increasing" if slope > 0 else "decreasing" if slope < 0 else "unchanged"}

def analyze(payload: dict, parameter: str, start: int, end: int, with_diagnostics: bool = True) -> dict:
    """with_diagnostics=False skips the bootstrap/extremes block (used per cell by the trend map)."""
    if parameter not in PARAMETERS:
        raise ValueError("Unsupported NASA POWER parameter")
    values = payload["properties"]["parameter"][parameter]
    fill = payload.get("header", {}).get("fill_value", -999)
    idx = pd.date_range(f"{start}-01-01", f"{end}-12-31", freq="D")
    series = pd.Series(list(values.values()), index=pd.to_datetime(list(values), format="%Y%m%d"), dtype=float).reindex(idx)
    series = series.mask((series == fill) | ~np.isfinite(series))
    rain = parameter == "PRECTOTCORR"
    series = clean(series, parameter)
    annual = []
    for year in range(start, end + 1):
        s = series[series.index.year == year]
        coverage = float(s.notna().mean())
        # Rainfall totals require complete years: do not scale incomplete totals.
        valid = coverage == 1 if rain else coverage >= .9
        value = float(s.sum()) if rain else float(s.mean())
        annual.append({"year": year, "value": value if valid else None, "coverage": round(coverage * 100, 2), "anomaly": None})
    usable = [a for a in annual if a["value"] is not None]
    baseline = float(np.mean([a["value"] for a in usable])) if usable else None
    for a in annual:
        if a["value"] is not None and baseline is not None:
            a["anomaly"] = a["value"] - baseline
    monthly = []
    for month, s in series.resample("MS"):
        valid = s.notna().all() if rain else s.notna().mean() >= .9
        monthly.append({"date": month.strftime("%Y-%m"), "value": float(s.sum() if rain else s.mean()) if valid else None})
    warnings = []
    coverage = float(series.notna().mean() * 100)
    if coverage < 100:
        warnings.append("Missing daily values are excluded. Annual means require ≥90% coverage; precipitation totals require 100%.")
    trend = fit_trend(np.array([a["year"] for a in usable], dtype=float), np.array([a["value"] for a in usable], dtype=float), warnings)
    return {"analysis": diagnostics(payload, parameter, start, end, annual, monthly) if with_diagnostics else None, "parameter": parameter, "unit": UNITS[parameter], "coverage": round(coverage, 2), "valid_days": int(series.notna().sum()), "expected_days": len(idx), "annual": annual, "monthly": monthly, "trend": trend, "baseline": f"{start}–{end} usable annual values (study-period mean, not a standard climate normal)", "warnings": warnings, "metadata": {"header": payload.get("header", {}), "parameter": payload.get("parameters", {}).get(parameter, {}), "geometry": payload.get("geometry", {}), "methods": {"aggregation": "Annual precipitation totals, no gap-filling" if rain else "Daily values averaged within each year; years with <90% coverage omitted; physically impossible values treated as missing", "slope": "Theil–Sen estimator with actual calendar years; reported per decade", "test": "Two-sided Kendall tau / Mann–Kendall test on annual values with tie handling", "confidence": "95% Theil–Sen interval, assumes independent annual values", "autocorrelation": "Lag-1 Pearson correlation of detrended annual residuals, consecutive years only; significance withheld above 1.96/√n", "multiple_testing": "Single location; no spatial multiple testing performed", "total_change": "Sen slope × elapsed years; a fitted change, not endpoint subtraction"}}}
