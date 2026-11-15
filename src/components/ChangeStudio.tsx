import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Pause,
  Play,
  Radar,
  RotateCcw,
  Satellite,
  ShieldCheck,
  Sigma,
  X,
  XCircle,
} from "lucide-react";
import { useEarth } from "../lib/store";
import { variables, type Variable } from "../lib/variables";
import { formatCoordinates } from "../lib/coordinates";
import { Term } from "./Term";
import {
  diverging,
  getSatellite,
  getScan,
  MONTH_NAMES,
  MONTHS,
  signed,
  STATUS_HINT,
  STATUS_LABEL,
  type CrossCheck,
  type SatelliteResult,
  type Scan,
  type ScanVariable,
} from "../lib/scan";

type Tab = "scan" | "seasons" | "spiral" | "stripes" | "significance";
const TABS: { id: Tab; label: string; icon: typeof Radar }[] = [
  { id: "scan", label: "What's changing", icon: Radar },
  { id: "seasons", label: "Seasons", icon: CalendarRange },
  { id: "spiral", label: "Spiral", icon: CircleDashed },
  { id: "stripes", label: "Stripes", icon: BarChart3 },
  { id: "significance", label: "Significance", icon: Sigma },
];
const LAST = new Date().getFullYear() - 1;
const RANGES = [1981, 1991, 2001].map((s) => ({ start: s, end: LAST }));
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const fmtP = (p: number) => (p < 0.001 ? "< 0.001" : p.toFixed(3));

function maxAbs(values: (number | null | undefined)[]) {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).map(Math.abs);
  return v.length ? Math.max(...v) || 1 : 1;
}
const isPower = (k: string): k is Variable => k in variables;
const shortOf = (v: ScanVariable) => v.short ?? (isPower(v.parameter) ? variables[v.parameter].short : v.name);
const monthlyOf = (v: ScanVariable) => v.monthly_unit ?? (isPower(v.parameter) ? variables[v.parameter].monthly : v.unit);
const spanOf = (v: ScanVariable, scan: Scan) => [v.start ?? scan.start, v.end ?? scan.end] as const;

/* ---------------------------------------------------------------- scan */
function Sparkline({ v }: { v: ScanVariable }) {
  const pts = v.annual.filter((a) => a.anomaly != null);
  if (pts.length < 2) return <svg className="cs-spark" viewBox="0 0 96 26" aria-hidden />;
  const m = maxAbs(pts.map((p) => p.anomaly));
  const x0 = pts[0].year;
  const x1 = pts[pts.length - 1].year;
  const X = (y: number) => ((y - x0) / Math.max(1, x1 - x0)) * 92 + 2;
  const Y = (a: number) => 13 - (a / m) * 11;
  const line = pts.map((p) => `${X(p.year).toFixed(1)},${Y(p.anomaly!).toFixed(1)}`).join(" ");
  const t = v.trend;
  const mid = (x0 + x1) / 2;
  const trend = t ? [x0, x1].map((y) => `${X(y)},${Y(((y - mid) * t.slope) / 10)}`).join(" ") : null;
  return (
    <svg className="cs-spark" viewBox="0 0 96 26" aria-hidden>
      <line x1="2" x2="94" y1="13" y2="13" className="cs-zero" />
      <polyline points={line} className="cs-spark-line" />
      {trend && <polyline points={trend} className={`cs-spark-trend ${(t?.slope ?? 0) >= 0 ? "pos" : "neg"}`} />}
    </svg>
  );
}

function StatusChip({ v }: { v: ScanVariable }) {
  const Icon = v.status === "significant" ? CheckCircle2 : v.status === "withheld" ? AlertTriangle : XCircle;
  return (
    <span className={`cs-chip ${v.status}`} title={STATUS_HINT[v.status]}>
      <Icon size={11} /> {STATUS_LABEL[v.status]}
    </span>
  );
}

