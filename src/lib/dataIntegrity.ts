import type { Analysis } from "./store";
import { variables, type Variable } from "./variables.ts";
import type { WeatherField } from "./weather";

export type AnalysisQuery = {
  latitude: number;
  longitude: number;
  start: number;
  end: number;
  parameter: Variable;
};
export function analysisKey(q: AnalysisQuery) {
  return [
    q.latitude.toFixed(4),
    q.longitude.toFixed(4),
    q.start,
    q.end,
    q.parameter,
  ].join(":");
}
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
const optionalNumber = (n: unknown) => n === null || finite(n);
const timestamp = (s: unknown) =>
  typeof s === "string" && Number.isFinite(Date.parse(s));

export function validateAnalysis(
  value: unknown,
  query: AnalysisQuery,
): Analysis {
  const d = value as Analysis;
  if (
    !d ||
    !d.request ||
    analysisKey(d.request) !== analysisKey(query) ||
    d.parameter !== query.parameter ||
    d.unit !== variables[query.parameter]?.annual ||
    !timestamp(d.retrieved_at) ||
    !timestamp(d.checked_at) ||
    !d.source_url?.startsWith("https://power.larc.nasa.gov/") ||
    !finite(d.coverage) ||
    d.coverage < 0 ||
    d.coverage > 100 ||
    !Array.isArray(d.annual) ||
    d.annual.length !== query.end - query.start + 1 ||
    d.annual.some(
      (a, i) =>
        a.year !== query.start + i ||
        !optionalNumber(a.value) ||
        !optionalNumber(a.anomaly) ||
        !finite(a.coverage) ||
        a.coverage < 0 ||
        a.coverage > 100,
    ) ||
    !Array.isArray(d.monthly) ||
    d.monthly.length !== (query.end - query.start + 1) * 12 ||
    d.monthly.some(
      (m, i) =>
        m.date !==
          `${query.start + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}` ||
        !optionalNumber(m.value),
    ) ||
    !Array.isArray(d.warnings) ||
    d.warnings.some((w) => typeof w !== "string") ||
    (d.trend !== null &&
      (!d.trend ||
        [
          d.trend.slope,
          d.trend.low,
          d.trend.high,
          d.trend.p_value,
          d.trend.total_change,
          d.trend.years,
        ].some((n) => !finite(n))))
  ) {
    throw new Error(
      "The response did not match this location, period, variable, or expected data format. It was not displayed.",
    );
  }
  return d;
}

export function validateWeather(
  value: unknown,
  lead: number,
  run?: string | null,
): WeatherField {
  const d = value as WeatherField;
  const expectedUnits = {
    u: "m/s",
    v: "m/s",
    temperature: "°C",
    pressure: "hPa",
    cloud: "fraction",
    precipitation: "mm accumulated since initialization",
  };
  if (
    !d ||
    !timestamp(d.initialization) ||
    !timestamp(d.valid_time) ||
    d.lead_hours !== lead ||
    Date.parse(d.valid_time) - Date.parse(d.initialization) !==
      lead * 3600000 ||
    (run &&
      run !==
        d.initialization.slice(0, 13).replaceAll("-", "").replace("T", "")) ||
    d.grid?.width !== 360 ||
    d.grid.height !== 181 ||
    d.grid.west !== -180 ||
    d.grid.north !== 90 ||
    d.grid.dx !== 1 ||
    d.grid.dy !== 1 ||
    !d.fields ||
    Object.entries(expectedUnits).some(([key, unit]) => {
      const a = d.fields[key as keyof typeof d.fields];
      return (
        d.units?.[key] !== unit ||
        !Array.isArray(a) ||
        a.length !== 65160 ||
        !a.some(finite) ||
        a.some(
          (n) =>
            !optionalNumber(n) ||
            (n !== null &&
              ((key === "cloud" && (n < 0 || n > 1)) ||
                (key === "precipitation" && n < 0))),
        )
      );
    }) ||
    !Array.isArray(d.contours) ||
    !Array.isArray(d.centers) ||
    !timestamp(d.provenance?.retrieved_at) ||
    !Array.isArray(d.provenance.source_urls)
  ) {
    throw new Error(
      "Forecast times, grid, fields, or units failed validation. The previous verified field remains visible when available.",
    );
  }
  return d;
}
