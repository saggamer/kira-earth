# Earth System Trend Detective: Review Concerns and Data Roadmap

Review date: **15 November 2026**  
Status: **SCI-01 to SCI-05 implemented on 15 November 2026 (see §11). Unchecked items are open; the data integrations in §4–§7 have not been added yet.**

## 1. Objective

Complete this workflow with traceable evidence:

**Draw or select a region → identify changing variables → map their trends and uncertainty → summarize exposure → save and share the investigation.**

Strengthen the scientific validation before expanding AI-generated prediction claims.

## 2. Current baseline

The reviewed version already includes:

- A globe with place/coordinate search, 2D/3D views and progressive disclosure.
- Eight NASA POWER variables, ranked by standardized trend magnitude.
- Annual trends, anomalies, seasonal fingerprints, spirals and stripes.
- Per-cell spatial trend maps with Benjamini–Hochberg false-discovery-rate correction.
- Sampled regional comparisons and independently tested A → B / B → A lagged relationships.
- MODIS satellite series and comparisons against related POWER variables.
- Satellite swipe comparisons and Planetary Computer land-cover/water display layers.
- Weather forecasts, an analog/AI layer, source information and guided onboarding.

Latest review verification:

| Check | Result |
| --- | --- |
| Production frontend build | Passed |
| Python tests | 89 passed |
| TypeScript/Node tests | 21 passed |
| Warning | One `Mean of empty slice` warning in a satellite missing-month fixture |
| Browser review | Opening view, initial tour steps, Cairo Studio ranking and seasonal view, desktop/mobile layout |

These results verify the checked implementation. They do not independently establish the forecast skill reported in saved model evaluations. Model training and paid cloud-AI calls were not rerun during the review.

## 3. Concerns to resolve first

### SCI-01 — Purge overlapping AI forecast-evaluation windows

**Priority: P0 — required before presenting current AI skill scores as clean prospective forecast validation.**

Relevant code: [predictive splits](backend/ai/predictive.py), [training](backend/ai/train_laya.py), [served model](backend/ai/laya_system1.py).

The observed episode split is:

| Partition | Forecast-origin years | Latest five-year outcome year |
| --- | --- | --- |
| Training | 1995, 1997, 1999, 2001, 2003, 2005, 2007, 2009 | 2014 |
| Calibration | 2011, 2013 | 2018 |
| Test | 2015, 2017, 2019 | 2024 |

Training therefore contains outcomes occurring after the earliest calibration origin. Calibration also contains outcomes occurring after the earliest test origin. Holding out sites does not by itself remove this temporal overlap. The current evaluation still provides information about held-out locations, but needs a stricter design for prospective forecasting claims.

Required work:

- [x] Define each episode's input interval, forecast origin and outcome interval explicitly.
- [x] At every forward-validation boundary, require all training outcomes to be available before the test forecast origin.
- [x] Apply the same rule between training and calibration, and calibration and the final test.
- [x] Keep sites/geographic blocks held out as well as time periods.
- [x] Choose model variants, calibration and gate thresholds on training/calibration data only.
- [x] Freeze an untouched final test and regenerate model cards after the split changes.
- [x] Report skill and uncertainty against the same stated baseline, plus sample counts and dates.

Acceptance criteria:

- Automated assertions reject any fold whose latest training outcome is at or after its first test origin.
- Saved evaluation metadata records the exact split and dataset/model versions.
- Served forecast-skill badges use the newly evaluated models and metrics.

