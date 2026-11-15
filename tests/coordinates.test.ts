import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoordinates } from "../src/lib/coordinates.ts";
test("decimal coordinates preserve latitude and longitude", () =>
  assert.deepEqual(parseCoordinates("11.0168, 76.9558"), {
    latitude: 11.0168,
    longitude: 76.9558,
  }));
test("cardinal directions produce correct hemispheres", () =>
  assert.deepEqual(parseCoordinates("33.8688 S, 151.2093 E"), {
    latitude: -33.8688,
    longitude: 151.2093,
  }));
test("western longitude supports degree signs", () =>
  assert.deepEqual(parseCoordinates("51.5074° N, 0.1278° W"), {
    latitude: 51.5074,
    longitude: -0.1278,
  }));
test("signed pairs support whitespace", () =>
  assert.deepEqual(parseCoordinates("-3.119 -60.0217"), {
    latitude: -3.119,
    longitude: -60.0217,
  }));
test("out-of-range or malformed coordinates are rejected", () => {
  for (const x of [
    "91, 10",
    "10, 181",
    "-91, 0",
    "abc",
    "11, NaN",
    "-10 N, 20 E",
    "11 N, -20 E",
    "11, 20, 30",
  ])
    assert.equal(parseCoordinates(x), null, x);
});
test("zero coordinates are a valid target", () =>
  assert.deepEqual(parseCoordinates("0, 0"), { latitude: 0, longitude: 0 }));
