# Space Apps 2026 submission kit — Earth System Trend Detective

Copy-ready text for the project submission form. The public app and demo links below are published. Review the scientific limitations and complete the final checklist before submitting.

## Project name
Earth System Trend Detective

## High-level summary (short)
Trend Detective is a globe-based tool that answers the four questions in the challenge for any place on Earth: **what** is changing, **where**, **how much**, and whether the change is **significant**. It tests eight NASA POWER climate variables, a standard drought index and 25 years of NASA MODIS satellite observations with one transparent method (Theil–Sen slope, Mann–Kendall test, autocorrelation screening, false-discovery-rate control and a permutation test), ranks what is changing, maps where it changes across grid cells, cross-checks model trends against independent satellite measurements, and shows change from space with then-and-now satellite comparisons.

## Links
- Live app: `https://kira-earth.onrender.com`
- Demo video (public, English subtitles): `https://github.com/saggamer/kira-earth/releases/tag/hackathon-demo-v1`
- Source code: https://github.com/saggamer/kira-earth (public)

## Project details (long)
**Problem.** Change in the Earth system shows up in many variables, sometimes in opposite directions in different regions, and there are too many variables to know where to look or how to tell real change from noise.

**What it does.**
- *Select variables automatically* — the Change Studio tests 8 NASA POWER model variables (temperature mean/max/min, precipitation, humidity, wind, surface pressure, root-zone soil wetness), the SPI drought index, and 5 NASA MODIS mission measurements (vegetation NDVI, day and night land surface temperature, evapotranspiration, net primary productivity), and ranks them by change relative to normal year-to-year variability so different units are comparable.
- *Visualize change over time* — trend charts, an animated climate spiral, warming stripes for every variable, and a seasonal fingerprint (which months change).
- *Where* — a spatial trend map tests every NASA POWER grid cell in a region (field-wide FDR control) and reports rising vs falling cells, so opposite regional trends are visible; a regional calculator compares two regions; then-and-now swipes compare NASA MODIS imagery and 10 m land cover on two dates.
- *How much* — slope per decade, fitted total change, 95 % interval and standardized change (σ/decade).
- *Significant* — Mann–Kendall test with record-length and lag-1 autocorrelation screens, Benjamini–Hochberg FDR across variables and across month × variable cells, and a 2,000-shuffle permutation test whose null distribution is drawn.
- *Reliability* — model trends are cross-checked against quality-screened MODIS satellite data (QA flags applied, season-balanced annual values); agreement is labelled “confirmed by satellite”.
- *Context* — a 16-day forecast (Google DeepMind WeatherNext 2 AI ensemble, ECMWF ensemble), local-climate event flags, and an analog layer that compares today's trends with past episodes on the same tectonic plates, showing only forecast odds whose skill was verified on a horizon-purged held-out test.

**How it works.** React + CesiumJS frontend; Python FastAPI backend computing all statistics at request time from live provider data (no gap filling, no invented values). Validation and limitations are documented in the README and `REVIEW_CONCERNS_AND_DATA_ROADMAP.md`.

**Benefits.** Anyone — students, planners, journalists, researchers — can go from “is it changing here?” to a defensible answer with provenance in minutes, with honest uncertainty instead of a single headline number.

## NASA data and resources (form field “NASA Data”)
| Link text | URL |
|---|---|
| NASA POWER (daily T2M, T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M, WS10M, PS, GWETROOT) | https://power.larc.nasa.gov/ |
| NASA POWER daily API documentation | https://power.larc.nasa.gov/docs/services/api/temporal/daily/ |
| NASA GMAO MERRA-2 (source of POWER meteorology) | https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/ |
| NASA GIBS imagery service (MODIS Terra true colour, MODIS land surface temperature, GPM IMERG precipitation rate) | https://nasa-gibs.github.io/gibs-api-docs/ |
| MODIS Terra MOD11A2 v061 land surface temperature (8-day, 1 km) | https://lpdaac.usgs.gov/products/mod11a2v061/ |
| MODIS Terra MOD13A1 v061 vegetation indices (16-day, 500 m) | https://lpdaac.usgs.gov/products/mod13a1v061/ |
| MODIS Terra MOD16A3GF v061 evapotranspiration (yearly) | https://lpdaac.usgs.gov/products/mod16a3gfv061/ |
| MODIS Terra MOD17A3HGF v061 net primary production (yearly) | https://lpdaac.usgs.gov/products/mod17a3hgfv061/ |
| GPM IMERG precipitation (via GIBS) | https://gpm.nasa.gov/data/imerg |
| NASA FIRMS active fires (VIIRS, optional key) | https://firms.modaps.eosdis.nasa.gov/ |
| NASA Blue Marble (offline basemap fallback) | https://visibleearth.nasa.gov/collection/1484/blue-marble |

