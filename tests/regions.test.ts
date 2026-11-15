import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scenario,
  comparisonKey,
  type DirectionModel,
  type ComparisonRequest,
} from "../src/lib/regions.ts";
const model = {
  status: "supported",
  coefficient: 2,
  coefficient_interval: [1, 3],
  supported_change: [-1, 1],
  scenario_reference: { prediction: 20, error_interval: [-2, 2] },
} as DirectionModel;
test("scenario estimates propagate signed source changes and uncertainty", () => {
  assert.deepEqual(scenario(model, 0.5), {
    response: 1,
    interval: [0.5, 1.5],
    prediction: 21,
    range: [19, 23],
  });
  const negative = scenario(model, -0.5)!;
  assert.equal(negative.response, -1);
  assert.deepEqual(negative.interval, [-1.5, -0.5]);
});
test("no scenario is produced for unsupported, missing or extrapolated relationships", () => {
  assert.equal(scenario({ ...model, status: "withheld" }, 0.5), null);
  assert.equal(scenario({ ...model, coefficient_interval: null }, 0.5), null);
  assert.equal(scenario(model, 1.1), null);
  assert.equal(scenario(model, NaN), null);
});
test("comparison identity includes both geographic extents, variables, years and lag", () => {
  const q = {
    a: { name: "A", latitude: 11, longitude: 77, half_span: 1 },
    b: { name: "B", latitude: -1, longitude: 37, half_span: 1 },
    parameter_a: "T2M",
    parameter_b: "PRECTOTCORR",
    start: 2001,
    end: 2024,
    lag_months: 3,
  } as ComparisonRequest;
  for (const other of [
    { ...q, lag_months: 6 },
    { ...q, parameter_a: "PRECTOTCORR" },
    { ...q, end: 2023 },
    { ...q, b: { ...q.b, half_span: 2.5 } },
    { ...q, a: { ...q.a, longitude: 78 } },
  ])
    assert.notEqual(
      comparisonKey(q),
      comparisonKey(other as ComparisonRequest),
    );
});

import { validateComparison, type Comparison } from "../src/lib/regions.ts";
const q = {
  a: { name: "A", latitude: 11, longitude: 77, half_span: 1 },
  b: { name: "B", latitude: -1, longitude: 37, half_span: 1 },
  parameter_a: "T2M",
  parameter_b: "T2M",
  start: 2020,
  end: 2020,
  lag_months: 3,
} as ComparisonRequest;
function comparisonFixture() {
  const region = (r: ComparisonRequest["a"]) => ({
    region: r,
    parameter: "T2M",
    unit: "°C",
    coverage: 100,
    annual: [{ year: 2020, value: 25, anomaly: 0 }],
    monthly: Array.from({ length: 12 }, (_, i) => ({
      date: `2020-${String(i + 1).padStart(2, "0")}`,
      value: 25,
    })),
    samples: [{ latitude: r.latitude, longitude: r.longitude, weight: 1 }],
    provenance: [
      {
        source_url: "https://power.larc.nasa.gov/api/temporal/daily/point",
        retrieved_at: "2026-11-14T00:00:00Z",
      },
    ],
  });
  const direction = {
    status: "withheld",
    lag_months: 3,
    coefficient: null,
    skill: null,
    validation: [],
    folds: [],
  };
  return {
    request: q,
    checked_at: "2026-11-14T00:00:00Z",
    a: region(q.a),
    b: region(q.b),
    directions: { a_to_b: direction, b_to_a: direction },
    limitations: [],
  } as unknown as Comparison;
}
test("regional response validation rejects swapped identities, units and time order", () => {
  const d = comparisonFixture();
  assert.equal(validateComparison(d, q), d);
  assert.throws(() =>
    validateComparison({ ...d, a: { ...d.a, region: q.b } }, q),
  );
  assert.throws(() =>
    validateComparison({ ...d, a: { ...d.a, unit: "K" } }, q),
  );
  assert.throws(() =>
    validateComparison({ ...d, b: { ...d.b, monthly: [] } }, q),
  );
  assert.throws(() =>
    validateComparison(
      {
        ...d,
        directions: {
          ...d.directions,
          a_to_b: {
            ...d.directions.a_to_b,
            folds: [
              {
                training_last_target: "2020-12",
                test_first_origin: "2020-01",
                months: 12,
                skill: 1,
              },
            ],
          },
        },
      },
      q,
    ),
  );
});
