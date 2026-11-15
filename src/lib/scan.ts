export type ScanStatus = "significant" | "nominal" | "not_significant" | "withheld";
export type ScanTrend = {
  slope: number;
  low: number;
  high: number;
  p_value: number;
  significant: boolean | null;
  lag1: number | null;
  total_change: number;
  years: number;
  direction: string;
};
export type SeasonalCell = {
  month: number;
  slope: number | null;
  z: number | null;
  p_value: number | null;
  n: number;
  significant_fdr: boolean | null;
  lag1?: number | null;
  /** Significance withheld: < 10 years or lag-1 autocorrelated (same rule as the annual series). */
  withheld?: boolean;
};
export type Permutation = {
  s_observed: number;
  s_max: number;
  p_value: number;
  permutations: number;
  share_as_extreme: number;
  /** False when the years are autocorrelated: shuffling assumes exchangeable years. */
  applicable?: boolean;
  assumption?: string;
  histogram: { edges: number[]; counts: number[] };
};
export type ScanVariable = {
  /** NASA POWER code (T2M…) or a MODIS product key (NDVI, LST_DAY…). */
  parameter: string;
  name: string;
  short?: string;
  unit: string;
  monthly_unit?: string;
  source?: "model" | "satellite";
  mission?: string;
  collection?: string;
  stac_url?: string;
  start?: number;
  end?: number;
  gap_filled?: boolean;
  quality?: {
    policy: string;
    granules?: number;
    fill_or_range?: number;
    qa_rejected?: number;
    accepted?: number;
    reasons?: Record<string, number>;
    month_coverage?: number[];
    masked_months?: number[];
    coverage_shift?: number;
    provider_qc_percent?: Record<string, number>;
    complete_year_sensitivity?: { complete_years: number; slope: number; significant: boolean | null } | null;
  };
  trend: ScanTrend | null;
  sigma: number | null;
  z: number | null;
  coverage: number;
  warnings: string[];
  annual: { year: number; value: number | null; anomaly: number | null }[];
  monthly_anomaly: (number | null)[][];
  seasonal: SeasonalCell[];
  permutation: Permutation | null;
  significant_fdr: boolean | null;
  status: ScanStatus;
};
export type Scan = {
  start: number;
  end: number;
  variables: ScanVariable[];
  ranking: string[];
  counts: Record<ScanStatus, number>;
  methods: Record<string, string>;
  request: { latitude: number; longitude: number; start: number; end: number };
  source: string;
  source_url: string;
  retrieved_at: string;
};

export async function getScan(
  q: { latitude: number; longitude: number; start: number; end: number },
  signal?: AbortSignal,
): Promise<Scan> {
  const p = new URLSearchParams({
    latitude: String(q.latitude),
    longitude: String(q.longitude),
    start: String(q.start),
    end: String(q.end),
  });
  const r = await fetch(`/api/scan?${p}`, { signal });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(typeof e.detail === "string" ? e.detail : "The change scan could not be computed. Retry.");
  }
  return r.json();
}

/** Validated diverging pair on the dark surface (see ai.css): decrease blue, increase orange, gray midpoint. */
const NEG = [74, 155, 224];
const MID = [56, 56, 53];
const POS = [201, 124, 51];
const mix = (a: number[], b: number[], t: number) =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
/** Map a value in [-1, 1] onto the diverging scale (clamped). */
export function diverging(t: number | null | undefined) {
  if (t == null || !Number.isFinite(t)) return "rgb(11,20,25)"; // missing: near-background, distinct from the grey midpoint
  const c = Math.max(-1, Math.min(1, t));
  return c < 0 ? mix(MID, NEG, -c) : mix(MID, POS, c);
}

export const STATUS_LABEL: Record<ScanStatus, string> = {
  significant: "Significant",
  nominal: "Not after FDR",
  not_significant: "Not significant",
  withheld: "Withheld",
};
export const STATUS_HINT: Record<ScanStatus, string> = {
  significant: "Mann–Kendall p < 0.05, passes the record-length and autocorrelation screens, and survives false-discovery-rate control across all 8 variables.",
  nominal: "p < 0.05 on its own, but not after controlling the false discovery rate across the 8 variables tested.",
  not_significant: "The Mann–Kendall test does not establish a trend at the 5% level.",
  withheld: "No significance claim: the record is short or the detrended annual values are autocorrelated, which inflates false positives.",
};

export const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const decimalsFor = (n: number) => {
  const a = Math.abs(n);
  return !Number.isFinite(a) || a === 0 || a >= 0.1 ? 2 : Math.min(4, Math.ceil(-Math.log10(a)) + 1);
};
export const signed = (n: number, d = decimalsFor(n)) => `${n > 0 ? "+" : ""}${n.toFixed(d)}`;

export type CrossCheck = {
  label: string;
  satellite: string;
  power: string;
  verdict: "confirmed" | "consistent" | "conflicting";
  satellite_slope: number;
  satellite_significant: boolean | null;
  power_slope: number;
  power_significant: boolean | null;
  power_unit: string;
  satellite_unit: string;
  period: [number, number];
  note?: string;
};
export type SatelliteResult = {
  variables: ScanVariable[];
  ranking: string[];
  cross_checks: CrossCheck[];
  start: number;
  end: number;
  methods: Record<string, string>;
  failed_chunks: string[];
  qa_policy?: string;
  retrieved_at: string;
  cache_status: "cached" | "fetched";
  source: string;
  source_url: string;
};

export async function getSatellite(q: { latitude: number; longitude: number }, signal?: AbortSignal): Promise<SatelliteResult> {
  const p = new URLSearchParams({ latitude: String(q.latitude), longitude: String(q.longitude) });
  const r = await fetch(`/api/satellite?${p}`, { signal });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(typeof e.detail === "string" ? e.detail : "Satellite series are unavailable right now.");
  }
  return r.json();
}
