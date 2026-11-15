import { useEffect, useRef, useState } from "react";
import { Grid3x3, Play, X, Download } from "lucide-react";
import { useEarth, variables, type Variable } from "../lib/store";
import {
  computeTrendMap,
  gridCellCount,
  niceScale,
  PALETTE,
  type TrendMap,
  type TrendMapRequest,
} from "../lib/trendmap";
import "../trendmap.css";

const MAX_CELLS = 100;
const lastYear = new Date().getFullYear() - 1;
const decimalsFor = (n: number) => {
  const a = Math.abs(n);
  return !Number.isFinite(a) || a === 0 || a >= 0.1 ? 2 : Math.min(4, Math.ceil(-Math.log10(a)) + 1);
};
const signed = (n: number, d = decimalsFor(n)) => `${n > 0 ? "+" : ""}${n.toFixed(d)}`;

export function TrendMapLegend({ map }: { map: TrendMap }) {
  const scale = niceScale(map.summary.scale);
  return (
    <div className="tm-legend" aria-label="Trend map legend">
      <div className="tm-legend-title">
        Sen slope · {map.unit}
      </div>
      <div
        className="tm-ramp"
        style={{
          background: `linear-gradient(90deg, ${PALETTE.neg}, ${PALETTE.mid}, ${PALETTE.pos})`,
        }}
      />
      <div className="tm-ticks">
        <span>{signed(-scale, scale < 1 ? 2 : 1)}</span>
        <span>0</span>
        <span>{signed(scale, scale < 1 ? 2 : 1)}</span>
      </div>
      <div className="tm-keys">
        <span>
          <i className="tm-key tm-key-sig" /> FDR-significant (hatched, α=
          {map.summary.alpha})
        </span>
        <span>
          <i className="tm-key tm-key-ns" /> not significant
        </span>
        <span>
          <i className="tm-key tm-key-missing" /> no usable record
        </span>
      </div>
    </div>
  );
}

