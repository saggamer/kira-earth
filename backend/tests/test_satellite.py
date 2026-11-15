from datetime import date, timedelta
import numpy as np
from backend import satellite as SAT
from backend.tests.test_scan import _payload


def test_item_dates_come_from_modis_granule_ids():
    assert SAT._item_date("modis-11A2-061/MOD11A2.A2020001.h20v05.061.2021005131821") == date(2020, 1, 1)
    assert SAT._item_date("MOD13A1.A2019353.h20v05.061") == date(2019, 12, 19)
    assert SAT._item_date("no-date-here") is None


def _composites(start=2001, end=2025, every=8, base=20.0, warm=0.05, drop_months=()):
    out = {}
    d = date(start, 1, 1)
    while d.year <= end:
        if d.month not in drop_months:
            out[d.isoformat()] = base + warm * (d.year - start) + 5 * np.sin(2 * np.pi * d.timetuple().tm_yday / 365)
        d += timedelta(days=every)
    return out


import pytest


@pytest.mark.parametrize("cut", [2013, 2016])
def test_dropping_cold_months_cannot_create_warming(cut):
    """SCI-03 regression: Jan/Feb 0 °C, other months 20 °C, unchanged every year; later years lose Jan/Feb.
    cut=2013: Jan/Feb seen in < half the years → masked for all years. cut=2016: kept, handled by anomalies."""
    series = {}
    for y in range(2001, 2026):
        for m in range(1, 13):
            if y >= cut and m in (1, 2):
                continue
            for day in (5, 20):
                series[f"{y}-{m:02d}-{day:02d}"] = 0.0 if m in (1, 2) else 20.0
    row = SAT._row("LST_DAY", series, 2025, np.random.default_rng(0))
    vals = [a["value"] for a in row["annual"] if a["value"] is not None]
    assert max(vals) - min(vals) < 1e-9                 # the old 10-month mean jumped 16.67 → 20.00
    assert abs(row["trend"]["slope"]) < 1e-9
    q = row["quality"]
    assert q["masked_months"] == [1, 2] or (q["coverage_shift"] > 0.3 and any("Seasonal coverage changes" in w for w in row["warnings"]))


def test_months_missing_in_most_years_are_masked_for_all_years():
    rng = np.random.default_rng(0)
    full = SAT._row("LST_DAY", _composites(), 2025, rng)
    assert all(a["value"] is not None for a in full["annual"]) and full["trend"]["slope"] > 0.3
    cloudy = SAT._row("LST_DAY", _composites(drop_months=(6, 7, 8)), 2025, rng)
    assert cloudy["quality"]["masked_months"] == [6, 7, 8]
    assert cloudy["trend"]["slope"] > 0.3            # a consistent mask leaves the real warming intact


def test_qa_rejects_in_range_values_with_bad_quality():
    """SCI-02: values inside the valid range must still be dropped when the QA flags say so."""
    assert SAT.qa_ok("LST_DAY", 0b00000000) == (True, "good")
    assert SAT.qa_ok("LST_DAY", 0b01000001)[0] is True          # other quality, LST error ≤ 2 K
    assert SAT.qa_ok("LST_DAY", 0b11000001)[0] is False         # other quality, LST error > 3 K
    assert SAT.qa_ok("LST_NIGHT", 0b00000010)[0] is False       # not produced (cloud)
    assert SAT.qa_ok("NDVI", 3) == (False, "cloudy") and SAT.qa_ok("NDVI", 2) == (False, "snow_ice")
    assert SAT.qa_ok("NDVI", 1) == (True, "marginal")


def test_cross_check_confirms_when_satellite_and_model_agree():
    raw = {"LST_DAY": _composites(start=2001, end=2019, warm=0.06), "LST_NIGHT": _composites(start=2001, end=2019, warm=0.06),
           "NDVI": {}, "ET": {}, "NPP": {}}
    out = SAT.build(raw, 2019, _payload(1990, 2019, warm=0.04))
    assert {v["parameter"] for v in out["variables"]} == {"LST_DAY", "LST_NIGHT"}      # empty products are dropped
    verdicts = {c["satellite"]: c["verdict"] for c in out["cross_checks"]}
    assert verdicts == {"LST_DAY": "confirmed", "LST_NIGHT": "confirmed"}
    assert out["variables"][0]["source"] == "satellite"
