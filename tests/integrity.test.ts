import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analysisKey,
  validateAnalysis,
  validateWeather,
} from "../src/lib/dataIntegrity.ts";
import type { Analysis } from "../src/lib/store.ts";
import type { WeatherField } from "../src/lib/weather.ts";
const query = {
  latitude: 11.0168,
  longitude: 76.9558,
  start: 2020,
  end: 2020,
  parameter: "T2M" as const,
};
const record = {
  request: query,
  parameter: "T2M",
  unit: "°C",
  coverage: 100,
  retrieved_at: "2026-11-14T00:00:00Z",
  checked_at: "2026-11-14T00:01:00Z",
  source_url: "https://power.larc.nasa.gov/api/temporal/daily/point",
  annual: [{ year: 2020, value: 26, anomaly: 0, coverage: 100 }],
  monthly: Array.from({ length: 12 }, (_, i) => ({
    date: `2020-${String(i + 1).padStart(2, "0")}`,
    value: 26,
  })),
  trend: null,
  warnings: [],
} as Analysis;
test("cached records are isolated by coordinates, period and variable", () => {
  for (const change of [
    { latitude: 12 },
    { longitude: 77 },
    { start: 2019 },
    { end: 2021 },
    { parameter: "PRECTOTCORR" as const },
  ]) {
    const other = { ...query, ...change };
    assert.notEqual(analysisKey(query), analysisKey(other));
    assert.throws(() => validateAnalysis(record, other));
  }
});
test("only the complete matching annual and monthly timeline is accepted", () => {
  assert.equal(validateAnalysis(record, query), record);
  assert.throws(() =>
    validateAnalysis(
      { ...record, annual: [{ ...record.annual[0], year: 2019 }] },
      query,
    ),
  );
  assert.throws(() =>
    validateAnalysis({ ...record, monthly: record.monthly.slice(1) }, query),
  );
  assert.throws(() => validateAnalysis({ ...record, unit: "K" }, query));
  // Each variable must come back in its own unit; a humidity query cannot accept °C.
  assert.throws(() =>
    validateAnalysis(
      { ...record, parameter: "RH2M" },
      { ...query, parameter: "RH2M" as never },
    ),
  );
  assert.throws(() =>
    validateAnalysis(
      { ...record, annual: [{ ...record.annual[0], value: Infinity }] },
      query,
    ),
  );
});
const weather = {
  initialization: "2026-11-14T00:00:00+00:00",
  valid_time: "2026-11-14T06:00:00+00:00",
  lead_hours: 6,
  grid: { width: 360, height: 181, west: -180, north: 90, dx: 1, dy: 1 },
  fields: Object.fromEntries(
    ["u", "v", "temperature", "pressure", "cloud", "precipitation"].map((k) => [
      k,
      Array(65160).fill(k === "cloud" ? 0.5 : 1),
    ]),
  ),
  units: {
    u: "m/s",
    v: "m/s",
    temperature: "°C",
    pressure: "hPa",
    cloud: "fraction",
    precipitation: "mm accumulated since initialization",
  },
  contours: [],
  centers: [],
  provenance: {
    retrieved_at: "2026-11-14T01:00:00Z",
    source_urls: ["https://data.ecmwf.int/forecasts/"],
  },
} as unknown as WeatherField;
test("forecast data must belong to the requested run and lead", () => {
  assert.equal(validateWeather(weather, 6, "2026111400"), weather);
  assert.throws(() => validateWeather(weather, 12));
  assert.throws(() => validateWeather(weather, 6, "2026111300"));
  assert.throws(() =>
    validateWeather({ ...weather, valid_time: "2026-11-14T12:00:00Z" }, 6),
  );
});
test("reject truncated, entirely missing and invalid-unit weather fields", () => {
  assert.throws(() =>
    validateWeather({ ...weather, fields: { ...weather.fields, u: [1] } }, 6),
  );
  assert.throws(() =>
    validateWeather(
      { ...weather, fields: { ...weather.fields, u: Array(65160).fill(null) } },
      6,
    ),
  );
  assert.throws(() =>
    validateWeather(
      {
        ...weather,
        fields: { ...weather.fields, cloud: Array(65160).fill(50) },
      },
      6,
    ),
  );
  assert.throws(() =>
    validateWeather(
      { ...weather, units: { ...weather.units, pressure: "Pa" } },
      6,
    ),
  );
});