export function TrendMapPanel({
  onClose,
  onResult,
  autoRun = false,
}: {
  onClose: () => void;
  onResult: (map: TrendMap | null) => void;
  /** Compute immediately on open (guided tour); repeats are served from the cache. */
  autoRun?: boolean;
}) {
  const { location, selected, start, end } = useEarth();
  const [request, setRequest] = useState<TrendMapRequest>({
    name: selected ? location.name : "Selected region",
    latitude: location.latitude,
    longitude: location.longitude,
    half_span: 2.5,
    parameter: "T2M",
    // Same study period as the rest of the app, so cached point records are reused.
    start,
    end,
  });
  const [data, setData] = useState<TrendMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (selected && !loading)
      setRequest((q) => ({
        ...q,
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, selected]);
  const cells = gridCellCount(request.latitude, request.longitude, request.half_span);
  const valid =
    Number.isFinite(request.latitude) &&
    Number.isFinite(request.longitude) &&
    Math.abs(request.latitude) + request.half_span <= 85 &&
    Math.abs(request.longitude) + request.half_span <= 180 &&
    request.start >= 1981 &&
    request.end <= lastYear &&
    request.end - request.start >= 9 &&
    request.end - request.start <= 44 &&
    cells > 0 &&
    cells <= MAX_CELLS;
  const run = async () => {
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    setLoading(true);
    setError("");
    setProgress(null);
    try {
      const result = await computeTrendMap(structuredClone(request), c.signal, setProgress);
      if (!c.signal.aborted) {
        setData(result);
        onResult(result);
      }
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    if (autoRun && valid) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);
  const s = data?.summary;
  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "spatial-trend-map.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <aside className="tm-panel glass-panel" aria-labelledby="tm-title">
      <header className="tm-header">
        <span className="tm-mark">
          <Grid3x3 size={18} />
        </span>
        <div>
          <span className="tm-eyebrow">WHERE IS IT CHANGING?</span>
          <h2 id="tm-title">Spatial trend map</h2>
        </div>
        <button
          aria-label="Close spatial trend map"
          onClick={() => {
            abort.current?.abort();
            onResult(null);
            onClose();
          }}
        >
          <X size={18} />
        </button>
      </header>
      <form
        className="tm-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void run();
        }}
      >
        <div className="tm-center">
          <span>Centre</span>
          <strong>{request.name}</strong>
          <small>
            {request.latitude.toFixed(3)}, {request.longitude.toFixed(3)}
            {!selected && " · click the globe to choose a place"}
          </small>
        </div>
        <label>
          Variable
          <select
            value={request.parameter}
            onChange={(e) => setRequest((q) => ({ ...q, parameter: e.target.value as Variable }))}
          >
            {Object.entries(variables).map(([key, v]) => (
              <option key={key} value={key}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Box
          <select
            value={request.half_span}
            onChange={(e) => setRequest((q) => ({ ...q, half_span: +e.target.value }))}
          >
            <option value="1">2° × 2°</option>
            <option value="1.5">3° × 3°</option>
            <option value="2">4° × 4°</option>
            <option value="2.5">5° × 5°</option>
          </select>
        </label>
        <label>
          From
          <input
            type="number"
            min={1981}
            max={lastYear}
            value={request.start}
            onChange={(e) => setRequest((q) => ({ ...q, start: +e.target.value }))}
          />
        </label>
        <label>
          To
          <input
            type="number"
            min={1981}
            max={lastYear}
            value={request.end}
            onChange={(e) => setRequest((q) => ({ ...q, end: +e.target.value }))}
          />
        </label>
        <p className="tm-note">
          {cells} native cells (0.5° × 0.625°) · one NASA POWER record each, two
          at a time. A first run can take a few minutes; repeats use the cache.
          {request.end - request.start < 9 && " Use at least 10 years."}
          {cells > MAX_CELLS && ` Limit is ${MAX_CELLS} cells.`}
        </p>
        <button className="tm-run" type="submit" disabled={!valid || loading}>
          {loading ? <span className="loader" /> : <Play size={14} />}
          {loading
            ? progress
              ? `Retrieving ${progress.done}/${progress.total} cells…`
              : "Starting…"
            : data
              ? "Recompute map"
              : "Compute trend map"}
        </button>
        {loading && progress && (
          <div className="tm-progress" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
            <i style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
          </div>
        )}
      </form>
      {error && (
        <p className="tm-error" role="alert">
          {error}
        </p>
      )}
      {data && s && (
        <section className="tm-result" aria-live="polite">
          <TrendMapLegend map={data} />
          <dl className="tm-stats">
            <div>
              <dt>Cells with a trend</dt>
              <dd>
                {s.tested} / {s.cells}
                {s.missing > 0 && <small> · {s.missing} empty</small>}
              </dd>
            </div>
            <div>
              <dt>Increasing / decreasing</dt>
              <dd>
                <span className="tm-pos">{s.increasing}</span> /{" "}
                <span className="tm-neg">{s.decreasing}</span>
              </dd>
            </div>
            <div>
              <dt>FDR-significant ↑ / ↓</dt>
              <dd>
                <span className="tm-pos">{s.fdr_increasing}</span> /{" "}
                <span className="tm-neg">{s.fdr_decreasing}</span>
                <small> · {s.uncorrected_p05} at p&lt;0.05 uncorrected</small>
              </dd>
            </div>
            <div>
              <dt>Median slope</dt>
              <dd>
                {s.median_slope === null ? "—" : `${signed(s.median_slope)} ${data.unit}`}
              </dd>
            </div>
          </dl>
          <p className="tm-reading">
            {s.opposite_significant
              ? "Significant trends run in opposite directions within this box: the region is not changing uniformly."
              : s.opposite_directions
                ? s.fdr_increasing + s.fdr_decreasing
                  ? "Fitted slopes have both signs here, but all FDR-significant cells share one direction."
                  : "Fitted slopes have both signs here, but no cell is significant after FDR correction."
                : s.tested
                  ? `All fitted slopes share one sign in this box; ${s.fdr_increasing + s.fdr_decreasing} of ${s.tested} cells are FDR-significant.`
                  : "No cell had a usable record."}
            {s.autocorrelated > 0 &&
              ` ${s.autocorrelated} cell${s.autocorrelated > 1 ? "s" : ""} failed the autocorrelation screen and ${s.autocorrelated > 1 ? "are" : "is"} never marked significant.`}
          </p>
          <details className="tm-methods">
            <summary>Methods and limitations</summary>
            <ul>
              {Object.values(data.methods).map((m) => (
                <li key={m}>{m}</li>
              ))}
              {data.limitations.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </details>
          <div className="tm-foot">
            <span>
              {data.source} · {variables[data.request.parameter]?.name}{" "}
              {data.request.start}–{data.request.end}
            </span>
            <button type="button" onClick={download} aria-label="Download trend map JSON">
              <Download size={13} /> JSON
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}
