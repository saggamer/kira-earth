export type Category =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm"
  | null;
export type Hour = {
  time: number;
  temperature: number | null;
  feels_like: number | null;
  humidity: number | null;
  precip_probability: number | null;
  precipitation: number | null;
  wind_speed: number | null;
  wind_gust: number | null;
  wind_direction: number | null;
  pressure: number | null;
  cloud: number | null;
  uv: number | null;
  category: Category;
  description: string | null;
};
export type Day = {
  date: string;
  t_max: number | null;
  t_min: number | null;
  precip_sum: number | null;
  precip_probability: number | null;
  wind_max: number | null;
  gust_max: number | null;
  uv_max: number | null;
  sunrise: number | null;
  sunset: number | null;
  category: Category;
  description: string | null;
};
export type Alert = {
  source: string;
  event: string | null;
  severity: string | null;
  headline: string | null;
  description: string;
  effective: string | number | null;
  expires: string | number | null;
  url: string | null;
};
export type ForecastEvent = {
  type: "heatwave" | "warm_spell" | "cold_wave" | "cold_spell" | "heavy_rain" | "extreme_rain";
  start: string;
  end: string;
  days: number;
  peak: number;
  threshold: number;
  rule: string;
};
export type ContextDay = Day & {
  hot_threshold: number;
  cold_threshold: number;
  normal_t_max: number;
  wet_threshold: number | null;
  hot: boolean;
  cold: boolean;
  heavy: boolean;
};
export type Forecast = {
  request: { latitude: number; longitude: number; provider: string };
  checked_at: string;
  forecast: {
    provider: string;
    label: string;
    model: string;
    utc_offset_seconds: number;
    timezone: string | null;
    elevation: number | null;
    current: Hour | null;
    hourly: Hour[];
    daily: Day[];
    source_url: string;
    license: string;
    docs: string;
    retrieved_at: string;
    cache: "cached" | "refreshed";
    units: Record<string, string>;
    /** Present for ensemble-derived providers (WeatherNext 2). */
    members?: number;
    notes?: string[];
  };
  ensemble: {
    model: string;
    kind?: "physics" | "ai";
    members: number;
    days: {
      date: string;
      members: number;
      t_max: [number, number, number];
      t_min: [number, number, number];
      precip: [number, number, number];
      p_precip_1mm: number;
      p_precip_10mm: number;
    }[];
    source_url: string;
    license: string;
  } | null;
  climate_context: {
    days: ContextDay[];
    events: ForecastEvent[];
    probabilities: {
      date: string;
      p_hot: number;
      p_cold: number;
      p_heavy: number | null;
      p_windy: number | null;
    }[];
    ensemble_summary: {
      p_heatwave: number;
      p_cold_wave: number;
      hot_label: string;
      cold_label: string;
      days: number;
      window: [string, string];
    } | null;
    normal_period: [number, number];
    power_elevation_m: number | null;
    forecast_elevation_m: number | null;
    lapse_shift_c: number;
    method: string;
    limitation: string;
  } | null;
  air_quality: {
    us_aqi: number | null;
    band: string | null;
    pm2_5: number | null;
    pm10: number | null;
    ozone: number | null;
    no2: number | null;
    max_us_aqi_24h: number | null;
    model: string;
    license: string;
  } | null;
  alerts: Alert[];
  fires: {
    count: number;
    nearest_km: number | null;
    max_frp: number | null;
    points: { latitude: number; longitude: number; distance_km: number; frp: number | null; acquired: string }[];
    box_deg: number;
    days: number;
    sensor: string;
    license: string;
  } | null;
  unavailable: Record<string, string>;
  configured_providers: string[];
};
export type ProviderInfo = {
  id: string;
  label: string;
  configured: boolean;
  needs_key: boolean;
  docs: string;
};
export type Comparison = {
  providers: {
    provider: string;
    label: string;
    error?: string;
    daily?: Pick<Day, "date" | "t_max" | "t_min" | "precip_sum" | "precip_probability">[];
  }[];
  t_max_spread: Record<string, { min: number; max: number; range: number; n: number }>;
};
export type Brief = {
  sections: Partial<Record<"next_48h" | "week" | "watch", string>>;
  removed_unsupported_sentences: number;
  model: string;
  provider: string;
  facts: string[];
};
export type KeyStatus = {
  id: string;
  label: string;
  kind: "forecast" | "hazard" | "llm";
  docs: string;
  note: string;
  configured: boolean;
  source: "environment" | "local file" | null;
  masked: string | null;
  env: string;
  fields: Record<string, { label: string; value: string | null }>;
};

