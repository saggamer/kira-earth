import numpy as np
from backend import scan as S


def _payload(start=1990, end=2019, warm=0.03):
    days = {}
    rng = np.random.default_rng(1)
    import pandas as pd
    for d in pd.date_range(f"{start}-01-01", f"{end}-12-31"):
        t = 20 + warm * (d.year - start) + 5 * np.sin(2 * np.pi * d.day_of_year / 365) + rng.normal(0, 1)
        days[d.strftime("%Y%m%d")] = t
    flat = {k: 50.0 + rng.normal(0, 2) for k in days}
    param = {"T2M": days, "T2M_MAX": {k: v + 5 for k, v in days.items()}, "T2M_MIN": {k: v - 5 for k, v in days.items()},
             "PRECTOTCORR": {k: abs(rng.normal(2, 1)) for k in days}, "RH2M": flat, "WS10M": {k: 3 + rng.normal(0, .3) for k in days},
             "PS": {k: 100 + rng.normal(0, .2) for k in days}, "GWETROOT": {k: .5 for k in days}}
    return {"properties": {"parameter": param}, "header": {"fill_value": -999}}


def test_bh_controls_false_discoveries():
    assert S.bh([0.001, 0.04, 0.03, 0.9]) == [True, False, False, False]  # .03 > 2/4·.05 and .04 > 3/4·.05
    assert S.bh([0.01, 0.02, 0.03, 0.04]) == [True, True, True, True]
    assert S.bh([None, 0.5]) == [None, False]


def test_mann_kendall_s_and_permutation_null():
    assert S.mk_s(np.arange(5.0)) == 10
    p = S.permutation(np.arange(20.0), np.random.default_rng(0), n=500)
    assert p["s_observed"] == p["s_max"] and p["p_value"] < 0.01 and sum(p["histogram"]["counts"]) == 500


def test_scan_ranks_the_warming_variable_first_and_flags_constant_ones():
    out = S.scan(_payload(), 1990, 2019)
    by = {v["parameter"]: v for v in out["variables"]}
    assert out["ranking"][0] in ("T2M", "T2M_MAX", "T2M_MIN")
    t = by["T2M"]
    assert t["status"] == "significant" and t["z"] > 1 and abs(t["trend"]["slope"] - 0.3) < 0.1
    assert len(t["monthly_anomaly"]) == 30 and len(t["monthly_anomaly"][0]) == 12
    assert len(t["seasonal"]) == 12 and t["permutation"]["p_value"] < 0.01
    assert by["GWETROOT"]["status"] != "significant"           # constant series: never called a change
    assert sum(out["counts"].values()) == 9           # 8 POWER variables + drought index


def test_seasonal_cells_withhold_significance_when_autocorrelated():
    """SCI-04: a strongly persistent month series cannot get an independent-sample significance badge."""
    monthly = []
    rng = np.random.default_rng(3)
    walk = np.cumsum(rng.normal(0, 1, 40))           # random walk: lag-1 autocorrelated, often 'trended'
    for i, y in enumerate(range(1981, 2021)):
        for m in range(1, 13):
            monthly.append({"date": f"{y}-{m:02d}", "value": float(walk[i]) if m == 7 else float(rng.normal())})
    cells = S._seasonal(monthly, 1981, 2020)
    july = cells[6]
    assert july["lag1"] is not None and july["withheld"] and july["screened"] is None
    row = {"seasonal": cells}
    S._seasonal_fdr([row])
    assert july["significant_fdr"] is None


def test_permutation_flags_dependence():
    p = S.permutation(np.arange(20.0), np.random.default_rng(0), n=100, applicable=False)
    assert p["applicable"] is False and "exchangeable" in p["assumption"]


def test_monthly_anomalies_tolerate_unobserved_months_without_warning():
    import warnings
    monthly = [{"date": f"{y}-{m:02d}", "value": (None if m == 1 else 1.0)} for y in range(2001, 2011) for m in range(1, 13)]
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        grid = S._monthly_anomalies(monthly, 2001, 2010)
    assert all(row[0] is None for row in grid)


def test_spi_is_standard_normal_and_detects_drying():
    rng = np.random.default_rng(5)
    monthly = []
    for i, y in enumerate(range(1981, 2021)):
        for m in range(1, 13):
            wet = 80 if m in (6, 7, 8) else 20
            monthly.append({"date": f"{y}-{m:02d}", "value": float(rng.gamma(4, wet / 4) * (1 - 0.012 * i))})   # slowly drying
    out = [v["value"] for v in S.spi(monthly) if v["value"] is not None]
    assert abs(np.mean(out)) < 0.2 and 0.8 < np.std(out) < 1.2
    early, late = np.mean(out[:120]), np.mean(out[-120:])
    assert late < early - 0.5


def test_scan_includes_drought_index():
    out = S.scan(_payload(), 1990, 2019)
    spi = next(v for v in out["variables"] if v["parameter"] == "SPI3")
    assert spi["unit"] == "SPI" and len(spi["seasonal"]) == 12 and spi["status"] in ("significant", "nominal", "not_significant", "withheld")
