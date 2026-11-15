import asyncio
from datetime import date, timedelta
import numpy as np
import pytest
from fastapi import HTTPException
from backend.trendmap import (MAX_CELLS, TrendMapRequest, assemble, benjamini_hochberg, cell_trend, grid_cells, trend_map)

START, END = 1995, 2024


def payload(annual: dict[int, float], parameter="T2M"):
    data = {}
    for year, value in annual.items():
        day = date(year, 1, 1)
        while day.year == year:
            data[day.strftime("%Y%m%d")] = value
            day += timedelta(days=1)
    return {"header": {"fill_value": -999}, "properties": {"parameter": {parameter: data}}}


def field_slope(cell):
    """Known synthetic slope field in °C/year: west half warms, east half cools, magnitude grows north."""
    sign = 1 if cell["longitude"] < 77 else -1
    return sign * (.02 + .01 * (cell["latitude"] - 10))


def synthetic_loader(slope_of, noise=0.0, fail=()):
    rng = np.random.default_rng(42)
    calls = []

    async def loader(lat, lon, start, end):
        calls.append((lat, lon))
        if (lat, lon) in fail:
            raise HTTPException(503, "NASA POWER data is unavailable.")
        s = slope_of({"latitude": lat, "longitude": lon})
        values = {y: 20 + s * (y - start) + (noise * rng.standard_normal() if noise else 0) for y in range(start, end + 1)}
        return {"payload": payload(values), "source_url": f"https://power.larc.nasa.gov/?lat={lat}&lon={lon}", "retrieved_at": "2026-11-15T00:00:00Z"}, "cached"
    loader.calls = calls
    return loader


def test_grid_cells_are_native_centers_inside_box_and_capped():
    cells = grid_cells(11.0168, 76.9558, 2.5)
    assert 64 <= len(cells) <= MAX_CELLS
    assert len({(c["latitude"], c["longitude"]) for c in cells}) == len(cells)
    for c in cells:
        assert abs(c["latitude"] - 11.0168) <= 2.5 and abs(c["longitude"] - 76.9558) <= 2.5
        assert c["latitude"] / .5 == pytest.approx(round(c["latitude"] / .5))
        assert c["longitude"] / .625 == pytest.approx(round(c["longitude"] / .625))
        b = c["bounds"]
        assert b["north"] - b["south"] == pytest.approx(.5) and b["east"] - b["west"] == pytest.approx(.625)
    # A 5°×5° box aligned on grid lines is the worst case and still fits the cap.
    assert len(grid_cells(10, 75, 2.5)) <= MAX_CELLS
    with pytest.raises(ValueError):
        TrendMapRequest(latitude=0, longitude=0, half_span=6)


def test_request_validation():
    with pytest.raises(ValueError): TrendMapRequest(latitude=83, longitude=0, half_span=5)
    with pytest.raises(ValueError): TrendMapRequest(latitude=0, longitude=178, half_span=5)
    with pytest.raises(ValueError): TrendMapRequest(latitude=0, longitude=0, start=2020, end=2010)
    with pytest.raises(ValueError): TrendMapRequest(latitude=0, longitude=0, start=2015, end=2020)
    with pytest.raises(ValueError): TrendMapRequest(latitude=float("nan"), longitude=0)


def test_benjamini_hochberg_matches_textbook_example():
    # Benjamini & Hochberg (1995)-style worked example, m=10, alpha=.05.
    p = [.001, .008, .039, .041, .042, .06, .074, .205, .212, .216]
    reject, q, threshold = benjamini_hochberg(p, .05)
    # k=2 is the largest rank with p_(k) <= k/m*alpha (0.008 <= 0.01; 0.039 > 0.015 ... 0.042 > 0.025).
    assert reject.tolist() == [True, True] + [False] * 8
    assert threshold == .008
    assert q[0] == pytest.approx(.01) and q[1] == pytest.approx(.04)
    assert np.all(np.diff(q) >= -1e-12) and np.all(q <= 1)


def test_benjamini_hochberg_is_step_up_and_ignores_missing():
    # 0.03 alone fails its own rank-1 bound only if m is large; step-up passes everything below the last passing rank.
    reject, q, threshold = benjamini_hochberg([.04, .045, np.nan, .03], .05)
    assert reject.tolist() == [True, True, False, True]
    assert np.isnan(q[2]) and threshold == .045
    none, q2, t2 = benjamini_hochberg([.2, .5, .9])
    assert not none.any() and t2 is None
    empty, _, t3 = benjamini_hochberg([np.nan, np.nan])
    assert not empty.any() and t3 is None