Reference: [time-series cross-validation](https://otexts.com/fpp3/tscv.html).

### SCI-02 — Apply satellite pixel-quality information

**Priority: P0 — required before treating satellite agreement as strong validation evidence.**

Relevant code: [satellite ingestion and aggregation](backend/satellite.py).

The current reader checks fill/range values, scales the measurement and retains it. It does not retrieve and evaluate the corresponding pixel-quality information. A value within a numeric range can still have poor retrieval quality.

Required data/work:

- [x] Retrieve the MODIS temperature quality fields, including `QC_Day` and `QC_Night`.
- [x] Retrieve the vegetation product's applicable QA/VI-quality information.
- [x] Inspect each STAC collection's asset schema before choosing asset names.
- [x] Define and document product-specific accepted QA bits and uncertainty categories.
- [x] Preserve valid-observation counts, rejection reasons and QA-policy version in cached results.
- [x] Apply appropriate quality handling to annual ET/NPP products and disclose provider gap filling.
- [x] Invalidate or version existing satellite caches when the quality policy changes.

Acceptance criteria:

- Fixtures contain valid-range measurements that must nevertheless be rejected by QA.
- Rejected pixels cannot contribute to trends or satellite agreement badges.
- The interface exposes usable coverage and quality limitations.

Reference: [NASA MOD11A2 Collection 6.1 product specification](https://ladsweb.modaps.eosdis.nasa.gov/filespec/MODIS/61/MOD11A2).

### SCI-03 — Prevent changing seasonal coverage from changing the annual mean

**Priority: P0 — required for comparable satellite annual records.**

Relevant code: [satellite `_row` aggregation](backend/satellite.py).

The current rule accepts a year with at least ten valid months and averages the available monthly means. Ten months alone does not ensure comparable seasonal sampling.

Reproduced review example, using a synthetic diagnostic fixture only:

- January and February stay at 0°C every year; all other months stay at 20°C.
- Earlier years contain all twelve months: annual mean = **16.67°C**.
- Later years omit January and February but retain ten months: annual mean = **20.00°C**.
- Every calendar month's temperature is unchanged. Only the missing-month pattern changes.

Required work:

- [x] Choose a documented comparable-season strategy: complete years, a fixed common-month mask, or appropriately aggregated calendar-month anomalies with explicit coverage rules.
- [x] Preserve the calendar and represent missing observations explicitly.
- [x] Add sensitivity comparisons between the chosen strategy and complete-year results.
- [x] Show per-month usable coverage and warn when seasonal sampling changes.
- [x] Remove statements that the ten-month threshold eliminates seasonal/cloud sampling bias.
- [x] Describe land-surface/air-temperature agreement as corroborating evidence, not proof that the quantities are equivalent.

Acceptance criteria:

- The unchanged-monthly-cycle fixture cannot acquire an apparent annual temperature increase solely from dropping its cold months.
- Records that fail comparable-coverage rules remain unavailable or explicitly exploratory.
- Remaining clear-sky selection bias is acknowledged; season balancing is not presented as a cure for all retrieval bias.

### SCI-04 — Use consistent dependence handling for seasonal significance

**Priority: P1.**

Relevant code: [seasonal and permutation tests](backend/scan.py), [annual screening](backend/science.py).

The annual method screens detrended lag-1 autocorrelation. The seasonal method currently applies Theil–Sen and Kendall tests without that screen. FDR addresses multiple testing; it does not correct temporally dependent observations. Ordinary year shuffling also destroys dependence.

Required work:

- [x] Apply a consistent dependence screen to each calendar-month series, or implement a justified dependence-aware alternative.
- [x] Withhold significance where the selected method's assumptions are not supported.
- [ ] Preserve time dependence when constructing null distributions where necessary; document the resampling method and assumptions.
- [x] Align the tour, checklist, heatmap dots and exported methods with the actual decision rule.
- [x] Distinguish annual and seasonal testing families, including model and satellite families.
- [x] Resolve the empty-month warning without replacing unavailable climatology with invented measurements.

Acceptance criteria: autocorrelated fixtures cannot silently receive ordinary independent-sample significance claims in the seasonal view, and every significance badge has a traceable rule.

Reference: [time-series bootstrapping](https://otexts.com/fpp3/bootstrap.html).

### SCI-05 — Keep similarity, forecast skill and generated explanations separate

**Priority: P1.**

Relevant code: [similarity](backend/ai/similarity.py), [outlook](backend/ai/outlook.py).

- [x] Label analog similarity as resemblance, never as probability that a forecast is correct.
- [x] Gate predictive statements on evaluated forecast skill, not similarity alone.
- [x] Present heuristic confidence ratings as evidence-strength ratings unless calibrated against outcomes.
- [x] Have the language model explain verified structured results; avoid allowing unsupported analog outcomes to introduce new directional predictions.
- [ ] Validate the meaning and provenance of generated statements. A numeric whitelist cannot establish that a sentence is true.
- [x] Show baseline comparison, evaluation period and uncertainty alongside forecast odds.

## 4. Data to add or extend next

Start with quality metadata for existing measurements. Then add geometry and exposure data for one pilot region, rather than downloading every global dataset.

| Priority | Data | Proposed source | Current position | Required use |
| --- | --- | --- | --- | --- |
| P0 | MODIS quality bands and usable-observation counts | NASA MODIS through the existing Planetary Computer collections | Measurement series exist; QA handling needs extension | Quality-controlled temperature/vegetation records and coverage diagnostics |
| P1 | Country and administrative polygons | [geoBoundaries gbOpen API](https://www.geoboundaries.org/api.html) | Reference outlines exist; analytical region selection is proposed | Select a country/state/district and compute statistics inside the actual geometry |
| P1 | Catchment polygons and identifiers | [HydroBASINS](https://www.hydrosheds.org/products/hydrobasins) | Proposed | Basin-level precipitation, wetness and water-change investigations |
| P1 | Population counts per grid cell | [JRC GHS-POP R2023A](https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php) | Proposed | Sum estimated residents inside the selected region and clearly defined trend/exposure masks |
| P1 | Analytical land-cover class rasters | Existing `io-lulc-annual-v02` collection; see [map integration](backend/pc.py) | Display tiles exist; zonal analytical summaries are proposed | Cropland/built-up area and land-cover context inside a region |
| P1 | Analytical surface-water rasters | Existing `jrc-gsw` collection; see [map integration](backend/pc.py) | Display tiles exist; zonal analytical summaries are proposed | Water occurrence/change area, with the product period stated |

Data-specific constraints:

- geoBoundaries: start with gbOpen; pin the boundary release/identifier and represented year, and retain attribution and license metadata.
- HydroBASINS: select a documented basin level and retain its identifiers and topology. Check and retain the applicable license and attribution.
- GHS-POP: choose a supported population epoch and resolution explicitly. R2023A distinguishes estimates through 2020 from projections for 2025/2030; a projected epoch must not be labeled an observed current population count.
- Land cover: the existing integration is configured for 2017–2023. Verify catalog availability when ingesting and label the chosen year. Use class rasters, not rendered RGB tiles, for area calculations.
- Surface water: the existing integration describes 1984–2020 products. Treat these as historical context, not live water conditions; use source rasters, not screenshots, for statistics.
- A fine-resolution population or land-cover layer does not increase the native resolution of the coarse climate record.

## 5. Required ingestion metadata

For every added dataset or derived result, store:

- Dataset ID, provider, release/version, collection and asset IDs where relevant.
- Source/metadata URL, attribution and applicable license.
- Measurement/reference period or epoch, and retrieval/check timestamps.
- Whether values are observations, model estimates, provider gap-filled products or projections.
- Native CRS, resolution, units, missing-value definition and QA rules.
- Region geometry, geometry version/hash and any geometry simplification used.
- Aggregation/resampling method, usable spatial/temporal coverage and excluded observations.
- Processing-code/method version and checksums where source files are retained.

Keep display imagery and analytical rasters distinct. Cache validated subsets with their provenance. Preserve the last verified matching result during a failed refresh, with its age and failure state visible.

## 6. Region and exposure calculations

- [ ] Support drawn polygons and selected administrative/basin boundaries.
- [ ] Validate geometry, holes, multipolygons and date-line handling.
- [ ] Account for partial-cell intersections and geodesic/equal-area cell areas.
- [ ] Keep temperature and precipitation in their stated units; a spatial rainfall average is not a catchment runoff volume.
- [ ] Preserve population totals during reprojection/resampling; do not average people-per-cell as if it were temperature.
- [ ] Calculate land-cover area from class masks and pixel areas, using appropriate categorical resampling.
- [ ] State the denominator: selected-region area, usable climate area, population-covered area and/or relevant land-cover area.
- [ ] Keep the spatial footprint consistent across dates, or disclose and quantify changes.
- [ ] Include coverage and uncertainty/sensitivity information in every summary.

Use wording such as **“estimated residents within cells showing a significant warming trend”** or **“cropland area overlapping the selected trend mask.”** These are exposure/context estimates. They do not by themselves estimate illness, deaths, crop loss, economic damage or a causal climatic influence between regions.

## 7. Product work to add

### First: regional evidence workflow

- [ ] Draw/select a region and preview its boundary.
- [ ] Choose the variable, dates and analytical method.
- [ ] Rank changes and map slopes, missing cells and significance separately.
- [ ] Add population, cropland/built-up and water context with their own dates.
- [ ] Show source provenance, uncertainty and method limitations beside the result.

### Next: saved and shareable investigations

- [ ] Save region geometry/ID, variable, period, method version and dataset versions.
- [ ] Restore a saved investigation without silently substituting newer sources.
- [ ] Provide a shareable view and a readable evidence report alongside JSON export.
- [ ] Label a reproducible saved snapshot separately from a newly refreshed calculation.

### Then: dependable demonstration and job handling

- [ ] Provide a small set of clearly dated, verified cached demonstrations.
- [ ] Show progress and cancellation for long satellite or per-cell requests.
- [ ] Keep results bound to their request when the location, period or variable changes.
- [ ] Exercise loading, partial coverage, provider failure and mobile navigation in end-to-end checks.

## 8. Recommended implementation order

1. Fix temporal validation, satellite QA/seasonal coverage and significance consistency.
2. Add regression tests for the reproduced issues; rerun affected scientific/model evaluations.
3. Add one administrative boundary or basin for a pilot investigation.
4. Add population exposure and analytical reuse of existing land-cover/water products for that region.
5. Implement polygon-aware aggregation and expose its coverage/limitations in the interface.
6. Add saved/shareable evidence reports.
7. Expand geographic coverage only after the pilot's calculations and provenance are verified.

## 9. Immediate task checklist

- [x] SCI-01: implement horizon-purged evaluation and regenerate the model report.
- [x] SCI-02: retrieve and apply MODIS QA metadata.
- [x] SCI-03: add the unchanged-seasonality/missing-cold-months regression fixture.
- [x] SCI-04: apply consistent temporal-dependence handling and fix the empty-month warning.
- [x] SCI-05: separate similarity, predictive skill and explanation confidence in the AI interface.
- [ ] Create a versioned dataset manifest for the pilot region.
- [ ] Ingest one boundary and one appropriately dated population subset.
- [ ] Add analytical land-cover/water summaries with explicit source years.
- [ ] Verify partial-cell weighting, count conservation, missing coverage and failed-refresh behavior.
- [ ] Run the full build/tests and an end-to-end pilot investigation before updating capability claims.

## 10. Source references

- [NASA MOD11A2 Collection 6.1 quality specification](https://ladsweb.modaps.eosdis.nasa.gov/filespec/MODIS/61/MOD11A2)
- [NASA MOD13 Collection 6.1 user guide](https://lpdaac.usgs.gov/documents/621/MOD13_User_Guide_V61.pdf)
- [Time-series cross-validation](https://otexts.com/fpp3/tscv.html)
- [Time-series bootstrapping](https://otexts.com/fpp3/bootstrap.html)
- [geoBoundaries programmatic access](https://www.geoboundaries.org/api.html)
- [HydroBASINS product, documentation and downloads](https://www.hydrosheds.org/products/hydrobasins)
- [JRC GHS-POP R2023A product description](https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php)
- [GHSL download wizard](https://human-settlement.emergency.copernicus.eu/downloadWizard.php)
- [Planetary Computer annual land-cover catalog](https://planetarycomputer.microsoft.com/dataset/io-lulc-annual-v02)
- [Planetary Computer JRC surface-water catalog](https://planetarycomputer.microsoft.com/dataset/jrc-gsw)

Provider releases, coverage and terms must be checked again when implementing ingestion. The catalog links for existing display layers identify the intended collections; this document does not certify new analytical extraction paths.

## 11. Resolution log — 15 November 2026

| Concern | What changed | Evidence |
| --- | --- | --- |
| SCI-01 | Explicit origin/outcome intervals (`predictive.origin`, `outcome_years`); purged split train ≤ 2001 (outcomes ≤ 2006), calibration 2007–2009 (≤ 2014), test ≥ 2015 on held-out sites; `assert_purged()` runs before fitting and its manifest is saved with the evaluation. The linear model's L2 strength is chosen on calibration only; Laya is not served because it was never re-evaluated on the purged split. | `backend/tests/test_predictive_split.py` (the old split now raises). Regenerated model card: average temperature RPSS 0.11 [0.03, 0.18] (skilful); hot days 0.05 [−0.01, 0.10], dry spell 0.06 [−0.03, 0.14] and heavy rain −0.03 lose verified skill. 204 test forecasts, 68 sites, outcomes 2016–2024. |
| SCI-02 | `QC_Day`/`QC_Night` (mandatory QA good, or other quality with LST error ≤ 2 K) and NDVI `pixel_reliability` (good/marginal) are fetched with every value; ET/NPP QC percentages recorded, products labelled provider gap-filled. Counts, rejection reasons and `qa-v1` stored; cache key versioned. | `test_qa_rejects_in_range_values_with_bad_quality`. Cairo: 115 day / 50 night LST composites rejected; night LST trend unchanged (+0.57 °C/decade, significant). |
| SCI-03 | Calendar-month anomalies with a fixed common-month mask (months in < half the years dropped for all years), ≥ 10 usable months; complete-year sensitivity trend, per-month coverage and a coverage-shift warning. Wording changed to "corroborating evidence". | `test_dropping_cold_months_cannot_create_warming` (both masked and anomaly paths give zero trend). |
| SCI-04 | Seasonal cells use the annual rule (`science.fit_trend`): ≥ 10 years and lag-1 screen; withheld cells are excluded from FDR and hatched. Four FDR families. Permutation results are marked not applicable when the screen fails. Empty-month warning removed without inventing values. | `test_seasonal_cells_withhold_significance_when_autocorrelated`, `test_permutation_flags_dependence`, `test_monthly_anomalies_tolerate_unobserved_months_without_warning`; suite runs with RuntimeWarning as error. |
| SCI-05 | "Similarity confidence" renamed resemblance score (not a probability); it no longer scales the rating, which is now an "evidence strength (heuristic, not calibrated)". The LLM explains skill-verified odds and is told not to derive directions from analogs; `guard_directions` removes sentences giving a direction for an unverified question. Odds show baseline, interval and evaluation years. | `test_direction_guard_drops_claims_for_unverified_questions`, `test_evidence_strength_ignores_resemblance`. |

Still open: everything in §4–§7 (boundaries, basins, population, analytical land-cover/water summaries, saved investigations) and re-training Laya on the purged split.
