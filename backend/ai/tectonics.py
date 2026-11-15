"""Tectonic plate lookup from the PB2002 model (Bird, 2003; GeoJSON by H. Ahlenius, ODC-BY).

Used only to scope analog searches: a location is compared with historical trend
episodes on its own plate and, when it lies near a boundary, the plates across that
boundary. Plates are a geographic neighbourhood here, not a claimed climate driver.
"""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
import json
import math
import numpy as np

RAW = Path(__file__).parent / "data" / "raw"
EARTH_KM = 6371.0
NEAR_BOUNDARY_KM = 600.0


def _ring_contains(ring: np.ndarray, lon: float, lat: float) -> bool:
    x, y = ring[:, 0], ring[:, 1]
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    crosses = (y > lat) != (y2 > lat)
    with np.errstate(divide="ignore", invalid="ignore"):
        xi = x + (lat - y) * (x2 - x) / (y2 - y)
    return bool(np.count_nonzero(crosses & (lon < xi)) % 2)


def _polygons(geometry: dict):
    if geometry["type"] == "Polygon":
        yield geometry["coordinates"]
    else:
        yield from geometry["coordinates"]


@lru_cache(maxsize=1)
def _load():
    plates = json.loads((RAW / "PB2002_plates.json").read_text())
    bounds = json.loads((RAW / "PB2002_boundaries.json").read_text())
    shapes = []
    for f in plates["features"]:
        code, name = f["properties"]["Code"], f["properties"]["PlateName"]
        for poly in _polygons(f["geometry"]):
            outer = np.array(poly[0], dtype=float)
            # PB2002 rings may exceed ±180°; test the point at its shifted longitudes too.
            shapes.append((code, name, outer, [np.array(h, dtype=float) for h in poly[1:]]))
    names = {f["properties"]["Code"]: f["properties"]["PlateName"] for f in plates["features"]}
    segments = []
    for f in bounds["features"]:
        p = f["properties"]
        coords = np.array(f["geometry"]["coordinates"], dtype=float)
        segments.append((p["PlateA"], p["PlateB"], p.get("Type") or "", coords))
    return shapes, names, segments


def plate_names() -> dict[str, str]:
    return dict(_load()[1])


def plate_at(latitude: float, longitude: float) -> str | None:
    shapes, _, _ = _load()
    for code, _, outer, holes in shapes:
        for lon in (longitude, longitude + 360, longitude - 360):
            if _ring_contains(outer, lon, latitude) and not any(_ring_contains(h, lon, latitude) for h in holes):
                return code
    return None


def _haversine(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dlat, dlon = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dlat / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def tectonic_context(latitude: float, longitude: float, near_km: float = NEAR_BOUNDARY_KM) -> dict:
    """Home plate, nearest boundary, and the plates whose history may be searched."""
    shapes, names, segments = _load()
    home = plate_at(latitude, longitude)
    nearest = None
    neighbours: dict[str, float] = {}
    for a, b, kind, coords in segments:
        d = float(np.min(_haversine(latitude, longitude, coords[:, 1], coords[:, 0])))
        if nearest is None or d < nearest["distance_km"]:
            nearest = {"plates": [a, b], "type": kind, "distance_km": d}
        if home in (a, b) or home is None:
            other = b if a == home else a
            if d <= near_km and other != home:
                neighbours[other] = min(d, neighbours.get(other, math.inf))
    if home is None and nearest:
        home = nearest["plates"][0]
    searched = [home] + sorted(neighbours, key=neighbours.get)
    boundary_types = {"SUB": "subduction zone", "OSR": "oceanic spreading ridge", "OTF": "oceanic transform fault",
                      "CTF": "continental transform fault", "CRB": "continental rift", "CCB": "continental convergent boundary",
                      "OCB": "oceanic convergent boundary", "": "plate boundary"}
    return {
        "plate": home,
        "plate_name": names.get(home, home),
        "nearest_boundary": None if nearest is None else {
            "between": [names.get(c, c) for c in nearest["plates"]],
            "codes": nearest["plates"],
            "type": boundary_types.get(nearest["type"], nearest["type"]),
            "distance_km": round(nearest["distance_km"], 1),
        },
        "neighbours": [{"plate": c, "plate_name": names.get(c, c), "boundary_distance_km": round(neighbours[c], 1)} for c in searched[1:]],
        "searched_plates": searched,
        "rule": f"Analogs are drawn only from the home plate and from plates whose shared boundary lies within {int(near_km)} km.",
        "source": "PB2002 plate model (Bird, 2003, G³ 4(3):1027); GeoJSON: github.com/fraxen/tectonicplates (ODC-BY 1.0)",
    }