## Space agency partner and other data / resources (form field “Space Agency Partner & Other Data”)
| Link text | URL |
|---|---|
| Microsoft Planetary Computer (STAC + data API; access path for MODIS series and map layers) | https://planetarycomputer.microsoft.com/ |
| Impact Observatory / Microsoft / Esri 10 m annual land use/land cover (io-lulc-annual-v02) | https://planetarycomputer.microsoft.com/dataset/io-lulc-annual-v02 |
| EC JRC Global Surface Water (Pekel et al. 2016) | https://planetarycomputer.microsoft.com/dataset/jrc-gsw |
| ECMWF open data (AIFS Single, IFS ensemble) | https://www.ecmwf.int/en/forecasts/datasets/open-data |
| Google DeepMind WeatherNext 2 via Open-Meteo | https://open-meteo.com/en/docs/google-weathernext-api |
| Open-Meteo forecast, ensemble, geocoding APIs (CC BY 4.0) | https://open-meteo.com/ |
| Copernicus CAMS air quality via Open-Meteo | https://open-meteo.com/en/docs/air-quality-api |
| US National Weather Service alerts API | https://www.weather.gov/documentation/services-web-api |
| PB2002 plate boundary model (Bird 2003) | https://doi.org/10.1029/2001GC000252 |
| Natural Earth country boundaries (public domain) | https://www.naturalearthdata.com/ |
| Esri World Imagery basemap (attribution on map) | https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9 |
| CesiumJS (Apache-2.0) | https://cesium.com/platform/cesiumjs/ |
| Laya decision model, convaiinnovations (Apache-2.0) | https://huggingface.co/convaiinnovations/laya |
| Qwen3.5-0.8B (Apache-2.0, optional local model) | https://huggingface.co/Qwen/Qwen3.5-0.8B |
| Anthropic Claude API (optional cloud model) | https://www.anthropic.com/api |
| Anthropic Claude Code (AI coding assistant used to build the project) | https://www.anthropic.com/claude-code |
| Kokoro-82M (AI narration voice for the 30-second demo) | https://huggingface.co/hexgrad/Kokoro-82M |
| Open-source libraries: React, Vite, Tailwind CSS, Recharts, lucide-react, zustand, FastAPI, NumPy, SciPy, pandas, xarray, ecCodes/cfgrib, httpx, PyTorch, transformers, playwright-core, FFmpeg | see `package.json`, `backend/requirements.txt` |
| Fonts: Inter, Space Grotesk, JetBrains Mono (SIL Open Font License, Google Fonts) | https://fonts.google.com/ |
| Interface inspiration: God's Eye View by Bilawal Sidhu (implemented independently) | https://github.com/bilawalsidhu/gods-eye-view |
| Methods: McKee et al. 1993 (SPI); Benjamini & Hochberg 1995 (FDR); Hyndman & Athanasopoulos, *Forecasting: Principles and Practice* (time-series cross-validation) | https://otexts.com/fpp3/tscv.html |

All data are accessed through public, free APIs; no copyrighted material is used without permission. NASA appears only as a data source: no NASA logos, flags, insignia or mission identifiers are used or generated.

## Use of Super Intelligence (form field “Use of SI”)
Select: **code and data**, **audio**, and (for the demo) **video — screen recording with SI audio**. Text to paste:

> Code and documentation were written with an AI coding assistant (Anthropic Claude Code and OpenAI Codex) and reviewed and tested by the team; this is stated in AI_USE.md, the README, package.json metadata and file headers. All scientific results (trends, significance tests, maps, SPI, satellite cross-checks) are computed by deterministic code from NASA and partner data, not generated. In the app, Laya (open decision model) scores trend resemblance, an optional language model explains skill-verified results (labelled “AI-generated (SI)” on screen), and Google DeepMind WeatherNext 2 is an AI weather model. The 30-second demo edits footage of the real app, with AI-assisted captions and an end card rendered in HyperFrames, and a visible “AI-generated voiceover · Kokoro” notice; its narration voice is AI-generated locally with Kokoro-82M, acknowledged on screen, in the description and in the file metadata. No NASA branding is used or generated.

## How the project meets the judging criteria
- **Impact** — turns the challenge's four questions into a repeatable workflow for any coordinate on Earth; free, keyless core; explains uncertainty instead of overstating it.
- **Creativity** — automatic variable screening ranked by standardized change; satellite-vs-model cross-check; climate spiral and stripes for any variable and place; then-and-now satellite and land-cover swipes; analog episodes scoped by tectonic plates.
- **Validity** — Theil–Sen + Mann–Kendall with autocorrelation and record-length screens, FDR across variables and grid cells, permutation test, quality-screened and season-balanced satellite data, horizon-purged forecast evaluation (enforced in code), 126 automated tests; limitations stated in the app and README.
- **Relevance** — uses NASA POWER, MODIS (LP DAAC products), GIBS imagery and FIRMS; follows the challenge reference's recommended layers (temperature, pressure, humidity, wind, precipitation, soil moisture, land surface temperature, NDVI, SPI, percentile baselines, trends).
- **Presentation** — guided 11-step tour inside the app, a recorded demo with narration and English subtitles, a submission-ready README with method and source documentation.

## Known gaps (state honestly if asked)
Sea-surface temperature (marine heatwaves, ENSO), dew point and CAPE from the challenge reference are not yet included; the hosted version runs without the optional Laya model (the AI layer falls back to rule-based gating).

## Before submitting — checklist
- [x] Live app reachable at `https://kira-earth.onrender.com`; demo video public at `https://github.com/saggamer/kira-earth/releases/tag/hackathon-demo-v1` with English subtitles
- [ ] NASA Data and Other Data fields filled from the tables above
- [ ] SI-use field filled; video shows the AI · SI notice
- [ ] Terms and conditions agreed; originality confirmed (all external resources are listed above)
- [ ] Re-check the 2026 Project Submission Guide for the demo length limit
