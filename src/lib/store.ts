import { create } from "zustand";
import type { WeatherField, WeatherVariable } from "./weather";
import type { Diagnostics } from "./diagnostics";
import { validateAnalysis, type AnalysisQuery } from "./dataIntegrity";
import type { Variable } from "./variables.ts";
export { variables, type Variable } from "./variables.ts";
export type Location = {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
};

export type Layer = "natural" | "temperature" | "precipitation" | "clouds";
export const places: Location[] = [
  {
    name: "Coimbatore",
    country: "India",
    latitude: 11.0168,
    longitude: 76.9558,
  },
  {
    name: "London",
    country: "United Kingdom",
    latitude: 51.5074,
    longitude: -0.1278,
  },
  { name: "Nairobi", country: "Kenya", latitude: -1.2921, longitude: 36.8219 },
  { name: "Manaus", country: "Brazil", latitude: -3.119, longitude: -60.0217 },
  {
    name: "Reykjavík",
    country: "Iceland",
    latitude: 64.1466,
    longitude: -21.9426,
  },
];
type State = {
  sceneMode: "3d" | "2d";
  viewsOpen: boolean;
  weatherActive: boolean;
  weatherData: WeatherField | null;
  weatherVariable: WeatherVariable;
  windFlow: boolean;
  isobars: boolean;
  flowSpeed: number;
  weatherLead: number;
  weatherLoading: boolean;
  weatherError: string;
  location: Location;
  selected: boolean;
  selectionVersion: number;
  variable: Variable;
  layer: Layer;
  start: number;
  end: number;
  date: string;
  opacity: number;
  borders: boolean;
  labels: boolean;
  mode: "historical" | "forecast";
  playing: boolean;
  speed: number;
  flight: number;
  set: (v: Partial<Omit<State, "set" | "select">>) => void;
  select: (l: Location, fly?: boolean) => void;
};
export const useEarth = create<State>((set) => ({
  sceneMode: "3d",
  viewsOpen: false,
  weatherActive: false,
  weatherData: null,
  weatherVariable: "wind",
  windFlow: true,
  isobars: true,
  flowSpeed: 1,
  weatherLead: 6,
  weatherLoading: false,
  weatherError: "",
  location: places[0],
  selected: false,
  selectionVersion: 0,
  variable: "T2M",
  layer: "natural",
  start: 2001,
  end: 2024,
  date: "2024-06-15",
  opacity: 0.75,
  borders: false,
  labels: false,
  mode: "historical",
  playing: false,
  speed: 1,
  flight: 0,
  set: (v) => set(v),
  select: (location, fly = true) =>
    set((s) => ({
      location,
      selected: true,
      selectionVersion: s.selectionVersion + 1,
      flight: s.flight + (fly ? 1 : 0),
      playing: false,
    })),
}));

export type Analysis = {
  request: AnalysisQuery;
  checked_at: string;
  cache_status: "cached" | "refreshed";
  analysis?: Diagnostics;
  source_url: string;
  retrieved_at: string;
  source: string;
  parameter: string;
  unit: string;
  coverage: number;
  valid_days: number;
  expected_days: number;
  annual: {
    year: number;
    value: number | null;
    coverage: number;
    anomaly: number | null;
  }[];
  monthly: { date: string; value: number | null }[];
  trend: {
    slope: number;
    low: number;
    high: number;
    p_value: number;
    significant: boolean | null;
    lag1: number | null;
    total_change: number;
    years: number;
    direction: string;
  } | null;
  baseline: string;
  warnings: string[];
  metadata: Record<string, unknown>;
};
export async function getAnalysis(
  signal: AbortSignal,
  query?: AnalysisQuery,
  refresh = false,
) {
  const s = useEarth.getState();
  const requested = query ?? {
    latitude: s.location.latitude,
    longitude: s.location.longitude,
    start: s.start,
    end: s.end,
    parameter: s.variable,
  };
  const p = new URLSearchParams({
    latitude: String(requested.latitude),
    longitude: String(requested.longitude),
    start: String(requested.start),
    end: String(requested.end),
    parameter: requested.parameter,
  });
  if (refresh) p.set("refresh", "true");
  const r = await fetch(`/api/investigate?${p}`, { signal });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(
      e.detail ||
        "The data service could not be reached. Check your connection and retry.",
    );
  }
  return validateAnalysis(await r.json(), requested);
}
