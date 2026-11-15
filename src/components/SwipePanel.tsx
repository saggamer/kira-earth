import { ArrowRightLeft, Plane, X } from "lucide-react";
import { layers, available, type Availability } from "../lib/layers";
import type { SwipeView } from "./Globe";
import { LANDCOVER_CLASSES } from "../lib/pc";

/** True-colour presets: clear-sky date pairs checked against NASA GIBS MODIS Terra (low cloud over each lake).
 *  Land-cover preset: built area in the tile rises from ~6% (2017) to ~19% (2023) in the Planetary Computer's io-lulc-annual-v02. */
export const SWIPE_PRESETS = [
  { id: "aral", layer: "clouds", name: "Aral Sea", place: "Kazakhstan / Uzbekistan", left: "2000-08-28", right: "2024-08-25", latitude: 45.0, longitude: 59.8, height: 650000 },
  { id: "gsl", layer: "clouds", name: "Great Salt Lake", place: "Utah, United States", left: "2000-08-20", right: "2022-08-15", latitude: 41.2, longitude: -112.5, height: 260000 },
  { id: "poopo", layer: "clouds", name: "Lake Poopó", place: "Oruro, Bolivia", left: "2013-05-05", right: "2016-05-05", latitude: -18.85, longitude: -67.1, height: 220000 },
  { id: "mead", layer: "clouds", name: "Lake Mead", place: "Nevada / Arizona, United States", left: "2000-06-10", right: "2022-06-10", latitude: 36.2, longitude: -114.45, height: 130000 },
  { id: "capital", layer: "landcover", name: "New Administrative Capital", place: "East of Cairo, Egypt · land cover", left: "2017", right: "2023", latitude: 30.02, longitude: 31.75, height: 60000 },
] as const;
const LC_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023];

const FIRST = "2000-02-24";

/** Camera target for a preset; on wide screens the view is nudged east so the lake sits left of the panel. */
export function presetTarget(p: (typeof SWIPE_PRESETS)[number], n: number) {
  const wide = typeof window !== "undefined" && window.innerWidth > 760;
  const shift = wide ? ((p.height / 111000) * 0.1) / Math.cos((p.latitude * Math.PI) / 180) : 0;
  return { latitude: p.latitude, longitude: p.longitude + shift, height: p.height, n };
}
type SwipeLayer = SwipeView["layer"];
const LAYERS: SwipeLayer[] = ["clouds", "temperature", "precipitation", "landcover"];
const LABEL: Record<SwipeLayer, string> = {
  clouds: "True colour (MODIS Terra)",
  temperature: "Land surface temperature (MODIS)",
  precipitation: "Precipitation rate (GPM IMERG)",
  landcover: "Land cover, 10 m (Planetary Computer)",
};

export function SwipePanel({
  view,
  catalog,
  onChange,
  onClose,
}: {
  view: SwipeView;
  catalog: Availability | null;
  onChange: (v: SwipeView) => void;
  onClose: () => void;
}) {
  const lc = view.layer === "landcover";
  const gibs = lc ? null : (view.layer as Exclude<SwipeLayer, "landcover">);
  const latest = (gibs && catalog?.[layers[gibs].id]?.default?.slice(0, 10)) ?? new Date().toISOString().slice(0, 10);
  const missing = gibs ? (["left", "right"] as const).filter((s) => catalog && !available(view[s], gibs, catalog)) : [];
  const active = SWIPE_PRESETS.find((p) => p.left === view.left && p.right === view.right && p.layer === view.layer);
  const switchLayer = (layer: SwipeLayer) => {
    if (layer === "landcover") onChange({ ...view, layer, left: "2017", right: "2023", target: undefined });
    else onChange({ ...view, layer, left: lc ? "2001-07-01" : view.left, right: lc ? latest : view.right, target: undefined });
  };
  return (
    <section className="swipe-panel glass-panel" aria-label="Then and now comparison">
      <header>
        <span className="swipe-mark">
          <ArrowRightLeft size={17} />
        </span>
        <div>
          <span className="trends-eyebrow">THEN &amp; NOW · NASA GIBS + PLANETARY COMPUTER</span>
          <h2>Swipe through time</h2>
        </div>
        <button aria-label="Close comparison" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <p className="swipe-lede">Drag the divider on the globe. Same satellite layer on both sides, two dates.</p>
      <div className="swipe-presets">
        {SWIPE_PRESETS.map((p, i) => (
          <button
            key={p.id}
            className={active?.id === p.id ? "on" : ""}
            style={{ "--i": i } as React.CSSProperties}
            onClick={() =>
              onChange({
                layer: p.layer,
                left: p.left,
                right: p.right,
                target: presetTarget(p, (view.target?.n ?? 0) + 1),
              })
            }
          >
            <strong>{p.name}</strong>
            <small>{p.place}</small>
            <em>
              {p.left.slice(0, 4)} → {p.right.slice(0, 4)} <Plane size={10} />
            </em>
          </button>
        ))}
      </div>
      <label className="swipe-field">
        Layer
        <select value={view.layer} onChange={(e) => switchLayer(e.target.value as SwipeLayer)}>
          {LAYERS.map((l) => (
            <option key={l} value={l}>
              {LABEL[l]}
            </option>
          ))}
        </select>
      </label>
      <div className="swipe-dates">
        {(["left", "right"] as const).map((side) => (
          <label className="swipe-field" key={side}>
            {side === "left" ? "Left (then)" : "Right (now)"}
            {lc ? (
              <select value={view[side]} onChange={(e) => onChange({ ...view, [side]: e.target.value, target: undefined })}>
                {LC_YEARS.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            ) : (
              <input type="date" min={FIRST} max={latest} value={view[side]} onChange={(e) => e.target.value && onChange({ ...view, [side]: e.target.value, target: undefined })} />
            )}
          </label>
        ))}
      </div>
      {lc && (
        <ul className="swipe-classes">
          {LANDCOVER_CLASSES.map((c) => (
            <li key={c.label}>
              <i style={{ background: c.color }} /> {c.label}
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <p className="swipe-warn">
          No {LABEL[view.layer].split(" (")[0].toLowerCase()} imagery is catalogued for the {missing.join(" and ")} date; that side shows the basemap.
        </p>
      )}
      <p className="swipe-note">
        {lc
          ? "Annual 10 m land use/land cover from Sentinel-2 (Impact Observatory, Microsoft, Esri) via Microsoft Planetary Computer. Zoom to city scale to see detail; class maps are model classifications, so compare broad patterns, not single pixels."
          : "Daily satellite images: clouds, haze and season can differ between the two dates. Presets use dates with little cloud over each lake, checked against NASA GIBS."}{" "}
        Inspired by NASA Earth Observatory&apos;s World of Change.
      </p>
    </section>
  );
}
