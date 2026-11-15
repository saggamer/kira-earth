# Earth System Trend Detective

A standalone NASA Space Apps project for investigating environmental change. The opening view is a full-screen Cesium Earth with location search and navigation. Science appears progressively, only when requested.

## How it answers the challenge

| Challenge question | Where in the app | Method |
|---|---|---|
| **Select variables** that could indicate change | **Studio → What's changing** tests all 8 NASA POWER variables at once and ranks them | One method for every variable; ranked by σ/decade so °C, mm and kPa compare |
| **Visualize change over time** | Studio → **Spiral** (animated monthly anomalies), **Stripes** (one band per year, every variable), Investigate charts | Anomalies from the study-period mean, no gap-filling |
| **What** is changing, and **when in the year** | Studio → **Seasons**: 8 variables × 12 months fingerprint | Mann–Kendall per calendar month, FDR across all 96 cells |
| **Where** it is changing (including opposite directions) | **Trend map**: every POWER grid cell in a box, drawn on the globe; **Compare**: then-and-now satellite swipe (MODIS true colour or 10 m land cover); **Layers → Planetary Computer**: land cover 2017–2023 and JRC surface-water change 1984–2020 | Per-cell Theil–Sen + Mann–Kendall, field-wide FDR; NASA GIBS imagery |
| **How much** | Every view reports slope per decade, fitted total change, 95 % interval and σ/decade | Theil–Sen estimator |
| Is the data **reliable**? | Studio → **Seen from space**: 25 years of NASA MODIS satellite observations at the same point, with a cross-check against the NASA POWER model record | Same tests on independent mission data via Microsoft Planetary Computer; *confirmed* = same direction and significant in both |
| Is it **significant**? | Studio → **Significance**: 2,000-shuffle permutation test with the null distribution drawn, plus a 5-point checklist | Mann–Kendall, record-length and autocorrelation screens, permutation test, Benjamini–Hochberg FDR |

**Demo in one click:** press **Tour** in the top bar (or `> tour`). Eleven steps drive the app through Cairo (what, when, how much, significance, satellite cross-check, where), the Aral Sea and New Administrative Capital swipes, and the AI outlook. First-time visitors get a welcome card offering the tour. Use ← → to step.

## Use of AI (SI) tools

Code and documentation were written with AI assistance (Anthropic Claude Code and OpenAI Codex) and reviewed and tested by the team; the 30-second demo narration voice is AI-generated locally with Kokoro-82M. All trends, significance tests and maps are computed by deterministic code from the data. In-app AI-generated text is labelled. Full disclosure: [AI_USE.md](AI_USE.md).

## Run locally

Requires Node.js 24+ (26+ for the built-in TypeScript coordinate tests), Python 3.11+, an internet connection for scientific providers, and a WebGL-capable browser.

```sh
npm install
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
npm start
```

Open http://127.0.0.1:5173. The launcher starts Vite on 5173 and FastAPI on 8000. Stop both with Ctrl+C. Alternatively, run `npm run api` and `npm run dev` in separate terminals. API documentation is at http://127.0.0.1:8000/docs.

No API key or Cesium ion token is required. Do not add private credentials to client code. `EARTH_CACHE_DIR` can override the default ignored `backend/.cache` directory.

## Explore

1. Drag to rotate, scroll or pinch to zoom. The compass resets the globe and clears scientific overlays.
2. Search a city or region, enter decimal coordinates such as `11.0168, 76.9558` or `33.8688 S, 151.2093 E`, or click Earth directly. Coordinates use WGS84, latitude first. Decimal coordinates and bundled places work without a geocoder.
3. Location selection reveals a compact location card. It does **not** fetch historical data or open a dashboard.
4. Choose **Investigate** to open the selected place’s record directly. Select temperature or rainfall in the panel. This explicit action retrieves the real NASA POWER record and opens the evidence panel. Adjust the variable and study years there.
5. Choose **Layers** for MODIS surface temperature or IMERG precipitation. Their legends and daily timeline appear only after requesting imagery. Temperature on the satellite map is land-surface temperature, distinct from the POWER 2 m air temperature investigation.
6. Type `>` into search for commands. Examples: `> temperature`, `> rainfall`, `> layers`, `> precipitation`, `> sources`, and `> hide`.
7. `⌘K`, `Ctrl+K`, or `/` focuses search. Escape closes panels and pauses the timeline. Clear selection or reset returns to the minimal view.
8. Reports answer the five investigation questions using computed results. Export JSON includes monthly/annual values, methods, provenance, and missing-data warnings. Print/save PDF uses the browser print dialog.

Zooming to a regional view offers **Explore this area** without automatically selecting or analyzing it. Initial country outlines and place labels are off; they are optional in Layers.

## Data and scientific integrity

| Provider | Implemented use | Important distinction |
| --- | --- | --- |
| Esri World Imagery | Detailed reference basemap with provider attribution | Mixed acquisition dates; not a historical measurement or live feed |
| NASA Blue Marble | Bundled local fallback reference texture | Not time varying; mirrored by Three.js |
| NASA POWER | Real daily T2M, T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M (relative humidity), WS10M (10 m wind speed), PS (surface pressure), GWETROOT (root-zone soil wetness, 0–1) via FastAPI; physically impossible daily values are treated as missing, never clipped | MERRA-2-derived historical estimates, not local station or direct satellite observations |
| NASA EOSDIS GIBS | Dated MODIS Terra daytime land-surface temperature and GPM IMERG precipitation-rate imagery | IMERG rate is mm/hr, not accumulated mm; display tiles do not increase native resolution |
| ECMWF AIFS Single | Official client → GRIB2/ecCodes → verified 1° display fields, contours and particles | Weather model forecasts; not satellite observations or climate projections |

