# KIRA Earth — external resources and credits

Full resource catalogue for the Space Apps submission. The form permits only 25 partner/other link entries, so the final entry links here for the remaining credits. Optional integrations are identified; their presence in source code does not mean that a provider key or neural weights are installed in the public demo.

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


## Additional development, presentation and hosting tools

| Resource | Role | Public link |
|---|---|---|
| OpenAI Codex | AI-assisted coding, review, documentation and demo composition | https://openai.com/codex/ |
| HyperFrames | Editable demo timeline, captions and video rendering; adapted clean-bar registry animation | https://github.com/heygen-com/hyperframes |
| Kokoro ONNX | Local Kokoro narration synthesis runtime | https://github.com/thewh1teagle/kokoro-onnx |
| GSAP | Seekable animation timelines in the editable demo | https://gsap.com/ |
| Playwright | Original real-application screen-recording automation | https://playwright.dev/ |
| FFmpeg | Video encoding, cutting, audio mixing, subtitles and metadata | https://ffmpeg.org/ |
| Docker | Single-container frontend and API build/runtime | https://www.docker.com/ |
| Render | Public free-tier hosting | https://render.com/ |
| GitHub | Public source, dependency manifests and demo-release hosting | https://github.com/saggamer/kira-earth |
| Frontend dependency manifest | React, TypeScript, Vite, Tailwind CSS, Recharts, Lucide, Zustand and utility dependencies | https://github.com/saggamer/kira-earth/blob/main/package.json |
| Backend dependency manifest | FastAPI, NumPy, SciPy, pandas, httpx, xarray, ecCodes/cfgrib and optional PyTorch/transformers tools | https://github.com/saggamer/kira-earth/blob/main/backend/requirements.txt |
| OpenWeather One Call 3.0 | Optional forecast integration documentation; requires the user's provider key | https://openweathermap.org/api/one-call-3 |
| WeatherAPI.com | Optional forecast integration documentation; requires the user's provider key | https://www.weatherapi.com/docs/ |
| Tomorrow.io | Optional forecast integration documentation; requires the user's provider key | https://docs.tomorrow.io/reference/weather-forecast |
| Forecasting: Principles and Practice | Time-series validation reference | https://otexts.com/fpp3/tscv.html |

## Method attribution and limits

The scientific pipeline applies Theil–Sen estimation, Mann–Kendall rank-trend testing, Benjamini–Hochberg false-discovery-rate control, SPI drought-index ideas attributed to McKee et al. (1993), and documented resampling/time-series validation methods. Their implementation and assumptions are described in the project README and source; the team does not claim to have invented these methods.

The app design was inspired by Bilawal Sidhu's God's Eye View: https://github.com/bilawalsidhu/gods-eye-view . It was implemented independently; that project's visual reference is credited rather than represented as team-created work.

The 30-second demo uses edited footage of the actual application. Its voice is AI-generated with Kokoro-82M (`af_heart`), not cloned, and the disclosure is visible, spoken and stored in metadata. AI code, text and design assistance from Claude Code and Codex is described in [AI_USE.md](AI_USE.md). The public Docker profile excludes Laya and Qwen neural checkpoints; optional local models and providers are credited because the project implements those integrations.
