import { variables, type Analysis, type Variable } from "./store";
export function interpretation(data: Analysis) {
  const t = data.trend;
  if (!t)
    return "The available record is insufficient to establish an annual trend.";
  return `The annual ${variables[data.parameter as Variable]?.noun ?? "value"} is ${t.direction} at an estimated ${Math.abs(t.slope).toFixed(variables[data.parameter as Variable]?.digits ?? 2)} ${data.unit} per decade. ${t.significant === true ? "The two-sided trend test is statistically significant at α = 0.05." : t.significant === false ? "The test does not establish a statistically significant trend at α = 0.05." : "Statistical significance is withheld because the record is short or the independence screen failed."} This location represents a model grid cell, not a local weather station.`;
}
