"""Reproducible daily, seasonal, extreme-event and dependence-aware diagnostics."""
import numpy as np
import pandas as pd
from scipy.stats import theilslopes

def clean(series, key):
    from .science import clean as _clean
    return _clean(series, key)

DAILY_UNITS = {"T2M": "°C", "T2M_MAX": "°C", "T2M_MIN": "°C", "PRECTOTCORR": "mm/day", "RH2M": "%", "WS10M": "m/s", "PS": "kPa", "GWETROOT": "fraction"}

def longest_run(values):
    longest = current = 0
    for value in values:
        current = current + 1 if bool(value) else 0
        longest = max(longest, current)
    return longest

def block_sample(values, rng, block):
    n = len(values)
    starts = rng.integers(0, n, int(np.ceil(n / block)))
    return np.concatenate([values[(np.arange(block) + start) % n] for start in starts])[:n]

def diagnostics(payload, parameter, start, end, annual, monthly):
    index = pd.date_range(f"{start}-01-01", f"{end}-12-31", freq="D")
    fill = payload.get("header", {}).get("fill_value", -999)
    series_cache = {}
    def read(key):
        if key in series_cache: return series_cache[key]
        values = payload.get("properties", {}).get("parameter", {}).get(key, {})
        s = pd.Series(list(values.values()), index=pd.to_datetime(list(values), format="%Y%m%d"), dtype=float).reindex(index)
        s = s.mask((s == fill) | ~np.isfinite(s))
        s = clean(s, key)
        series_cache[key] = s
        return s
    s = read(parameter)
    rain = parameter == "PRECTOTCORR"
    observed = s.dropna()
    summary = None
    if not observed.empty:
        q = observed.quantile([.05, .25, .5, .75, .95])
        summary = {"mean": float(observed.mean()), "median": float(q.loc[.5]), "std": float(observed.std()) if len(observed) > 1 else None, "minimum": float(observed.min()), "minimum_date": str(observed.idxmin().date()), "maximum": float(observed.max()), "maximum_date": str(observed.idxmax().date()), "p05": float(q.loc[.05]), "p25": float(q.loc[.25]), "p75": float(q.loc[.75]), "p95": float(q.loc[.95]), "unit": DAILY_UNITS[parameter]}
    seasons = []
    for month in range(1, 13):
        usable = [m["value"] for m in monthly if int(m["date"][5:7]) == month and m["value"] is not None]
        seasons.append({"month": month, "mean": float(np.mean(usable)) if usable else None, "std": float(np.std(usable, ddof=1)) if len(usable) > 1 else None, "minimum": float(np.min(usable)) if usable else None, "maximum": float(np.max(usable)) if usable else None, "samples": len(usable)})
    seasonal_anomalies = []
    for m in monthly:
        c = seasons[int(m["date"][5:7]) - 1]
        seasonal_anomalies.append({"date": m["date"], "departure": m["value"] - c["mean"] if m["value"] is not None and c["mean"] is not None else None, "standardized": (m["value"] - c["mean"]) / c["std"] if m["value"] is not None and c["samples"] >= 10 and c["std"] is not None and c["std"] > 1e-10 else None})
    usable = [a for a in annual if a["value"] is not None]
    robust = None
    if len(usable) >= 10 and all(b["year"] - a["year"] == 1 for a, b in zip(usable, usable[1:])):
        x = np.array([a["year"] for a in usable], dtype=float)
        y = np.array([a["value"] for a in usable], dtype=float)
        slope, intercept, _, _ = theilslopes(y, x)
        residual = y - (intercept + slope * x)
        residual -= np.mean(residual)
        block = max(2, int(np.ceil(len(y) ** (1 / 3))))
        rng = np.random.default_rng(413)
        slopes = [float(theilslopes(intercept + slope * x + block_sample(residual, rng, block), x)[0] * 10) for _ in range(499)]
        lower, upper = np.quantile(slopes, [.025, .975])
        robust = {"low": float(lower), "high": float(upper), "slope": float(slope * 10), "iterations": 499, "block_years": block, "seed": 413, "interval_excludes_zero": bool(lower > 0 or upper < 0), "method": "Circular moving-block residual bootstrap of annual Sen slope; 95% percentile interval", "limitation": "Exploratory: assumes stationary detrended residuals and weak dependence. Not a separate p-value or a causal attribution test."}
    split = (start + end + 1) // 2
    early = [a for a in usable if a["year"] < split]
    late = [a for a in usable if a["year"] >= split]
    comparison = None
    if early and late:
        a, b = np.array([v["value"] for v in early]), np.array([v["value"] for v in late])
        delta = float(b.mean() - a.mean())
        comparison = {"early": {"start": start, "end": split - 1, "mean": float(a.mean()), "years": len(a)}, "late": {"start": split, "end": end, "mean": float(b.mean()), "years": len(b)}, "difference": delta, "percent": delta / float(a.mean()) * 100 if rain and a.mean() > 0 else None, "interval": None}
        if len(early) == split - start and len(late) == end - split + 1 and min(len(a), len(b)) >= 5:
            rng = np.random.default_rng(414)
            deltas = [block_sample(b, rng, max(2, int(np.ceil(len(b) ** (1 / 3))))).mean() - block_sample(a, rng, max(2, int(np.ceil(len(a) ** (1 / 3))))).mean() for _ in range(499)]
            comparison["interval"] = np.quantile(deltas, [.025, .975]).tolist()
    rainfall = read("PRECTOTCORR")
    max_t, min_t = read("T2M_MAX"), read("T2M_MIN")
    extremes = []
    rolling_rain = rainfall.rolling(5, min_periods=5).sum()
    for year in range(start, end + 1):
        r, tx, tn = [v[v.index.year == year] for v in (rainfall, max_t, min_t)]
        complete_rain, complete_tx, complete_tn = [bool(v.notna().all()) for v in (r, tx, tn)]
        wet = r[r >= 1]
        rr5 = rolling_rain[rolling_rain.index.year == year]
        extremes.append({"year": year, "wet_days": int(len(wet)) if complete_rain else None, "heavy_rain_days": int((r >= 10).sum()) if complete_rain else None, "very_heavy_rain_days": int((r >= 20).sum()) if complete_rain else None, "rx1day": float(r.max()) if complete_rain else None, "rx5day": float(rr5.max()) if complete_rain and rr5.notna().any() else None, "wet_day_intensity": float(wet.mean()) if complete_rain and len(wet) else None, "longest_dry_spell": longest_run(r.notna() & (r < 1)) if complete_rain else None, "longest_wet_spell": longest_run(r >= 1) if complete_rain else None, "hot_days": int((tx >= 35).sum()) if complete_tx else None, "tropical_nights": int((tn > 20).sum()) if complete_tn else None, "frost_nights": int((tn < 0).sum()) if complete_tn else None, "longest_hot_spell": longest_run(tx >= 35) if complete_tx else None, "diurnal_range": float((tx - tn).mean()) if complete_tx and complete_tn else None})
    temperature = read("T2M").resample("MS").mean()
    temperature = temperature.where(read("T2M").resample("MS").count() / temperature.index.days_in_month >= .9)
    rain_monthly = rainfall.resample("MS").sum(min_count=1)
    rain_monthly = rain_monthly.where(rainfall.resample("MS").count() == rain_monthly.index.days_in_month)
    pair = pd.DataFrame({"temperature": temperature, "rainfall": rain_monthly}).dropna()
    correlation = None
    if len(pair) >= 24:
        de_seasoned = pair - pair.groupby(pair.index.month).transform("mean")
        if (de_seasoned.std() > 1e-10).all():
            correlation = {"pearson_r": float(de_seasoned.corr().iloc[0, 1]), "paired_months": len(pair), "method": "Calendar-month-demeaned temperature vs rainfall; no independent-sample p-value is asserted", "limitation": "Association is not causation; serial dependence remains possible."}
    return {"summary": summary, "seasonal_cycle": seasons, "seasonal_anomalies": seasonal_anomalies, "robust_trend": robust, "period_comparison": comparison, "extremes": extremes, "correlation": correlation, "quality": {"missing_days": int(s.isna().sum()), "longest_missing_run": longest_run(s.isna()), "usable_years": len(usable), "excluded_years": [a["year"] for a in annual if a["value"] is None], "first_valid": str(observed.index[0].date()) if len(observed) else None, "last_valid": str(observed.index[-1].date()) if len(observed) else None}, "definitions": {"wet_day": "Daily precipitation ≥1 mm", "heavy_rain_day": "Daily precipitation ≥10 mm", "very_heavy_rain_day": "Daily precipitation ≥20 mm", "hot_day": "Daily maximum 2 m temperature ≥35°C", "tropical_night": "Daily minimum 2 m temperature >20°C", "frost_night": "Daily minimum 2 m temperature <0°C", "spells": "Longest consecutive runs within each complete calendar year. Missing years are excluded, not gap-filled.", "rx5day": "Maximum complete trailing 5-day rainfall sum ending within the year; not a rainfall rate", "seasonal_baseline": f"{start}–{end} study-period calendar-month means; not a standard climate normal", "standardized_departure": "Monthly departure / sample standard deviation, minimum 10 usable years per month; not a fitted SPI drought index", "period_interval": "499-iteration circular moving-block bootstrap of each complete period; approximate 95% percentile interval", "thresholds": "Descriptive fixed thresholds; not location-specific impact or health risk thresholds"}}
