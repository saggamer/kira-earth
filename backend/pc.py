"""Microsoft Planetary Computer map layers (anonymous data API).

The browser draws tiles straight from planetarycomputer.microsoft.com (CORS-enabled); the backend
only registers the STAC search once and hands back the XYZ template. Render options are the
Planetary Computer's own published presets for each collection, so colours match its Explorer.
"""
from __future__ import annotations
import time
import httpx

PC = "https://planetarycomputer.microsoft.com/api/data/v1"
TTL = 6 * 3600

LAYERS = {
    "landcover": {
        "collection": "io-lulc-annual-v02", "years": list(range(2017, 2024)),
        "options": "assets=data&exitwhenfull=False&skipcovered=False&colormap_name=io-lulc-9-class",
        "name": "Land use / land cover", "resolution": "10 m", "min_zoom": 4,
        "attribution": "Impact Observatory · Microsoft · Esri — 10 m annual land use/land cover (io-lulc-annual-v02), Sentinel-2",
    },
    "water-change": {
        "collection": "jrc-gsw", "years": None,
        "options": "assets=change&colormap_name=jrc-change&nodata=0",
        "name": "Surface water change 1984–2020", "resolution": "30 m", "min_zoom": 4,
        "attribution": "EC JRC / Google — Global Surface Water (Pekel et al. 2016), Landsat 1984–2020",
    },
    "water-occurrence": {
        "collection": "jrc-gsw", "years": None,
        "options": "assets=occurrence&colormap_name=jrc-occurrence&nodata=0",
        "name": "Surface water occurrence 1984–2020", "resolution": "30 m", "min_zoom": 4,
        "attribution": "EC JRC / Google — Global Surface Water (Pekel et al. 2016), Landsat 1984–2020",
    },
}
_cache: dict[tuple[str, int | None], tuple[float, dict]] = {}


async def tiles(client: httpx.AsyncClient, kind: str, year: int | None) -> dict:
    spec = LAYERS[kind]
    if spec["years"]:
        year = year if year in spec["years"] else spec["years"][-1]
    else:
        year = None
    hit = _cache.get((kind, year))
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    body: dict = {"collections": [spec["collection"]]}
    if year:
        body |= {"filter-lang": "cql2-json", "filter": {"op": "anyinteracts", "args": [
            {"property": "datetime"}, {"interval": [f"{year}-01-01T23:59:59Z", f"{year}-12-31T23:59:59Z"]}]}}
    r = await client.post(f"{PC}/mosaic/register", json=body, timeout=30)
    r.raise_for_status()
    sid = r.json()["searchid"]
    out = {"kind": kind, "year": year, "template": f"{PC}/mosaic/{sid}/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}?collection={spec['collection']}&{spec['options']}",
           "min_zoom": spec["min_zoom"], "name": spec["name"], "resolution": spec["resolution"], "attribution": spec["attribution"],
           "years": spec["years"], "catalog": f"https://planetarycomputer.microsoft.com/dataset/{spec['collection']}"}
    _cache[(kind, year)] = (time.time(), out)
    return out
