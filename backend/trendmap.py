"""Per-cell spatial trend map on the NASA POWER native grid with FDR field significance.

Every cell is an independent NASA POWER point record at a native 0.5° lat × 0.625° lon grid
center, analysed with the same rules as a point investigation (science.analyze). Nothing is
interpolated between cells; a cell whose record is unavailable or too short stays missing.
Pointwise Mann–Kendall p-values are corrected across the map with Benjamini–Hochberg (α=0.05).
"""
import asyncio
from datetime import date, datetime, timezone
import numpy as np
from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from .regions import Parameter
from .science import analyze, UNITS

LAT_STEP, LON_STEP = 0.5, 0.625
MAX_CELLS = 100
FDR_ALPHA = 0.05
CONCURRENCY = 2


class TrendMapRequest(BaseModel):
    name: str = Field(default="Selected region", min_length=1, max_length=80)
    latitude: float = Field(ge=-84, le=84, allow_inf_nan=False)
    longitude: float = Field(ge=-179.5, le=179.5, allow_inf_nan=False)
    half_span: float = Field(default=2.5, ge=.5, le=5, allow_inf_nan=False)
    parameter: Parameter = "T2M"
    start: int = Field(default=1991, ge=1981)
    end: int = Field(default=2024, ge=1981)
    request_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

    @model_validator(mode="after")
    def valid(self):
        if abs(self.latitude) + self.half_span > 85 or abs(self.longitude) + self.half_span > 180:
            raise ValueError("Keep the map box within 85° latitude and on one side of the date line.")
        if self.start > self.end or self.end >= date.today().year or self.end - self.start > 44:
            raise ValueError("Use at most 45 ordered, complete historical years, ending before the current year.")
        if self.end - self.start < 9:
            raise ValueError("Use at least 10 years: shorter records withhold significance in every cell.")
        return self


def grid_cells(latitude: float, longitude: float, half_span: float) -> list[dict]:
    """Every native grid center inside the box (inclusive), with its cell footprint."""
    eps = 1e-9
    lat = np.arange(np.ceil((latitude - half_span) / LAT_STEP - eps), np.floor((latitude + half_span) / LAT_STEP + eps) + 1) * LAT_STEP
    lon = np.arange(np.ceil((longitude - half_span) / LON_STEP - eps), np.floor((longitude + half_span) / LON_STEP + eps) + 1) * LON_STEP
    cells = []
    for y in lat[::-1]:  # north → south, west → east (reading order)
        for x in lon:
            y, x = round(float(y), 4), round(float(x), 4)
            cells.append({"latitude": y, "longitude": x,
                          "bounds": {"south": y - LAT_STEP / 2, "north": y + LAT_STEP / 2,
                                     "west": x - LON_STEP / 2, "east": x + LON_STEP / 2}})
    if len(cells) > MAX_CELLS:
        raise ValueError(f"This box covers {len(cells)} native grid cells; the map is limited to {MAX_CELLS}. Reduce the half-span.")
    if not cells:
        raise ValueError("The box contains no native grid centers. Increase the half-span.")
    return cells


def benjamini_hochberg(p_values, alpha: float = FDR_ALPHA):
    """Benjamini–Hochberg step-up procedure.

    Returns (reject, q_values, threshold). Non-finite p-values are excluded from the family and
    get reject=False, q=nan. `threshold` is the largest p-value declared significant (None if none).
    """
    p = np.asarray(p_values, dtype=float)
    reject = np.zeros(p.shape, dtype=bool)
    q = np.full(p.shape, np.nan)
    tested = np.flatnonzero(np.isfinite(p))
    m = len(tested)
    if m == 0:
        return reject, q, None
    order = tested[np.argsort(p[tested], kind="stable")]
    ranked = p[order]
    ranks = np.arange(1, m + 1)
    passing = np.flatnonzero(ranked <= ranks / m * alpha)
    threshold = None
    if len(passing):
        k = passing[-1]
        reject[order[:k + 1]] = True
        threshold = float(ranked[k])
    adjusted = np.minimum.accumulate((ranked * m / ranks)[::-1])[::-1]
    q[order] = np.minimum(adjusted, 1.0)
    return reject, q, threshold


def cell_trend(payload: dict, parameter: str, start: int, end: int) -> dict:
    """Run the point-investigation analysis and keep only what a map cell needs."""
    result = analyze(payload, parameter, start, end, with_diagnostics=False)
    t = result["trend"]
    base = {"coverage": result["coverage"], "unit": result["unit"]}
    if t is None:
        return {**base, "status": "insufficient", "reason": "Fewer than three usable years."}
    autocorrelated = t["lag1"] is not None and abs(t["lag1"]) > 1.96 / np.sqrt(t["years"])
    return {**base, "status": "ok", "slope": t["slope"], "low": t["low"], "high": t["high"], "p_value": t["p_value"],
            "lag1": t["lag1"], "autocorrelated": bool(autocorrelated), "years": t["years"],
            "pointwise_significant": t["significant"], "direction": t["direction"]}


