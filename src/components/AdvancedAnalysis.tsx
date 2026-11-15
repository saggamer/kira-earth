import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";
import { ChevronDown, FlaskConical, Info } from "lucide-react";
import { variables, type Analysis, type Variable } from "../lib/store";
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const metrics = {
  hot_days: { name: "Hot days · Tmax ≥35°C", unit: "days" },
  tropical_nights: { name: "Tropical nights · Tmin >20°C", unit: "nights" },
  frost_nights: { name: "Frost nights · Tmin <0°C", unit: "nights" },
  longest_hot_spell: { name: "Longest hot spell", unit: "days" },
  wet_days: { name: "Wet days · ≥1 mm", unit: "days" },
  heavy_rain_days: { name: "Heavy rain days · ≥10 mm", unit: "days" },
  very_heavy_rain_days: { name: "Very heavy rain days · ≥20 mm", unit: "days" },
  rx1day: { name: "Maximum 1-day rainfall", unit: "mm" },
  rx5day: { name: "Maximum 5-day rainfall", unit: "mm" },
  longest_dry_spell: { name: "Longest dry spell", unit: "days" },
  longest_wet_spell: { name: "Longest wet spell", unit: "days" },
  wet_day_intensity: { name: "Mean wet-day intensity", unit: "mm/day" },
  diurnal_range: { name: "Mean diurnal temperature range", unit: "°C" },
};
type Metric = keyof typeof metrics;
const format = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : n.toFixed(d);
export function AdvancedAnalysis({ data }: { data: Analysis }) {
  const [tab, setTab] = useState<
    "seasonal" | "extremes" | "compare" | "quality"
  >("seasonal");
  const [metric, setMetric] = useState<Metric>(
    data.parameter === "PRECTOTCORR" ? "rx5day" : "hot_days",
  );
  const a = data.analysis;
  if (!a) return null;
  const rain = data.parameter === "PRECTOTCORR";
  const digits = variables[data.parameter as Variable].digits;
  const tooltip = {
    background: "#102330",
    border: "1px solid #355665",
    fontSize: 10,
    borderRadius: 6,
  };
  const seasonal = a.seasonal_cycle.map((s) => ({
    ...s,
    name: months[s.month - 1],
  }));
  const p = a.period_comparison;
  return (
    <details className="advanced-analysis">
      <summary>
        <FlaskConical size={14} />
        <span>Full weather analysis</span>
        <ChevronDown size={14} />
      </summary>
      <div
        className="analysis-tabs"
        role="tablist"
        aria-label="Detailed analysis"
      >
        <button
          role="tab"
          aria-selected={tab === "seasonal"}
          onClick={() => setTab("seasonal")}
        >
          Seasons
        </button>
        <button
          role="tab"
          aria-selected={tab === "extremes"}
          onClick={() => setTab("extremes")}
        >
          Extremes
        </button>
        <button
          role="tab"
          aria-selected={tab === "compare"}
          onClick={() => setTab("compare")}
        >
          Compare
        </button>
        <button
          role="tab"
          aria-selected={tab === "quality"}
          onClick={() => setTab("quality")}
        >
          Quality
        </button>
      </div>
      {tab === "seasonal" && (
        <div className="advanced-content">
          <h3>The seasonal rhythm</h3>
          <p>
            {rain ? "Monthly accumulated rainfall" : "Monthly mean temperature"}{" "}
            · study-period calendar-month means.
          </p>
          <div className="diagnostic-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={seasonal}
                margin={{ left: -25, right: 0, top: 8, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="#28404d"
                  vertical={false}
                  strokeDasharray="2 4"
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 8, fill: "#7796a9" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 8, fill: "#7796a9" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={tooltip}
                  formatter={(value) => [
                    format(Number(value), digits) + " " + variables[data.parameter as Variable].monthly,
                    "Monthly mean",
                  ]}
                />
                <Bar
                  dataKey="mean"
                  fill={rain ? "#79b8ca" : "#d5ba88"}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="diagnostic-note">
            Baseline: {a.definitions.seasonal_baseline}. Missing months stay
            missing.
          </p>
          {a.correlation && (
            <div className="diagnostic-finding">
              <span>Temperature–rainfall association</span>
              <strong>r = {a.correlation.pearson_r.toFixed(2)}</strong>
              <p>
                {a.correlation.paired_months} paired months, with the
                calendar-month means removed. Association does not establish
                cause.
              </p>
            </div>
          )}
        </div>
      )}
      {tab === "extremes" && (
        <div className="advanced-content">
          <h3>Extremes & persistence</h3>
          <label className="diagnostic-select">
            <select
              aria-label="Extreme weather metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
            >
              {Object.entries(metrics).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.name}
                </option>
              ))}
            </select>
            <ChevronDown size={11} />
          </label>
          <div className="diagnostic-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={a.extremes}
                margin={{ left: -25, right: 0, top: 8, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="#28404d"
                  vertical={false}
                  strokeDasharray="2 4"
                />
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 8, fill: "#7796a9" }}
                  minTickGap={35}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 8, fill: "#7796a9" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={tooltip}
                  formatter={(value) => [
                    format(Number(value), 1) + " " + metrics[metric].unit,
                    metrics[metric].name,
                  ]}
                />
                <Area
                  type="linear"
                  dataKey={metric}
                  stroke="#94b9cf"
                  fill="#70b2c32b"
                  strokeWidth={1.5}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="diagnostic-note">
            Only complete calendar years contribute to counts and spells.
            Thresholds are descriptive, not local impact warnings.{" "}
            {metric === "rx5day"
              ? "Five-day accumulation is not rainfall rate."
              : ""}
          </p>
        </div>
      )}
      {tab === "compare" && (
        <div className="advanced-content">
          <h3>Earlier vs later</h3>
          {p ? (
            <>
              <div className="period-cards">
                {[p.early, p.late].map((period, i) => (
                  <div key={i}>
                    <span>
                      {period.start}–{period.end}
                    </span>
                    <strong>{format(period.mean, digits)}</strong>
                    <small>
                      {data.unit} · {period.years} years
                    </small>
                  </div>
                ))}
              </div>
              <div className="diagnostic-finding">
                <span>Difference in annual means</span>
                <strong>
                  {p.difference > 0 ? "+" : ""}
                  {format(p.difference, digits)} {data.unit}
                  {p.percent != null ? (
                    <small> ({format(p.percent, 1)}%)</small>
                  ) : null}
                </strong>
                {p.interval && (
                  <p>
                    Approximate 95% block-bootstrap interval:{" "}
                    {format(p.interval[0], digits)} to {format(p.interval[1], digits)}{" "}
                    {data.unit}.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p>
              Not enough usable years in both halves of the selected record.
            </p>
          )}
          {a.robust_trend ? (
            <div className="diagnostic-finding">
              <span>Dependence-aware slope interval</span>
              <strong>
                {format(a.robust_trend.low, digits)} to {format(a.robust_trend.high, digits)}
              </strong>
              <small>{data.unit} per decade · 95% interval</small>
              <p>
                {a.robust_trend.iterations} residual bootstrap samples in{" "}
                {a.robust_trend.block_years}-year blocks.{" "}
                {a.robust_trend.limitation}
              </p>
            </div>
          ) : (
            <p className="diagnostic-note">
              A block-bootstrap slope interval needs at least 10 consecutive
              usable annual values.
            </p>
          )}
        </div>
      )}
      {tab === "quality" && (
        <div className="advanced-content">
          <h3>What the record can support</h3>
          <div className="quality-grid">
            <div>
              <span>Missing days</span>
              <strong>{a.quality.missing_days.toLocaleString()}</strong>
            </div>
            <div>
              <span>Longest missing run</span>
              <strong>{a.quality.longest_missing_run} days</strong>
            </div>
            <div>
              <span>Usable years</span>
              <strong>{a.quality.usable_years}</strong>
            </div>
            <div>
              <span>Excluded years</span>
              <strong>{a.quality.excluded_years.length}</strong>
            </div>
          </div>
          {a.quality.excluded_years.length > 0 && (
            <p>Excluded: {a.quality.excluded_years.join(", ")}.</p>
          )}
          {a.summary && (
            <div className="daily-summary">
              <span>Daily distribution · {a.summary.unit}</span>
              <dl>
                <div>
                  <dt>Mean / median</dt>
                  <dd>
                    {format(a.summary.mean, digits)} / {format(a.summary.median, digits)}
                  </dd>
                </div>
                <div>
                  <dt>5th / 95th percentile</dt>
                  <dd>
                    {format(a.summary.p05, digits)} / {format(a.summary.p95, digits)}
                  </dd>
                </div>
                <div>
                  <dt>Minimum</dt>
                  <dd>
                    {format(a.summary.minimum, digits)} · {a.summary.minimum_date}
                  </dd>
                </div>
                <div>
                  <dt>Maximum</dt>
                  <dd>
                    {format(a.summary.maximum, digits)} · {a.summary.maximum_date}
                  </dd>
                </div>
              </dl>
            </div>
          )}
          <p className="diagnostic-note">
            <Info size={11} />
            Missing values are never filled. Standardized monthly departures use
            the study-period seasonal cycle; they are not a drought-index model.
          </p>
        </div>
      )}
    </details>
  );
}