NASA POWER requests use UTC and complete historical calendar years, starting no earlier than 1981. The four supported variables are retrieved together, cached on disk for 30 days, and reused when switching variables. Concurrent identical downloads share a lock. Cached raw responses preserve retrieval time and original source URL. Failed providers return explicit errors, never generated replacement values. Obsolete client requests are aborted when targets or panels change.

MODIS imagery is approximately 1 km native resolution. IMERG's native grid is 0.1°; a finer display tile is not a finer measurement. Dated layer availability intervals are stored from NASA's GIBS catalog, including gaps. Animation advances through catalogued days and never interpolates observations. Catalog availability does not guarantee a valid cloud-free retrieval at every pixel.

GIBS imagery is requested through WMS with exact EPSG:4326 geographic bounds. Its geographic WMTS grids have padded top-level tiles that do not match Cesium's normal 180° quadtree. WMS avoids geographic misalignment. Country boundaries are local public-domain Natural Earth line geometry, rather than polygon fills.

### Calculations

- Temperature: annual means of daily values, requiring at least 90% daily coverage per year. Monthly means use the same threshold.
- Precipitation: sum daily precipitation amounts into annual/monthly totals only with **100%** daily coverage. Incomplete totals remain missing; no scaling or gap filling.
- Trend magnitude: SciPy Theil–Sen estimator on usable annual values with actual calendar years, reported per decade. Fitted total change is slope times elapsed years, not subtraction of noisy endpoint values.
- Significance: two-sided SciPy Kendall tau / Mann–Kendall trend test with tie handling on the annual series.
- Dependence screening: detrended lag-1 Pearson correlation, using only consecutive year pairs. If `|r₁| > 1.96 / √n`, significance is withheld. This conservative screen is not a complete autocorrelation correction.
- Fewer than 10 usable years: significance withheld; fewer than three: slope unavailable.
- Confidence intervals: 95% Theil–Sen interval assuming independent annual values. It is exploratory if the dependence screen fails.
- Anomalies: annual departures from the mean of usable annual values in the selected study period. This is explicitly **not** a standard 30-year climate normal.

Trend direction and significance are separate: an upward slope alone is not evidence of a significant trend. No causal conclusions, interpolated point maps, climate projections, or uncorrected spatial significance maps are produced. The spatial trend map marks significance only after a Benjamini–Hochberg false-discovery-rate correction across its cells.

## Architecture

```text
src/App.tsx                         Progressive disclosure and command/search navigation
src/components/Globe.tsx            Cesium lifecycle, camera, picking, imagery, optional boundaries
src/components/Investigation.tsx    Lazy-loaded evidence panel and Recharts historical record
src/components/InvestigationDialog.tsx  Sources, methods, and exportable investigation report
src/components/Timeline.tsx         Daily imagery playback and date navigation
src/lib/store.ts                    Zustand state and typed analysis responses
src/lib/layers.ts                   Shared imagery descriptors and provider construction
src/lib/coordinates.ts              Validated decimal coordinate parsing
backend/main.py                    FastAPI, NASA POWER retrieval/cache, place search
backend/science.py                 Missing-data handling, aggregation, trend calculations
```

Vite proxies `/api` to FastAPI in development. `npm run build` produces the frontend in `dist/`; a production host must serve those files and reverse-proxy `/api` to FastAPI. A standalone static deployment alone cannot provide the scientific API. Large raster/GRIB data should remain server-side when future providers are implemented.

## Verification

```sh
npm run build
npm run test:science
npm run test:coordinates
```

Scientific tests use explicitly synthetic fixtures for known slopes, constants, missing days/years, short records, anomalies, autocorrelation and invalid parameters. Synthetic fixtures are never used by the application. Coordinate tests verify hemisphere signs and range rejection. Browser verification covers the clean opening view, place and coordinate selection, on-command analysis, source panels, real satellite layers and returning to Earth.

## Scope and next phases

Implemented: Phase 1 globe/navigation foundation, real POWER point investigations, robust annual trend estimates, study-period anomalies, real GIBS satellite imagery and daily playback, and JSON/print reports. The regional trends calculator supports sampled-area comparisons and validated cross-region scenarios. A per-cell spatial trend map (up to 100 native grid cells, Benjamini–Hochberg FDR field significance) shows *where* a variable is changing. AIFS ingestion, six-hour forecast stepping, 2D/3D views and model-based atmospheric animation are implemented. Seasonal/adjusted trend tests, gridded (non-point) spatial products at finer than native resolution, prewhitened or field-resampling significance tests, and raw IMERG processing remain later phases.

