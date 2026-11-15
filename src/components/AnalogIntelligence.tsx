import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Cloud,
  ExternalLink,
  KeyRound,
  Layers3,
  Power,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useEarth } from "../lib/store";
import { formatCoordinates } from "../lib/coordinates";
import {
  aiAnalyze,
  aiStatus,
  aiWarmup,
  REGIME_SHORT,
  type AIResult,
  type AIStatus,
  type AnalogMap,
  type TrendRow,
  type TargetOutlook,
  type Similarity,
} from "../lib/ai";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number, d = 1) => `${n > 0 ? "+" : ""}${n.toFixed(d)}`;
const SHORT: Record<string, string> = {
  t_mean: "Mean temp",
  t_max: "Day max",
  t_min: "Night min",
  rain: "Rainfall",
  hot_days: "Hot days",
  warm_nights: "Warm nights",
  cold_days: "Cold days",
  heavy_rain: "Heavy rain",
  dry_spell: "Dry spell",
};
type Phase = "idle" | "warming" | "analyzing" | "done" | "error";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Eases a number from 0 to its value once it appears (skipped for reduced motion). */
function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min((t - t0) / ms, 1);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const STEPS = [
  "NASA POWER record",
  "Tectonic scope",
  "40 nearest episodes",
  "Laya similarity",
  "Cloud model if ≥70%",
];

