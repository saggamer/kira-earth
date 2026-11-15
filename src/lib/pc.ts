import { Credit, UrlTemplateImageryProvider, WebMercatorTilingScheme } from "cesium";

/** Microsoft Planetary Computer layers served through /api/pc/tiles (anonymous data API). */
export type PcKind = "landcover" | "water-change" | "water-occurrence";
export type PcTiles = {
  kind: PcKind;
  year: number | null;
  template: string;
  min_zoom: number;
  name: string;
  resolution: string;
  attribution: string;
  years: number[] | null;
  catalog: string;
};

const memo = new Map<string, Promise<PcTiles>>();
export function pcTiles(kind: PcKind, year?: number | null): Promise<PcTiles> {
  const key = `${kind}:${year ?? ""}`;
  if (!memo.has(key)) {
    const p = new URLSearchParams({ kind });
    if (year) p.set("year", String(year));
    memo.set(
      key,
      fetch(`/api/pc/tiles?${p}`).then(async (r) => {
        if (!r.ok) {
          memo.delete(key);
          const e = await r.json().catch(() => ({}));
          throw new Error(typeof e.detail === "string" ? e.detail : "Planetary Computer layer unavailable.");
        }
        return r.json();
      }),
    );
  }
  return memo.get(key)!;
}

export function pcProvider(t: PcTiles) {
  return new UrlTemplateImageryProvider({
    url: t.template,
    tilingScheme: new WebMercatorTilingScheme(),
    // The Planetary Computer renders these collections from zoom 4 (its Explorer's own minimum).
    minimumLevel: t.min_zoom,
    maximumLevel: 16,
    credit: new Credit(`Microsoft Planetary Computer / ${t.attribution}`),
  });
}

/** io-lulc-9-class colormap as published by the Planetary Computer legend endpoint. */
export const LANDCOVER_CLASSES: { label: string; color: string }[] = [
  { label: "Water", color: "#419bdf" },
  { label: "Trees", color: "#397d49" },
  { label: "Flooded vegetation", color: "#7a87c6" },
  { label: "Crops", color: "#e49635" },
  { label: "Built area", color: "#c4281b" },
  { label: "Bare ground", color: "#a59b8f" },
  { label: "Snow / ice", color: "#a8ebff" },
  { label: "Clouds", color: "#616161" },
  { label: "Rangeland", color: "#e3e2c3" },
];

export const PC_MENU: { kind: PcKind; title: string; hint: string }[] = [
  { kind: "landcover", title: "Land cover change", hint: "Impact Observatory · Esri · 10 m · 2017–2023" },
  { kind: "water-change", title: "Surface water change", hint: "JRC Global Surface Water · Landsat · 1984–2020" },
  { kind: "water-occurrence", title: "Where water occurs", hint: "JRC Global Surface Water · % of months with water" },
];
