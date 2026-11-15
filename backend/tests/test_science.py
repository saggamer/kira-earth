from datetime import date, timedelta
import pytest
from backend.science import analyze

def payload(years, missing=None, parameter="T2M"):
    data = {}
    for year, value in years.items():
        day = date(year, 1, 1)
        while day.year == year:
            data[day.strftime("%Y%m%d")] = -999 if missing and missing(day) else value
            day += timedelta(days=1)
    return {"header": {"fill_value": -999}, "properties": {"parameter": {parameter: data}}}

def test_known_sen_slope_and_significance():
    r = analyze(payload({y: 20 + .2 * (y - 2001) for y in range(2001, 2025)}), "T2M", 2001, 2024)
    assert r["trend"]["slope"] == pytest.approx(2)
    assert r["trend"]["total_change"] == pytest.approx(4.6)
    assert r["trend"]["significant"] is True
    assert r["coverage"] == 100

def test_constant_series_has_no_significant_trend():
    r = analyze(payload({y: 20 for y in range(2001, 2025)}), "T2M", 2001, 2024)
    assert r["trend"]["slope"] == 0
    assert r["trend"]["p_value"] == 1
    assert r["trend"]["significant"] is False

def test_rain_missing_day_never_scaled_into_total():
    r = analyze(payload({2020: 1, 2021: 1, 2022: 1}, lambda d: d == date(2021, 1, 1), "PRECTOTCORR"), "PRECTOTCORR", 2020, 2022)
    assert [a["value"] for a in r["annual"]] == [366, None, 365]
    assert r["trend"] is None

def test_short_series_withholds_significance():
    r = analyze(payload({y: y for y in range(2001, 2006)}), "T2M", 2001, 2005)
    assert r["trend"]["significant"] is None

def test_missing_year_is_not_compressed_in_time():
    r = analyze(payload({2001: 0, 2003: 2, 2006: 5}), "T2M", 2001, 2006)
    assert r["trend"]["slope"] == pytest.approx(10)
    assert r["annual"][1]["value"] is None

def test_empty_series_does_not_invent_values():
    r = analyze(payload({}), "T2M", 2001, 2004)
    assert r["trend"] is None
    assert r["coverage"] == 0
    assert all(a["value"] is None for a in r["annual"])

def test_anomalies_use_explicit_study_period_baseline():
    r = analyze(payload({2001: 10, 2002: 12, 2003: 14}), "T2M", 2001, 2003)
    assert [a["anomaly"] for a in r["annual"]] == [-2, 0, 2]

def test_unsupported_parameter_rejected():
    with pytest.raises(ValueError):
        analyze({}, "FAKE", 2001, 2024)

def test_autocorrelated_residuals_withhold_significance():
    import math
    r = analyze(payload({y: 20 + .1 * (y - 2001) + math.sin((y - 2001) / 2) for y in range(2001, 2025)}), "T2M", 2001, 2024)
    assert abs(r["trend"]["lag1"]) > 1.96 / math.sqrt(24)
    assert r["trend"]["significant"] is None
    assert any("autocorrelation" in w for w in r["warnings"])

@pytest.mark.parametrize("parameter,value,unit", [("RH2M", 70.0, "%"), ("WS10M", 3.2, "m/s"), ("PS", 95.1, "kPa"), ("GWETROOT", .55, "fraction")])
def test_new_power_variables_are_averaged_with_their_own_units(parameter, value, unit):
    r = analyze(payload({y: value + .01 * (y - 2001) for y in range(2001, 2025)}, parameter=parameter), parameter, 2001, 2024)
    assert r["unit"] == unit and r["analysis"]["summary"]["unit"] == unit
    assert r["annual"][0]["value"] == pytest.approx(value)
    assert r["trend"]["slope"] == pytest.approx(.1)

def test_physically_impossible_values_are_missing_not_clipped():
    # Humidity above 100% and soil wetness above 1 are provider errors: drop the day, never clip it.
    bad = payload({2020: 60, 2021: 60}, parameter="RH2M")
    bad["properties"]["parameter"]["RH2M"]["20200101"] = 140
    r = analyze(bad, "RH2M", 2020, 2021)
    assert r["valid_days"] == 366 + 365 - 1
    assert r["annual"][0]["value"] == pytest.approx(60)
    soil = payload({2020: .5}, parameter="GWETROOT")
    soil["properties"]["parameter"]["GWETROOT"]["20200102"] = 1.4
    assert analyze(soil, "GWETROOT", 2020, 2020)["valid_days"] == 365