function Row({ v, i, zMax, picked, pick }: { v: ScanVariable; i: number; zMax: number; picked: string; pick: (k: string) => void }) {
  const z = v.z ?? 0;
  const w = (Math.min(Math.abs(z), zMax) / zMax) * 50;
  return (
    <li style={{ "--i": i } as React.CSSProperties}>
      <button className={`cs-row ${picked === v.parameter ? "picked" : ""}`} onClick={() => pick(v.parameter)}>
        <span className="cs-rank">{i + 1}</span>
        <span className="cs-name">
          <strong>{v.name}</strong>
          <small>
            {v.trend ? `${signed(v.trend.slope)} ${v.unit}/decade` : "no trend estimate"}
            {v.trend ? ` · p ${fmtP(v.trend.p_value)}` : ""}
          </small>
        </span>
        <Sparkline v={v} />
        <span className="cs-zbar" title={v.z != null ? `${signed(v.z, 2)} σ per decade` : "not available"}>
          <i />
          <b className={z >= 0 ? "pos" : "neg"} style={z >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
          <em>{v.z != null ? `${signed(v.z, 1)}σ` : "—"}</em>
        </span>
        <StatusChip v={v} />
      </button>
    </li>
  );
}

const VERDICT: Record<CrossCheck["verdict"], { label: string; hint: string }> = {
  confirmed: { label: "Confirmed by satellite", hint: "Same direction and significant in both the NASA POWER model record and the MODIS satellite record." },
  consistent: { label: "Same direction", hint: "Both records move the same way, but at least one is not statistically significant." },
  conflicting: { label: "Records disagree", hint: "The model and the satellite record move in opposite directions: treat this trend with caution." },
};

function CrossChecks({ checks }: { checks: CrossCheck[] }) {
  if (!checks.length) return null;
  return (
    <div className="cs-cross">
      {checks.map((c, i) => (
        <div key={c.satellite} className={`cs-cross-card ${c.verdict}`} style={{ "--i": i } as React.CSSProperties} title={VERDICT[c.verdict].hint}>
          <span className="cs-cross-badge">
            <ShieldCheck size={13} /> {VERDICT[c.verdict].label}
          </span>
          <strong>{c.label}</strong>
          <small className="cs-cross-why">
            <Term k="lst">Land surface temperature</Term> from orbit vs NASA POWER 2 m air temperature
          </small>
          <div className="cs-cross-vals">
            <span>
              <small>MODIS satellite</small>
              <b>
                {signed(c.satellite_slope)} {c.satellite_unit}/dec
              </b>
              {c.satellite_significant ? <em>significant</em> : <em className="no">not significant</em>}
            </span>
            <span>
              <small>NASA POWER model</small>
              <b>
                {signed(c.power_slope)} {c.power_unit}/dec
              </b>
              {c.power_significant ? <em>significant</em> : <em className="no">not significant</em>}
            </span>
          </div>
          <small className="cs-cross-period">
            {c.period[0]}–{c.period[1]} · corroborating evidence from two observing systems, not proof the quantities are equal
          </small>
        </div>
      ))}
    </div>
  );
}

function ScanTab({ scan, sat, satError, pick, picked, onInvestigate }: {
  scan: Scan; sat: SatelliteResult | null; satError: string; pick: (v: string) => void; picked: string; onInvestigate: (v: Variable) => void;
}) {
  const by = Object.fromEntries(scan.variables.map((v) => [v.parameter, v])) as Record<string, ScanVariable>;
  const ranked = scan.ranking.map((k) => by[k]);
  const top = ranked[0];
  const zMax = Math.max(2, maxAbs([...ranked, ...(sat?.variables ?? [])].map((v) => v.z)));
  const satRows = sat ? sat.ranking.map((k) => sat.variables.find((v) => v.parameter === k)!) : [];
  return (
    <div className="cs-scan">
      {top?.trend && (
        <div className={`cs-headline ${top.status}`}>
          <span className="cs-eyebrow">Strongest change · {scan.start}–{scan.end}</span>
          <strong>
            {top.name} is {top.trend.slope >= 0 ? "rising" : "falling"} {signed(top.trend.slope)} {top.unit}/decade
          </strong>
          <small>
            {top.z != null ? `${Math.abs(top.z).toFixed(2)} × its year-to-year swing per decade · ` : ""}
            fitted change {signed(top.trend.total_change)} {top.unit} over {scan.end - scan.start} years ·{" "}
            {top.status === "significant" ? "statistically significant" : STATUS_LABEL[top.status].toLowerCase()}
          </small>
          <div className="cs-counts">
            {(["significant", "nominal", "not_significant", "withheld"] as const).map((s) => (
              <span key={s} className={`cs-count ${s}`} title={STATUS_HINT[s]}>
                <b>{scan.counts[s]}</b> {STATUS_LABEL[s].toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      )}
      <h4 className="cs-group">
        <Activity size={13} /> NASA POWER · model-derived climate record <span>{scan.start}–{scan.end}</span>
      </h4>
      <ol className="cs-rows">
        {ranked.map((v, i) => (
          <Row key={v.parameter} v={v} i={i} zMax={zMax} picked={picked} pick={pick} />
        ))}
      </ol>
      {isPower(picked) && (
        <div className="cs-row-actions">
          <button className="cs-ghost" onClick={() => onInvestigate(picked)}>
            Open full investigation of {variables[picked].name.toLowerCase()} <ArrowUpRight size={12} />
          </button>
        </div>
      )}
      <h4 className="cs-group sat">
        <Satellite size={13} /> Seen from space · NASA MODIS Terra via Microsoft Planetary Computer <span>{sat ? `${sat.start}–${sat.end}` : "2001–"}</span>
      </h4>
      {!sat && !satError && (
        <div className="cs-sat-loading" role="status">
          <span className="cs-orbit-dot" aria-hidden />
          Sampling 25 years of MODIS granules at this point (vegetation, land surface temperature, evapotranspiration, productivity)… a first visit
          takes about half a minute.
        </div>
      )}
      {satError && (
        <p className="cs-error">
          <AlertTriangle size={14} /> {satError}
        </p>
      )}
      {sat && (
        <>
          <CrossChecks checks={sat.cross_checks} />
          <ol className="cs-rows">
            {satRows.map((v, i) => (
              <Row key={v.parameter} v={v} i={i} zMax={zMax} picked={picked} pick={pick} />
            ))}
          </ol>
          <details className="cs-quality">
            <summary>Data quality · QA policy {sat.qa_policy ?? "?"}</summary>
            <table>
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Accepted</th>
                  <th>QA-rejected</th>
                  <th>Fill / range</th>
                  <th>Season check</th>
                </tr>
              </thead>
              <tbody>
                {satRows.map((v) => {
                  const q = v.quality;
                  const sens = q?.complete_year_sensitivity;
                  return (
                    <tr key={v.parameter}>
                      <td>{shortOf(v)}</td>
                      <td>{q?.accepted ?? "—"}</td>
                      <td>{q?.qa_rejected ?? "—"}</td>
                      <td>{q?.fill_or_range ?? "—"}</td>
                      <td>
                        {v.gap_filled
                          ? "provider gap-filled"
                          : sens
                            ? `complete years only: ${signed(sens.slope)} ${v.unit}/dec (${sens.complete_years} yrs)`
                            : "too few complete years"}
                        {q?.masked_months?.length ? ` · months dropped: ${q.masked_months.join(", ")}` : ""}
                        {q?.coverage_shift != null && q.coverage_shift > 0.3 ? " · seasonal coverage shifts" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="cs-note">{sat.methods.quality} {sat.methods.annual}</p>
          </details>
          {sat.failed_chunks.length > 0 && (
            <p className="cs-note">Some years could not be retrieved ({sat.failed_chunks.join(", ")}); trends use the years that were.</p>
          )}
          <p className="cs-note">
            Only quality-accepted pixels count; each year is built from calendar-month anomalies so changing seasonal coverage
            cannot fake a trend.{" "}
            <a href="https://planetarycomputer.microsoft.com/catalog" target="_blank" rel="noreferrer">
              Planetary Computer catalog <ExternalLink size={10} />
            </a>
          </p>
        </>
      )}
      <p className="cs-note">
        Ranked by standardized change (<Term k="sigma">σ/decade</Term>), significant variables first, using one method for every variable so different
        units can be compared. Thin line: annual <Term k="anomaly">anomalies</Term>; bold: <Term k="theilsen">Theil–Sen</Term> trend. Significance uses the{" "}
        <Term k="mk">Mann–Kendall test</Term>, an <Term k="autocorrelation">autocorrelation</Term> screen and <Term k="fdr">FDR</Term> control. Tap any
        underlined term for its meaning.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- seasons */
function SeasonsTab({ scan, sat, pick, picked }: { scan: Scan; sat: SatelliteResult | null; pick: (v: string) => void; picked: string }) {
  const [hover, setHover] = useState<string>("");
  const power = scan.ranking.map((k) => scan.variables.find((v) => v.parameter === k)!);
  const space = (sat?.ranking ?? []).map((k) => sat!.variables.find((v) => v.parameter === k)!).filter((v) => v.seasonal.length);
  const rows = [...power, ...space];
  const nSig = power.reduce((n, r) => n + r.seasonal.filter((c) => c.significant_fdr).length, 0);
  return (
    <div className="cs-seasons">
      <p className="cs-lede">
        Which months are changing? Each cell tests one calendar month across {scan.end - scan.start + 1} years. <b>{nSig}</b> of {power.length * 12} cells stay
        significant after <Term k="fdr">false-discovery-rate control</Term> (dot).
      </p>
      <div className="cs-heat" role="grid" aria-label="Seasonal change fingerprint" onMouseLeave={() => setHover("")}>
        <span />
        {MONTHS.map((m, i) => (
          <span key={i} className="cs-heat-month">
            {m}
          </span>
        ))}
        {rows.map((r, ri) => (
          <div className={`cs-heat-row ${picked === r.parameter ? "picked" : ""} ${r.source === "satellite" ? "sat" : ""}`} key={r.parameter} role="row">
            {r.parameter === space[0]?.parameter && (
              <span className="cs-heat-divider">
                <Satellite size={11} /> MODIS {sat!.start}–{sat!.end}
              </span>
            )}
            <button className="cs-heat-label" onClick={() => pick(r.parameter)}>
              {shortOf(r)}
            </button>
            {r.seasonal.map((c) => {
              const text =
                c.slope == null
                  ? `${r.name} · ${MONTH_NAMES[c.month - 1]}: not enough years`
                  : `${r.name} · ${MONTH_NAMES[c.month - 1]}: ${signed(c.slope)} ${monthlyOf(r)}/decade` +
                    (c.z != null ? ` (${signed(c.z, 2)}σ)` : "") +
                    ` · p ${fmtP(c.p_value!)}` +
                    (c.withheld
                      ? " · significance withheld (years autocorrelated or < 10 years)"
                      : c.significant_fdr
                        ? " · significant after FDR"
                        : "");
              return (
                <span
                  key={c.month}
                  role="gridcell"
                  tabIndex={0}
                  aria-label={text}
                  className={`cs-cell ${c.significant_fdr ? "sig" : ""} ${c.withheld ? "withheld" : ""}`}
                  style={{ background: diverging(c.z == null ? null : c.z / 1.5), "--d": `${ri * 0.03 + c.month * 0.015}s` } as React.CSSProperties}
                  onMouseEnter={() => setHover(text)}
                  onFocus={() => setHover(text)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="cs-readout" aria-live="polite">
        {hover || "Hover or focus a cell to read its trend."}
      </p>
      <div className="cs-scale">
        <span>falling</span>
        <i />
        <span>rising · colour = σ/decade, saturates at ±1.5σ · hatched = significance withheld (autocorrelated)</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- spiral */
function SpiralTab({ scan, v }: { scan: Scan; v: ScanVariable }) {
  const [smooth, setSmooth] = useState(true);
  const months = useMemo(() => {
    const flat: { year: number; month: number; a: number | null }[] = [];
    const y0 = v.start ?? scan.start;
    v.monthly_anomaly.forEach((row, yi) => row.forEach((a, mi) => flat.push({ year: y0 + yi, month: mi, a })));
    // Optional centred 12-month running mean: shows the drift instead of month-to-month weather noise.
    const values = smooth
      ? flat.map((_, i) => {
          const w = flat.slice(Math.max(0, i - 6), Math.min(flat.length, i + 6)).map((p) => p.a).filter((a): a is number => a != null);
          return w.length >= 9 ? w.reduce((x, y) => x + y, 0) / w.length : null;
        })
      : flat.map((p) => p.a);
    return flat.map((p, i) => ({ ...p, a: values[i] })).filter((p): p is { year: number; month: number; a: number } => p.a != null);
  }, [v, scan.start, smooth]);
  const [y0, y1] = spanOf(v, scan);
  const [frame, setFrame] = useState(() => (reduced() ? months.length : 0));
  const [playing, setPlaying] = useState(!reduced());
  useEffect(() => {
    setFrame(reduced() ? months.length : 0);
    setPlaying(!reduced());
  }, [months]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    // Time-based: about 36 months per second whatever the timer rate (throttled background tabs included).
    const id = window.setInterval(() => {
      const t = performance.now();
      const n = Math.floor((t - last) / 28);
      if (n <= 0) return;
      last += n * 28;
      setFrame((f) => {
        if (f >= months.length) {
          setPlaying(false);
          return f;
        }
        return Math.min(months.length, f + n);
      });
    }, 30);
    return () => window.clearInterval(id);
  }, [playing, months.length]);

  const m = maxAbs(months.map((p) => p.a));
  const C = 160;
  const R0 = 78;
  const K = 62 / m;
  const polar = (month: number, r: number) => {
    const ang = (month / 12) * Math.PI * 2 - Math.PI / 2;
    return [C + r * Math.cos(ang), C + r * Math.sin(ang)];
  };
  const pos = (month: number, a: number) => polar(month, Math.max(8, R0 + a * K));
  const shown = months.slice(0, frame);
  const current = shown[shown.length - 1];
  const unit = monthlyOf(v);
  if (!v.monthly_anomaly.length)
    return <p className="cs-note">{v.name} is a yearly product, so there is no monthly cycle to spiral. Try Stripes or Significance.</p>;
  return (
    <div className="cs-spiral">
      <svg viewBox="0 0 320 320" overflow="visible" role="img" aria-label={`Climate spiral of ${v.name} monthly anomalies ${y0}–${y1}`}>
        {[-1, -0.5, 0.5, 1].map((k) => (
          <circle key={k} cx={C} cy={C} r={R0 + k * m * K} className="cs-ring" />
        ))}
        <circle cx={C} cy={C} r={R0} className="cs-ring zero" />
        {([[0, "0"], [m, `+${m.toFixed(m < 1 ? 2 : 1)} ${unit}`], [-m, `−${m.toFixed(m < 1 ? 2 : 1)}`]] as [number, string][]).map(([a, label]) => {
          const [x, y] = polar(0.5, R0 + a * K);
          return (
            <text key={label} x={x + 2} y={y - 2} className="cs-ring-label">
              {label}
            </text>
          );
        })}
        {MONTHS.map((mm, i) => {
          const [x, y] = polar(i, R0 + 62 + 12);
          return (
            <text key={i} x={x} y={y + 3} className="cs-month">
              {mm}
            </text>
          );
        })}
        {shown.map((p, i) => {
          if (i === 0) return null;
          const q = shown[i - 1];
          const [x1, y1] = pos(q.month, q.a);
          const [x2, y2] = pos(p.month, p.a);
          const age = (shown.length - i) / 12;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={diverging(p.a / m)}
              strokeWidth={age < 1 ? 2.4 : 1.3}
              strokeOpacity={Math.max(0.25, 1 - age / 30)}
              strokeLinecap="round"
            />
          );
        })}
        {current && (() => {
          const [x, y] = pos(current.month, current.a);
          return <circle cx={x} cy={y} r={3.5} className="cs-head" />;
        })()}
        <text x={C} y={C - 4} className="cs-year">
          {current?.year ?? y0}
        </text>
        <text x={C} y={C + 14} className="cs-year-sub">
          {current ? `${MONTH_NAMES[current.month]} ${signed(current.a)} ${unit}` : v.name}
        </text>
      </svg>
      <div className="cs-controls">
        <button
          className="cs-icon"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            if (!playing && frame >= months.length) setFrame(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="cs-icon" aria-label="Restart" onClick={() => { setFrame(0); setPlaying(true); }}>
          <RotateCcw size={14} />
        </button>
        <label className="cs-toggle">
          <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> 12-month mean
        </label>
        <input
          type="range"
          min={0}
          max={months.length}
          value={frame}
          aria-label="Spiral position"
          onChange={(e) => {
            setPlaying(false);
            setFrame(+e.target.value);
          }}
        />
      </div>
      <p className="cs-note">
        Each loop is one year; distance from the centre ring is the monthly anomaly from that month&apos;s {y0}–{y1} mean ({v.source === "satellite" ? v.mission : "NASA POWER"})
        {smooth ? ", smoothed with a centred 12-month running mean" : ""}.
        Inspired by NASA&apos;s climate spiral visualizations; drawn here from this location&apos;s own record.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- stripes */
function Stripes({ v, height = 90, label = true }: { v: ScanVariable; height?: number; label?: boolean }) {
  const [hover, setHover] = useState("");
  const m = maxAbs(v.annual.map((a) => a.anomaly));
  const n = v.annual.length;
  return (
    <div className="cs-stripes-wrap">
      <svg viewBox={`0 0 ${n * 10} ${height}`} preserveAspectRatio="none" className="cs-stripes" role="img"
        aria-label={`${v.name} annual anomalies as colour stripes`} onMouseLeave={() => setHover("")}>
        {v.annual.map((a, i) => (
          <rect key={a.year} x={i * 10} y={0} width={10.4} height={height} fill={diverging(a.anomaly == null ? null : a.anomaly / m)}
            style={{ "--d": `${i * 0.012}s` } as React.CSSProperties}
            onMouseEnter={() => setHover(`${a.year}: ${a.anomaly == null ? "no complete-year value" : `${signed(a.anomaly)} ${v.unit} vs the period mean`}`)} />
        ))}
      </svg>
      {label && (
        <div className="cs-stripe-axis">
          <span>{v.annual[0]?.year}</span>
          <span className="cs-readout">{hover || " "}</span>
          <span>{v.annual[n - 1]?.year}</span>
        </div>
      )}
    </div>
  );
}

function StripesTab({ scan, sat, v, pick }: { scan: Scan; sat: SatelliteResult | null; v: ScanVariable; pick: (k: string) => void }) {
  const [y0, y1] = spanOf(v, scan);
  const board = [
    ...scan.ranking.map((k) => scan.variables.find((y) => y.parameter === k)!),
    ...(sat?.ranking ?? []).map((k) => sat!.variables.find((y) => y.parameter === k)!),
  ];
  return (
    <div className="cs-stripes-tab">
      <h4>
        {v.name} <span>annual anomaly · {y0}–{y1}{v.source === "satellite" ? ` · ${v.mission}` : ""}</span>
      </h4>
      <Stripes v={v} height={120} />
      <p className="cs-note">
        One stripe per year, coloured by its departure from the {y0}–{y1} mean: blue below, orange above, grey near the mean. Dark gaps are
        years without a complete record. The style follows Ed Hawkins&apos; warming stripes, extended here to every variable.
      </p>
      <h4>
        Stripe board <span>every variable, ranked by change</span>
      </h4>
      <div className="cs-board">
        {board.map((x) => {
          const k = x.parameter;
          return (
            <button key={k} className={`cs-board-row ${k === v.parameter ? "picked" : ""} ${x.source === "satellite" ? "sat" : ""}`} onClick={() => pick(k)}>
              <span>
                {x.source === "satellite" && <Satellite size={10} />} {shortOf(x)}
              </span>
              <Stripes v={x} height={18} label={false} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- significance */
function SignificanceTab({ v }: { v: ScanVariable }) {
  const p = v.permutation;
  const t = v.trend;
  if (!p || !t) return <p className="cs-note">Not enough annual values for a significance test.</p>;
  const counts = p.histogram.counts;
  const edges = p.histogram.edges;
  const top = Math.max(...counts, 1);
  const W = 320;
  const H = 130;
  const bw = W / counts.length;
  const X = (s: number) => ((s - edges[0]) / (edges[edges.length - 1] - edges[0])) * W;
  const extreme = Math.round(p.share_as_extreme * p.permutations);
  const checks: { ok: boolean | null; label: string; detail: string }[] = [
    { ok: t.years >= 10, label: "Long enough record", detail: `${t.years} usable years (≥ 10 needed)` },
    {
      ok: t.lag1 == null ? null : Math.abs(t.lag1) <= 1.96 / Math.sqrt(t.years),
      label: "Years behave independently",
      detail: t.lag1 == null ? "lag-1 autocorrelation not computable" : `detrended lag-1 r = ${t.lag1.toFixed(2)} (limit ±${(1.96 / Math.sqrt(t.years)).toFixed(2)})`,
    },
    { ok: t.p_value < 0.05, label: "Mann–Kendall trend test", detail: `p = ${fmtP(t.p_value)} (two-sided, α = 0.05)` },
    p.applicable === false
      ? { ok: null, label: "Permutation test", detail: "not applicable: shuffling assumes independent years, and this record is autocorrelated" }
      : { ok: p.p_value < 0.05, label: "Permutation test", detail: `${extreme} of ${p.permutations.toLocaleString()} shuffles as extreme · p = ${fmtP(p.p_value)}` },
    { ok: v.significant_fdr, label: "Survives multiple testing", detail: v.source === "satellite" ? "Benjamini–Hochberg FDR across the satellite variables at this place" : "Benjamini–Hochberg FDR across the 8 NASA POWER variables and the drought index at this place" },
  ];
  return (
    <div className="cs-sig">
      <p className="cs-lede">
        <b>Is the {v.name.toLowerCase()} change real, or could chance produce it?</b> In a <Term k="permutation">permutation test</Term> we shuffled the {t.years} annual values {p.permutations.toLocaleString()} times,
        destroying any time order, and measured the trend statistic each time.{" "}
        {extreme === 0
          ? "No shuffle looked as trended as the real record."
          : `${extreme} shuffle${extreme === 1 ? "" : "s"} looked as trended as the real record.`}
      </p>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="cs-hist" role="img" aria-label={`Permutation null distribution with the observed Mann–Kendall S = ${p.s_observed}`}>
        {counts.map((c, i) => {
          const mid = (edges[i] + edges[i + 1]) / 2;
          const tail = Math.abs(mid) >= Math.abs(p.s_observed);
          const h = (c / top) * H;
          return <rect key={i} x={i * bw + 1} y={H - h} width={bw - 2} height={h} rx={1.5} className={tail ? "tail" : ""} style={{ "--d": `${i * 0.012}s` } as React.CSSProperties} />;
        })}
        {[p.s_observed, -p.s_observed].map((s, i) => (
          <g key={i} className={i === 0 ? "obs" : "obs mirror"}>
            <line x1={X(s)} x2={X(s)} y1={0} y2={H} />
            {i === 0 && (
              <text x={Math.min(W - 4, Math.max(4, X(s)))} y={12} textAnchor={X(s) > W / 2 ? "end" : "start"}>
                observed S = {p.s_observed}
              </text>
            )}
          </g>
        ))}
        <line x1={0} x2={W} y1={H} y2={H} className="cs-axis" />
        <text x={0} y={H + 16} className="cs-tick">−{p.s_max}</text>
        <text x={W / 2} y={H + 16} textAnchor="middle" className="cs-tick">0 · no trend</text>
        <text x={W} y={H + 16} textAnchor="end" className="cs-tick">+{p.s_max}</text>
      </svg>
      <ul className="cs-checks">
        {checks.map((c) => (
          <li key={c.label} className={c.ok === true ? "ok" : c.ok === false ? "bad" : "na"}>
            {c.ok === true ? <CheckCircle2 size={14} /> : c.ok === false ? <XCircle size={14} /> : <AlertTriangle size={14} />}
            <span>
              <b>{c.label}</b>
              <small>{c.detail}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className={`cs-verdict ${v.status}`}>
        Verdict: <b>{STATUS_LABEL[v.status]}</b>. {STATUS_HINT[v.status]}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- panel */
export function ChangeStudio({ onClose, onInvestigate, initialTab = "scan" }: { onClose: () => void; onInvestigate: (v: Variable) => void; initialTab?: Tab }) {
  const { location, selectionVersion } = useEarth();
  const [range, setRange] = useState(RANGES[0]);
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>(initialTab);
  const [picked, setPicked] = useState<string | null>(null);
  const [sat, setSat] = useState<SatelliteResult | null>(null);
  const [satError, setSatError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => setTab(initialTab), [initialTab]);

  useEffect(() => {
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    setError("");
    setScan(null);
    getScan({ latitude: location.latitude, longitude: location.longitude, ...range }, c.signal)
      .then((s) => {
        if (c.signal.aborted) return;
        setScan(s);
        setPicked((p) => p ?? s.ranking[0]);
      })
      .catch((e) => !c.signal.aborted && setError((e as Error).message));
    return () => c.abort();
  }, [location.latitude, location.longitude, range, selectionVersion]);
  // MODIS series do not depend on the chosen period (always 2001–last year), so they load once per place.
  useEffect(() => {
    const c = new AbortController();
    setSat(null);
    setSatError("");
    getSatellite({ latitude: location.latitude, longitude: location.longitude }, c.signal)
      .then((r) => !c.signal.aborted && setSat(r))
      .catch((e) => !c.signal.aborted && setSatError((e as Error).message));
    return () => c.abort();
  }, [location.latitude, location.longitude, selectionVersion]);

  const all = [...(scan?.variables ?? []), ...(sat?.variables ?? [])];
  const v = scan && picked ? all.find((x) => x.parameter === picked) ?? scan.variables.find((x) => x.parameter === scan.ranking[0])! : null;
  return (
    <section className="cs-panel glass-panel" aria-label="Change studio">
      <header className="cs-header">
        <span className="cs-mark">
          <Activity size={19} />
        </span>
        <div>
          <span className="trends-eyebrow">CHANGE STUDIO · NASA POWER + MODIS SATELLITE</span>
          <h2>What is changing here?</h2>
          <p>
            {location.name} · {formatCoordinates(location.latitude, location.longitude)}
          </p>
        </div>
        <button aria-label="Close change studio" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <nav className="cs-tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </nav>
      <div className="cs-toolbar">
        <label>
          Period
          <select value={range.start} onChange={(e) => setRange(RANGES.find((r) => r.start === +e.target.value)!)}>
            {RANGES.map((r) => (
              <option key={r.start} value={r.start}>
                {r.start}–{r.end}
              </option>
            ))}
          </select>
        </label>
        {tab !== "scan" && tab !== "seasons" && scan && picked && (
          <label>
            Variable
            <select value={v?.parameter ?? picked} onChange={(e) => setPicked(e.target.value)}>
              <optgroup label="NASA POWER (model)">
                {scan.ranking.map((k) => (
                  <option key={k} value={k}>
                    {scan.variables.find((x) => x.parameter === k)!.name}
                  </option>
                ))}
              </optgroup>
              {sat && (
                <optgroup label="MODIS satellite">
                  {sat.ranking.map((k) => (
                    <option key={k} value={k}>
                      {sat.variables.find((x) => x.parameter === k)!.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        )}
      </div>
      <div className="cs-body">
        {error && (
          <p className="cs-error">
            <AlertTriangle size={14} /> {error}
          </p>
        )}
        {!scan && !error && (
          <div className="cs-loading" role="status">
            <div className="cs-radar" aria-hidden>
              <i />
            </div>
            <div>
              <strong>Scanning 8 variables and the drought index…</strong>
              <small>NASA POWER daily record → annual series → Theil–Sen + Mann–Kendall → 2,000 permutations each → FDR</small>
            </div>
          </div>
        )}
        {scan && v && (
          <div className="cs-view" key={tab + range.start}>
            {tab === "scan" && <ScanTab scan={scan} sat={sat} satError={satError} pick={setPicked} picked={v.parameter} onInvestigate={onInvestigate} />}
            {tab === "seasons" && <SeasonsTab scan={scan} sat={sat} pick={(k) => { setPicked(k); setTab("stripes"); }} picked={v.parameter} />}
            {tab === "spiral" && <SpiralTab scan={scan} v={v} />}
            {tab === "stripes" && <StripesTab scan={scan} sat={sat} v={v} pick={setPicked} />}
            {tab === "significance" && <SignificanceTab v={v} />}
          </div>
        )}
        {scan && (
          <p className="cs-source">
            {scan.source} · retrieved {new Date(scan.retrieved_at).toLocaleDateString()} ·{" "}
            <a href={scan.source_url} target="_blank" rel="noreferrer">
              source <ExternalLink size={10} />
            </a>
          </p>
        )}
      </div>
    </section>
  );
}
