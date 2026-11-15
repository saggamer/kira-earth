import {
  GeographicTilingScheme,
  WebMapServiceImageryProvider,
  Credit,
} from "cesium";
import type { Layer } from "./store";
export const layers = {
  natural: {
    name: "Satellite basemap",
    source: "Esri · NASA reference fallback",
    kind: "Reference imagery · mixed acquisition dates",
    resolution: "Provider-dependent reference imagery",
    unit: "Natural color",
    id: "BlueMarble_NextGeneration",
    matrix: "500m",
    max: 8,
    format: "jpeg",
  },
  temperature: {
    name: "Land surface temperature",
    source: "NASA · MODIS Terra",
    kind: "Satellite retrieval · daytime",
    resolution: "1 km native grid",
    unit: "°C",
    id: "MODIS_Terra_Land_Surface_Temp_Day",
    matrix: "1km",
    max: 7,
    format: "png",
  },
  precipitation: {
    name: "Precipitation rate",
    source: "NASA · GPM IMERG",
    kind: "Satellite precipitation estimate",
    resolution: "0.1° native grid · 2 km display tiles",
    unit: "mm/hr",
    id: "IMERG_Precipitation_Rate",
    matrix: "2km",
    max: 6,
    format: "png",
  },
  clouds: {
    name: "Global cloud atlas",
    source: "NASA · MODIS Terra",
    kind: "Satellite true-color reflectance · daily composite",
    resolution:
      "250 m imagery, display limited by map zoom; gaps are not filled",
    unit: "True color",
    id: "MODIS_Terra_CorrectedReflectance_TrueColor",
    matrix: "250m",
    max: 8,
    format: "jpeg",
  },
};
// GIBS EPSG:4326 WMTS uses padded 288° top-level tiles, not Cesium's
// conventional 180° tiles. WMS requests exact geographic bounds, avoiding
// the silent misalignment produced by using a standard WMTS tiling scheme.
export function imagery(layer: Layer, date: string) {
  const l = layers[layer];
  return new WebMapServiceImageryProvider({
    url: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
    layers: l.id,
    parameters: {
      service: "WMS",
      version: "1.1.1",
      format: "image/png",
      transparent: true,
      time: date,
    },
    tilingScheme: new GeographicTilingScheme(),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: l.max,
    credit: new Credit("NASA EOSDIS GIBS / " + l.source),
  });
}
export type Availability = Record<
  string,
  { intervals: string[]; default: string }
>;
export function available(
  date: string,
  layer: Layer,
  catalog: Availability | null,
) {
  if (layer === "natural") return true;
  const item = catalog?.[layers[layer].id];
  return !!item?.intervals.some((v) => {
    const [a, b] = v.split("/");
    return date >= a.slice(0, 10) && date <= b.slice(0, 10);
  });
}
