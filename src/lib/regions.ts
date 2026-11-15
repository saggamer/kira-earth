import type { Analysis } from "./store";
import { variables, type Variable } from "./variables.ts";
export type Region = {
  name: string;
  latitude: number;
  longitude: number;
  half_span: number;
};
export type ComparisonRequest = {
  a: Region;
  b: Region;
  parameter_a: Variable;
  parameter_b: Variable;
  start: number;
  end: number;
  lag_months: number;
};
export type RegionAnalysis = Omit<
  Analysis,
  | "request"
  | "checked_at"
  | "cache_status"
  | "source_url"
  | "retrieved_at"
  | "source"
> & {
  region: Region;
  bounds: { west: number; east: number; south: number; north: number };
  samples: { latitude: number; longitude: number; weight: number }[];
  sampling: string;
  missing_policy: string;
  provenance: {
    latitude: number;
    longitude: number;
    source_url: string;
    retrieved_at: string;
  }[];
};
export type DirectionModel = {
  status: "supported" | "withheld";
  reason: string;
  lag_months: number;
  paired_months?: number;
  coefficient: number | null;
  coefficient_interval: [number, number] | null;
  skill: number | null;
  rmse: number | null;
  baseline_rmse: number | null;
  validation_months: number;
  validation: {
    origin: string;
    date: string;
    actual: number;
    prediction: number;
    baseline: number;
  }[];
  folds: {
    training_last_target: string;
    test_first_origin: string;
    months: number;
    skill: number | null;
  }[];
  supported_change: [number, number] | null;
  scenario_reference: {
    origin: string;
    target_date: string;
    prediction: number;
    error_interval: [number, number];
    limitation: string;
  } | null;
  method: string;
  limitation: string;
};
export type Comparison = {
  request: ComparisonRequest;
  checked_at: string;
  a: RegionAnalysis;
  b: RegionAnalysis;
  contrast: {
    slope_b_minus_a: number | null;
    opposite_directions: boolean;
    limitation: string;
  };
  directions: { a_to_b: DirectionModel; b_to_a: DirectionModel };
  limitations: string[];
};
export const comparisonKey = (q: ComparisonRequest) => JSON.stringify(q);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const maybeNumber = (v: unknown) => v === null || finite(v);
export function validateComparison(
  value: unknown,
  q: ComparisonRequest,
): Comparison {
  const d = value as Comparison;
  const invalid = () =>
    new Error(
      "Regional results did not match the requested regions, variables, dates or expected data format. They were not displayed.",
    );
  if (
    !d ||
    comparisonKey(d.request) !== comparisonKey(q) ||
    !Number.isFinite(Date.parse(d.checked_at)) ||
    !Array.isArray(d.limitations)
  )
    throw invalid();
  for (const key of ["a", "b"] as const) {
    const r = d[key],
      parameter = key === "a" ? q.parameter_a : q.parameter_b;
    if (
      !r ||
      JSON.stringify(r.region) !== JSON.stringify(q[key]) ||
      r.parameter !== parameter ||
      r.unit !== variables[parameter]?.annual ||
      !finite(r.coverage) ||
      r.coverage < 0 ||
      r.coverage > 100 ||
      !Array.isArray(r.annual) ||
      r.annual.length !== q.end - q.start + 1 ||
      r.annual.some(
        (a, i) =>
          a.year !== q.start + i ||
          !maybeNumber(a.value) ||
          !maybeNumber(a.anomaly),
      ) ||
      !Array.isArray(r.monthly) ||
      r.monthly.length !== 12 * (q.end - q.start + 1) ||
      r.monthly.some(
        (m, i) =>
          m.date !==
            `${q.start + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}` ||
          !maybeNumber(m.value),
      ) ||
      !Array.isArray(r.samples) ||
      r.samples.length < 1 ||
      r.samples.length > 9 ||
      r.samples.some(
        (p) =>
          !finite(p.weight) ||
          p.weight <= 0 ||
          Math.abs(p.latitude - q[key].latitude) > q[key].half_span ||
          Math.abs(p.longitude - q[key].longitude) > q[key].half_span,
      ) ||
      Math.abs(r.samples.reduce((sum, p) => sum + p.weight, 0) - 1) > 1e-6 ||
      !Array.isArray(r.provenance) ||
      r.provenance.length !== r.samples.length ||
      r.provenance.some(
        (p) =>
          !p.source_url?.startsWith("https://power.larc.nasa.gov/") ||
          !Number.isFinite(Date.parse(p.retrieved_at)),
      )
    )
      throw invalid();
  }
  for (const key of ["a_to_b", "b_to_a"] as const) {
    const m = d.directions?.[key];
    if (
      !m ||
      !["supported", "withheld"].includes(m.status) ||
      m.lag_months !== q.lag_months ||
      !maybeNumber(m.coefficient) ||
      !maybeNumber(m.skill) ||
      !Array.isArray(m.validation) ||
      !Array.isArray(m.folds) ||
      m.folds.some((f) => f.training_last_target >= f.test_first_origin) ||
      m.validation.some(
        (v) =>
          !finite(v.actual) || !finite(v.prediction) || !finite(v.baseline),
      ) ||
      (m.status === "supported" &&
        (!m.coefficient_interval ||
          !m.supported_change ||
          !m.coefficient_interval.every(finite) ||
          !m.supported_change.every(finite) ||
          m.coefficient === null ||
          m.coefficient_interval[0] > m.coefficient_interval[1]))
    )
      throw invalid();
  }
  return d;
}
export function scenario(model: DirectionModel, change: number) {
  if (
    model.status !== "supported" ||
    model.coefficient === null ||
    !model.coefficient_interval ||
    !model.supported_change ||
    !Number.isFinite(change) ||
    change < model.supported_change[0] ||
    change > model.supported_change[1]
  )
    return null;
  const interval = model.coefficient_interval
    .map((v) => v * change)
    .sort((a, b) => a - b) as [number, number];
  const response = model.coefficient * change;
  const reference = model.scenario_reference;
  return {
    response,
    interval,
    prediction: reference ? reference.prediction + response : null,
    range: reference
      ? [
          reference.prediction + response + reference.error_interval[0],
          reference.prediction + response + reference.error_interval[1],
        ]
      : null,
  };
}
export async function calculateRegions(
  q: ComparisonRequest,
  signal: AbortSignal,
): Promise<Comparison> {
  const r = await fetch("/api/regions/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(q),
    signal,
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(
      typeof d.detail === "string"
        ? d.detail
        : r.status === 422
          ? "Check the region bounds, years and time lag."
          : "The regional data service is unavailable. Retry the calculation.",
    );
  }
  return validateComparison(await r.json(), q);
}
