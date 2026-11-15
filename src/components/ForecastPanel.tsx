import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Flame,
  KeyRound,
  Navigation,
  RefreshCw,
  Sparkles,
  Sun,
  Wind,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEarth } from "../lib/store";
import { formatCoordinates } from "../lib/coordinates";
import {
  compareProviders,
  compass,
  EVENT_LABEL,
  getBrief,
  getForecast,
  getProviders,
  localTime,
  weekday,
  type Brief,
  type Category,
  type Comparison,
  type Forecast,
  type ProviderInfo,
} from "../lib/forecast";

const ICONS: Record<Exclude<Category, null>, typeof Sun> = {
  clear: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};
function Icon({ c, size = 16 }: { c: Category; size?: number }) {
  const I = c ? ICONS[c] : CloudSunRain;
  return <I size={size} aria-hidden />;
}
const r1 = (n: number | null | undefined, d = 0) => {
  if (n == null) return "—";
  const t = n.toFixed(d);
  return /^-0(\.0+)?$/.test(t) ? t.slice(1) : t; // never show "-0"
};
const pct = (p: number) => `${Math.round(p * 100)}%`;

export function ForecastPanel({
  onClose,
  onKeys,
  keysVersion = 0,
}: {
  onClose: () => void;
  onKeys: () => void;
  /** Bumped when keys change so the provider list and hazard sections refresh. */
  keysVersion?: number;
}) {
  const { location, selectionVersion } = useEarth();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  // Default: Google DeepMind WeatherNext 2, the strongest free model available (64-member AI ensemble).
  const [provider, setProvider] = useState("weathernext2");
  const [fellBack, setFellBack] = useState(false);
  const [data, setData] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefState, setBriefState] = useState<"idle" | "busy" | "error">("idle");
  const [briefError, setBriefError] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    getProviders().then(setProviders).catch(() => setProviders([]));
  }, [keysVersion]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setBrief(null);
    setBriefState("idle");
    setComparison(null);
    getForecast(
      { latitude: location.latitude, longitude: location.longitude, provider, refresh: reload > 0 },
      ac.signal,
    )
      .then((d) => setData(d))
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (provider === "weathernext2") {
          // The AI feed can lag while a new run arrives: fall back to the physics blend rather than show nothing.
          setFellBack(true);
          setProvider("open-meteo");
          return;
        }
        setData(null);
        setError(e.message);
      })
      .finally(() => !ac.signal.aborted && setLoading(false));
    return () => ac.abort();
  }, [location.latitude, location.longitude, selectionVersion, provider, reload, keysVersion]);

  const f = data?.forecast;
  const off = f?.utc_offset_seconds ?? 0;
  const hours = useMemo(
    () =>
      (f?.hourly ?? []).slice(0, 48).map((h) => ({
        ...h,
        label: localTime(h.time, off),
        pp: h.precip_probability,
      })),
    [f, off],
  );
  const ctxByDate = useMemo(
    () => new Map((data?.climate_context?.days ?? []).map((d) => [d.date, d])),
    [data],
  );
  const probByDate = useMemo(
    () => new Map((data?.climate_context?.probabilities ?? []).map((d) => [d.date, d])),
    [data],
  );
  const ensByDate = useMemo(
    () => new Map((data?.ensemble?.days ?? []).map((d) => [d.date, d])),
    [data],
  );
  const scale = useMemo(() => {
    const vals: number[] = [];
    for (const d of f?.daily ?? []) {
      if (d.t_min != null) vals.push(d.t_min);
      if (d.t_max != null) vals.push(d.t_max);
      const e = ensByDate.get(d.date);
      if (e) vals.push(e.t_max[2], e.t_min[0]);
      const c = ctxByDate.get(d.date);
      if (c) vals.push(c.hot_threshold);
    }
    if (!vals.length) vals.push(0, 1);
    const lo = Math.floor(Math.min(...vals) - 1),
      hi = Math.ceil(Math.max(...vals) + 1);
    return { lo, hi, x: (v: number) => ((v - lo) / (hi - lo)) * 100 };
  }, [f, ensByDate, ctxByDate]);

  const runBrief = () => {
    setBriefState("busy");
    getBrief({ latitude: location.latitude, longitude: location.longitude, name: location.name, provider })
      .then((b) => {
        setBrief(b);
        setBriefState("idle");
      })
      .catch((e) => {
        setBriefError(e.message);
        setBriefState("error");
      });
  };
  const runCompare = () => {
    setComparing(true);
    compareProviders(location.latitude, location.longitude)
      .then(setComparison)
      .catch(() => setComparison(null))
      .finally(() => setComparing(false));
  };
  const ready = providers.filter((p) => p.configured);
  const ctx = data?.climate_context;
  const es = ctx?.ensemble_summary;

  return (
    <section className="ai-panel fc-panel glass-panel" aria-label="Weather forecast">
      <header className="ai-header">
        <span className="ai-mark fc-mark">
          <CloudSun size={20} />
        </span>
        <div>
          <span className="trends-eyebrow">FORECAST · PREDICTION</span>
          <h2>{location.name}</h2>
          <p>
            {formatCoordinates(location.latitude, location.longitude)}
            {f?.timezone ? ` · ${f.timezone}` : ""}
          </p>
        </div>
        <button aria-label="Close forecast" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="fc-toolbar">
        <label>
          Provider
          <select
            aria-label="Forecast provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {(providers.length ? providers : [{ id: "open-meteo", label: "Open-Meteo (best-match models)", configured: true, needs_key: false, docs: "" }]).map((p) => (
              <option key={p.id} value={p.id} disabled={!p.configured}>
                {p.label}
                {p.configured ? "" : " · add key"}
              </option>
            ))}
          </select>
        </label>
        <button className="fc-tool" onClick={onKeys} title="Add or manage API keys">
          <KeyRound size={14} /> Keys
        </button>
        <button
          className="fc-tool"
          aria-label="Refresh forecast"
          title="Fetch a fresh forecast"
          onClick={() => setReload((n) => n + 1)}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>

      <div className="ai-body fc-body">
        {loading && !data && (
          <div className="fc-loading" role="status">
            <span className="loader" /> Fetching {providers.find((p) => p.id === provider)?.label ?? "forecast"},{" "}
            {provider === "weathernext2" ? "its 64 AI ensemble members" : "the 51-member ECMWF ensemble"} and this place's 1991–2020 climate…
          </div>
        )}
        {error && (
          <div className="ai-error" role="alert">
            <AlertTriangle size={16} />
            <div>
              <b>Forecast unavailable</b>
              <p>{error}</p>
              <button onClick={() => setReload((n) => n + 1)}>Retry</button>
            </div>
          </div>
        )}

        {data && f && (
          <>
            {f.provider === "weathernext2" ? (
              <div className="fc-model-card">
                <span className="fc-ai-chip">AI MODEL</span>
                <div>
                  <b>Google DeepMind WeatherNext 2</b>
                  <small>
                    {f.members ?? 64}-member AI ensemble · free via Open-Meteo · shown as the member median, with probabilities from
                    the share of members
                  </small>
                </div>
              </div>
            ) : (
              fellBack && (
                <p className="fc-muted fc-fallback">
                  WeatherNext 2 is unavailable right now, so this shows the Open-Meteo best-match physics blend instead.
                </p>
              )
            )}
            {data.alerts.length > 0 && (
              <div className="fc-alerts" role="alert">
                {data.alerts.map((a, i) => (
                  <details key={i}>
                    <summary>
                      <AlertTriangle size={14} />
                      <b>{a.event ?? "Weather alert"}</b>
                      {a.severity && <span>{a.severity}</span>}
                    </summary>
                    <p>{a.headline}</p>
                    <p className="fc-muted">{a.description}</p>
                    <small>
                      {a.source}
                      {a.url && (
                        <>
                          {" · "}
                          <a href={a.url} target="_blank" rel="noreferrer">
                            official notice
                          </a>
                        </>
                      )}
                    </small>
                  </details>
                ))}
              </div>
            )}

            {ctx && (ctx.events.length > 0 || es) && (
              <div className={`fc-events ${ctx.events.length ? "has-events" : ""}`}>
                <span className="fc-section-kicker">WHAT'S UNUSUAL FOR THIS PLACE</span>
                {ctx.events.length === 0 && (
                  <p>No heat, cold or heavy-rain events against this place's 1991–2020 climate in the forecast.</p>
                )}
                {ctx.events.map((e, i) => (
                  <div className={`fc-event ${e.type}`} key={i}>
                    <b>{EVENT_LABEL[e.type]}</b>
                    <span>
                      {weekday(e.start)} {e.start.slice(5)}
                      {e.days > 1 ? ` → ${weekday(e.end)} ${e.end.slice(5)} · ${e.days} days` : ""}
                    </span>
                    <small>
                      {e.type.includes("rain")
                        ? `${r1(e.peak, 1)} mm vs local threshold ${r1(e.threshold, 1)} mm`
                        : `${e.type.startsWith("cold") ? "low" : "peak"} ${r1(e.peak, 1)} °C vs threshold ${r1(e.threshold, 1)} °C`}
                    </small>
                  </div>
                ))}
                {es && (
                  <p className="fc-prob">
                    Ensemble ({data.ensemble?.members} runs, next {es.days} days): <b>{pct(es.p_heatwave)}</b> chance of a{" "}
                    {es.hot_label}, <b>{pct(es.p_cold_wave)}</b> chance of a {es.cold_label}.
                  </p>
                )}
              </div>
            )}

            {f.current && (
              <div className="fc-now">
                <div className="fc-now-main">
                  <Icon c={f.current.category} size={34} />
                  <strong>{r1(f.current.temperature)}°</strong>
                  <div>
                    <span>{f.current.description}</span>
                    <small>
                      {f.current.feels_like != null ? `Feels ${r1(f.current.feels_like)}° · ` : ""}
                      {localTime(f.current.time, off)} local
                    </small>
                  </div>
                </div>
                <dl className="fc-stats">
                  {f.current.humidity != null && (
                    <div>
                      <dt>Humidity</dt>
                      <dd>{r1(f.current.humidity)}%</dd>
                    </div>
                  )}
                  <div>
                    <dt>Wind</dt>
                    <dd>
                      <Navigation
                        size={11}
                        style={{ transform: `rotate(${(f.current.wind_direction ?? 0) + 180}deg)` }}
                        aria-hidden
                      />{" "}
                      {r1(f.current.wind_speed, 1)} m/s {compass(f.current.wind_direction)}
                      {f.current.wind_gust != null && <small> gust {r1(f.current.wind_gust, 1)}</small>}
                    </dd>
                  </div>
                  <div>
                    <dt>Pressure</dt>
                    <dd>{r1(f.current.pressure)} hPa</dd>
                  </div>
                  {f.current.uv != null && (
                    <div>
                      <dt>UV</dt>
                      <dd>{r1(f.current.uv, 1)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Cloud</dt>
                    <dd>{r1(f.current.cloud)}%</dd>
                  </div>
                  <div>
                    <dt>Air quality</dt>
                    <dd title={data.air_quality ? `PM2.5 ${r1(data.air_quality.pm2_5, 1)} µg/m³ · ${data.air_quality.model}` : undefined}>
                      {data.air_quality?.us_aqi != null ? (
                        <>
                          {Math.round(data.air_quality.us_aqi)} <small>{data.air_quality.band}</small>
                        </>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="fc-block">
              <span className="fc-section-kicker">NEXT 48 HOURS · TEMPERATURE °C</span>
              <div className="fc-legend">
                <i className="sw temp" /> Air temperature <i className="sw feels" /> Feels like
              </div>
              <div className="fc-chart">
                <ResponsiveContainer width="100%" height={130}>
                  <LineChart data={hours} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
                    <CartesianGrid stroke="#7797a01f" vertical={false} />
                    <XAxis dataKey="label" interval={5} tick={{ fill: "#6f8791", fontSize: 9 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "#6f8791", fontSize: 9 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ background: "#0b1720", border: "1px solid #7797a044", fontSize: 11 }}
                      formatter={(v, n) => [`${Number(v).toFixed(1)} °C`, n === "temperature" ? "Air" : "Feels like"]}
                    />
                    <Line dataKey="temperature" stroke="var(--ai-pos)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line dataKey="feels_like" stroke="#9db4bc" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <span className="fc-section-kicker">CHANCE OF PRECIPITATION %</span>
              <div className="fc-chart">
                <ResponsiveContainer width="100%" height={70}>
                  <BarChart data={hours} margin={{ top: 4, right: 6, bottom: 0, left: -22 }} barCategoryGap={1}>
                    <XAxis dataKey="label" interval={5} tick={{ fill: "#6f8791", fontSize: 9 }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: "#6f8791", fontSize: 9 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: "#7797a01a" }}
                      contentStyle={{ background: "#0b1720", border: "1px solid #7797a044", fontSize: 11 }}
                      formatter={(v, _n, p) => [
                        `${v == null ? "—" : Math.round(Number(v))}% · ${r1(p.payload.precipitation, 1)} mm`,
                        "Precipitation",
                      ]}
                    />
                    <Bar dataKey="pp" fill="var(--ai-neg)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                {hours.every((h) => h.pp == null) && <small className="fc-muted">This provider gives no hourly probability.</small>}
              </div>
            </div>

            <div className="fc-block">
              <span className="fc-section-kicker">
                {f.daily.length}-DAY OUTLOOK · DAY RANGE °C
              </span>
              <div className="fc-legend">
                <i className="sw range" /> Forecast min–max
                {data.ensemble && (
                  <>
                    <i className="sw band" /> Ensemble 10–90% of day max
                  </>
                )}
                {ctx && (
                  <>
                    <i className="sw tick" /> Local hot threshold
                  </>
                )}
              </div>
              <ol className="fc-days">
                {f.daily.map((d) => {
                  const c = ctxByDate.get(d.date);
                  const e = ensByDate.get(d.date);
                  const p = probByDate.get(d.date);
                  const flag = c?.hot ? "hot" : c?.cold ? "cold" : c?.heavy ? "wet" : "";
                  return (
                    <li key={d.date} className={flag}>
                      <span className="fc-day">
                        <b>{weekday(d.date)}</b>
                        <small>{d.date.slice(5)}</small>
                      </span>
                      <span className="fc-icon" title={d.description ?? ""}>
                        <Icon c={d.category} />
                      </span>
                      <span className="fc-lo">{r1(d.t_min)}°</span>
                      <span
                        className="fc-range"
                        title={`${d.description ?? ""} · min ${r1(d.t_min, 1)} °C, max ${r1(d.t_max, 1)} °C${e ? ` · ensemble max ${e.t_max[0]}–${e.t_max[2]} °C` : ""}${c ? ` · normal max ${c.normal_t_max} °C, hot threshold ${c.hot_threshold} °C` : ""}${p ? ` · P(above threshold) ${pct(p.p_hot)}` : ""}`}
                      >
                        {e && (
                          <i
                            className="band"
                            style={{ left: `${scale.x(e.t_max[0])}%`, width: `${Math.max(scale.x(e.t_max[2]) - scale.x(e.t_max[0]), 1)}%` }}
                          />
                        )}
                        {d.t_min != null && d.t_max != null && (
                          <i
                            className="bar"
                            style={{ left: `${scale.x(d.t_min)}%`, width: `${Math.max(scale.x(d.t_max) - scale.x(d.t_min), 1.5)}%` }}
                          />
                        )}
                        {c && <i className="tick" style={{ left: `${scale.x(c.hot_threshold)}%` }} />}
                      </span>
                      <span className="fc-hi">{r1(d.t_max)}°</span>
                      <span className="fc-rain" title="Precipitation total · chance">
                        {d.precip_sum != null && d.precip_sum >= 0.1 ? `${r1(d.precip_sum, 1)} mm` : ""}
                        {d.precip_probability != null && d.precip_probability > 0 && <small>{Math.round(d.precip_probability)}%</small>}
                      </span>
                      <span className="fc-flag">
                        {p && p.p_hot >= 0.2 ? <em className="hot">hot {pct(p.p_hot)}</em> : null}
                        {p && p.p_cold >= 0.2 ? <em className="cold">cold {pct(p.p_cold)}</em> : null}
                        {p && p.p_heavy != null && p.p_heavy >= 0.2 ? <em className="wet">wet {pct(p.p_heavy)}</em> : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="fc-block">
              <span className="fc-section-kicker">AI BRIEFING · ON DEMAND</span>
              {!brief && briefState !== "busy" && (
                <button className="ai-activate" onClick={runBrief}>
                  <Sparkles size={15} /> Write a plain-language briefing
                </button>
              )}
              {briefState === "busy" && (
                <div className="fc-loading" role="status">
                  <span className="loader" /> The System-2 model is writing from the computed facts only…
                </div>
              )}
              {briefState === "error" && <p className="fc-muted">{briefError}</p>}
              {brief && (
                <dl className="fc-brief">
                  {(["next_48h", "week", "watch"] as const).map(
                    (k) =>
                      brief.sections[k] && (
                        <div key={k}>
                          <dt>{k === "next_48h" ? "Next 48 hours" : k === "week" ? "This week" : "Watch"}</dt>
                          <dd>{brief.sections[k]}</dd>
                        </div>
                      ),
                  )}
                  <small className="fc-muted">
                    AI-generated (SI) by {brief.model} ({brief.provider}) from the numbers above.
                    {brief.removed_unsupported_sentences > 0 &&
                      ` ${brief.removed_unsupported_sentences} sentence(s) citing numbers not in the data were removed.`}
                  </small>
                </dl>
              )}
            </div>

            <div className="fc-block">
              <span className="fc-section-kicker">PROVIDER AGREEMENT</span>
              {ready.length < 2 ? (
                <p className="fc-muted">
                  Add a key for OpenWeather, WeatherAPI or Tomorrow.io to compare providers and see where they disagree.{" "}
                  <button className="fc-link" onClick={onKeys}>
                    Open API keys
                  </button>
                </p>
              ) : !comparison ? (
                <button className="fc-tool wide" onClick={runCompare} disabled={comparing}>
                  {comparing ? "Comparing…" : `Compare ${ready.length} providers`}
                </button>
              ) : (
                <div className="fc-compare">
                  <table>
                    <thead>
                      <tr>
                        <th>Day max °C</th>
                        {comparison.providers.map((p) => (
                          <th key={p.provider} title={p.label}>
                            {p.label.split(" ")[0]}
                          </th>
                        ))}
                        <th>Spread</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(comparison.t_max_spread)
                        .slice(0, 7)
                        .map(([date, s]) => (
                          <tr key={date}>
                            <td>
                              {weekday(date)} {date.slice(5)}
                            </td>
                            {comparison.providers.map((p) => (
                              <td key={p.provider}>{p.error ? "—" : r1(p.daily?.find((d) => d.date === date)?.t_max, 1)}</td>
                            ))}
                            <td className={s.range >= 3 ? "wide" : ""}>{s.range.toFixed(1)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {comparison.providers
                    .filter((p) => p.error)
                    .map((p) => (
                      <small key={p.provider} className="fc-muted">
                        {p.label}: {p.error}
                      </small>
                    ))}
                  <small className="fc-muted">A spread of 3 °C or more means the forecast is uncertain that day.</small>
                </div>
              )}
            </div>

            <div className="fc-block">
              <span className="fc-section-kicker">
                <Flame size={11} /> ACTIVE FIRES · NASA FIRMS
              </span>
              {data.fires ? (
                <p>
                  {data.fires.count === 0 ? (
                    `No VIIRS fire detections within ±${data.fires.box_deg}° in the last ${data.fires.days * 24} h.`
                  ) : (
                    <>
                      <b>{data.fires.count}</b> detections within ±{data.fires.box_deg}° in the last {data.fires.days * 24} h; nearest{" "}
                      <b>{data.fires.nearest_km} km</b>
                      {data.fires.max_frp != null && `, strongest ${r1(data.fires.max_frp)} MW radiative power`}.
                    </>
                  )}
                  <small className="fc-muted"> {data.fires.sensor}</small>
                </p>
              ) : data.unavailable.fires ? (
                <p className="fc-muted">{data.unavailable.fires}</p>
              ) : (
                <p className="fc-muted">
                  Add a free NASA FIRMS MAP_KEY to see satellite fire detections near this place.{" "}
                  <button className="fc-link" onClick={onKeys}>
                    Open API keys
                  </button>
                </p>
              )}
            </div>

            <details className="fc-method">
              <summary>
                <Wind size={12} /> Sources & method
              </summary>
              <p>
                <b>Forecast:</b> {f.label} — {f.model}. {(f.notes ?? []).join(" ")} Retrieved {new Date(f.retrieved_at).toLocaleString()} ({f.cache}).{" "}
                {f.license}.
              </p>
              {data.ensemble && (
                <p>
                  <b>Probabilities:</b> {data.ensemble.model}, {data.ensemble.members} members. Each probability is the share of
                  members meeting the condition. {data.ensemble.license}.
                </p>
              )}
              {ctx && (
                <p>
                  <b>Climate context:</b> {ctx.method} Height difference correction: {ctx.lapse_shift_c >= 0 ? "+" : ""}
                  {ctx.lapse_shift_c} °C (POWER cell {r1(ctx.power_elevation_m)} m, forecast point {r1(ctx.forecast_elevation_m)} m).{" "}
                  {ctx.limitation}
                </p>
              )}
              {data.air_quality && (
                <p>
                  <b>Air quality:</b> {data.air_quality.model}. {data.air_quality.license}.
                </p>
              )}
              {Object.keys(data.unavailable).length > 0 && (
                <p className="fc-muted">
                  Not available this time: {Object.entries(data.unavailable).map(([k, v]) => `${k} (${v})`).join("; ")}. Nothing was
                  substituted.
                </p>
              )}
            </details>
          </>
        )}
      </div>
    </section>
  );
}
