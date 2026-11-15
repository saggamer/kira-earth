export type TrendRow = {
  index: string;
  label: string;
  slope: number;
  unit: string;
  z: number;
  p: number;
  significant: boolean;
};
export type AnalogCard = {
  option: string;
  anchor: string;
  plate: string;
  latitude: number;
  longitude: number;
  period: [number, number];
  regime: string;
  regime_label: string;
  similarity: number;
  signature: TrendRow[];
  n_significant: number;
  magnitude: number;
  outcome: {
    years: [number, number];
    shift: Record<string, number>;
    peaks: Record<string, number>;
  };
  baseline: { t_mean: number; rain: number };
  source_url: string;
  /** Laya's calibrated confidence that this episode's trend changes match the current ones (0–1). */
  laya_similarity?: number;
  matching_indices?: string[];
};
export type SimilarityMetrics = { n: number; mae: number; pearson_r: number; mean_predicted: number; mean_true: number };
export type SimilarityEvaluation = {
  trained_at: string;
  definition: string;
  gate: number;
  pool: number;
  top: number;
  split: string;
  test: { retrieval_baseline: SimilarityMetrics; laya_zero_shot: SimilarityMetrics; laya: SimilarityMetrics };
  gate_report: {
    queries: number;
    gate_open_rate: number;
    true_open_rate: number;
    gate_agreement: number;
    outcome_rmse_sigma: Record<"gate_open" | "gate_closed", { analogs: number | null; usual_change: number | null; n: number }>;
  };
};
export type Similarity =
  | { status: "unavailable"; reason: string }
  | { status: "ok"; average: number; gate: number; passes: boolean; pool: number; model?: string; evaluation: SimilarityEvaluation };
export type Probabilities = Record<string, number>;
export type Direction = "fall" | "steady" | "rise";
export type TargetOutlook = {
  label: string;
  probabilities: Record<Direction, number>;
  most_likely: Direction;
  climatology: Record<Direction, number>;
  skilful: boolean;
  /** Which System-1 model answered: chosen per question on the calibration years. */
  source: "laya" | "logistic";
  /** Laya's own answer; null when Laya serves no question and is not loaded. */
  laya_probabilities: Record<Direction, number> | null;
  rpss: number;
  rpss_ci: [number, number];
  laya_rpss: number;
  logistic_rpss: number;
  accuracy: number;
};
export type SystemOne =
  | { status: "unavailable"; reason: string }
  | {
      status: "ok";
      weights: "fine-tuned";
      model: string;
      task: string;
      horizon_years: number;
      outlook: Record<string, TargetOutlook>;
      evaluation: Evaluation;
    };
export type Score = {
  n: number;
  rpss: number;
  rpss_ci: [number, number];
  accuracy: number;
  ece: number;
  log_loss: number;
};
export type Evaluation = {
  trained_at: string;
  task: string;
  targets: Record<string, string>;
  split: Record<string, string>;
  rows: Record<string, number>;
  metric: string;
  test: Record<
    string,
    {
      climatology: Score;
      logistic: Score;
      laya_zero_shot: Score | null;
      laya: Score | null;
      served_model?: "laya" | "logistic";
      served?: Score;
      calibration_rpss?: { laya: number; logistic: number };
      skilful: boolean;
      test_frequencies: Record<Direction, number>;
    }
  >;
};
export type System2 = { provider: string; model: string; cloud: boolean };
export type Outlook = {
  /** needs_cloud: the similarity gate opened but no cloud model is configured. */
  status: "ok" | "unavailable" | "needs_cloud";
  provider: string;
  model: string;
  cloud?: boolean;
  grounded: string[];
  text?: string;
  sections?: Partial<
    Record<"likely_next" | "hazards" | "confidence" | "monitor", string>
  >;
  reason?: string;
  removed_unsupported_sentences?: number;
  confidence?: { label: string; score: number; basis: string };
};
export type Tectonics = {
  plate: string;
  plate_name: string;
  nearest_boundary: {
    between: string[];
    codes: string[];
    type: string;
    distance_km: number;
  } | null;
  neighbours: { plate: string; plate_name: string; boundary_distance_km: number }[];
  searched_plates: string[];
  rule: string;
  source: string;
};
export type AIResult = {
  request: { latitude: number; longitude: number; name: string };
  checked_at: string;
  window: [number, number];
  signature: {
    trends: TrendRow[];
    magnitude: number;
    n_significant: number;
    start: number;
    end: number;
  };
  regime_rule: { id: string; label: string };
  baseline: { t_mean: number; rain: number };
  tectonics: Tectonics;
  analogs: AnalogCard[];
  percentile: number | null;
  pool_size: number;
  rule_severity: { level: number; label: string };
  system1: SystemOne;
  similarity: Similarity;
  escalation: {
    escalate: boolean;
    reasons: string[];
    notes?: string[];
    threshold_percentile: number;
    gate: "laya_similarity" | "rules";
    system2?: System2;
  };
  outlook: Outlook | null;
  source: string;
  source_url: string;
  retrieved_at: string;
  limitations: string[];
};
export type AIStatus = {
  library: { episodes: number; anchors: number; built_at: string; end_year: number } | null;
  system1: {
    available: boolean;
    reason: string;
    weights: string;
    loaded: boolean;
    /** False when the linear model serves every question, so Laya is never loaded. */
    laya_needed: boolean;
    evaluation: Evaluation | null;
  };
  similarity: { available: boolean; reason: string; loaded: boolean; evaluation: SimilarityEvaluation | null };
  system2: System2;
};

async function readError(r: Response, fallback: string) {
  const e = await r.json().catch(() => ({}));
  return new Error(typeof e.detail === "string" ? e.detail : fallback);
}

export async function aiStatus(signal?: AbortSignal): Promise<AIStatus> {
  const r = await fetch("/api/ai/status", { signal });
  if (!r.ok) throw await readError(r, "AI status is unavailable.");
  return r.json();
}

export async function aiWarmup(signal?: AbortSignal) {
  const r = await fetch("/api/ai/warmup", { method: "POST", signal });
  if (!r.ok) throw await readError(r, "The System-1 model could not be loaded.");
}

export async function aiAnalyze(
  body: {
    latitude: number;
    longitude: number;
    name: string;
    outlook: "auto" | "force" | "off";
  },
  signal?: AbortSignal,
): Promise<AIResult> {
  const r = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok)
    throw await readError(
      r,
      "The AI analysis could not be completed. No substitute result was generated.",
    );
  const data = (await r.json()) as AIResult;
  if (
    Math.abs(data.request.latitude - body.latitude) > 1e-6 ||
    Math.abs(data.request.longitude - body.longitude) > 1e-6
  )
    throw new Error("The AI response belongs to a different location.");
  return data;
}

export type AnalogMap = {
  origin: { latitude: number; longitude: number; name: string };
  analogs: { option: string; latitude: number; longitude: number; best: boolean; label: string }[];
  plates: string[];
};

export const REGIME_SHORT: Record<string, string> = {
  heat: "Warming, more hot days",
  warm_nights: "Warmer nights",
  heat_drought: "Hot and drying",
  drying: "Rain deficit, longer dry spells",
  extreme_rain: "More heavy-rain days",
  warm_wet_extremes: "Warming with heavier rain",
  cooling: "Cooling, more cold days",
  wetting: "Steadily wetter",
  no_clear_regime: "No significant regime",
};
