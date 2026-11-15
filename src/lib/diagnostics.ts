export type Diagnostics = {
  summary: {
    mean: number;
    median: number;
    std: number | null;
    minimum: number;
    minimum_date: string;
    maximum: number;
    maximum_date: string;
    p05: number;
    p25: number;
    p75: number;
    p95: number;
    unit: string;
  } | null;
  seasonal_cycle: {
    month: number;
    mean: number | null;
    std: number | null;
    minimum: number | null;
    maximum: number | null;
    samples: number;
  }[];
  seasonal_anomalies: {
    date: string;
    departure: number | null;
    standardized: number | null;
  }[];
  robust_trend: {
    low: number;
    high: number;
    slope: number;
    iterations: number;
    block_years: number;
    seed: number;
    interval_excludes_zero: boolean;
    method: string;
    limitation: string;
  } | null;
  period_comparison: {
    early: { start: number; end: number; mean: number; years: number };
    late: { start: number; end: number; mean: number; years: number };
    difference: number;
    percent: number | null;
    interval: [number, number] | null;
  } | null;
  extremes: ({ year: number } & Record<string, number | null>)[];
  correlation: {
    pearson_r: number;
    paired_months: number;
    method: string;
    limitation: string;
  } | null;
  quality: {
    missing_days: number;
    longest_missing_run: number;
    usable_years: number;
    excluded_years: number[];
    first_valid: string | null;
    last_valid: string | null;
  };
  definitions: Record<string, string>;
};
