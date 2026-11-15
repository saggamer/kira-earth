import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, ShieldCheck, Trash2, X, XCircle } from "lucide-react";
import { listKeys, removeKey, saveKey, testKey, type KeyStatus } from "../lib/forecast";

const KIND: Record<KeyStatus["kind"], string> = {
  forecast: "Forecast",
  hazard: "Hazard",
  llm: "AI model",
};

function KeyCard({ p, onChange }: { p: KeyStatus; onChange: (p: KeyStatus) => void }) {
  const [value, setValue] = useState("");
  const [fields, setFields] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(p.fields).map(([k, f]) => [k, f.value ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const hasFields = Object.keys(p.fields).length > 0;
  const fromEnv = p.source === "environment";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setResult(null);
    try {
      await fn();
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      const updated = await saveKey(p.id, value.trim() ? value.trim() : hasFields ? null : value.trim(), hasFields ? fields : {});
      setValue("");
      onChange(updated);
      setResult({ ok: true, message: "Saved on this computer." });
    });

  return (
    <li className={`key-card ${p.configured ? "on" : ""}`}>
      <div className="key-head">
        <span className={`key-dot ${p.configured ? "on" : ""}`} aria-hidden />
        <div>
          <b>{p.label}</b>
          <span className="key-kind">{KIND[p.kind]}</span>
        </div>
        <a href={p.docs} target="_blank" rel="noreferrer" title="Get a key">
          Get a key <ExternalLink size={11} />
        </a>
      </div>
      <p className="key-note">{p.note}</p>
      <p className="key-state">
        {p.configured ? (
          <>
            <CheckCircle2 size={12} /> Configured {p.masked ? <code>{p.masked}</code> : null}
            {fromEnv ? ` · from ${p.env} (environment variable)` : " · saved locally"}
          </>
        ) : (
          <>Not configured</>
        )}
      </p>
      {!fromEnv && (
        <form
          className="key-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {Object.entries(p.fields).map(([name, f]) => (
            <input
              key={name}
              aria-label={`${p.label} ${name}`}
              placeholder={f.label}
              value={fields[name] ?? ""}
              onChange={(e) => setFields((s) => ({ ...s, [name]: e.target.value }))}
              autoComplete="off"
              spellCheck={false}
            />
          ))}
          <input
            type="password"
            aria-label={`${p.label} API key`}
            placeholder={p.configured ? "Paste a new key to replace it" : p.id === "llm" ? "API key (optional for local servers)" : "Paste API key"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="key-actions">
            <button type="submit" disabled={busy || (!value.trim() && (p.id !== "llm" || !hasFields) && !p.configured)}>
              Save
            </button>
            <button
              type="button"
              disabled={busy || !p.configured}
              onClick={() =>
                run(async () => {
                  setResult(await testKey(p.id));
                })
              }
            >
              {busy ? "Working…" : "Test"}
            </button>
            {p.configured && (
              <button
                type="button"
                className="danger"
                aria-label={`Remove ${p.label} key`}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    onChange(await removeKey(p.id));
                    setResult({ ok: true, message: "Removed from this computer." });
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </form>
      )}
      {result && (
        <p className={`key-result ${result.ok ? "ok" : "bad"}`} role="status">
          {result.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {result.message}
        </p>
      )}
    </li>
  );
}

export function ApiKeysMenu({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [rows, setRows] = useState<KeyStatus[] | null>(null);
  const [storage, setStorage] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listKeys()
      .then((d) => {
        setRows(d.providers);
        setStorage(d.storage);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="key-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="key-menu glass-panel" role="dialog" aria-modal="true" aria-label="API keys">
        <header>
          <span className="ai-mark">
            <KeyRound size={18} />
          </span>
          <div>
            <span className="trends-eyebrow">SETTINGS</span>
            <h2>API keys</h2>
            <p>Optional. Open-Meteo forecasts, the ECMWF ensemble, air quality and US alerts work without any key.</p>
          </div>
          <button aria-label="Close API keys" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="key-body">
          {error && <p className="key-result bad">{error}</p>}
          {!rows && !error && (
            <p className="fc-loading">
              <span className="loader" /> Loading…
            </p>
          )}
          {rows && (
            <ul className="key-list">
              {rows.map((p) => (
                <KeyCard
                  key={p.id}
                  p={p}
                  onChange={(u) => {
                    setRows((r) => r?.map((x) => (x.id === u.id ? u : x)) ?? null);
                    onSaved?.();
                  }}
                />
              ))}
            </ul>
          )}
          <p className="key-privacy">
            <ShieldCheck size={13} /> {storage} Environment variables override saved keys.
          </p>
        </div>
      </section>
    </div>
  );
}