The interface takes visual inspiration from [God's Eye View by Bilawal Sidhu](https://github.com/bilawalsidhu/gods-eye-view): globe-led navigation, compact commands, translucent surfaces and context appearing after interaction. The application code is an independent implementation for environmental science.

## Sources and attribution

- [NASA POWER daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/)
- [NASA GPM IMERG](https://gpm.nasa.gov/data/imerg)
- [NASA GIBS layer catalog](https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml)
- [Esri World Imagery](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer)
- [NASA reference texture, Three.js mirror](https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg)
- [Natural Earth boundaries, public domain](https://www.naturalearthdata.com/about/terms-of-use/)
- [Open-Meteo geocoding / GeoNames, CC BY 4.0](https://open-meteo.com/en/docs/geocoding-api)
- [ECMWF open data and licensing](https://www.ecmwf.int/en/forecasts/datasets/open-data)

Provider credits remain available on the map. This independent project is not affiliated with or endorsed by NASA, ECMWF, Esri, or God's Eye View.


## Atmospheric and 2D views

Use **Views** at the top right, or commands `> 2d`, `> 3d`, `> clouds`, and `> flow`. The cloud atlas is dated NASA MODIS satellite true color, with genuine retrieval gaps. **Atmospheric flow** retrieves AIFS Single via the official `ecmwf-opendata` client and displays a separate forecast console. Initialization and valid times come from decoded GRIB metadata. Available controls include wind speed, 2 m temperature, sea-level pressure, total cloud cover, accumulated precipitation, animated wind particles, and 4 hPa isobars. Globe navigation remains native Cesium, with animated 2D/3D morphing.

AIFS surface fields are published at 0.25°. The backend retains every fourth native grid point for a 1° display response; bilinear interpolation is used for raster display and particle advection. This does not add forecast information or imply higher measurement resolution. ecCodes validates temperature (K → °C), pressure (Pa → hPa), cloud cover (% → fraction where needed), precipitation (kg/m² equals mm water equivalent, or m → mm), accumulation start, model run and valid time. Raw GRIB and processed fields are cached on disk. The forecast console pins one run while stepping through 0–72 hours in six-hour increments. Playback waits for each real field; it does not fabricate temporal frames.

Wind particle time is intentionally accelerated for visual readability and does not represent tracked air parcels. H/L symbols are model pressure extrema selected from a 19-cell neighborhood with at least 2 hPa local variation and spatial separation. Isobars come from `contourpy` at 4 hPa intervals. Forecasts describe short-term weather, not future climate. New endpoints: `GET /api/weather?lead=6` and optional `run=YYYYMMDDHH`.

## Complete historical diagnostics

Open **Full weather analysis** in a location investigation for:

- Daily distribution, percentiles, dated minima/maxima, missing-day counts, longest gap and excluded years.
- Calendar-month study-period seasonal means, monthly departures and standardized departures (not a fitted SPI drought index).
- Hot days (Tmax ≥35°C), tropical nights (Tmin >20°C), frost nights (Tmin <0°C), diurnal range, and longest hot spell.
- Wet days (≥1 mm), heavy days (≥10 mm), very heavy days (≥20 mm), maximum 1-day and trailing 5-day rainfall, wet-day intensity, and longest calendar-year wet/dry spells. Counts and spell metrics require complete calendar-year records.
- Equal-calendar-span early/late period comparison, with a 499-sample circular moving-block bootstrap interval for complete periods of at least five years each.
- Annual Sen-slope uncertainty from 499 circular moving-block residual samples, using `ceil(n^(1/3))`-year blocks and fixed seed 413. At least 10 consecutive usable annual values are required. These exploratory intervals assume stationary detrended residuals and weak dependence; they do not override withheld independent-sample p-values.
- Calendar-month-demeaned temperature–rainfall Pearson association over paired complete monthly records. No independent-sample significance or causal claim is asserted.

All diagnostic outputs and definitions are included in the JSON investigation export. Tests: `npm run test:science`, `npm run test:coordinates`, and `npm run test:weather`.

## Location workspace and freshness

**Investigate** opens the selected location's historical record directly. The separate **Questions** side button offers optional temperature and rainfall prompts without replacing the data panel. **Climate history / Latest weather** switches between NASA POWER records and the ECMWF forecast sampled at the same location. These are distinct products, with their timestamps and units shown.

Historical requests are validated against coordinates, complete study years, parameter, expected units, and monthly/annual timelines. The browser retains up to six validated investigations, keyed by the exact rounded coordinates, period and variable. Switching requests cancels the previous response; data for one query is never relabeled as another. A failed refresh preserves the matching saved record with an explicit warning. Open investigations recheck every five minutes while visible and when connectivity or focus returns. Complete historical source responses have a 30-day server cache; the refresh button bypasses it and retrieves POWER again. “Record checked” is distinct from the source retrieval time.

Weather follows the latest published AIFS initialization with checks every five minutes while visible, or on reconnect/focus. Forecast playback stays within one initialization. Disable **Follow latest available run** to pin it; manual refresh checks the provider immediately. The latest-run cache expires from the last actual provider check, never from a cached field read. New fields replace the globe only after the run, lead, grid, units and arrays pass validation. On failure the last verified global field stays visible with its actual valid time and a refresh warning, including when minimized. Requested and displayed forecast leads remain distinct while loading.

NASA's imagery catalog is checked every ten minutes while visible. **Latest available** selects the current published date for that layer. A bundled dated catalog is the fallback when the provider is unavailable, clearly labeled as saved. Catalog availability does not imply a complete retrieval at every pixel. External providers can be delayed or unavailable; the app never fabricates replacement measurements or promises uninterrupted live observations.

Additional verification: `npm run test:integrity` and `backend/tests/test_freshness.py` cover query isolation, response mismatches, missing/invalid fields, provider cache expiry, forced checks and failed-check preservation.

## Spatial trend map

Use `> trend map` in the command bar, or the **Trend map** button in the regional trends calculator. The panel centres a 2°–5° square box on the selected globe location; nothing is downloaded until **Compute trend map** is pressed.

`POST /api/regions/trend-map` takes every native NASA POWER grid center (0.5° latitude × 0.625° longitude) inside the box, capped at 100 cells (a 5° × 5° box is 80–99 cells). Each cell is its own POWER point record, retrieved through the same validated cache as point investigations, two requests at a time. A progress endpoint (`GET /api/regions/trend-map/progress?id=…`) reports retrieved cells. A first 5° map can take several minutes; repeats come from the 30-day cache.

Each cell is analysed with the point-investigation rules (`science.analyze`): annual coverage thresholds, Theil–Sen slope per decade with a 95% interval, two-sided Mann–Kendall p-value and the lag-1 autocorrelation screen. Field significance uses the **Benjamini–Hochberg** false discovery rate at α = 0.05 across every cell that has a p-value. Cells that fail the autocorrelation screen, or have fewer than 10 usable years, stay in the BH family (making it stricter) but are never marked significant. Cells whose record is unavailable or too short are drawn as empty dashed outlines: there is **no interpolation, smoothing or gap filling between cells**.

On the globe, cell colour is the Sen slope on a symmetric diverging scale (increase `#c97c33`, decrease `#4a9be0`, neutral `#383835`); FDR-significant cells are opaque, hatched and outlined. Hovering a cell shows its slope, interval, p, BH q, years, lag-1 value and flags. The panel summarises increasing/decreasing and significant cell counts next to the uncorrected p < 0.05 count, and states when significant trends run in opposite directions inside the box. Results download as JSON with each cell's POWER source URL.

Limitations: neighbouring cells share weather, so p-values are spatially correlated. BH controls the FDR under positive dependence, but marked cells are not independent evidence. Cells are ~50 km reanalysis-derived estimates, not station data, and may mix land and ocean. The map shows where fitted trends differ; it does not attribute causes.

## Regional trends calculator

Select a location, then use the **Trends** side button (or `> trends`). Choose A and B by place name, decimal coordinates or the current globe selection, set each variable and a 1°, 2°, 5° or 10° square box, choose complete study years and a 1–12 month lag, then calculate. The boxes and a dashed comparison link appear on the globe. The link identifies the compared regions; it does not represent physical transport. Opening the calculator does not automatically download measurements.

The backend `POST /api/regions/compare` retrieves at most 18 distinct NASA POWER points, with two concurrent regional requests. Points are native 0.5° latitude × 0.625° longitude grid centers inside the boxes; up to three distinct centers per axis are used, without oversampling duplicate cells. Daily regional values are cosine-latitude-weighted means over these fixed samples. Every sampled cell must be valid for a day, otherwise that regional day is missing. No changing spatial mask or gap filling is used. These are sampled regional estimates, **not exact full-area or administrative-polygon averages**; boxes can include land and ocean. See [NASA's native-grid and access guidance](https://power.larc.nasa.gov/docs/tutorials/service-data-request/api/). Raw source URLs and retrieval times remain available for every sample.

Both regional annual records use the existing coverage, Sen-slope, interval and pointwise trend-test rules. Temperature is °C; precipitation is spatially averaged annual mm/year. Annual anomaly charts use a common axis for the same variable, and labeled separate axes for different variables. A B−A slope difference is descriptive and is only computed for the same variable; it is not a between-region significance test. Opposite directions can be identified, but no causal or spatial significance map is inferred.

The two directions are fitted independently. For a user-chosen lag h, the model estimates target(t+h) from target(t), source(t), a linear time term and 11 calendar-month indicators. The target-only baseline excludes source(t). Each expanding yearly validation fold trains only on outcomes observed **before the earliest test origin**, purging the forecast horizon at the boundary. Season/time/response coefficients are fitted in each training fold; full-record preprocessing and random train/test shuffling are not used. This follows the temporal ordering principle in [Forecasting: Principles and Practice](https://otexts.com/fpp3/tscv.html). The last five origin-years are tested; at least 180 usable paired months, 36 test months and three folds are required.

A scenario response is enabled only when adding the source improves validation mean-squared error by more than 5%, positive skill occurs in at least 60% of yearly folds, and an exploratory 95% residual-block coefficient interval excludes zero. The interval uses 499 fixed-design circular residual-block resamples, seed 7301 and blocks of at least 12 months/h+1; consecutive monthly training pairs are required. Residual stationarity and weak dependence are assumptions, not guarantees. Coefficients are conditional associations and no causal or multiple-testing-adjusted significance claim is made. Overlapping boxes or shared sampled cells withhold cross-region estimates.

“What if” inputs hold target starting conditions, calendar month and time fixed. Changes are restricted to ±1 residual source standard deviation after baseline controls; larger extrapolations are withheld. The associated target difference is the source coefficient × the requested change, with its block interval. A historical scenario can be anchored to the last complete source/target month; its target date and approximate outcome range from held-out errors are shown explicitly. Calculations use retrospective, potentially revised records; historical publication latency is not simulated. Negative precipitation outcome ranges are withheld. This is **not a live forecast, a long-term climate projection, physical attribution, or a damage/health/crop impact model**. Trying many lags or regions remains exploratory.

JSON export includes both regional series, sample provenance, validation folds and predictions, model limits and the selected scenario. Tests: `npm run test:regions` and `backend/tests/test_regions.py`.

## On-demand analog intelligence (AI layer)

Select a location, then press **AI** on the left rail (or type `> ai`). Nothing loads, downloads or runs until **Activate analog AI** is pressed: the models are never loaded at server start.

```text
NASA POWER 1981–END daily record ──► 9 locally calibrated annual indices ──► 15-year trend signature
                                                                                │
PB2002 tectonic plates ──► home plate + plates across a boundary ≤600 km ──► 40 nearest past episodes
                                                                                │
   Laya · similarity confidence per episode (share of the 9 trend changes that match) ──► keep the 5 best
                                                                                │
   average ≥ 70 %? ──► System 2 · larger LLM predicts the next 5 years from what followed them,
                       checked against the skill-verified System-1 odds (number-guarded)
```

**Indices.** Mean, day-max and night-min temperature; annual rainfall; hot days (Tmax ≥ local p90), warm nights (Tmin ≥ local p90), cold days (Tmax ≤ local p10), heavy-rain days (≥ local wet-day p95) and longest dry spell. Thresholds are calibrated on each site's own record, as the event detection reference requires. Years with <95% daily coverage are excluded, never filled. Trends are Theil–Sen slopes with Mann–Kendall p-values and the project's lag-1 autocorrelation screen, expressed per decade in the site's detrended interannual σ. σ uses only years up to the end of each window (no look-ahead).

**Tectonic scope.** `backend/ai/tectonics.py` assigns the PB2002 plate (Bird, 2003) and adds plates whose shared boundary lies within 600 km. Comparisons are drawn **only** from those plates. Plates define a geographic neighbourhood; they are not presented as a climate driver.

**Library.** `python -m backend.ai.build_library --end 2025` spreads 380 anchor grid points over all 52 plates, downloads each full NASA POWER daily record (sharing the app's 30-day cache), and stores 6,073 overlapping 15-year episodes with what really happened in the 5 years that followed. How unusual a site is (plate-history percentile) and its hazard regime are deterministic rules. The closest past episodes are shown as *historical examples*: averaging what followed them predicted the next 5 years worse than the plain mean (RMSE 0.80σ vs 0.72σ), so they are not used as a forecast.

**Laya · resemblance score.** Laya estimates how much a past episode's trend changes resemble today's (resemblance, not the probability that any forecast is right). For each of the 9 indices a trend change *matches* when both windows move the same way (flat = |z| < 0.3σ/decade) with similar strength (within 0.5σ/decade or 35 %); similarity = share of the 9 that match, so 70 % ≈ 6–7 of 9 alike. Laya reads both patterns (words + numbers, never outcomes or places) and answers *match / different*; `python -m backend.ai.train_similarity` fine-tunes it on 2,870 pairs with the true share as a soft target (~37 min on MPS) and maps its score onto the true-share scale by quantile matching on calibration sites. It re-ranks the 40 nearest plate-scoped episodes and keeps the 5 it is most confident about; when their average is ≥ 70 % the cloud System-2 model is run automatically to explain the skill-verified odds, with the matches as context only.

| Similarity confidence, 3,245 pairs at held-out sites | mean error | correlation |
|---|---|---|
| retrieval score (baseline) | 13 pts | 0.66 |
| Laya base (zero-shot) | 18 pts | 0.11 |
| **Laya fine-tuned** | **10 pts** | **0.81** |

On 129 held-out sites the gate opened for 17 % (truly ≥ 70 % for 7 %; decisions agree 84 % of the time, so it errs towards opening). Similarity measures resemblance, not foresight: even when the gate opened, what followed the matched episodes missed the next 5 years by 0.81σ against 0.72σ for the usual change. The LLM is therefore told to check the analogs against the skill-verified System-1 odds, and the computed confidence is scaled by the similarity. Platt-scaled scores (kept in `earth_config.json`) were slightly better on error but pulled every high similarity toward the mean, so the gate never opened.

**System 1 · predictive questions.** For average temperature, hot days, heavy-rain days and longest dry spell: will the next 5 years average more than ½σ lower, within ½σ, or more than ½σ higher than the last 5? The labels are real NASA POWER outcomes, so no rule can compute them from the inputs. Split: 80% of sites with windows ending ≤2009 for training, the same sites 2011–2013 for calibration, and the other 20% of sites (never seen) with windows ending ≥2015 (outcomes 2016–2025) for testing. Score: ranked probability skill score (RPSS) against the training-period usual rates, with a 95% interval from resampling whole sites. A question's odds are shown as a forecast only if that interval lies above zero.

Two models compete per question, and the one with the better *calibration* score is served (chosen before looking at the test set):

| Test RPSS (204 windows, 68 unseen sites) | linear model | Laya base | Laya fine-tuned | served | skilful |
|---|---|---|---|---|---|
| average temperature | **+0.125** [0.05, 0.20] | −0.75 | +0.038 [−0.00, 0.08] | linear | ✓ |
| hot days | **+0.067** [0.00, 0.13] | −0.43 | −0.014 | linear | ✓ |
| heavy-rain days | −0.022 | −0.22 | +0.031 [−0.00, 0.06] | linear | ✗ |
| longest dry spell | **+0.092** [0.00, 0.17] | −0.58 | +0.020 | linear | ✓ |

*Linear model*: multinomial logistic regression on the 9 trend z-scores, 9 recent-anomaly values, significance flags, climate and latitude (30 parameters per class, stored in `earth_config.json`). *Laya*: [convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya) (Apache-2.0, 421M ModernBERT) fine-tuned for 2 epochs on 2,000 episodes described in words and numbers (`python -m backend.ai.train_laya`, ~105 min on Apple MPS). `backend/ai/laya_model.py` re-implements its decision head and loads **only** data files (safetensors, tokenizer, configs); no downloaded Python is executed. Laya did not beat the linear model on any calibration question, so it is currently **not loaded at all**: the System-1 answers in milliseconds with no 0.9 GB weight load. If a future retrain wins a question, it is loaded on demand for that question only. Skill is modest: these are odds, not certainties, and not a climate projection.

**System 2 · outlook.** Generated automatically only when Laya's average resemblance score is ≥ 70 % (plate percentile, significant indices and System-1 odds are listed as context), or when the user presses *Generate an outlook anyway*. The LLM receives the computed trends, the 5 Laya-matched episodes with their similarity and what followed them, the System-1 odds for skilful questions only (unskilful ones are marked "no verified forecast skill; do not predict its direction"), and the matching row of the event detection matrix. Its *Confidence* line is replaced by a computed **evidence-strength** rating (shift from the usual rates × verified skill; heuristic, not calibrated, and not affected by resemblance). Sentences citing numbers absent from the evidence are removed, and so are sentences that give a direction for a question without verified skill. The larger model is a **cloud model**: by default Claude (`claude-opus-5-5`, low effort, with server-side fallback if a request is declined), set by saving a Claude key in the API-keys menu or `EARTH_ANTHROPIC_KEY`; any https OpenAI-compatible API also counts as cloud. If the gate opens and no cloud model is set up, the panel asks for a key instead of handing the match to the small local Qwen3.5-0.8B, which stays available as an explicit *Use the small local model* choice. Only computed trends and analog summaries are sent. Environment overrides: `EARTH_LLM_PROVIDER=anthropic|openai|local`, `EARTH_LLM_MODEL`, `EARTH_LLM_URL`, `EARTH_LLM_KEY`.

**Endpoints.** `GET /api/ai/status`, `POST /api/ai/warmup`, `POST /api/ai/analyze {latitude, longitude, name, outlook: auto|force|off}`. CLI check: `backend/.venv/bin/python -m backend.ai.selfcheck 11.0168 76.9558`.

**Setup.** Only needed to retrain or if Laya serves a question: `uv pip install --python backend/.venv/bin/python torch transformers huggingface_hub safetensors accelerate`, then download the Laya weights to `backend/ai/models/laya` (`huggingface_hub.snapshot_download("convaiinnovations/laya", local_dir=..., allow_patterns=["*.json","model.safetensors","encoder/*","tokenizer/*"])`). On exFAT drives, delete macOS `._*` files inside `backend/.venv` if transformers fails with a UTF-8 decode error.

**Limits.** Grid estimates (~0.5°×0.625°), not station observations. Five-year direction skill is real but small; heavy-rain direction has none. The LLM outlook is generated text and must be read against the numbers shown. PB2002 GeoJSON: github.com/fraxen/tectonicplates (ODC-BY 1.0).

## Forecast, prediction and API keys

Select a place and press **Forecast** (top right, or `⌘K → Weather forecast`).

**Why WeatherNext 2.** Among models available free in the cloud, Google DeepMind's WeatherNext 2 is a 64-member AI ensemble that Google reports outperforms the ECMWF ENS physics ensemble on most variables and lead times. Open-Meteo serves it with no key for non-commercial use (CC BY 4.0, attribution required). The panel shows the member median, takes rain chance from the share of members with ≥ 1 mm, and leaves fields the model does not publish (humidity, gusts, feels-like, UV) empty instead of borrowing them from another model. If its feed is unavailable, the panel falls back to the Open-Meteo physics blend and says so.

| Feature | Source | Key needed |
|---|---|---|
| **Default forecast**: current conditions, hourly, daily (horizon as published, currently ~9–15 days) | **Google DeepMind WeatherNext 2**, 64-member AI ensemble, shown as the member median, via Open-Meteo | No |
| Alternative: 48 h hourly, 16-day daily | Open-Meteo best-match NWP blend (also the automatic fallback if WeatherNext 2 is unavailable) | No |
| Probabilities (warm spell / heatwave, cold wave, heavy rain) | WeatherNext 2 members when it is selected; otherwise ECMWF IFS 0.25° ensemble, 51 members | No |
| "What's unusual for this place" | This place's NASA POWER 1991–2020 record, ±7-day window, lapse-rate corrected | No |
| Air quality (US AQI, PM2.5, PM10, O₃, NO₂) | CAMS via Open-Meteo | No |
| Official alerts | US National Weather Service (US only); OpenWeather / WeatherAPI alerts with a key | No / Yes |
| Provider agreement table (AI vs physics works with no key) | WeatherNext 2 and Open-Meteo; plus OpenWeather One Call 3.0, WeatherAPI.com, Tomorrow.io with keys | No / Yes |
| Active fires near the place, last 48 h | NASA FIRMS VIIRS 375 m | Yes (free MAP_KEY) |
| AI briefing (on demand) | System-2 cloud model: Claude (`EARTH_ANTHROPIC_KEY` or keys menu), or any OpenAI-compatible API; local Qwen3.5-0.8B as a small fallback | Optional |

Event rules follow the detection matrix: heatwave = ≥3 consecutive days with daily maximum ≥ the local 90th percentile
("warm spell" when that threshold is below 25 °C); cold wave = ≥3 days with minimum ≤ the local 10th percentile; heavy /
extreme rain = daily total ≥ the local wet-day 95th / 99th percentile. Ensemble probabilities are the share of the 51
members meeting each rule. Flags are climate context, not official warnings.

**API keys** (key button, top right): keys are stored only on this computer in `backend/.secrets/keys.json`
(owner-only permissions, git-ignored; override the path with `EARTH_SECRETS_FILE`). The browser can save, test and
remove a key but never read it back. Environment variables win over saved keys: `OPENWEATHER_API_KEY`,
`WEATHERAPI_KEY`, `TOMORROW_API_KEY`, `NASA_FIRMS_MAP_KEY`, `EARTH_ANTHROPIC_KEY`, `EARTH_LLM_KEY`. Key endpoints only answer requests from
this computer that carry the app's client header.

Endpoints: `GET /api/forecast`, `GET /api/forecast/compare`, `POST /api/forecast/brief`, `GET /api/forecast/providers`,
`GET|PUT|DELETE /api/settings/keys[/{provider}]`, `POST /api/settings/keys/{provider}/test`.

## Change Studio

`Studio` (left rail, or `> studio`) opens one panel for the selected place with five views, all computed by `GET /api/scan` from the cached NASA POWER record (one request covers all 8 variables):

- **What's changing**: every variable ranked, significant first, by σ/decade (Theil–Sen slope ÷ standard deviation of the detrended annual values). Each row has a sparkline of annual anomalies with its trend, the slope, a diverging σ bar and a status chip: *Significant* (p < 0.05, passes the length and lag-1 autocorrelation screens and survives Benjamini–Hochberg FDR across the 8 variables), *Not after FDR*, *Not significant*, or *Withheld*.
- **Seasons**: Mann–Kendall and Theil–Sen for each calendar month; dots mark cells significant after FDR across all 96 cells.
- **Spiral**: monthly anomalies from each month's study-period mean, one loop per year, animated (optional centred 12-month running mean). Inspired by NASA's climate spiral visualizations.
- **Stripes**: one stripe per year coloured by its anomaly, for the chosen variable and as a board for all 8 (Ed Hawkins' warming-stripes style, extended to every variable).
- **Significance**: the observed annual values shuffled 2,000 times (seeded); the histogram of the Mann–Kendall S statistic under "no trend" is drawn with the observed S, alongside a checklist of record length, independence, Mann–Kendall, permutation and FDR results.

Colours use the validated diverging pair (decrease #4a9be0, increase #c97c33, grey midpoint); missing years are near-background, never a data colour.

## Then & now satellite swipe

`Compare` (top bar, or `> swipe`) splits the globe with Cesium's imagery split: the same NASA GIBS layer (MODIS Terra true colour, MODIS land surface temperature or GPM IMERG) on two dates, divided by a draggable, keyboard-accessible handle. Presets fly to the Aral Sea (2000 vs 2024), Great Salt Lake (2000 vs 2022), Lake Poopó (2013 vs 2016) and Lake Mead (2000 vs 2022); their dates were picked by scoring cloud cover over each lake in GIBS snapshots. Any dates can be chosen; dates without catalogued imagery are flagged. Inspired by NASA Earth Observatory's *World of Change*.

## Guided tour

`Tour` (top bar, or `> tour`) is an eleven-step walkthrough for demos and judging. Each step performs the action it describes (selects Cairo, opens a Studio tab, computes the trend map, starts the Aral Sea swipe, opens the AI layer) and states which challenge question it answers.

## Satellite evidence (NASA MODIS via Microsoft Planetary Computer)

NASA POWER is a model-derived record, so the Studio adds variables *measured by an Earth science mission* and uses them as an independent check. `GET /api/satellite` samples NASA MODIS Terra collection 6.1 at the selected point through the Microsoft Planetary Computer's anonymous STAC + data API (`/mosaic/register` then `/mosaic/{id}/point/{lon},{lat}`, Terra granules only, chunked to stay under the 100-item point limit, cached for 30 days):

| Key | Variable | Collection | Sampling |
|---|---|---|---|
| NDVI | Vegetation greenness | `modis-13A1-061` | 16-day, 500 m |
| LST_DAY / LST_NIGHT | Land surface temperature | `modis-11A2-061` | 8-day, 1 km |
| ET | Evapotranspiration | `modis-16A3GF-061` | yearly gap-filled, 500 m |
| NPP | Net primary productivity | `modis-17A3HGF-061` | yearly gap-filled, 500 m |

Raw integers are scaled with each product's documented scale and offset; fill and out-of-range values are dropped, never filled. **Quality policy `qa-v1`:** land surface temperature is kept only when MOD11A2 mandatory QA is "good", or "other quality" with LST error ≤ 2 K; NDVI only when pixel reliability is good or marginal (cloudy and snow/ice rejected); ET and NPP are provider gap-filled yearly products whose QC percentage is recorded, not used as a filter. Accepted/rejected counts and reasons are shown in Studio → *Data quality*. **Comparable seasons:** composites → calendar-month means → anomalies from each month's own mean; months observed in fewer than half the years are dropped for every year, a year needs ≥ 10 usable months, and the annual value is the mean seasonal cycle plus the mean anomaly, so a year missing its cold months cannot look warmer. A complete-year sensitivity trend and a coverage-shift warning are reported. Clear-sky selection inside a month is not removed by this and is disclosed. Each series gets the same Theil–Sen, Mann–Kendall, screening, permutation and FDR treatment as the POWER variables, and appears in every Studio tab. Urban or water pixels can lack ET/NPP (the products mask them); those rows are simply omitted.

**Cross-check.** MODIS day/night land surface temperature trends are compared with NASA POWER maximum/minimum air temperature over the same years (2001–last year): *confirmed by satellite* (same direction, both significant), *same direction*, or *records disagree*. This is corroborating evidence from two observing systems, not proof that land surface and air temperature are equivalent. Example, Cairo 2001–2025: night-time land surface +0.57 °C/decade vs POWER minimum air temperature +0.41 °C/decade, both significant.

## Planetary Computer map layers

`Layers → Microsoft Planetary Computer` (or `> planetary`) draws tiles straight from the Planetary Computer data API using its own published render presets (`GET /api/pc/tiles` registers the search and returns the XYZ template):

- **Land cover change**: Impact Observatory / Microsoft / Esri 10 m annual land use/land cover (`io-lulc-annual-v02`, Sentinel-2), 2017–2023, with a year track and play button.
- **Surface water change**: EC JRC Global Surface Water change intensity (`jrc-gsw`), 1984–1999 vs 2000–2020: red lost, green gained.
- **Where water occurs**: JRC occurrence, share of months with water 1984–2020.

Land cover also works in **Compare**: the *New Administrative Capital* preset swipes 2017 against 2023 east of Cairo (built area in the sampled tile rises from about 6% to 19%).

## Guidance for new users

A first-visit welcome card states the question the tool answers and offers the tour (dismissal is remembered in the browser). Statistical terms in the Studio (σ/decade, Theil–Sen, Mann–Kendall, FDR, permutation test, autocorrelation, anomaly, land surface temperature) are underlined; hover, focus or tap shows a plain-language definition.

## Validation fixes (review of 15 November 2026)

See `REVIEW_CONCERNS_AND_DATA_ROADMAP.md` §11. In short: System-1 is now evaluated on a **horizon-purged** split (training outcomes end before the first calibration forecast, calibration outcomes before the first test forecast, test sites held out; enforced by `assert_purged`). On that split only the average-temperature question keeps verified skill (RPSS 0.11, 95 % interval 0.03–0.18, 204 forecasts at 68 unseen sites, outcomes 2016–2024), so it is the only one presented as a forecast. Seasonal significance uses the same record-length and autocorrelation screens as the annual test, withheld cells are excluded from FDR, and permutation results are shown as not applicable when years are autocorrelated. MODIS series are quality-screened and season-balanced as described above.

## Hosting

The repository builds as one container (`Dockerfile`): Node builds the frontend, then FastAPI serves both `/api` and the built app on port 7860 (`$PORT` overrides). The hosted image uses `requirements-deploy.txt`, which leaves out PyTorch: everything works except Laya's resemblance score (the AI panel falls back to its rule-based gate and plain similarity search) and the plain-language forecast briefing, which needs an LLM. API keys can only be managed from the machine the server runs on, so a public instance never exposes or accepts keys.

**Hugging Face Spaces (free, recommended):** `deploy/hf-space.sh` stages a clean copy with the Space front matter; `deploy/hf-space.sh --push <user>/<space>` creates the Docker Space and uploads it (requires `hf auth login`). The first build takes a few minutes; idle Spaces sleep and wake on the next visit.

**Any Docker host** (Render, Railway, Fly.io): deploy the `Dockerfile` as is; set `PORT` if the platform requires it.

## Demo video

`demo/` holds the recorder and voiceover pipeline: `narration.json` (one line per tour step), `voiceover.py tts` (ElevenLabs, key from `ELEVENLABS_API_KEY` or `backend/.secrets/elevenlabs.key`; `--say` gives an offline placeholder), `record-tour.mjs --voice … --narration …` (holds each step until its narration ends and logs step times), and `voiceover.py mix` (places each line at its step, adds an English subtitle track and `.srt`).

## Hackathon release

[Download the 30-second narrated demo](https://github.com/saggamer/kira-earth/releases/tag/hackathon-demo-v1) · [Public source code](https://github.com/saggamer/kira-earth)

The 30-second film, English subtitles and editable HyperFrames source are documented in [demo/hackathon-30/README.md](demo/hackathon-30/README.md). The voice is AI-generated using Kokoro-82M. Deployment choices and the hosted-mode limitations are in [deploy/HACKATHON_DEPLOYMENT.md](deploy/HACKATHON_DEPLOYMENT.md).
