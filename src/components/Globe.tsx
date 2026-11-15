import { useEffect, useRef, useState } from "react";
import {
  Viewer,
  Rectangle,
  SceneMode,
  MapMode2D,
  SingleTileImageryProvider,
  Cartesian3,
  Color,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartographic,
  Math as CMath,
  GeoJsonDataSource,
  LabelStyle,
  VerticalOrigin,
  Cartesian2,
  EllipsoidTerrainProvider,
  ArcGisMapServerImageryProvider,
  PolylineDashMaterialProperty,
  StripeMaterialProperty,
  StripeOrientation,
  defined,
  SplitDirection,
  type ImageryLayer,
  type PerspectiveFrustum,
} from "cesium";
import { Compass, Plus, Minus, AlertCircle } from "lucide-react";
import { useEarth, places, type Layer } from "../lib/store";
import { imagery, available, type Availability } from "../lib/layers";
import { pcProvider, pcTiles, type PcTiles } from "../lib/pc";
import { Button } from "./ui/button";
import { WeatherScene } from "../lib/WeatherScene";
import type { ComparisonRequest } from "../lib/regions";
import type { AnalogMap } from "../lib/ai";
import { niceScale, slopeColor, type TrendCell, type TrendMap } from "../lib/trendmap";
import "../trendmap.css";
function TrendTooltip({ cell, unit }: { cell: TrendCell; unit: string }) {
  const where = `${Math.abs(cell.latitude).toFixed(2)}°${cell.latitude >= 0 ? "N" : "S"} ${Math.abs(cell.longitude).toFixed(3)}°${cell.longitude >= 0 ? "E" : "W"}`;
  if (cell.status !== "ok")
    return (
      <>
        <strong>{where}</strong>
        <div className="tm-tip-flag">{cell.reason}</div>
      </>
    );
  const s = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}`;
  return (
    <>
      <strong>{where}</strong>
      <div className="tm-tip-row">
        Sen slope <b>{s(cell.slope)} {unit}</b>
      </div>
      <div className="tm-tip-row">
        95% interval <b>{s(cell.low)} … {s(cell.high)}</b>
      </div>
      <div className="tm-tip-row">
        Mann–Kendall p <b>{cell.p_value < 0.001 ? "<0.001" : cell.p_value.toFixed(3)}</b>
      </div>
      <div className="tm-tip-row">
        BH q <b>{cell.q_value === null ? "—" : cell.q_value < 0.001 ? "<0.001" : cell.q_value.toFixed(3)}</b>
      </div>
      <div className="tm-tip-row">
        Years · lag-1 <b>{cell.years} · {cell.lag1 === null ? "—" : cell.lag1.toFixed(2)}</b>
      </div>
      <div className="tm-tip-row">
        Field significance <b>{cell.fdr_significant ? "FDR-significant" : "not significant"}</b>
      </div>
      {cell.autocorrelated && (
        <div className="tm-tip-flag">Autocorrelation screen failed: significance withheld.</div>
      )}
    </>
  );
}
function overviewAltitude(v: Viewer) {
  const frustum = v.camera.frustum as PerspectiveFrustum;
  const vertical = (frustum.fovy ?? Math.PI / 3) / 2;
  const horizontal = Math.atan(
    (Math.tan(vertical) * v.canvas.clientWidth) /
      Math.max(1, v.canvas.clientHeight),
  );
  const angle = Math.atan(Math.tan(Math.min(vertical, horizontal)) * 0.82);
  return 6378137 / Math.sin(angle) - 6378137;
}
export type ViewTarget = { latitude: number; longitude: number };
export type SwipeView = {
  /** A NASA GIBS layer (dates YYYY-MM-DD) or Planetary Computer land cover (dates are years). */
  layer: Exclude<Layer, "natural"> | "landcover";
  left: string;
  right: string;
  /** Optional camera target; `n` changes to request a new flight. */
  target?: { latitude: number; longitude: number; height: number; n: number };
};

export function Globe({
  catalog,
  onViewChange,
  onReset,
  comparison,
  analogs = null,
  focus = null,
  trendMap = null,
  swipe = null,
  pcOverlay = null,
}: {
  catalog: Availability | null;
  onViewChange: (target: ViewTarget | null) => void;
  onReset: () => void;
  comparison: ComparisonRequest | null;
  analogs?: AnalogMap | null;
  focus?: { latitude: number; longitude: number; n: number } | null;
  trendMap?: TrendMap | null;
  /** Then-and-now comparison: one NASA GIBS layer on two dates, split by a draggable divider. */
  swipe?: SwipeView | null;
  /** Microsoft Planetary Computer overlay (land cover, surface water). */
  pcOverlay?: PcTiles | null;
}) {
  const [hover, setHover] = useState<{ x: number; y: number; cell: TrendCell } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const border = useRef<GeoJsonDataSource | null>(null);
  const overlay = useRef<ImageryLayer | null>(null);
  const atmosphere = useRef<WeatherScene | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [tileError, setTileError] = useState(false);
  const {
    sceneMode,
    weatherActive,
    weatherData,
    weatherVariable,
    windFlow,
    isobars,
    flowSpeed,
    location,
    selected,
    flight,
    layer,
    date,
    opacity,
    borders,
    labels,
    mode,
  } = useEarth();
  const callbacks = useRef({ onViewChange, onReset });
  callbacks.current = { onViewChange, onReset };
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const ids = [
      "comparison-a",
      "comparison-b",
      "comparison-a-label",
      "comparison-b-label",
      "comparison-link",
    ];
    ids.forEach((id) => v.entities.removeById(id));
    if (comparison) {
      for (const key of ["a", "b"] as const) {
        const r = comparison[key],
          s = r.half_span;
        const color = Color.fromCssColorString(
          key === "a" ? "#8ad8c4" : "#b9a2ea",
        );
        v.entities.add({
          id: `comparison-${key}`,
          rectangle: {
            coordinates: Rectangle.fromDegrees(
              r.longitude - s,
              r.latitude - s,
              r.longitude + s,
              r.latitude + s,
            ),
            material: color.withAlpha(0.22),
            outline: true,
            outlineColor: color,
            height: 1000,
          },
        });
        v.entities.add({
          id: `comparison-${key}-label`,
          position: Cartesian3.fromDegrees(r.longitude, r.latitude, 15000),
          point: { pixelSize: 7, color },
          label: {
            text: `${key.toUpperCase()} · ${r.name}`,
            font: "12px sans-serif",
            fillColor: color,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(0, -23),
          },
        });
      }
      const { a, b } = comparison;
      v.entities.add({
        id: "comparison-link",
        polyline: {
          positions: Cartesian3.fromDegreesArrayHeights([
            a.longitude,
            a.latitude,
            30000,
            b.longitude,
            b.latitude,
            30000,
          ]),
          width: 2,
          material: new PolylineDashMaterialProperty({
            color: Color.fromCssColorString("#a6c6d2").withAlpha(0.7),
            dashLength: 16,
          }),
        },
      });
      v.camera.flyTo({
        destination: Rectangle.fromDegrees(
          Math.max(
            -180,
            Math.min(a.longitude - a.half_span, b.longitude - b.half_span) - 8,
          ),
          Math.max(
            -85,
            Math.min(a.latitude - a.half_span, b.latitude - b.half_span) - 6,
          ),
          Math.min(
            180,
            Math.max(a.longitude + a.half_span, b.longitude + b.half_span) + 8,
          ),
          Math.min(
            85,
            Math.max(a.latitude + a.half_span, b.latitude + b.half_span) + 6,
          ),
        ),
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 1.8,
      });
    }
    v.scene.requestRender();
  }, [comparison, ready]);
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let v: Viewer;
    let handler: ScreenSpaceEventHandler;
    let removeMove: (() => void) | undefined;
    try {
      v = new Viewer(container.current, {
        baseLayer: false,
        terrainProvider: new EllipsoidTerrainProvider(),
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        mapMode2D: MapMode2D.ROTATE,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        skyBox: false,
        contextOptions: { webgl: { alpha: true, antialias: true } },
      });
      viewer.current = v;
      v.scene.backgroundColor = Color.TRANSPARENT;
      v.scene.globe.baseColor = Color.fromCssColorString("#16304b");
      v.scene.globe.showGroundAtmosphere = true;
      v.scene.globe.enableLighting = false;
      v.scene.fog.enabled = false;
      v.scene.screenSpaceCameraController.minimumZoomDistance = 200000;
      v.scene.screenSpaceCameraController.maximumZoomDistance = 40000000;
      v.resize();
      v.camera.setView({
        destination: Cartesian3.fromDegrees(48, 16, overviewAltitude(v)),
      });
      SingleTileImageryProvider.fromUrl("/earth.jpg", {
        credit: "NASA Blue Marble reference texture, via Three.js",
      })
        .then((p) => {
          if (!disposed) {
            v.imageryLayers.addImageryProvider(p, 0);
            setReady(true);
            ArcGisMapServerImageryProvider.fromUrl(
              "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
              { enablePickFeatures: false },
            )
              .then((provider) => {
                if (!disposed) {
                  v.imageryLayers.addImageryProvider(provider, 1);
                  v.scene.requestRender();
                }
              })
              .catch(() => {});
          }
        })
        .catch(() => {
          if (!disposed) {
            setReady(true);
            setError("Reference imagery unavailable. Check public/earth.jpg.");
          }
        });
      GeoJsonDataSource.load("/data/countries.geojson", {
        stroke: Color.fromCssColorString("#a6c3d5").withAlpha(0.23),
        fill: Color.TRANSPARENT,
        strokeWidth: 1,
      })
        .then((d) => {
          if (!disposed) {
            border.current = d;
            d.show = useEarth.getState().borders;
            v.dataSources.add(d);
            v.scene.requestRender();
          }
        })
        .catch(() => {});
      for (const p of places)
        v.entities.add({
          id: "label-" + p.name,
          position: Cartesian3.fromDegrees(p.longitude, p.latitude),
          label: {
            text: p.name.toUpperCase(),
            font: "10px sans-serif",
            fillColor: Color.fromCssColorString("#d5e1e9"),
            outlineColor: Color.fromCssColorString("#101b24"),
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(0, -12),
            verticalOrigin: VerticalOrigin.BOTTOM,
            distanceDisplayCondition: undefined,
          },
          point: { pixelSize: 3, color: Color.fromCssColorString("#b5cbd9") },
        });
      handler = new ScreenSpaceEventHandler(v.scene.canvas);
      handler.setInputAction((e: { position: Cartesian2 }) => {
        const pos = v.camera.pickEllipsoid(e.position, v.scene.globe.ellipsoid);
        if (!pos) return;
        const c = Cartographic.fromCartesian(pos);
        const latitude = CMath.toDegrees(c.latitude),
          longitude = CMath.toDegrees(c.longitude);
        const nearby = places.find(
          (p) =>
            Math.abs(p.latitude - latitude) < 0.2 &&
            Math.abs(p.longitude - longitude) < 0.2,
        );
        useEarth.getState().select(
          nearby || {
            name: "Selected location",
            country: "Geographic point",
            latitude: +latitude.toFixed(4),
            longitude: +longitude.toFixed(4),
          },
          false,
        );
      }, ScreenSpaceEventType.LEFT_CLICK);
      removeMove = v.camera.moveEnd.addEventListener(() => {
        if (v.camera.positionCartographic.height > 4000000) {
          callbacks.current.onViewChange(null);
          return;
        }
        const center = new Cartesian2(
          v.canvas.clientWidth / 2,
          v.canvas.clientHeight / 2,
        );
        const point = v.camera.pickEllipsoid(center, v.scene.globe.ellipsoid);
        if (point) {
          const c = Cartographic.fromCartesian(point);
          callbacks.current.onViewChange({
            latitude: +CMath.toDegrees(c.latitude).toFixed(4),
            longitude: +CMath.toDegrees(c.longitude).toFixed(4),
          });
        }
      });
    } catch (e) {
      setError(
        "The 3D globe needs WebGL. Enable hardware acceleration and reload.",
      );
      console.error(e);
    }
    return () => {
      disposed = true;
      atmosphere.current?.destroy();
      atmosphere.current = null;
      removeMove?.();
      handler?.destroy();
      if (v && !v.isDestroyed()) v.destroy();
      viewer.current = null;
    };
  }, []);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    let remove: (() => void) | undefined;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : 1.5;
    if (sceneMode === "2d" && v.scene.mode !== SceneMode.SCENE2D) {
      remove = v.scene.morphComplete.addEventListener(() => {
        if (!v.isDestroyed()) {
          v.camera.setView({
            destination: Rectangle.fromDegrees(-180, -90, 180, 90),
          });
          v.camera.zoomIn(v.camera.positionCartographic.height * 0.18);
          v.scene.requestRender();
        }
      });
      v.scene.morphTo2D(duration);
    } else if (sceneMode === "3d" && v.scene.mode !== SceneMode.SCENE3D) {
      remove = v.scene.morphComplete.addEventListener(() => {
        if (!v.isDestroyed()) {
          v.camera.setView({
            destination: Cartesian3.fromDegrees(48, 16, overviewAltitude(v)),
          });
          v.scene.requestRender();
        }
      });
      v.scene.morphTo3D(duration);
    }
    return () => remove?.();
  }, [sceneMode, ready]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready || !container.current) return;
    if (!weatherActive || !weatherData) {
      atmosphere.current?.destroy();
      atmosphere.current = null;
      return;
    }
    if (!atmosphere.current)
      atmosphere.current = new WeatherScene(v, container.current);
    atmosphere.current
      .update(weatherData, weatherVariable, windFlow, isobars, flowSpeed)
      .catch((e) => console.error("Weather rendering failed", e));
  }, [
    ready,
    weatherActive,
    weatherData,
    weatherVariable,
    windFlow,
    isobars,
    flowSpeed,
  ]);
  useEffect(() => {
    const v = viewer.current;
    if (
      v &&
      ready &&
      weatherActive &&
      !selected &&
      v.scene.mode === SceneMode.SCENE3D
    ) {
      v.camera.flyTo({
        destination: Cartesian3.fromDegrees(-45, 28, overviewAltitude(v)),
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 2.2,
      });
    }
  }, [weatherActive, ready]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    let active = true;
    setTileError(false);
    if (overlay.current && v.imageryLayers.contains(overlay.current))
      v.imageryLayers.remove(overlay.current);
    overlay.current = null;
    if (
      !swipe &&
      layer !== "natural" &&
      mode === "historical" &&
      available(date, layer, catalog)
    ) {
      const provider = imagery(layer, date);
      const remove = provider.errorEvent.addEventListener(() => {
        if (active) setTileError(true);
      });
      const l = v.imageryLayers.addImageryProvider(provider);
      overlay.current = l;
      l.alpha = opacity;
      v.scene.requestRender();
      return () => {
        active = false;
        remove();
      };
    }
    v.scene.requestRender();
  }, [layer, date, ready, catalog, mode, !!swipe]);
  // Then-and-now swipe: the left date shows left of the divider, the right date right of it.
  const [split, setSplit] = useState(0.5);
  const dragging = useRef(false);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready || !swipe) return;
    let cancelled = false;
    const added: ImageryLayer[] = [];
    const sides = [["left", SplitDirection.LEFT], ["right", SplitDirection.RIGHT]] as const;
    const add = (provider: Parameters<typeof v.imageryLayers.addImageryProvider>[0], dir: SplitDirection) => {
      const l = v.imageryLayers.addImageryProvider(provider);
      l.splitDirection = dir;
      added.push(l);
    };
    if (swipe.layer === "landcover") {
      void Promise.all(sides.map(([side]) => pcTiles("landcover", +swipe[side].slice(0, 4))))
        .then((tiles) => {
          if (cancelled) return;
          tiles.forEach((t, i) => add(pcProvider(t), sides[i][1]));
          v.scene.requestRender();
        })
        .catch(() => !cancelled && setTileError(true));
    } else {
      const layer = swipe.layer;
      sides.forEach(([side, dir]) => add(imagery(layer, swipe[side]), dir));
    }
    v.scene.splitPosition = split;
    v.scene.requestRender();
    return () => {
      cancelled = true;
      added.forEach((l) => v.imageryLayers.contains(l) && v.imageryLayers.remove(l));
      v.scene.requestRender();
    };
  }, [swipe?.layer, swipe?.left, swipe?.right, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = viewer.current;
    const t = swipe?.target;
    if (!v || !ready || !t) return;
    setSplit(0.5);
    v.scene.splitPosition = 0.5;
    v.camera.flyTo({
      destination: Cartesian3.fromDegrees(t.longitude, t.latitude, t.height),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 2.2,
    });
  }, [swipe?.target?.n, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // Planetary Computer overlay above the basemap, using the shared opacity control.
  const pcLayer = useRef<ImageryLayer | null>(null);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    if (pcLayer.current && v.imageryLayers.contains(pcLayer.current)) v.imageryLayers.remove(pcLayer.current);
    pcLayer.current = null;
    if (pcOverlay && !swipe) {
      const l = v.imageryLayers.addImageryProvider(pcProvider(pcOverlay));
      l.alpha = Math.max(0.6, opacity);
      pcLayer.current = l;
    }
    v.scene.requestRender();
  }, [pcOverlay?.template, ready, !!swipe]); // eslint-disable-line react-hooks/exhaustive-deps
  const moveSplit = (clientX: number) => {
    const v = viewer.current;
    const box = container.current?.getBoundingClientRect();
    if (!v || !box) return;
    const pos = Math.min(0.98, Math.max(0.02, (clientX - box.left) / box.width));
    setSplit(pos);
    v.scene.splitPosition = pos;
    v.scene.requestRender();
  };
  useEffect(() => {
    const v = viewer.current;
    if (v && overlay.current) {
      overlay.current.alpha = opacity;
      v.scene.requestRender();
    }
  }, [opacity, layer]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (border.current) border.current.show = borders;
    for (const e of v.entities.values)
      if (e.id.startsWith("label-")) e.show = labels;
    v.scene.requestRender();
  }, [borders, labels, ready]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    v.entities.removeById("selection");
    if (selected)
      v.entities.add({
        id: "selection",
        position: Cartesian3.fromDegrees(
          location.longitude,
          location.latitude,
          0,
        ),
        point: {
          pixelSize: 6,
          color: Color.fromCssColorString("#a3f5e7"),
          outlineColor: Color.fromCssColorString("#72dac9").withAlpha(0.18),
          outlineWidth: 8,
        },
        label: {
          text: location.name.toUpperCase(),
          font: "11px monospace",
          fillColor: Color.fromCssColorString("#b2e5dd"),
          outlineColor: Color.fromCssColorString("#081419"),
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, -25),
        },
      });
    v.scene.requestRender();
  }, [location, selected, ready]);
  useEffect(() => {
    const v = viewer.current;
    if (v && ready && flight > 0 && selected)
      v.camera.flyTo({
        destination: Cartesian3.fromDegrees(
          location.longitude,
          location.latitude,
          1600000,
        ),
        duration: 2.1,
      });
  }, [flight, ready]);
  // AI analog overlay: searched plate boundaries + analog sites linked to the origin.
  const plates = useRef<GeoJsonDataSource | null>(null);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    let cancelled = false;
    const prefix = "ai-analog-";
    v.entities.values
      .filter((e) => e.id.startsWith(prefix))
      .forEach((e) => v.entities.remove(e));
    if (plates.current) {
      v.dataSources.remove(plates.current, true);
      plates.current = null;
    }
    if (analogs) {
      const pos = Color.fromCssColorString("#9fc4e6");
      const best = Color.fromCssColorString("#e0bd88");
      for (const a of analogs.analogs) {
        const color = a.best ? best : pos;
        v.entities.add({
          id: `${prefix}${a.option}`,
          position: Cartesian3.fromDegrees(a.longitude, a.latitude, 20000),
          point: {
            pixelSize: a.best ? 11 : 8,
            color: color.withAlpha(0.95),
            outlineColor: Color.fromCssColorString("#08141b"),
            outlineWidth: 2,
          },
          label: {
            text: a.label,
            font: "11px sans-serif",
            fillColor: color,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(0, -18),
          },
        });
        v.entities.add({
          id: `${prefix}link-${a.option}`,
          polyline: {
            positions: Cartesian3.fromDegreesArrayHeights([
              analogs.origin.longitude,
              analogs.origin.latitude,
              20000,
              a.longitude,
              a.latitude,
              20000,
            ]),
            width: a.best ? 2 : 1,
            material: new PolylineDashMaterialProperty({
              color: color.withAlpha(a.best ? 0.85 : 0.45),
              dashLength: 12,
            }),
          },
        });
      }
      fetch("/data/plate-boundaries.json")
        .then((r) => r.json())
        .then(async (geo) => {
          if (cancelled) return;
          const wanted = new Set(analogs.plates);
          const features = geo.features.filter(
            (f: { properties: { PlateA: string; PlateB: string } }) =>
              wanted.has(f.properties.PlateA) || wanted.has(f.properties.PlateB),
          );
          const ds = await GeoJsonDataSource.load(
            { type: "FeatureCollection", features },
            {
              stroke: Color.fromCssColorString("#c97c33").withAlpha(0.8),
              strokeWidth: 2,
              clampToGround: false,
            },
          );
          if (cancelled) return;
          plates.current = ds;
          await v.dataSources.add(ds);
          v.scene.requestRender();
        })
        .catch(() => {});
    }
    v.scene.requestRender();
    return () => {
      cancelled = true;
    };
  }, [analogs, ready]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready || !focus) return;
    v.camera.flyTo({
      destination: Cartesian3.fromDegrees(focus.longitude, focus.latitude, 2600000),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1.6,
    });
  }, [focus, ready]);
  // Spatial trend map: one rectangle per native grid cell, no interpolation between cells.
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const prefix = "trendmap-";
    v.entities.values
      .filter((e) => e.id.startsWith(prefix))
      .forEach((e) => v.entities.remove(e));
    setHover(null);
    if (!trendMap) {
      v.scene.requestRender();
      return;
    }
    const scale = niceScale(trendMap.summary.scale);
    const b = trendMap.bounds;
    v.entities.add({
      id: `${prefix}box`,
      rectangle: {
        coordinates: Rectangle.fromDegrees(b.west, b.south, b.east, b.north),
        fill: false,
        outline: true,
        outlineColor: Color.fromCssColorString("#d5e7e9").withAlpha(0.7),
        height: 2800,
      },
    });
    trendMap.cells.forEach((cell, i) => {
      const r = Rectangle.fromDegrees(
        cell.bounds.west,
        cell.bounds.south,
        cell.bounds.east,
        cell.bounds.north,
      );
      if (cell.status !== "ok") {
        v.entities.add({
          id: `${prefix}cell-${i}`,
          rectangle: {
            coordinates: r,
            material: Color.fromCssColorString("#6f8791").withAlpha(0.06),
            outline: true,
            outlineColor: Color.fromCssColorString("#6f8791").withAlpha(0.6),
            height: 2500,
          },
        });
        return;
      }
      const color = Color.fromCssColorString(slopeColor(cell.slope, scale));
      v.entities.add({
        id: `${prefix}cell-${i}`,
        rectangle: {
          coordinates: r,
          material: color.withAlpha(cell.fdr_significant ? 0.9 : 0.62),
          outline: cell.fdr_significant,
          outlineColor: Color.WHITE.withAlpha(0.9),
          height: 2500,
        },
      });
      if (cell.fdr_significant)
        v.entities.add({
          id: `${prefix}hatch-${i}`,
          rectangle: {
            coordinates: r,
            material: new StripeMaterialProperty({
              evenColor: Color.WHITE.withAlpha(0.28),
              oddColor: Color.TRANSPARENT,
              repeat: 5,
              orientation: StripeOrientation.HORIZONTAL,
            }),
            height: 2600,
          },
        });
    });
    const padLat = (b.north - b.south) * 0.6,
      padLon = (b.east - b.west) * 0.6;
    v.camera.flyTo({
      destination: Rectangle.fromDegrees(
        Math.max(-180, b.west - padLon),
        Math.max(-89, b.south - padLat),
        Math.min(180, b.east + padLon),
        Math.min(89, b.north + padLat),
      ),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1.6,
    });
    const handler = new ScreenSpaceEventHandler(v.scene.canvas);
    handler.setInputAction((e: { endPosition: Cartesian2 }) => {
      const picked = v.scene.pick(e.endPosition);
      const id: string | undefined =
        defined(picked) && picked.id && typeof picked.id.id === "string" ? picked.id.id : undefined;
      const m = id?.match(/^trendmap-(?:cell|hatch)-(\d+)$/);
      if (m) {
        const cell = trendMap.cells[+m[1]];
        setHover({ x: e.endPosition.x, y: e.endPosition.y, cell });
      } else setHover((h) => (h ? null : h));
    }, ScreenSpaceEventType.MOUSE_MOVE);
    v.scene.requestRender();
    return () => handler.destroy();
  }, [trendMap, ready]);
  const reset = () => {
    callbacks.current.onReset();
    const v = viewer.current;
    if (v && v.scene.mode === SceneMode.SCENE3D)
      v.camera.flyTo({
        destination: Cartesian3.fromDegrees(48, 16, overviewAltitude(v)),
        duration: 1.8,
      });
  };
  return (
    <>
      <div className="cesium-host" ref={container} />
      {swipe && ready && (
        <div className="swipe-layer" aria-hidden={false}>
          <span className="swipe-date left" style={{ right: `${(1 - split) * 100}%` }}>
            {swipe.left}
          </span>
          <span className="swipe-date right" style={{ left: `${split * 100}%` }}>
            {swipe.right}
          </span>
          <div
            className="swipe-divider"
            style={{ left: `${split * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Comparison divider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split * 100)}
            onPointerDown={(e) => {
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => dragging.current && moveSplit(e.clientX)}
            onPointerUp={() => (dragging.current = false)}
            onKeyDown={(e) => {
              const box = container.current?.getBoundingClientRect();
              if (!box) return;
              const step = e.key === "ArrowLeft" ? -0.03 : e.key === "ArrowRight" ? 0.03 : 0;
              if (step) moveSplit(box.left + (split + step) * box.width);
            }}
          >
            <i />
            <b>‹ ›</b>
          </div>
        </div>
      )}
      {hover && trendMap && (
        <div className="tm-tooltip" role="tooltip" style={{ left: hover.x, top: hover.y }}>
          <TrendTooltip cell={hover.cell} unit={trendMap.unit} />
        </div>
      )}
      {!ready && !error && (
        <div className="globe-loading">
          <span className="loader" />
          Loading our planet…
        </div>
      )}
      {error && (
        <div className="globe-error">
          <AlertCircle size={20} />
          {error}
        </div>
      )}
      {tileError && (
        <div className="imagery-warning">
          Some NASA tiles could not load. Blue Marble reference imagery remains
          visible.
        </div>
      )}
      <div className="globe-controls">
        <Button
          variant="outline"
          size="icon"
          title="Reset globe view"
          aria-label="Reset globe view"
          onClick={reset}
        >
          <Compass size={19} />
        </Button>
        <div className="zoom-group">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom in"
            onClick={() => {
              const v = viewer.current;
              if (v) {
                v.camera.zoomIn(v.camera.positionCartographic.height * 0.25);
                v.scene.requestRender();
              }
            }}
          >
            <Plus size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom out"
            onClick={() => {
              const v = viewer.current;
              if (v) {
                v.camera.zoomOut(v.camera.positionCartographic.height * 0.3);
                v.scene.requestRender();
              }
            }}
          >
            <Minus size={18} />
          </Button>
        </div>
      </div>
    </>
  );
}