def test_fdr_is_stricter_than_uncorrected_on_pure_noise():
    rng = np.random.default_rng(7)
    p = rng.uniform(size=100)
    reject, _, _ = benjamini_hochberg(p)
    assert (p < .05).sum() > 0
    assert reject.sum() <= (p < .05).sum()
    assert reject.sum() == 0


def test_known_slope_field_with_opposite_halves():
    request = TrendMapRequest(name="Test", latitude=11, longitude=77, half_span=2.5, start=START, end=END)
    loader = synthetic_loader(field_slope)
    result = asyncio.run(trend_map(request, loader))
    cells, summary = result["cells"], result["summary"]
    assert len(loader.calls) == len(cells) == summary["cells"]
    assert summary["tested"] == len(cells) and summary["missing"] == 0
    for c in cells:
        assert c["status"] == "ok"
        assert c["slope"] == pytest.approx(field_slope(c) * 10, abs=1e-9)  # per decade
        assert c["fdr_significant"] is True  # noise-free monotonic trend
        assert c["source_url"].startswith("https://power.larc.nasa.gov/")
    west = [c for c in cells if c["longitude"] < 77]
    east = [c for c in cells if c["longitude"] > 77]
    assert west and east and all(c["slope"] > 0 for c in west) and all(c["slope"] < 0 for c in east)
    assert summary["opposite_directions"] and summary["opposite_significant"]
    assert summary["fdr_increasing"] == len(west)
    assert summary["scale"] == pytest.approx(max(abs(c["slope"]) for c in cells))
    assert result["unit"] == "°C per decade"


def test_missing_cells_stay_missing_without_interpolation():
    request = TrendMapRequest(latitude=11, longitude=77, half_span=1, start=START, end=END)
    cells = grid_cells(11, 77, 1)
    gone = {(cells[0]["latitude"], cells[0]["longitude"]), (cells[3]["latitude"], cells[3]["longitude"])}
    result = asyncio.run(trend_map(request, synthetic_loader(field_slope, fail=gone)))
    missing = [c for c in result["cells"] if c["status"] == "unavailable"]
    assert {(c["latitude"], c["longitude"]) for c in missing} == gone
    for c in missing:
        assert "slope" not in c and c["q_value"] is None and c["fdr_significant"] is False
    assert result["summary"]["missing"] == 2
    assert result["summary"]["tested"] == len(cells) - 2


def test_every_cell_failing_is_an_error_not_an_empty_map():
    request = TrendMapRequest(latitude=11, longitude=77, half_span=.5, start=START, end=END)
    cells = grid_cells(11, 77, .5)
    with pytest.raises(HTTPException):
        asyncio.run(trend_map(request, synthetic_loader(field_slope, fail={(c["latitude"], c["longitude"]) for c in cells})))


def test_null_field_with_noise_yields_few_or_no_fdr_cells():
    request = TrendMapRequest(latitude=11, longitude=77, half_span=2.5, start=START, end=END)
    result = asyncio.run(trend_map(request, synthetic_loader(lambda c: 0.0, noise=1.0)))
    s = result["summary"]
    assert s["fdr_increasing"] + s["fdr_decreasing"] <= s["uncorrected_p05"]
    assert s["fdr_increasing"] + s["fdr_decreasing"] <= 2


def test_autocorrelated_cell_counts_in_family_but_is_never_declared():
    cells = grid_cells(11, 77, .5)
    trends = [{"status": "ok", "slope": 1.0, "low": .5, "high": 1.5, "p_value": 1e-6, "lag1": .1, "autocorrelated": False,
               "years": 30, "pointwise_significant": True, "direction": "increasing", "coverage": 100, "unit": "°C"} for _ in cells]
    trends[0] = {**trends[0], "lag1": .8, "autocorrelated": True, "pointwise_significant": None}
    out, summary = assemble(cells, trends)
    assert out[0]["q_value"] is not None and out[0]["fdr_significant"] is False and out[0]["fdr_withheld"] is True
    assert all(c["fdr_significant"] for c in out[1:])
    assert summary["fdr_withheld"] == 1 and summary["autocorrelated"] == 1


def test_cell_trend_reuses_point_analysis_and_flags_short_records():
    t = cell_trend(payload({y: 20 + .2 * (y - 2001) for y in range(2001, 2025)}), "T2M", 2001, 2024)
    assert t["status"] == "ok" and t["slope"] == pytest.approx(2) and t["autocorrelated"] is False
    short = cell_trend(payload({2001: 20, 2002: 21}), "T2M", 2001, 2002)
    assert short["status"] == "insufficient" and "slope" not in short
