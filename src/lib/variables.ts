/** NASA POWER daily variables available for trend analysis. */
export type Variable =
  | "T2M"
  | "T2M_MAX"
  | "T2M_MIN"
  | "PRECTOTCORR"
  | "RH2M"
  | "WS10M"
  | "PS"
  | "GWETROOT";
type VariableInfo = {
  name: string;
  /** Display unit for the variable itself. */
  unit: string;
  short: string;
  /** Unit of the annual values returned by /api/investigate. */
  annual: string;
  /** Unit of monthly values (precipitation is a monthly total). */
  monthly: string;
  /** Chart caption for the annual series. */
  series: string;
  /** Noun used in the plain-language interpretation. */
  noun: string;
  /** Decimal places that resolve a typical per-decade change. */
  digits: number;
};
export const variables: Record<Variable, VariableInfo> = {
  T2M: {
    name: "Air temperature",
    unit: "°C",
    short: "Temperature",
    annual: "°C",
    monthly: "°C",
    series: "Annual mean temperature",
    noun: "mean temperature",
    digits: 2,
  },
  T2M_MAX: {
    name: "Maximum temperature",
    unit: "°C",
    short: "Maximum temperature",
    annual: "°C",
    monthly: "°C",
    series: "Annual mean daily maximum",
    noun: "mean daily maximum temperature",
    digits: 2,
  },
  T2M_MIN: {
    name: "Minimum temperature",
    unit: "°C",
    short: "Minimum temperature",
    annual: "°C",
    monthly: "°C",
    series: "Annual mean daily minimum",
    noun: "mean daily minimum temperature",
    digits: 2,
  },
  PRECTOTCORR: {
    name: "Precipitation",
    unit: "mm",
    short: "Precipitation",
    annual: "mm/year",
    monthly: "mm/month",
    series: "Annual rainfall total",
    noun: "precipitation total",
    digits: 2,
  },
  RH2M: {
    name: "Relative humidity (2 m)",
    unit: "%",
    short: "Humidity",
    annual: "%",
    monthly: "%",
    series: "Annual mean relative humidity",
    noun: "mean relative humidity",
    digits: 2,
  },
  WS10M: {
    name: "Wind speed (10 m)",
    unit: "m/s",
    short: "Wind speed",
    annual: "m/s",
    monthly: "m/s",
    series: "Annual mean wind speed",
    noun: "mean wind speed",
    digits: 3,
  },
  PS: {
    name: "Surface pressure",
    unit: "kPa",
    short: "Pressure",
    annual: "kPa",
    monthly: "kPa",
    series: "Annual mean surface pressure",
    noun: "mean surface pressure",
    digits: 3,
  },
  GWETROOT: {
    name: "Root-zone soil wetness",
    unit: "fraction",
    short: "Soil moisture",
    annual: "fraction",
    monthly: "fraction",
    series: "Annual mean root-zone soil wetness (0–1)",
    noun: "mean root-zone soil wetness",
    digits: 3,
  },
};
