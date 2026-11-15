import {
  Viewer,
  SingleTileImageryProvider,
  Cartesian3,
  Cartesian2,
  Color,
  SceneTransforms,
  EllipsoidalOccluder,
  Ellipsoid,
  SceneMode,
  LabelStyle,
  type ImageryLayer,
  type Entity,
} from "cesium";
import {
  sampleField,
  sampleWeather,
  colorAt,
  weatherVariables,
  type WeatherField,
  type WeatherVariable,
} from "./weather";

/** Canvas particles advect through real model vectors; the camera controls stay native. */
export class WeatherScene {
  private viewer: Viewer;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frame = 0;
  private disposed = false;
  private raster: ImageryLayer | null = null;
  private entities: Entity[] = [];
  private baseAppearance: {
    layer: ImageryLayer;
    brightness: number;
    saturation: number;
  }[] = [];
  private generation = 0;
  private data: WeatherField | null = null;
  private particles: { lon: number; lat: number; age: number }[] = [];
  private flow = true;
  private speed = 1;
  private signature = "";
  private previous = 0;
  private width = 0;
  private height = 0;
  private point = new Cartesian3();
  private a = new Cartesian2();
  private b = new Cartesian2();
  private occluder: EllipsoidalOccluder;
  constructor(viewer: Viewer, host: HTMLElement) {
    this.viewer = viewer;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "weather-flow-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    host.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.occluder = new EllipsoidalOccluder(
      Ellipsoid.WGS84,
      viewer.camera.positionWC,
    );
    this.frame = requestAnimationFrame(this.draw);
  }
  private project(lon: number, lat: number, result: Cartesian2) {
    Cartesian3.fromDegrees(lon, lat, 12000, Ellipsoid.WGS84, this.point);
    if (
      this.viewer.scene.mode === SceneMode.SCENE3D &&
      !this.occluder.isPointVisible(this.point)
    )
      return undefined;
    return SceneTransforms.worldToWindowCoordinates(
      this.viewer.scene,
      this.point,
      result,
    );
  }
  private seed() {
    const camera = this.viewer.camera.positionCartographic;
    if (camera.height < 3000000) {
      const span = Math.max(2, camera.height / 111195);
      return {
        lon:
          (((camera.longitude * 180) / Math.PI +
            (Math.random() - 0.5) * span * 2 +
            540) %
            360) -
          180,
        lat: Math.max(
          -78,
          Math.min(
            78,
            (camera.latitude * 180) / Math.PI +
              (Math.random() - 0.5) * span * 1.4,
          ),
        ),
        age: Math.random() * 100,
      };
    }
    return {
      lon: Math.random() * 360 - 180,
      lat: Math.random() * 156 - 78,
      age: Math.random() * 100,
    };
  }
  private draw = (now: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.draw);
    if (now - this.previous < 30) return;
    const elapsed = Math.min(2, (now - this.previous) / 33.33) || 1;
    this.previous = now;
    const width = this.viewer.canvas.clientWidth,
      height = this.viewer.canvas.clientHeight;
    if (width !== this.width || height !== this.height) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = width;
      this.height = height;
      this.particles = Array.from(
        {
          length: Math.min(
            1500,
            Math.max(400, Math.round((width * height) / 1000)),
          ),
        },
        () => this.seed(),
      );
    }
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "rgba(0,0,0,0.965)";
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    if (
      !this.data ||
      !this.flow ||
      document.hidden ||
      this.viewer.scene.mode === SceneMode.MORPHING
    )
      return;
    this.occluder.cameraPosition = this.viewer.camera.positionWC;
    ctx.lineWidth = 1.15;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.age++ > 110) {
        this.particles[i] = this.seed();
        continue;
      }
      const u = sampleField(this.data, "u", p.lon, p.lat),
        v = sampleField(this.data, "v", p.lon, p.lat);
      if (u == null || v == null) {
        this.particles[i] = this.seed();
        continue;
      }
      const a = this.project(p.lon, p.lat, this.a);
      const ax = a?.x,
        ay = a?.y;
      const dt =
        4500 *
        this.speed *
        elapsed *
        Math.min(
          1,
          Math.max(
            0.015,
            this.viewer.camera.positionCartographic.height / 12000000,
          ),
        );
      const nextLat = p.lat + (v * dt) / 111195,
        nextLon =
          p.lon +
          (u * dt) /
            (111195 * Math.max(0.15, Math.cos((p.lat * Math.PI) / 180)));
      if (Math.abs(nextLat) > 83) {
        this.particles[i] = this.seed();
        continue;
      }
      p.lon = ((nextLon + 540) % 360) - 180;
      p.lat = nextLat;
      const b = this.project(p.lon, p.lat, this.b);
      if (
        ax == null ||
        ay == null ||
        !b ||
        Math.abs(b.x - ax) > 45 ||
        Math.abs(b.y - ay) > 45 ||
        b.x < 0 ||
        b.x > width ||
        b.y < 0 ||
        b.y > height
      )
        continue;
      const speed = Math.hypot(u, v);
      ctx.strokeStyle =
        speed > 18
          ? "rgba(255,237,123,.95)"
          : speed > 9
            ? "rgba(192,247,191,.9)"
            : "rgba(149,230,247,.86)";
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  };
  async update(
    data: WeatherField,
    variable: WeatherVariable,
    flow: boolean,
    isobars: boolean,
    speed: number,
  ) {
    this.data = data;
    this.flow = flow;
    this.speed = speed;
    const signature = `${data.initialization}/${data.lead_hours}/${variable}/${isobars}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const generation = ++this.generation;
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (this.raster && this.viewer.imageryLayers.contains(this.raster))
      this.viewer.imageryLayers.remove(this.raster);
    this.raster = null;
    for (const e of this.entities) this.viewer.entities.remove(e);
    this.entities = [];
    for (let i = 0; i < Math.min(2, this.viewer.imageryLayers.length); i++) {
      const layer = this.viewer.imageryLayers.get(i);
      if (!this.baseAppearance.some((b) => b.layer === layer))
        this.baseAppearance.push({
          layer,
          brightness: layer.brightness,
          saturation: layer.saturation,
        });
      layer.brightness = variable === "cloud" ? 0.8 : 0.48;
      layer.saturation = variable === "cloud" ? 0.75 : 0.25;
    }
    const config = weatherVariables[variable];
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const value = sampleWeather(
          data,
          variable,
          -180 + ((x + 0.5) / canvas.width) * 360,
          90 - ((y + 0.5) / canvas.height) * 180,
        );
        if (value == null) continue;
        const index = (y * canvas.width + x) * 4;
        const rgb =
          variable === "cloud"
            ? [245, 249, 255]
            : colorAt(
                config.colors,
                (value - config.range[0]) / (config.range[1] - config.range[0]),
              );
        image.data[index] = rgb[0];
        image.data[index + 1] = rgb[1];
        image.data[index + 2] = rgb[2];
        image.data[index + 3] =
          variable === "cloud"
            ? Math.round(225 * (value / 100) ** 1.2)
            : variable === "precipitation"
              ? Math.round(Math.min(190, Math.max(0, value - 0.1) * 55))
              : variable === "wind"
                ? 170
                : 150;
      }
    ctx.putImageData(image, 0, 0);
    const provider = await SingleTileImageryProvider.fromUrl(
      canvas.toDataURL("image/png"),
      { credit: "ECMWF AIFS Single · CC BY 4.0 · " + data.valid_time },
    );
    if (this.disposed || generation !== this.generation) return;
    this.raster = this.viewer.imageryLayers.addImageryProvider(provider);
    if (isobars) {
      for (const [i, contour] of data.contours.entries()) {
        if (contour.coordinates.length < 8) continue;
        const entity = this.viewer.entities.add({
          polyline: {
            positions: contour.coordinates.map((p) =>
              Cartesian3.fromDegrees(p[0], p[1], 15000),
            ),
            width: 1,
            material: Color.fromCssColorString("#f4e6a0").withAlpha(0.53),
          },
        });
        this.entities.push(entity);
        if (i % 9 === 0 && contour.coordinates.length > 35) {
          const p =
            contour.coordinates[Math.floor(contour.coordinates.length * 0.55)];
          this.entities.push(
            this.viewer.entities.add({
              position: Cartesian3.fromDegrees(p[0], p[1], 18000),
              label: {
                text: String(contour.value),
                font: "10px monospace",
                fillColor: Color.fromCssColorString("#eee7b8"),
                outlineColor: Color.fromCssColorString("#172634"),
                outlineWidth: 3,
                style: LabelStyle.FILL_AND_OUTLINE,
              },
            }),
          );
        }
      }
      for (const center of data.centers)
        this.entities.push(
          this.viewer.entities.add({
            position: Cartesian3.fromDegrees(
              center.longitude,
              center.latitude,
              20000,
            ),
            label: {
              text: center.kind + "\n" + center.value.toFixed(0),
              font: "bold 18px monospace",
              fillColor: Color.fromCssColorString(
                center.kind === "H" ? "#94caff" : "#ec96ce",
              ),
              outlineColor: Color.fromCssColorString("#142634"),
              outlineWidth: 4,
              style: LabelStyle.FILL_AND_OUTLINE,
            },
          }),
        );
    }
    this.viewer.scene.requestRender();
  }
  destroy() {
    this.disposed = true;
    this.generation++;
    cancelAnimationFrame(this.frame);
    this.canvas.remove();
    if (this.viewer.isDestroyed()) return;
    for (const b of this.baseAppearance) {
      if (this.viewer.imageryLayers.contains(b.layer)) {
        b.layer.brightness = b.brightness;
        b.layer.saturation = b.saturation;
      }
    }
    for (const e of this.entities) this.viewer.entities.remove(e);
    if (this.raster && this.viewer.imageryLayers.contains(this.raster))
      this.viewer.imageryLayers.remove(this.raster);
    this.viewer.scene.requestRender();
  }
}