def assemble(cells: list[dict], trends: list[dict | None], alpha: float = FDR_ALPHA) -> tuple[list[dict], dict]:
    """Attach per-cell trends and the BH field-significance flag; summarise the map.

    The BH family is every cell with a computed Mann–Kendall p-value (cells withheld for
    autocorrelation or short records still count toward m, so they make the test stricter),
    but such cells are never declared field-significant.
    """
    out = []
    for cell, trend in zip(cells, trends):
        out.append({**cell, **(trend or {"status": "unavailable", "reason": "NASA POWER record unavailable; cell left empty."})})
    p = [c["p_value"] if c["status"] == "ok" else np.nan for c in out]
    reject, q, threshold = benjamini_hochberg(p, alpha)
    for c, r, qv in zip(out, reject, q):
        if c["status"] != "ok":
            c.update({"q_value": None, "fdr_significant": False})
            continue
        eligible = not c["autocorrelated"] and c["years"] >= 10
        c.update({"q_value": float(qv), "fdr_significant": bool(r and eligible),
                  "fdr_withheld": bool(r and not eligible)})
    ok = [c for c in out if c["status"] == "ok"]
    slopes = np.array([c["slope"] for c in ok], dtype=float)
    sig = [c for c in ok if c["fdr_significant"]]
    summary = {
        "cells": len(out), "tested": len(ok), "missing": len(out) - len(ok),
        "increasing": int((slopes > 0).sum()), "decreasing": int((slopes < 0).sum()), "unchanged": int((slopes == 0).sum()),
        "fdr_increasing": sum(c["slope"] > 0 for c in sig), "fdr_decreasing": sum(c["slope"] < 0 for c in sig),
        "uncorrected_p05": int(sum(c["p_value"] < .05 for c in ok)),
        "autocorrelated": sum(c["autocorrelated"] for c in ok),
        "fdr_withheld": sum(c.get("fdr_withheld", False) for c in ok),
        "bh_threshold": threshold, "alpha": alpha,
        "opposite_directions": bool((slopes > 0).any() and (slopes < 0).any()),
        "opposite_significant": bool(any(c["slope"] > 0 for c in sig) and any(c["slope"] < 0 for c in sig)),
        "scale": float(np.max(np.abs(slopes))) if len(slopes) else None,
        "median_slope": float(np.median(slopes)) if len(slopes) else None,
    }
    return out, summary


# Progress of in-flight maps, keyed by the client's request_id. In-memory only.
progress: dict[str, dict] = {}


async def trend_map(request: TrendMapRequest, loader) -> dict:
    cells = grid_cells(request.latitude, request.longitude, request.half_span)
    track = progress.setdefault(request.request_id, {}) if request.request_id else {}
    track.update({"done": 0, "total": len(cells), "failed": 0})
    semaphore = asyncio.Semaphore(CONCURRENCY)
    provenance: list[dict | None] = [None] * len(cells)

    async def run(i: int, cell: dict):
        try:
            async with semaphore:
                cached, _ = await loader(cell["latitude"], cell["longitude"], request.start, request.end)
            provenance[i] = {"source_url": cached["source_url"], "retrieved_at": cached["retrieved_at"]}
            return await asyncio.to_thread(cell_trend, cached["payload"], request.parameter, request.start, request.end)
        except HTTPException:
            track["failed"] = track.get("failed", 0) + 1
            return None
        finally:
            track["done"] = track.get("done", 0) + 1

    try:
        trends = await asyncio.gather(*(run(i, c) for i, c in enumerate(cells)))
    finally:
        if request.request_id:
            progress.pop(request.request_id, None)
    if all(t is None for t in trends):
        raise HTTPException(503, "NASA POWER data is unavailable for every cell. No substitute data was generated. Please retry later.")
    out, summary = assemble(cells, trends)
    for c, prov in zip(out, provenance):
        if prov:
            c.update(prov)
    value_unit = UNITS[request.parameter]
    s = request.half_span
    return {
        "request": request.model_dump(exclude={"request_id"}), "checked_at": datetime.now(timezone.utc).isoformat(),
        "bounds": {"west": request.longitude - s, "east": request.longitude + s, "south": request.latitude - s, "north": request.latitude + s},
        "grid": {"lat_step": LAT_STEP, "lon_step": LON_STEP},
        "unit": f"{value_unit} per decade", "value_unit": value_unit,
        "cells": out, "summary": summary,
        "source": "NASA POWER · MERRA-2-derived daily estimates, one native-grid point record per cell",
        "methods": {
            "cells": "Every native 0.5° lat × 0.625° lon grid center inside the box; each cell is its own POWER point record. No interpolation, smoothing or gap filling between cells.",
            "trend": "Per cell: annual values with the point-investigation coverage rules, Theil–Sen slope per decade, two-sided Mann–Kendall p-value.",
            "autocorrelation": "Lag-1 autocorrelation screen of detrended annual residuals; flagged cells are never declared significant.",
            "field_significance": f"Benjamini–Hochberg false discovery rate across all cells with a p-value (α={FDR_ALPHA}). Flagged or short-record cells stay in the family, which only makes the test stricter.",
        },
        "limitations": [
            "Neighbouring cells share large-scale weather, so p-values are spatially correlated. Benjamini–Hochberg controls the FDR under positive dependence, but marked cells are not independent pieces of evidence.",
            "POWER cells are reanalysis-derived grid estimates (~50 km), not station observations; cells may mix land and ocean.",
            "The map shows where fitted trends differ; it does not attribute causes or project future change.",
        ],
    }
