import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sampleField,
  sampleWeather,
  colorAt,
  type WeatherField,
} from "../src/lib/weather.ts";
const fixture = {
  grid: { width: 4, height: 2, west: -180, north: 45, dx: 90, dy: 90 },
  fields: {
    u: [0, 10, 20, 30, 10, 20, 30, 40],
    v: Array(8).fill(0),
    temperature: Array(8).fill(20),
    pressure: Array(8).fill(1012),
    cloud: Array(8).fill(0.5),
    precipitation: Array(8).fill(2),
  },
} as WeatherField;
test("vector interpolation preserves a known linear field", () =>
  assert.equal(sampleField(fixture, "u", -135, 0), 10));
test("longitude interpolation wraps at the antimeridian", () =>
  assert.equal(sampleField(fixture, "u", 135, 45), 15));
test("outside latitude coverage has no value", () =>
  assert.equal(sampleField(fixture, "u", 0, 90), null));
test("wind speed derives from vector magnitude", () =>
  assert.equal(sampleWeather(fixture, "wind", 0, 45), 20));
test("cloud fraction is displayed as a percentage", () =>
  assert.equal(sampleWeather(fixture, "cloud", 0, 0), 50));
test("missing grid values do not become invented vectors", () => {
  const missing = {
    ...fixture,
    fields: { ...fixture.fields, u: [null, ...fixture.fields.u.slice(1)] },
  };
  assert.equal(sampleField(missing, "u", -180, 45), null);
});
test("map palette interpolation preserves endpoint colors", () => {
  assert.deepEqual(colorAt(["#000000", "#ffffff"], 0), [0, 0, 0]);
  assert.deepEqual(colorAt(["#000000", "#ffffff"], 1), [255, 255, 255]);
});
