import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Calculator,
  Check,
  Download,
  Grid3x3,
  ExternalLink,
  Info,
  MapPin,
  Play,
  Search,
  X,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  places,
  useEarth,
  variables,
  type Location,
  type Variable,
} from "../lib/store";
import { parseCoordinates, formatCoordinates } from "../lib/coordinates";
import {
  calculateRegions,
  comparisonKey,
  scenario,
  type Comparison,
  type ComparisonRequest,
  type Region,
} from "../lib/regions";

/** Signed value with enough decimals to keep two significant digits for small units (e.g. soil wetness fraction). */
const decimalsFor = (n: number) => {
  const a = Math.abs(n);
  if (!Number.isFinite(a) || a === 0 || a >= 0.1) return 2;
  return Math.min(4, Math.ceil(-Math.log10(a)) + 1);
};
const signed = (n: number, d = decimalsFor(n)) => `${n > 0 ? "+" : ""}${n.toFixed(d)}`;
const monthlyUnit = (v: Variable) => variables[v].monthly;
function RegionEditor({
  label,
  region,
  onChange,
  parameter,
  onParameter,
  onCurrent,
}: {
  label: string;
  region: Region;
  onChange: (r: Region) => void;
  parameter: Variable;
  onParameter: (v: Variable) => void;
  onCurrent: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Location[]>([]);
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setStatus("");
      return;
    }
    const coords = parseCoordinates(query);
    if (coords) {
      setResults([{ name: "Coordinate region", country: "WGS84", ...coords }]);
      setStatus("");
      return;
    }
    const local = places.filter((p) =>
      `${p.name} ${p.country}`.toLowerCase().includes(query.toLowerCase()),
    );
    if (local.length) {
      setResults(local);
      setStatus("");
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const abort = new AbortController();
    setResults([]);
    setStatus("Searching…");
    const timer = setTimeout(
      () =>
        void fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: abort.signal,
        })
          .then(async (r) => {
            if (!r.ok) throw new Error();
            return r.json() as Promise<Location[]>;
          })
          .then((d) => {
            if (!abort.signal.aborted) {
              setResults(d);
              setStatus(
                d.length ? "" : "No matching places. Enter coordinates.",
              );
            }
          })
          .catch(() => {
            if (!abort.signal.aborted)
              setStatus(
                "Search unavailable. Enter coordinates or use the globe selection.",
              );
          }),
      350,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);
  return (
    <fieldset className="region-editor">
      <legend>
        <span
          className={`region-letter ${label === "A" ? "region-a" : "region-b"}`}
        >
          {label}
        </span>
        {region.name}
      </legend>
      <div className="region-search">
        <Search size={14} />
        <input
          aria-label={`Region ${label} location search`}
          value={query}
          placeholder="Search a place or latitude, longitude"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !query.trim()) return;
            e.preventDefault();
            const p = results[0];
            if (p) {
              onChange({
                ...region,
                name: p.name,
                latitude: p.latitude,
                longitude: p.longitude,
              });
              setQuery("");
            }
          }}
        />
        {query && (
          <button
            type="button"
            aria-label={`Clear region ${label} search`}
            onClick={() => setQuery("")}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {status && (
        <p role="status" className="region-search-status">
          {status}
        </p>
      )}
      {results.length > 0 && (
        <div className="region-search-results">
          {results.map((p) => (
            <button
              type="button"
              key={`${p.latitude},${p.longitude}`}
              onClick={() => {
                onChange({
                  ...region,
                  name: p.name,
                  latitude: p.latitude,
                  longitude: p.longitude,
                });
                setQuery("");
              }}
            >
              <MapPin size={13} />
              <span>
                {p.name}
                <small>{p.country}</small>
              </span>
              <ArrowRight size={13} />
            </button>
          ))}
        </div>
      )}
      <div className="region-coordinate-row">
        <span>{formatCoordinates(region.latitude, region.longitude)}</span>
        <button type="button" onClick={onCurrent}>
          Use globe selection
        </button>
      </div>
      <div className="region-options">
        <label>
          Variable
          <select
            aria-label={`Region ${label} climate variable`}
            value={parameter}
            onChange={(e) => onParameter(e.target.value as Variable)}
          >
            {Object.entries(variables).map(([key, v]) => (
              <option key={key} value={key}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Region size
          <select
            aria-label={`Region ${label} size`}
            value={region.half_span}
            onChange={(e) =>
              onChange({ ...region, half_span: +e.target.value })
            }
          >
            <option value=".5">1° × 1° box</option>
            <option value="1">2° × 2° box</option>
            <option value="2.5">5° × 5° box</option>
            <option value="5">10° × 10° box</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}
export function TrendsCalculator({
  onClose,
  onMap,
  onTrendMap,
}: {
  onClose: () => void;
  onMap: (q: ComparisonRequest) => void;
  onTrendMap?: () => void;
}) {
  const current = useEarth((s) => s.location);
  const initial = useEarth.getState();
  const [request, setRequest] = useState<ComparisonRequest>({
    a: {
      name: current.name,
      latitude: current.latitude,
      longitude: current.longitude,
      half_span: 1,
    },
    b: { name: "Nairobi", latitude: -1.2921, longitude: 36.8219, half_span: 1 },
    parameter_a: initial.variable,
    parameter_b: initial.variable,
    start: initial.start,
    end: initial.end,
    lag_months: 3,
  });
  const [data, setData] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<"a_to_b" | "b_to_a">("a_to_b");
  const [changeText, setChangeText] = useState("0");
  const change = changeText.trim() === "" ? NaN : Number(changeText);
  const [chart, setChart] = useState<"trends" | "validation">("trends");
  const dialog = useRef<HTMLDialogElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (data && window.matchMedia("(max-width:650px)").matches)
      resultsRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion:reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
  }, [data]);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      abort.current?.abort();
      dialog.current?.close();
    };
  }, []);
  const valid =
    [request.a, request.b].every(
      (r) =>
        Number.isFinite(r.latitude) &&
        Number.isFinite(r.longitude) &&
        Math.abs(r.latitude) + r.half_span <= 85 &&
        Math.abs(r.longitude) + r.half_span <= 180,
    ) &&
    request.start >= 1981 &&
    request.end < new Date().getFullYear() &&
    request.start <= request.end &&
    request.end - request.start <= 44;
  const changed =
    !!data && comparisonKey(data.request) !== comparisonKey(request);
  const source = data ? (direction === "a_to_b" ? data.a : data.b) : null;
  const target = data ? (direction === "a_to_b" ? data.b : data.a) : null;
  const model = data?.directions[direction];
  const rawImpact = model ? scenario(model, change) : null;
  const sourceVariable = data
    ? direction === "a_to_b"
      ? data.request.parameter_a
      : data.request.parameter_b
    : request.parameter_a;
  const targetVariable = data
    ? direction === "a_to_b"
      ? data.request.parameter_b
      : data.request.parameter_a
    : request.parameter_b;
  const impact =
    targetVariable === "PRECTOTCORR" && rawImpact?.range?.some((v) => v < 0)
      ? null
      : rawImpact;
  const annual = data?.a.annual.map((a, i) => ({
    year: a.year,
    a: a.anomaly,
    b: data.b.annual[i]?.anomaly,
  }));
  const run = async () => {
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    setLoading(true);
    setError("");
    const snapshot = structuredClone(request);
    onMap(snapshot);
    try {
      const result = await calculateRegions(snapshot, c.signal);
      if (!c.signal.aborted) {
        setData(result);
        setChangeText("0");
        setChart("trends");
      }
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : "The calculation failed.");
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  };
  const exportResult = () => {
    if (!data) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...data,
            scenario: { direction, source_change: change, result: impact },
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "regional-climate-comparison.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <dialog
      className="trends-workbench"
      ref={dialog}
      aria-labelledby="trends-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="trends-header">
        <span className="calculator-mark">
          <Calculator size={20} />
        </span>
        <div>
          <span className="trends-eyebrow">EARTH SYSTEM LAB</span>
          <h2 id="trends-title">Regional trends calculator</h2>
          <p>Compare change. Test connections. Explore a climate scenario.</p>
        </div>
        {onTrendMap && (
          <button
            type="button"
            className="trends-map-launch"
            title="Map where the variable is changing, cell by cell"
            onClick={onTrendMap}
          >
            <Grid3x3 size={15} /> Trend map
          </button>
        )}
        <button aria-label="Close regional trends calculator" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      <div className="trends-body">
        <form
          className="trends-settings"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="trends-section-label">
            01 <span>CHOOSE TWO REGIONS</span>
          </div>
          <RegionEditor
            label="A"
            region={request.a}
            parameter={request.parameter_a}
            onChange={(a) => setRequest((q) => ({ ...q, a }))}
            onParameter={(parameter_a) =>
              setRequest((q) => ({ ...q, parameter_a }))
            }
            onCurrent={() =>
              setRequest((q) => ({
                ...q,
                a: {
                  ...q.a,
                  name: current.name,
                  latitude: current.latitude,
                  longitude: current.longitude,
                },
              }))
            }
          />
          <RegionEditor
            label="B"
            region={request.b}
            parameter={request.parameter_b}
            onChange={(b) => setRequest((q) => ({ ...q, b }))}
            onParameter={(parameter_b) =>
              setRequest((q) => ({ ...q, parameter_b }))
            }
            onCurrent={() =>
              setRequest((q) => ({
                ...q,
                b: {
                  ...q.b,
                  name: current.name,
                  latitude: current.latitude,
                  longitude: current.longitude,
                },
              }))
            }
          />
          <div className="trends-period">
            <label>
              From year
              <input
                aria-label="Regional comparison start year"
                type="number"
                min="1981"
                max={new Date().getFullYear() - 1}
                value={request.start}
                onChange={(e) =>
                  setRequest((q) => ({ ...q, start: +e.target.value }))
                }
              />
            </label>
            <label>
              Through year
              <input
                aria-label="Regional comparison end year"
                type="number"
                min="1981"
                max={new Date().getFullYear() - 1}
                value={request.end}
                onChange={(e) =>
                  setRequest((q) => ({ ...q, end: +e.target.value }))
                }
              />
            </label>
            <label>
              Time lag
              <select
                aria-label="Cross-region lag months"
                value={request.lag_months}
                onChange={(e) =>
                  setRequest((q) => ({ ...q, lag_months: +e.target.value }))
                }
              >
                {[1, 2, 3, 6, 9, 12].map((n) => (
                  <option value={n} key={n}>
                    {n} month{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="region-footprint-note">
            <Info size={13} />
            Each box uses up to 9 distinct NASA POWER grid cells, weighted by
            latitude. It is a sampled regional estimate.
          </p>
          {!valid && (
            <p className="trends-error" role="alert">
              Use complete historical years (maximum 45) and boxes within 85°
              latitude that do not cross the date line.
            </p>
          )}
          <button
            className="calculate-regions"
            type="submit"
            disabled={!valid || loading}
          >
            {loading ? <span className="loader" /> : <Play size={14} />}
            <span>
              {loading
                ? "Retrieving & analysing regions…"
                : "Calculate regional trends"}
            </span>
            <ArrowRight size={16} />
          </button>
          {loading && (
            <div className="trends-loading-note" role="status">
              First calculation can take a few minutes. Retrieving up to 18
              verified source records; later calculations reuse them.
            </div>
          )}
          {error && (
            <p className="trends-error" role="alert">
              {error}
              {data ? " The previous calculation remains below." : ""}
            </p>
          )}
        </form>
        <section
          className="trends-results"
          ref={resultsRef}
          aria-label="Regional comparison results"
          aria-busy={loading}
        >
          {!data ? (
            <div className="trends-welcome">
              <div className="connection-illustration">
                <span>A</span>
                <i />
                <ArrowLeftRight size={30} />
                <i />
                <span>B</span>
              </div>
              <span className="trends-eyebrow">
                ONE PLANET · DIFFERENT DIRECTIONS
              </span>
              <h3>How are these regions changing together?</h3>
              <p>
                Calculate their historical trends, then test whether changes in
                one region help predict the other after your chosen lag.
              </p>
              <div>
                <Check size={14} /> Real NASA POWER records
              </div>
              <div>
                <Check size={14} /> Separate warming and rainfall trends
              </div>
              <div>
                <Check size={14} /> Historical prediction tests before scenario
                estimates
              </div>
              <small>
                A statistical connection does not prove that one region causes
                changes in another.
              </small>
            </div>
          ) : (
            <>
              {changed && (
                <div className="trends-notice" role="status">
                  Settings changed. Results below still describe{" "}
                  {data.request.a.name} and {data.request.b.name},{" "}
                  {data.request.start}–{data.request.end}, at a{" "}
                  {data.request.lag_months}-month lag. Calculate again to
                  update.
                </div>
              )}
              <div className="trends-result-heading">
                <div>
                  <span className="trends-section-label">
                    02 <span>HISTORICAL COMPARISON</span>
                  </span>
                  <h3>
                    {data.request.start}–{data.request.end}
                  </h3>
                </div>
                <button onClick={exportResult}>
                  <Download size={14} /> Export JSON
                </button>
              </div>
              <div className="regional-trend-cards">
                {(["a", "b"] as const).map((key) => {
                  const r = data[key],
                    t = r.trend;
                  return (
                    <article
                      key={key}
                      className={`regional-trend-card region-card-${key}`}
                    >
                      <span className={`region-letter region-${key}`}>
                        {key.toUpperCase()}
                      </span>
                      <h4>{r.region.name}</h4>
                      <p>{variables[r.parameter as Variable].name}</p>
                      <strong>
                        {t ? signed(t.slope) : "—"}
                        <small>{r.unit}/decade</small>
                      </strong>
                      <span
                        className={`trend-evidence ${t?.significant ? "has-evidence" : ""}`}
                      >
                        {t?.significant === true
                          ? "Significant annual trend"
                          : t?.significant === false
                            ? "No significant trend established"
                            : "Significance withheld"}
                      </span>
                      <small>
                        {r.samples.length} grid samples ·{" "}
                        {r.coverage.toFixed(1)}% daily coverage
                        {t
                          ? ` · p = ${t.p_value < 0.001 ? "<0.001" : t.p_value.toFixed(3)}`
                          : ""}
                      </small>
                      {t && (
                        <small>
                          95% slope interval {signed(t.low, Math.max(decimalsFor(t.low), decimalsFor(t.high)))} to{" "}
                          {signed(t.high, Math.max(decimalsFor(t.low), decimalsFor(t.high)))}
                        </small>
                      )}
                    </article>
                  );
                })}
              </div>
              {data.contrast.slope_b_minus_a !== null && (
                <p className="trend-contrast">
                  {data.contrast.opposite_directions
                    ? "Opposing trend directions. "
                    : "Same variable compared. "}
                  B − A slope difference:{" "}
                  <b>
                    {signed(data.contrast.slope_b_minus_a)} {data.a.unit}/decade
                  </b>
                  . Descriptive difference; not a regional significance test.
                </p>
              )}
              <div className="regional-chart-heading">
                <h4>
                  {chart === "trends"
                    ? "Annual departures from each region’s mean"
                    : "Out-of-sample predictions"}
                </h4>
                <div>
                  <button
                    className={chart === "trends" ? "active" : ""}
                    onClick={() => setChart("trends")}
                  >
                    Trends
                  </button>
                  <button
                    className={chart === "validation" ? "active" : ""}
                    onClick={() => setChart("validation")}
                  >
                    Validation
                  </button>
                </div>
              </div>
              <div className="regional-chart">
                {chart === "trends" ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={annual}
                      margin={{ left: 0, right: 0, top: 12, bottom: 0 }}
                    >
                      <CartesianGrid
                        stroke="#27404a"
                        strokeDasharray="3 5"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="year"
                        tick={{ fill: "#829ca8", fontSize: 10 }}
                        minTickGap={35}
                      />
                      <YAxis
                        yAxisId="a"
                        tick={{ fill: "#89d5c4", fontSize: 10 }}
                        width={42}
                      />
                      {data.request.parameter_a !==
                        data.request.parameter_b && (
                        <YAxis
                          yAxisId="b"
                          orientation="right"
                          tick={{ fill: "#b4a1df", fontSize: 10 }}
                          width={42}
                        />
                      )}
                      <Tooltip
                        contentStyle={{
                          background: "#10232c",
                          border: "1px solid #34535b",
                          borderRadius: 8,
                          fontSize: 11,
                        }}
                        formatter={(v, n) => [Number(v).toFixed(2), n]}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line
                        yAxisId="a"
                        type="linear"
                        dataKey="a"
                        name={`A · ${data.a.unit}`}
                        stroke="#8ad8c4"
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId={
                          data.request.parameter_a === data.request.parameter_b
                            ? "a"
                            : "b"
                        }
                        type="linear"
                        dataKey="b"
                        name={`B · ${data.b.unit}`}
                        stroke="#b9a2ea"
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : model && model.validation.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={model.validation}
                      margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
                    >
                      <CartesianGrid
                        stroke="#27404a"
                        strokeDasharray="3 5"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "#829ca8", fontSize: 9 }}
                        minTickGap={50}
                      />
                      <YAxis
                        domain={["auto", "auto"]}
                        tick={{ fill: "#829ca8", fontSize: 10 }}
                        width={45}
                      />
                      <Tooltip
                        formatter={(value, name) => [
                          `${Number(value).toFixed(2)} ${monthlyUnit(targetVariable)}`,
                          name,
                        ]}
                        contentStyle={{
                          background: "#10232c",
                          border: "1px solid #34535b",
                          fontSize: 11,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line
                        dataKey="actual"
                        name="Actual target"
                        stroke="#a6c8cd"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="prediction"
                        name="With source"
                        stroke="#8ad8c4"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="baseline"
                        name="Target-only baseline"
                        stroke="#b9a2ea"
                        strokeDasharray="4 4"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="trends-empty">
                    Not enough usable history for out-of-sample validation.
                  </p>
                )}
              </div>
              <p className="regional-chart-note">
                {chart === "trends"
                  ? data.request.parameter_a === data.request.parameter_b
                    ? "Both curves use the same unit and axis. Departures use each region’s study-period mean."
                    : "Separate axes use each region’s stated unit; line heights alone do not compare magnitudes. Departures use each study-period mean."
                  : `Target unit: ${monthlyUnit(targetVariable)}. Each yearly test fold is predicted using only earlier training outcomes, with the time lag purged at the boundary.`}
              </p>
              <section className="regional-scenario">
                <div className="trends-section-label">
                  03 <span>CROSS-REGION RESPONSE</span>
                </div>
                <div className="scenario-direction">
                  <button
                    aria-pressed={direction === "a_to_b"}
                    onClick={() => {
                      setDirection("a_to_b");
                      setChangeText("0");
                    }}
                  >
                    A → B
                  </button>
                  <button
                    aria-pressed={direction === "b_to_a"}
                    onClick={() => {
                      setDirection("b_to_a");
                      setChangeText("0");
                    }}
                  >
                    B → A
                  </button>
                  <span>
                    {source?.region.name} <ArrowRight size={12} />{" "}
                    {target?.region.name}
                  </span>
                </div>
                <div
                  className={`scenario-verdict ${model?.status === "supported" ? "is-supported" : ""}`}
                >
                  <Info size={16} />
                  <div>
                    <strong>
                      {model?.status === "supported"
                        ? "Exploratory predictive response"
                        : "Response estimate withheld"}
                    </strong>
                    <p>{model?.reason}</p>
                  </div>
                </div>
                {model?.rmse !== null && model?.rmse !== undefined && (
                  <div className="validation-metrics">
                    <div>
                      <span>Prediction RMSE</span>
                      <b>
                        {model.rmse.toFixed(2)}{" "}
                        <small>{monthlyUnit(targetVariable)}</small>
                      </b>
                    </div>
                    <div>
                      <span>Target-only RMSE</span>
                      <b>{model.baseline_rmse?.toFixed(2)}</b>
                    </div>
                    <div>
                      <span>Added-source skill</span>
                      <b>
                        {model.skill === null
                          ? "—"
                          : signed(model.skill * 100, 1) + "%"}
                      </b>
                    </div>
                    <div>
                      <span>Tested months</span>
                      <b>{model.validation_months}</b>
                    </div>
                  </div>
                )}
                {model?.status === "supported" && (
                  <>
                    <label className="scenario-change">
                      If {source?.region.name} changes by
                      <input
                        aria-label="Source region scenario change"
                        type="number"
                        step={sourceVariable === "PRECTOTCORR" ? 1 : 0.1}
                        min={model.supported_change?.[0]}
                        max={model.supported_change?.[1]}
                        value={changeText}
                        onChange={(e) => setChangeText(e.target.value)}
                      />
                      <span>{monthlyUnit(sourceVariable)}</span>
                    </label>
                    <p className="regional-chart-note">
                      Within-history range:{" "}
                      {model.supported_change
                        ?.map((v) => signed(v))
                        .join(" to ")}{" "}
                      {monthlyUnit(sourceVariable)}. Target’s starting
                      conditions, season and time are held fixed.
                    </p>
                    {impact ? (
                      <div className="scenario-output">
                        <span>
                          Associated target change after{" "}
                          {data.request.lag_months} months
                        </span>
                        <strong>
                          {signed(impact.response)}{" "}
                          <small>{monthlyUnit(targetVariable)}</small>
                        </strong>
                        <p>
                          Exploratory 95% response interval:{" "}
                          {signed(impact.interval[0])} to{" "}
                          {signed(impact.interval[1])}{" "}
                          {monthlyUnit(targetVariable)}
                        </p>
                        {model.scenario_reference && (
                          <p>
                            Historical scenario for{" "}
                            {model.scenario_reference.target_date}, anchored at{" "}
                            {model.scenario_reference.origin}:{" "}
                            {impact.prediction?.toFixed(2)}{" "}
                            {monthlyUnit(targetVariable)}. Approximate outcome
                            range{" "}
                            {impact.range
                              ?.map((v) => v.toFixed(2))
                              .join(" to ")}
                            . This is not a current forecast.
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="trends-error">
                        The input or predicted range exceeds the supported
                        history or physical bounds. response estimates are
                        withheld.
                      </p>
                    )}
                  </>
                )}
                <p className="scenario-limit">
                  Predictive association does not prove climatic influence,
                  physical transport or causality. This calculator does not
                  estimate damage, crop yields or health impacts.
                </p>
              </section>
              <details className="regional-methods">
                <summary>Methods, sources & limitations</summary>
                <p>{data.a.sampling}</p>
                <p>{data.a.missing_policy}</p>
                <p>{model?.method}</p>
                <p>{model?.limitation}</p>
                <p>
                  Response uncertainty: 499 fixed-design circular residual-block
                  resamples, at least 12 months per block; exploratory
                  stationary-residual assumption. No automatic lag selection.
                </p>
                {data.limitations.map((v) => (
                  <p key={v}>{v}</p>
                ))}
                {(["a", "b"] as const).map((key) => (
                  <div key={key}>
                    <h4>
                      {key.toUpperCase()} · {data[key].region.name} · source
                      records
                    </h4>
                    {data[key].provenance.map((p) => (
                      <a
                        key={`${p.latitude},${p.longitude}`}
                        href={p.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {p.latitude}°, {p.longitude}° · retrieved{" "}
                        {new Date(p.retrieved_at).toLocaleDateString("en-GB")}{" "}
                        <ExternalLink size={10} />
                      </a>
                    ))}
                  </div>
                ))}
                <a
                  href="https://power.larc.nasa.gov/docs/tutorials/service-data-request/api/"
                  target="_blank"
                  rel="noreferrer"
                >
                  NASA grid guidance <ExternalLink size={10} />
                </a>
                <a
                  href="https://otexts.com/fpp3/tscv.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  Time-series validation reference <ExternalLink size={10} />
                </a>
                <small>
                  Calculated{" "}
                  {new Date(data.checked_at).toLocaleString("en-GB", {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </small>
              </details>
            </>
          )}
        </section>
      </div>
    </dialog>
  );
}