async function json<T>(r: Response, fallback: string): Promise<T> {
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(typeof e.detail === "string" ? e.detail : fallback);
  }
  return r.json();
}

export async function getForecast(
  q: { latitude: number; longitude: number; provider: string; refresh?: boolean },
  signal?: AbortSignal,
): Promise<Forecast> {
  const p = new URLSearchParams({
    latitude: String(q.latitude),
    longitude: String(q.longitude),
    provider: q.provider,
    refresh: String(!!q.refresh),
  });
  const d = await json<Forecast>(
    await fetch(`/api/forecast?${p}`, { signal }),
    "The forecast could not be loaded. No substitute forecast was generated.",
  );
  if (
    Math.abs(d.request.latitude - q.latitude) > 1e-6 ||
    Math.abs(d.request.longitude - q.longitude) > 1e-6 ||
    d.request.provider !== q.provider
  )
    throw new Error("The forecast response belongs to a different request.");
  return d;
}

export async function getProviders(): Promise<ProviderInfo[]> {
  return (await json<{ providers: ProviderInfo[] }>(await fetch("/api/forecast/providers"), "Providers unavailable.")).providers;
}

export async function compareProviders(latitude: number, longitude: number, signal?: AbortSignal) {
  const p = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  return json<Comparison>(await fetch(`/api/forecast/compare?${p}`, { signal }), "Comparison unavailable.");
}

export async function getBrief(
  body: { latitude: number; longitude: number; name: string; provider: string },
  signal?: AbortSignal,
) {
  return json<Brief>(
    await fetch("/api/forecast/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
    "The briefing could not be written.",
  );
}

const keyHeaders = { "Content-Type": "application/json", "X-Earth-Client": "1" };

export async function listKeys() {
  return json<{ providers: KeyStatus[]; storage: string }>(
    await fetch("/api/settings/keys", { headers: keyHeaders }),
    "API key settings are unavailable.",
  );
}
export async function saveKey(id: string, key: string | null, fields: Record<string, string> = {}) {
  return json<KeyStatus>(
    await fetch(`/api/settings/keys/${id}`, {
      method: "PUT",
      headers: keyHeaders,
      body: JSON.stringify(key === null ? { fields } : { key, fields }),
    }),
    "The key could not be saved.",
  );
}
export async function removeKey(id: string) {
  return json<KeyStatus>(
    await fetch(`/api/settings/keys/${id}`, { method: "DELETE", headers: keyHeaders }),
    "The key could not be removed.",
  );
}
export async function testKey(id: string) {
  return json<{ ok: boolean; message: string }>(
    await fetch(`/api/settings/keys/${id}/test`, { method: "POST", headers: keyHeaders }),
    "The test could not run.",
  );
}

/** Wall-clock time at the forecast location (not the viewer's time zone). */
export function localTime(ts: number, offset: number) {
  return new Date((ts + offset) * 1000).toISOString().slice(11, 16);
}
export function weekday(date: string, short = true) {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en", { weekday: short ? "short" : "long", timeZone: "UTC" });
}
export function compass(deg: number | null) {
  if (deg == null) return "";
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}
export const EVENT_LABEL: Record<ForecastEvent["type"], string> = {
  heatwave: "Heatwave",
  warm_spell: "Warm spell",
  cold_wave: "Cold wave",
  cold_spell: "Cold spell",
  heavy_rain: "Heavy rain",
  extreme_rain: "Extreme rain",
};
