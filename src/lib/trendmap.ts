import type { Variable } from "./store";

export type TrendMapRequest = {
  name: string;
  latitude: number;
  longitude: number;
  half_span: number;
  parameter: Variable;
  start: number;
  end: number;
};
export type Bounds = { west: number; east: number; south: number; north: number };
type CellBase = {
  latitude: number;
  longitude: number;
  bounds: Bounds;
  q_value: number | null;
  fdr_significant: boolean;
  source_url?: string;
  retrieved_at?: string;
};
export type TrendCell =
  | (CellBase & {
      status: "ok";
      slope: number;
      low: number;
      high: number;
      p_value: number;
      lag1: number | null;
      autocorrelated: boolean;
      years: number;
      coverage: number;
      fdr_withheld: boolean;
    })
  | (CellBase & { status: "unavailable" | "insufficient"; reason: string });
export type TrendMap = {
  request: TrendMapRequest;
  checked_at: string;
  bounds: Bounds;
  unit: string;
  value_unit: string;
  cells: TrendCell[];
  summary: {
    cells: number;
    tested: number;
    missing: number;
    increasing: number;
    decreasing: number;
    unchanged: number;
    fdr_increasing: number;
    fdr_decreasing: number;
    uncorrected_p05: number;
    autocorrelated: number;
    fdr_withheld: number;
    bh_threshold: number | null;
    alpha: number;
    opposite_directions: boolean;
    opposite_significant: boolean;
    scale: number | null;
    median_slope: number | null;
  };
  source: string;
  methods: Record<string, string>;
  limitations: string[];
};

/** Diverging palette shared with the AI layer (src/ai.css). */
export const PALETTE = { pos: "#c97c33", neg: "#4a9be0", mid: "#383835" };

function hex(c: string) {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}
/** Map a slope to the diverging palette; `scale` is the symmetric |max| of the map. */
export function slopeColor(slope: number, scale: number): string {
  const t = scale > 0 ? Math.max(-1, Math.min(1, slope / scale)) : 0;
  const end = hex(t >= 0 ? PALETTE.pos : PALETTE.neg);
  const mid = hex(PALETTE.mid);
  const k = Math.abs(t);
  const rgb = mid.map((m, i) => Math.round(m + (end[i] - m) * k));
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Round a scale up to a tidy legend value. */
export function niceScale(x: number | null): number {
  if (!x || !Number.isFinite(x) || x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

export function gridCellCount(latitude: number, longitude: number, half: number) {
  const eps = 1e-9;
  const nLat =
    Math.floor((latitude + half) / 0.5 + eps) -
    Math.ceil((latitude - half) / 0.5 - eps) +
    1;
  const nLon =
    Math.floor((longitude + half) / 0.625 + eps) -
    Math.ceil((longitude - half) / 0.625 - eps) +
    1;
  return Math.max(0, nLat) * Math.max(0, nLon);
}

export async function computeTrendMap(
  q: TrendMapRequest,
  signal: AbortSignal,
  onProgress: (p: { done: number; total: number; failed: number }) => void,
): Promise<TrendMap> {
  const id = Math.random().toString(36).slice(2, 12);
  const poll = setInterval(async () => {
    try {
      const r = await fetch(`/api/regions/trend-map/progress?id=${id}`, { signal });
      if (r.ok) {
        const p = await r.json();
        if (p.total) onProgress(p);
      }
    } catch {
      /* progress is best-effort */
    }
  }, 1200);
  try {
    const r = await fetch("/api/regions/trend-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...q, request_id: id }),
      signal,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(
        typeof d.detail === "string"
          ? d.detail
          : r.status === 422
            ? "Check the box size, location and years."
            : "The trend-map service is unavailable. Retry the map.",
      );
    }
    const data = (await r.json()) as TrendMap;
    if (!Array.isArray(data.cells) || !data.summary)
      throw new Error("The trend-map response could not be verified.");
    return data;
  } finally {
    clearInterval(poll);
  }
}