/** Pipeline stepper shown while the analysis runs; steps advance on a timer as an indication only. */
function Pipeline({ warming, forcing }: { warming: boolean; forcing: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (warming) return;
    const id = window.setInterval(() => setStep((n) => Math.min(n + 1, STEPS.length - 1)), 1400);
    return () => window.clearInterval(id);
  }, [warming]);
  const active = forcing ? STEPS.length - 1 : step;
  return (
    <div className="ai-loading" role="status">
      <div className="ai-orbit" aria-hidden>
        <i />
        <i />
        <BrainCircuit size={18} />
      </div>
      <div>
        <strong>
          {warming
            ? "Loading Laya…"
            : forcing
              ? "Writing the outlook…"
              : "Comparing with plate-scoped history…"}
        </strong>
        {warming ? (
          <small>First activation reads the model weights; later runs take seconds.</small>
        ) : (
          <ol className="ai-steps">
            {STEPS.map((label, i) => (
              <li key={label} className={i < active ? "done" : i === active ? "now" : ""}>
                <span />
                {label}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function ZBar({ row, i = 0 }: { row: TrendRow; i?: number }) {
  const w = Math.min(Math.abs(row.z) / 2.5, 1) * 50;
  return (
    <div
      className="ai-zrow"
      style={{ "--i": i } as CSSProperties}
      title={`${row.label}: ${signed(row.slope, 2)} ${row.unit}/decade · ${signed(row.z, 2)}σ/decade · p=${row.p.toFixed(3)}${row.significant ? " · significant" : ""}`}
    >
      <span className="ai-zname">{SHORT[row.index] ?? row.index}</span>
      <span className="ai-ztrack">
        <i className="ai-zmid" />
        <b
          className={row.z >= 0 ? "pos" : "neg"}
          style={
            row.z >= 0
              ? { left: "50%", width: `${w}%` }
              : { right: "50%", width: `${w}%` }
          }
        />
      </span>
      <span className="ai-zval">
        {signed(row.z)}σ{row.significant ? <em>*</em> : <em> </em>}
      </span>
    </div>
  );
}

function SimilarityMeter({ sim }: { sim: Extract<Similarity, { status: "ok" }> }) {
  const v = Math.round(sim.average * 100);
  const gate = Math.round(sim.gate * 100);
  const shown = useCountUp(v);
  return (
    <div className={`ai-sim ${sim.passes ? "pass" : ""}`}>
      <div className="ai-sim-head">
        <span>Laya resemblance score</span>
        <strong>
          {Math.round(shown)}
          <small>%</small>
        </strong>
      </div>
      <div
        className="ai-sim-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-label={`Laya resemblance score ${v}%, gate ${gate}%`}
      >
        <b style={{ width: `${v}%` }} />
        <i style={{ left: `${gate}%` }} title={`Gate: ${gate}%`} />
      </div>
      <small>
        Average over the {sim.evaluation.top} closest past episodes of how many of the 9 trend changes match (same
        direction, similar strength). This is resemblance, not the chance that a forecast is right.{" "}
        {sim.passes ? `At or above ${gate}%: the larger model explains the skill-verified outlook, using them as context.` : `Below the ${gate}% gate: no automatic outlook.`}
      </small>
    </div>
  );
}

function OutlookRow({ o }: { o: TargetOutlook }) {
  const p = o.probabilities;
  const word = { fall: "fall", steady: "stay steady", rise: "rise" }[o.most_likely];
  return (
    <div className={`ai-out ${o.skilful ? "" : "unskilled"}`}>
      <div className="ai-out-head">
        <strong>{o.label.charAt(0).toUpperCase() + o.label.slice(1)}</strong>
        <span className="ai-source" title={o.source === "laya" ? "Answered by the fine-tuned Laya decision model" : "Laya scored lower on the calibration years for this question, so the System-1 linear model answers it"}>
          {o.source === "laya" ? "Laya" : "linear model"}
        </span>
        {o.skilful ? (
          <span className="ai-skill ok" title={`Ranked probability skill score ${o.rpss.toFixed(2)} (95% interval ${o.rpss_ci[0].toFixed(2)} to ${o.rpss_ci[1].toFixed(2)}) vs climatology on later years at unseen sites`}>
            skill verified · RPSS {o.rpss.toFixed(2)}
          </span>
        ) : (
          <span className="ai-skill" title="The 95% interval of its skill score includes zero on held-out sites">
            no verified skill
          </span>
        )}
      </div>
      <div
        className="ai-stack"
        role="img"
        aria-label={`${o.label}: fall ${pct(p.fall)}, steady ${pct(p.steady)}, rise ${pct(p.rise)}`}
      >
        <b className="fall" style={{ width: `${p.fall * 100}%` }} title={`Fall ${pct(p.fall)} (usually ${pct(o.climatology.fall)})`} />
        <b className="steady" style={{ width: `${p.steady * 100}%` }} title={`Steady ${pct(p.steady)} (usually ${pct(o.climatology.steady)})`} />
        <b className="rise" style={{ width: `${p.rise * 100}%` }} title={`Rise ${pct(p.rise)} (usually ${pct(o.climatology.rise)})`} />
      </div>
      <small>
        {o.skilful ? (
          <>
            Most likely to <b>{word}</b> ({pct(p[o.most_likely])}; usually {pct(o.climatology[o.most_likely])}) · fall{" "}
            {pct(p.fall)} · steady {pct(p.steady)} · rise {pct(p.rise)} · skill vs the climatology baseline RPSS {o.rpss.toFixed(2)} [
            {o.rpss_ci[0].toFixed(2)}, {o.rpss_ci[1].toFixed(2)}], tested on later years (outcomes 2016–2024) at unseen sites
          </>
        ) : (
          <>Not shown as a forecast: the model did not beat the usual rates (climatology) for this index on held-out sites and later years.</>
        )}
      </small>
    </div>
  );
}

export function AnalogIntelligence({
  onClose,
  onMap,
  onFly,
  onKeys,
  keysVersion = 0,
}: {
  onClose: () => void;
  onMap: (m: AnalogMap | null) => void;
  onFly: (lat: number, lon: number) => void;
  /** Opens the API-keys menu, where the cloud model's key is added. */
  onKeys?: () => void;
  keysVersion?: number;
}) {
  const { location, selectionVersion } = useEarth();
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<AIResult | null>(null);
  const [error, setError] = useState("");
  const [forcing, setForcing] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const c = new AbortController();
    aiStatus(c.signal)
      .then(setStatus)
      .catch(() => {});
    return () => c.abort();
  }, [keysVersion]);
  // A new target invalidates the previous AI result; nothing re-runs until asked.
  useEffect(() => {
    abort.current?.abort();
    setResult(null);
    setPhase("idle");
    setError("");
    onMap(null);
  }, [selectionVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (outlook: "auto" | "force") => {
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    setError("");
    if (outlook === "force") setForcing(true);
    try {
      if (
        (status?.system1.laya_needed && !status.system1.loaded) ||
        (status?.similarity?.available && !status.similarity.loaded)
      ) {
        setPhase("warming");
        await aiWarmup(c.signal);
      }
      setPhase("analyzing");
      const r = await aiAnalyze(
        {
          latitude: location.latitude,
          longitude: location.longitude,
          name: `${location.name}, ${location.country}`,
          outlook,
        },
        c.signal,
      );
      if (c.signal.aborted) return;
      setResult(r);
      setPhase("done");
      setStatus((s) =>
        s ? { ...s, system1: { ...s.system1, loaded: true } } : s,
      );
      const best = r.analogs[0]?.option;
      onMap({
        origin: {
          latitude: location.latitude,
          longitude: location.longitude,
          name: location.name,
        },
        analogs: r.analogs.map((a) => ({
          option: a.option,
          latitude: a.latitude,
          longitude: a.longitude,
          best: a.option === best,
          label: `${a.option} · ${a.period[0]}–${a.period[1]}`,
        })),
        plates: r.tectonics.searched_plates,
      });
    } catch (e) {
      if (c.signal.aborted) return;
      setError((e as Error).message);
      setPhase("error");
    } finally {
      setForcing(false);
    }
  };

  const s1 = result?.system1;
  const s1ok = s1?.status === "ok" ? s1 : null;
  const evaluation = s1ok?.evaluation ?? status?.system1.evaluation ?? null;

  return (
    <section className="ai-panel glass-panel" aria-label="Analog intelligence">
      <header className="ai-header">
        <span className="ai-mark">
          <BrainCircuit size={20} />
        </span>
        <div>
          <span className="trends-eyebrow">ON-DEMAND AI · TECTONIC ANALOGS</span>
          <h2>Analog intelligence</h2>
          <p>
            {location.name} ·{" "}
            {formatCoordinates(location.latitude, location.longitude)}
          </p>
        </div>
        <button aria-label="Close analog intelligence" onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      <div className="ai-body">
        {phase === "idle" && (
          <div className="ai-idle">
            <p>
              The AI layer stays off until you ask. When activated it compares this
              location&apos;s last 15 years of trends with{" "}
              <strong>historically significant trend episodes</strong> on its
              tectonic plate and the plates across any boundary within 600&nbsp;km.
            </p>
            <ol>
              <li>
                <b>Retrieve.</b> NASA POWER 1981–
                {status?.library?.end_year ?? "…"} record → 9 locally calibrated
                indices → plate-scoped analog search
                {status?.library
                  ? ` (${status.library.episodes.toLocaleString()} episodes, ${status.library.anchors} sites)`
                  : ""}
                .
              </li>
              <li>
                <b>System 1 · forecast odds.</b> A linear model learned from what really
                happened next at NASA POWER sites gives odds that temperature, hot days,
                heavy rain and dry spells fall, hold or rise over 5 years. It was tested on
                later years at unseen sites with no overlap; only skill-verified answers are
                shown as forecasts.
              </li>
              <li>
                <b>Resemblance gate · Laya.</b> Scores how much past trend changes resemble
                today&apos;s (resemblance, not a probability). At 70% or more the cloud model
                is called.
              </li>
              <li>
                <b>System 2 · cloud model.</b> Explains the skill-verified odds in plain
                words; past matches are context only, never a source of new predictions.
              </li>
            </ol>
            {status && !status.system1.available && (
              <p className="ai-warn">
                <AlertTriangle size={13} /> {status.system1.reason} Retrieval
                still works; System-1 scores will be missing.
              </p>
            )}
            {!status?.library && status && (
              <p className="ai-warn">
                <AlertTriangle size={13} /> Analog library not built yet.
              </p>
            )}
            <button className="ai-activate" onClick={() => run("auto")}>
              <Power size={15} /> Activate analog AI
            </button>
            <small>
              System 1: {status?.system1.laya_needed === false ? "linear model (Laya scored lower)" : `Laya ${status?.system1.weights ?? ""} weights`} · System 2:{" "}
              {status ? (
                status.system2.cloud ? (
                  <span className="ai-cloud-tag">
                    <Cloud size={11} /> {status.system2.model}
                  </span>
                ) : (
                  <>
                    no cloud model yet{" "}
                    {onKeys && (
                      <button className="ai-link" onClick={onKeys}>
                        add a Claude key
                      </button>
                    )}
                  </>
                )
              ) : (
                "…"
              )}
            </small>
          </div>
        )}

        {(phase === "warming" || phase === "analyzing") && (
          <Pipeline key={phase} warming={phase === "warming"} forcing={forcing} />
        )}

        {phase === "error" && (
          <div className="ai-error">
            <AlertTriangle size={16} />
            <p>{error}</p>
            <button onClick={() => run("auto")}>
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        )}

        {result && phase !== "idle" && (
          <div className="ai-result" key={result.checked_at} aria-busy={phase !== "done"}>
            <div className="ai-plate">
              <Layers3 size={14} />
              <span>
                <strong>{result.tectonics.plate_name} plate</strong>
                {result.tectonics.nearest_boundary && (
                  <small>
                    {Math.round(result.tectonics.nearest_boundary.distance_km)} km from
                    the {result.tectonics.nearest_boundary.between.join("–")}{" "}
                    {result.tectonics.nearest_boundary.type}
                  </small>
                )}
              </span>
              <span className="ai-chips">
                {result.tectonics.searched_plates.map((p, i) => (
                  <i key={p} className={i === 0 ? "home" : ""}>
                    {p}
                  </i>
                ))}
              </span>
            </div>

            {result.similarity?.status === "ok" && (
              <SimilarityMeter sim={result.similarity} />
            )}

            <div
              className={`ai-escalation ${result.escalation.escalate ? "hot" : "calm"}`}
            >
              {result.escalation.escalate ? (
                <AlertTriangle size={16} />
              ) : (
                <CheckCircle2 size={16} />
              )}
              <div>
                <strong>
                  {result.escalation.gate === "laya_similarity"
                    ? result.escalation.escalate
                      ? "Close historical match: the larger model explains the verified outlook"
                      : "No close historical match: no automatic outlook"
                    : result.escalation.escalate
                      ? "Significant change: AI suggestion generated"
                      : "Within the historical range of this tectonic neighbourhood"}
                </strong>
                {result.escalation.escalate || result.escalation.gate === "laya_similarity" ? (
                  <ul>
                    {[...result.escalation.reasons, ...(result.escalation.notes ?? [])].map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : (
                  <small>
                    No outlook was generated automatically (escalation needs ≥
                    {result.escalation.threshold_percentile}th percentile, ≥4
                    significant indices, or a skill-verified System-1 rise of hot days,
                    heavy rain or dry spells well above the usual rate).
                  </small>
                )}
              </div>
            </div>

            <div className="ai-stats">
              <div>
                <span>Plate-history percentile</span>
                <strong>
                  {result.percentile == null
                    ? "—"
                    : result.percentile >= 99
                      ? Math.min(result.percentile, 99.9).toFixed(1)
                      : `${Math.round(result.percentile)}`}
                  <small>th</small>
                </strong>
                <small>of {result.pool_size.toLocaleString()} episodes</small>
              </div>
              <div>
                <span>Significant indices</span>
                <strong>
                  {result.signature.n_significant}
                  <small>/9</small>
                </strong>
                <small>
                  {result.window[0]}–{result.window[1]} · Mann–Kendall p&lt;0.05
                </small>
              </div>
              <div>
                <span>How unusual</span>
                <strong className="ai-stat-text">{result.rule_severity.label}</strong>
                <small>rule: percentile + significant indices</small>
              </div>
            </div>

            {result.outlook?.status === "needs_cloud" && (
              <section className="ai-cloud-cta">
                <span className="ai-cloud-icon">
                  <Cloud size={18} />
                </span>
                <div>
                  <strong>Ready for the cloud model</strong>
                  <p>
                    The match is close enough for the larger model to explain the skill-verified outlook,
                    but no cloud model is set up. Add a Claude key (or another cloud API) in API keys, then
                    re-run. Only the computed trends and past-match summaries are sent.
                  </p>
                  <div className="ai-cloud-actions">
                    {onKeys && (
                      <button className="ai-activate" onClick={onKeys}>
                        <KeyRound size={14} /> Add a cloud key
                      </button>
                    )}
                    <button className="ai-secondary" disabled={phase !== "done"} onClick={() => run("auto")}>
                      <RefreshCw size={13} /> Re-run
                    </button>
                    <button
                      className="ai-secondary"
                      disabled={phase !== "done"}
                      onClick={() => run("force")}
                      title={`Uses ${result.outlook.model} on this computer, a much smaller model`}
                    >
                      <Sparkles size={13} /> Use the small local model
                    </button>
                  </div>
                </div>
              </section>
            )}
            {result.outlook && result.outlook.status !== "needs_cloud" && (
              <section className={`ai-outlook ${result.outlook.cloud ? "cloud" : ""}`}>
                <h3>
                  <Sparkles size={14} /> What might happen next{" "}
                  <span>
                    {result.outlook.cloud ? (
                      <span className="ai-cloud-tag">
                        <Cloud size={11} /> {result.outlook.model}
                      </span>
                    ) : (
                      `${result.outlook.model} (small local model)`
                    )}{" "}
                    · AI-generated text (SI), check against the numbers
                  </span>
                </h3>
                {result.outlook.status === "ok" && result.outlook.sections &&
                Object.keys(result.outlook.sections).length >= 2 ? (
                  <dl>
                    {(
                      [
                        ["likely_next", "Likely next"],
                        ["hazards", "Hazards to watch"],
                        ["confidence", "Confidence"],
                        ["monitor", "Monitor"],
                      ] as const
                    ).map(([k, label]) =>
                      result.outlook!.sections![k] ? (
                        <div key={k}>
                          <dt>{label}</dt>
                          <dd>{result.outlook!.sections![k]}</dd>
                        </div>
                      ) : null,
                    )}
                  </dl>
                ) : result.outlook.status === "ok" ? (
                  <p className="ai-llm-text">{result.outlook.text}</p>
                ) : (
                  <p className="ai-warn">
                    <AlertTriangle size={13} /> LLM unavailable ({result.outlook.reason}
                    ). Showing the analog evidence only.
                  </p>
                )}
                {!!result.outlook.removed_unsupported_sentences && (
                  <p className="ai-guard">
                    {result.outlook.removed_unsupported_sentences} generated
                    sentence
                    {result.outlook.removed_unsupported_sentences > 1 ? "s" : ""}{" "}
                    removed: cited numbers not present in the evidence.
                  </p>
                )}
                <h4>Analog evidence (deterministic)</h4>
                <ul>
                  {result.outlook.grounded.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </section>
            )}
            {!result.outlook && (
              <button
                className="ai-secondary"
                disabled={phase !== "done"}
                onClick={() => run("force")}
              >
                <Sparkles size={13} /> Generate an outlook anyway
              </button>
            )}

            {s1ok && (
              <section>
                <h3>
                  Next {s1ok.horizon_years} years vs the last {s1ok.horizon_years}{" "}
                  <span>System 1 · calibrated odds · best verified model per question</span>
                </h3>
                <p className="ai-legend ai-out-legend">
                  <i className="neg" /> fall <i className="mid" /> steady <i className="pos" /> rise · change of more
                  than half a typical year-to-year swing
                </p>
                {Object.entries(s1ok.outlook).map(([k, o]) => (
                  <OutlookRow key={k} o={o} />
                ))}
              </section>
            )}

            <section>
              <h3>
                Current trend signature{" "}
                <span>σ per decade, local interannual σ · * significant</span>
              </h3>
              <div className="ai-zlist">
                {result.signature.trends.map((t, i) => (
                  <ZBar key={t.index} row={t} i={i} />
                ))}
              </div>
              <p className="ai-legend">
                <i className="neg" /> decreasing <i className="pos" /> increasing ·
                rule regime: {REGIME_SHORT[result.regime_rule.id]}
              </p>
            </section>

            <section>
              <h3>
                {result.similarity?.status === "ok" ? "Closest past matches" : "Historical examples"}{" "}
                <span>
                  {result.similarity?.status === "ok"
                    ? `Laya's 5 most similar of the ${result.similarity.pool} nearest on these plates · context, not a forecast`
                    : "similar past episodes on these plates · not a forecast"}
                </span>
              </h3>
              {result.analogs.length === 0 && (
                <p className="ai-warn">
                  No significant historical episodes on these plates.
                </p>
              )}
              <div className="ai-analogs">
                {result.analogs.map((a, idx) => {
                  const best = a.option === "A";
                  const next = Object.entries(a.outcome.shift)
                    .filter(([, v]) => Math.abs(v) >= 0.5)
                    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
                    .slice(0, 3);
                  return (
                    <button
                      key={a.option}
                      className={`ai-analog ${best ? "best" : ""}`}
                      style={{ "--i": idx } as CSSProperties}
                      onClick={() => onFly(a.latitude, a.longitude)}
                      title="Fly to this analog site"
                    >
                      <span className="ai-analog-letter">{a.option}</span>
                      <span className="ai-analog-main">
                        <strong>
                          {a.plate} · {a.period[0]}–{a.period[1]}
                        </strong>
                        <small>
                          {REGIME_SHORT[a.regime]} ·{" "}
                          {formatCoordinates(a.latitude, a.longitude)}
                        </small>
                        <span className="ai-next">
                          next {a.outcome.years[0]}–{a.outcome.years[1]}:{" "}
                          {next.length
                            ? next.map(([k, v]) => (
                                <i key={k} className={v > 0 ? "pos" : "neg"}>
                                  {SHORT[k]} {signed(v)}σ
                                </i>
                              ))
                            : <i>little change</i>}
                        </span>
                      </span>
                      {a.laya_similarity != null ? (
                        <span
                          className="ai-analog-score"
                          title={`Laya resemblance score (not a probability). Trend changes that match: ${(a.matching_indices ?? []).map((k) => SHORT[k]).join(", ") || "none"}`}
                        >
                          <strong>{Math.round(a.laya_similarity * 100)}%</strong>
                          <small>
                            resemblance · {a.matching_indices?.length ?? 0}/9 alike
                          </small>
                        </span>
                      ) : (
                        <span className="ai-analog-score">
                          <strong>{a.similarity.toFixed(2)}</strong>
                          <small>similarity</small>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {s1 && s1.status === "unavailable" && (
              <p className="ai-warn">
                <AlertTriangle size={13} /> System 1 unavailable: {s1.reason}
              </p>
            )}

            <section className="ai-model">
              <h3>Model card</h3>
              {evaluation?.test ? (
                <table>
                  <thead>
                    <tr>
                      <th>Next-5-year RPSS</th>
                      <th>Linear model</th>
                      <th>Laya base</th>
                      <th>Laya fine-tuned</th>
                      <th>Served</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(evaluation.test).map(([k, t]) => (
                      <tr key={k}>
                        <td>{evaluation.targets[k]}</td>
                        <td>
                          {t.logistic.rpss.toFixed(2)}{" "}
                          <small>
                            [{t.logistic.rpss_ci[0].toFixed(2)}, {t.logistic.rpss_ci[1].toFixed(2)}]
                          </small>
                        </td>
                        <td>{t.laya_zero_shot ? t.laya_zero_shot.rpss.toFixed(2) : <small>not re-run</small>}</td>
                        <td>
                          {t.laya ? (
                            <>
                              {t.laya.rpss.toFixed(2)}{" "}
                              <small>
                                [{t.laya.rpss_ci[0].toFixed(2)}, {t.laya.rpss_ci[1].toFixed(2)}]
                              </small>
                            </>
                          ) : (
                            <small title="Evaluated only on the earlier overlapping split; not re-evaluated on the purged split, so not served.">not re-evaluated</small>
                          )}
                        </td>
                        <td>
                          <strong>{(t.served ?? t.logistic).rpss.toFixed(2)}</strong>{" "}
                          <small>
                            {t.served_model === "logistic" ? "linear" : "Laya"}
                            {t.skilful ? " ✓" : ""}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="ai-warn">
                  <AlertTriangle size={13} /> Predictive Laya weights are missing. Run the
                  fine-tuning script (backend.ai.train_laya).
                </p>
              )}
              <small>
                RPSS = ranked probability skill score against the climatology baseline (0 = no
                better than always predicting the usual odds, 1 = perfect). Tested on{" "}
                {evaluation?.split?.test ?? "held-out sites and later years"}; [ ] = 95% interval
                from resampling whole sites; {evaluation?.rows?.test ?? "?"} test forecasts. The split
                is horizon-purged: training outcomes end before the first calibration forecast and
                calibration outcomes before the first test forecast ({evaluation?.split?.train};{" "}
                {evaluation?.split?.calibration}). ✓ = test skill verified, so it is shown as a
                forecast.
              </small>
              {result.similarity?.status === "ok" && (() => {
                const e = result.similarity.evaluation;
                const g = e.gate_report;
                const rows: [string, typeof e.test.laya][] = [
                  ["Retrieval score (baseline)", e.test.retrieval_baseline],
                  ["Laya base", e.test.laya_zero_shot],
                  ["Laya fine-tuned", e.test.laya],
                ];
                const open = g.outcome_rmse_sigma.gate_open;
                return (
                  <>
                    <table>
                      <thead>
                        <tr>
                          <th>Similarity confidence</th>
                          <th>Mean error</th>
                          <th>Correlation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(([name, m]) => (
                          <tr key={name}>
                            <td>{name}</td>
                            <td>{Math.round(m.mae * 100)} pts</td>
                            <td>{m.pearson_r.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <small>
                      Against the true share of matching trend changes on {e.test.laya.n.toLocaleString()} pairs at held-out
                      sites. The {Math.round(e.gate * 100)}% gate opened for {pct(g.gate_open_rate)} of {g.queries} test
                      sites and agreed with the true share {pct(g.gate_agreement)} of the time.
                      {open.n > 0 && open.analogs != null && open.usual_change != null
                        ? ` When open, the matched episodes' next 5 years were off by ${open.analogs.toFixed(2)}σ versus ${open.usual_change.toFixed(2)}σ for the usual change (n = ${open.n}).`
                        : ""}
                    </small>
                  </>
                );
              })()}
            </section>

            <section className="ai-limits">
              <h3>Limitations</h3>
              <ul>
                {result.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p>
                {result.tectonics.rule} {result.tectonics.source}.{" "}
                <a href={result.source_url} target="_blank" rel="noreferrer">
                  NASA POWER source <ExternalLink size={10} />
                </a>
              </p>
            </section>

            <button
              className="ai-secondary"
              disabled={phase !== "done"}
              onClick={() => run("auto")}
            >
              <RefreshCw size={13} /> Re-run
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
