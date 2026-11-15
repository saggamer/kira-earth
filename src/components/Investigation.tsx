import { useState } from "react";
import {
  MapPin,
  ArrowUpRight,
  ArrowDownRight,
  Info,
  FileText,
  RefreshCw,
  Activity,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { useEarth, variables, type Analysis } from "../lib/store";
import { Button } from "./ui/button";
import { interpretation } from "../lib/science";
import { AdvancedAnalysis } from "./AdvancedAnalysis";

export function Investigation({
  data,
  loading,
  error,
  retry,
  onReport,
  onSources,
}: {
  data: Analysis | null;
  loading: boolean;
  error: string;
  retry: () => void;
  onReport: () => void;
  onSources: () => void;
}) {
  const { location, variable, start, end } = useEarth();
  const [chart, setChart] = useState<"value" | "anomaly">("value");
  const t = data?.trend;
  const v = variables[variable];
  return (
    <aside className="investigation">
      <div className="panel-top">
        <span className="eyebrow">LOCATION INVESTIGATION</span>
        <span className="tiny-dot" />
      </div>
      <div className="location-title">
        <div className="location-icon">
          <MapPin size={20} />
        </div>
        <div>
          <h2>{location.name}</h2>
          <p>{location.country}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          title="Refresh investigation"
          aria-label="Refresh investigation"
          onClick={retry}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </Button>
      </div>
      <div className="location-coords">
        {Math.abs(location.latitude).toFixed(4)}°{" "}
        {location.latitude >= 0 ? "N" : "S"} <span>/</span>{" "}
        {Math.abs(location.longitude).toFixed(4)}°{" "}
        {location.longitude >= 0 ? "E" : "W"}
      </div>
      <div className="source-badge">
        <span className="dot" />
        NASA POWER<span className="source-type">Historical estimates</span>
      </div>
      <div className={`data-health ${error ? "is-stale" : ""}`} role="status">
        <span className="health-dot" />
        <div>
          <strong>
            {loading
              ? data
                ? "Updating · verified record stays visible"
                : "Retrieving NASA records…"
              : error
                ? data
                  ? "Saved record · refresh unavailable"
                  : "Connection unavailable"
                : data
                  ? "Record validated"
                  : "Waiting for data"}
          </strong>
          <small>
            {data
              ? `Retrieved ${new Date(data.retrieved_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`
              : "Coordinates, dates, units & coverage are checked"}
          </small>
          {data && (
            <small>
              Record checked{" "}
              {new Date(data.checked_at).toLocaleString("en-GB", {
                timeZone: "UTC",
              })}{" "}
              UTC · source cache up to 30 days
            </small>
          )}
        </div>
      </div>
      <>
        <div className="section-title">
          <h3>{v.name}</h3>
          <span>
            {start} — {end}
          </span>
        </div>
        <div className="stat-hero">
          <span>LONG-TERM TREND</span>
          <div>
            {loading && !data ? (
              <span className="skeleton big-skeleton" />
            ) : t ? (
              <>
                <strong>
                  {t.slope > 0 ? "+" : ""}
                  {t.slope.toFixed(v.digits)}
                </strong>
                <span className="trend-unit">
                  {data?.unit}
                  <small>per decade</small>
                </span>
                {t.slope >= 0 ? (
                  <ArrowUpRight className="trend-arrow" size={31} />
                ) : (
                  <ArrowDownRight className="trend-arrow" size={31} />
                )}
              </>
            ) : (
              <strong className="no-data">—</strong>
            )}
          </div>
          <p>
            {loading && !data
              ? "Retrieving NASA historical estimates…"
              : t
                ? `Sen’s slope · ${t.years} usable annual values`
                : "Calculated from complete historical records"}
          </p>
        </div>
        {error && (
          <div className="data-error">
            <AlertCircle size={17} />
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={retry}>
              Retry request
            </Button>
          </div>
        )}
        {(!error || data) && (
          <>
            <div className="metrics">
              <div>
                <span>
                  Fitted change <Info size={11} />
                </span>
                <strong>
                  {t
                    ? `${t.total_change > 0 ? "+" : ""}${t.total_change.toFixed(v.digits)} ${data?.unit}`
                    : "—"}
                </strong>
              </div>
              <div>
                <span>Data coverage</span>
                <strong>
                  {data ? `${data.coverage.toFixed(1)}%` : "—"}
                  {data && data.coverage >= 90 && <CheckCircle2 size={13} />}
                </strong>
              </div>
            </div>
            <div
              className={`significance ${t?.significant === true ? "significant" : ""}`}
            >
              <span className="significance-icon">
                {t?.significant === true ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <Info size={16} />
                )}
              </span>
              <div>
                <strong>
                  {loading && !data
                    ? "Testing the evidence…"
                    : t?.significant === true
                      ? "Statistically significant"
                      : t?.significant === false
                        ? "No significant trend established"
                        : t
                          ? "Significance withheld"
                          : "Awaiting measurements"}
                </strong>
                <small>
                  {t
                    ? `p = ${t.p_value < 0.001 ? "< 0.001" : t.p_value.toFixed(3)} · α = 0.05${t.significant === null ? " · unadjusted test" : ""}`
                    : "Annual series · two-sided trend test"}
                </small>
              </div>
            </div>
            <div className="chart-heading">
              <h3>Historical record</h3>
              <div className="mini-tabs">
                <button
                  className={chart === "value" ? "active" : ""}
                  onClick={() => setChart("value")}
                >
                  Annual
                </button>
                <button
                  className={chart === "anomaly" ? "active" : ""}
                  onClick={() => setChart("anomaly")}
                >
                  Anomaly
                </button>
              </div>
            </div>
            <div className="history-chart">
              {data ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.annual}
                    margin={{ top: 12, right: 5, left: -22, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="chartFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#eeb874"
                          stopOpacity={0.24}
                        />
                        <stop
                          offset="100%"
                          stopColor="#eeb874"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="#26313c"
                      vertical={false}
                      strokeDasharray="2 4"
                    />
                    <XAxis
                      dataKey="year"
                      tick={{ fill: "#7e8b9a", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={35}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fill: "#7e8b9a", fontSize: 10 }}
                      tickFormatter={(n) => Number(n).toFixed(Math.max(1, v.digits - 1))}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#121c27",
                        border: "1px solid #344151",
                        borderRadius: 7,
                        fontSize: 12,
                      }}
                      formatter={(value) => [
                        `${Number(value).toFixed(v.digits)} ${data.unit}`,
                        chart === "value"
                          ? "Annual value"
                          : "Study-period anomaly",
                      ]}
                    />
                    {chart === "anomaly" && (
                      <ReferenceLine y={0} stroke="#7e8b9a" />
                    )}
                    <Area
                      type="linear"
                      dataKey={chart === "value" ? "value" : "anomaly"}
                      stroke="#eeb874"
                      strokeWidth={2}
                      fill="url(#chartFill)"
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="chart-await">
                  <Activity size={23} className={loading ? "pulse" : ""} />
                  <span>
                    {loading && !data
                      ? "Building the historical record"
                      : "No measurements loaded"}
                  </span>
                </div>
              )}
            </div>
            <div className="chart-note">
              <span className="legend-line" />
              {chart === "value"
                ? v.series
                : "Anomaly from study-period mean"}
              <span>{data?.unit || v.unit}</span>
            </div>
            {t && (
              <div className="confidence">
                <span>95% slope interval</span>
                <strong>
                  {t.low.toFixed(v.digits)} to {t.high.toFixed(v.digits)}{" "}
                  <small>{data?.unit}/decade</small>
                </strong>
              </div>
            )}
            <div className="interpretation">
              <div>
                <Activity size={14} />
                <h3>What the evidence says</h3>
              </div>
              <p>
                {data
                  ? interpretation(data)
                  : "Choose any point on Earth to investigate its environmental history. All statistics are calculated from retrieved source data."}
              </p>
            </div>
            {data?.warnings.map((w) => (
              <p className="science-warning" key={w}>
                <Info size={12} />
                {w}
              </p>
            ))}
          </>
        )}
        {data && <AdvancedAnalysis data={data} />}
        <Button
          className="report-button"
          variant="outline"
          disabled={!data}
          onClick={onReport}
        >
          <FileText size={15} />
          Generate Investigation Report
          <ArrowUpRight size={15} />
        </Button>
        <button className="inspect-sources" onClick={onSources}>
          Inspect sources & calculation methods
          <ExternalLink size={11} />
        </button>
      </>
      <div className="investigation-footer">
        <span className="foot-orbit">◉</span>
        <p>
          Follow the evidence.
          <br />
          <strong>Understand the change.</strong>
        </p>
        <ChevronDown size={13} />
      </div>
    </aside>
  );
}
