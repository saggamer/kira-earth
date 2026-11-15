export type WeatherField = {
  latest_checked_at?: string | null;
  model: string;
  category: string;
  initialization: string;
  valid_time: string;
  lead_hours: number;
  native_resolution: string;
  display_resolution: string;
  grid: {
    width: number;
    height: number;
    west: number;
    north: number;
    dx: number;
    dy: number;
  };
  fields: Record<
    "u" | "v" | "temperature" | "pressure" | "cloud" | "precipitation",
    (number | null)[]
  >;
  units: Record<string, string>;
  contours: { value: number; coordinates: number[][] }[];
  centers: {
    kind: "H" | "L";
    longitude: number;
    latitude: number;
    value: number;
  }[];
  provenance: {
    source_urls: string[];
    retrieved_at: string;
    license: string;
    processing: string;
    animation: string;
    precipitation: string;
  };
};
export type WeatherVariable =
  "wind" | "temperature" | "pressure" | "cloud" | "precipitation";
export const weatherVariables: Record<
  WeatherVariable,
  { name: string; unit: string; range: [number, number]; colors: string[] }
> = {
  wind: {
    name: "10 m wind speed",
    unit: "m/s",
    range: [0, 35],
    colors: ["#233755", "#235f9b", "#31bdd0", "#a4dd73", "#f1dd58", "#ec683e"],
  },
  temperature: {
    name: "2 m air temperature",
    unit: "°C",
    range: [-40, 45],
    colors: [
      "#493c99",
      "#2d8cce",
      "#63c6bd",
      "#b1d693",
      "#f5d275",
      "#e47c4e",
      "#ad305b",
    ],
  },
  pressure: {
    name: "Mean sea-level pressure",
    unit: "hPa",
    range: [960, 1040],
    colors: [
      "#4d3d93",
      "#416db8",
      "#53b4c8",
      "#afcdb6",
      "#e4ca78",
      "#cb765c",
      "#a94a63",
    ],
  },
  cloud: {
    name: "Total cloud cover",
    unit: "%",
    range: [0, 100],
    colors: ["#11212b", "#a4b7c3", "#ffffff"],
  },
  precipitation: {
    name: "Accumulated precipitation",
    unit: "mm since initialization",
    range: [0, 50],
    colors: [
      "#11212b",
      "#216ca0",
      "#58c0c4",
      "#7ac66e",
      "#e4d75c",
      "#d66a58",
      "#af53a2",
    ],
  },
};
/** Bilinear interpolation of actual gridded model values for display/advection. */
export function sampleField(
  data: WeatherField,
  key: keyof WeatherField["fields"],
  longitude: number,
  latitude: number,
): number | null {
  const g = data.grid;
  const x = ((((longitude - g.west) / g.dx) % g.width) + g.width) % g.width;
  const y = (g.north - latitude) / g.dy;
  if (y < 0 || y > g.height - 1) return null;
  const x0 = Math.floor(x),
    x1 = (x0 + 1) % g.width,
    y0 = Math.floor(y),
    y1 = Math.min(y0 + 1, g.height - 1);
  const values = data.fields[key];
  const a = values[y0 * g.width + x0],
    b = values[y0 * g.width + x1],
    c = values[y1 * g.width + x0],
    d = values[y1 * g.width + x1];
  if (a == null || b == null || c == null || d == null) return null;
  const fx = x - x0,
    fy = y - y0;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
export function sampleWeather(
  data: WeatherField,
  key: WeatherVariable,
  lon: number,
  lat: number,
): number | null {
  if (key === "wind") {
    const u = sampleField(data, "u", lon, lat),
      v = sampleField(data, "v", lon, lat);
    return u == null || v == null ? null : Math.hypot(u, v);
  }
  const value = sampleField(data, key, lon, lat);
  return value != null && key === "cloud" ? value * 100 : value;
}
export function colorAt(
  colors: string[],
  fraction: number,
): [number, number, number] {
  const t = Math.max(0, Math.min(1, fraction)) * (colors.length - 1),
    i = Math.min(colors.length - 2, Math.floor(t)),
    mix = t - i;
  const a = colors[i].replace("#", ""),
    b = colors[i + 1].replace("#", "");
  return [0, 2, 4].map((n) =>
    Math.round(
      parseInt(a.slice(n, n + 2), 16) * (1 - mix) +
        parseInt(b.slice(n, n + 2), 16) * mix,
    ),
  ) as [number, number, number];
}
