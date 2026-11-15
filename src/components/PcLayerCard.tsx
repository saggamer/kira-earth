import { useEffect, useState } from "react";
import { Database, ExternalLink, Pause, Play, X } from "lucide-react";
import { LANDCOVER_CLASSES, type PcKind, type PcTiles } from "../lib/pc";

/** Legend + time control for a Planetary Computer layer drawn on the globe. */
export function PcLayerCard({
  kind,
  year,
  tiles,
  error,
  onYear,
  onClose,
}: {
  kind: PcKind;
  year: number | null;
  tiles: PcTiles | null;
  error: string;
  onYear: (y: number) => void;
  onClose: () => void;
}) {
  const years = tiles?.years ?? null;
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || !years) return;
    const id = window.setInterval(() => {
      const i = years.indexOf(year ?? years[0]);
      if (i >= years.length - 1) {
        setPlaying(false);
        return;
      }
      onYear(years[i + 1]);
    }, 1800);
    return () => window.clearInterval(id);
  }, [playing, year, years, onYear]);
  return (
    <aside className="pc-card glass-panel" aria-label="Planetary Computer layer">
      <header>
        <span className="pc-mark">
          <Database size={15} />
        </span>
        <div>
          <span className="trends-eyebrow">MICROSOFT PLANETARY COMPUTER</span>
          <strong>{tiles?.name ?? "Loading layer…"}</strong>
        </div>
        <button aria-label="Hide Planetary Computer layer" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      {error && <p className="pc-error">{error}</p>}
      {years && (
        <div className="pc-years">
          <button
            className="pc-play"
            aria-label={playing ? "Pause year animation" : "Play years"}
            onClick={() => {
              if (!playing && year === years[years.length - 1]) onYear(years[0]);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <div className="pc-year-track" role="radiogroup" aria-label="Year">
            {years.map((y) => (
              <button key={y} role="radio" aria-checked={y === year} className={y === year ? "on" : ""} onClick={() => onYear(y)}>
                {String(y).slice(2)}
              </button>
            ))}
          </div>
          <b className="pc-year">{year}</b>
        </div>
      )}
      {kind === "landcover" && (
        <ul className="pc-classes">
          {LANDCOVER_CLASSES.map((c) => (
            <li key={c.label}>
              <i style={{ background: c.color }} /> {c.label}
            </li>
          ))}
        </ul>
      )}
      {kind === "water-change" && (
        <div className="pc-ramp">
          <i style={{ background: "linear-gradient(90deg, #ff0000, #000000, #00ff00)" }} />
          <span>
            <b>water lost</b> <em>no change</em> <b>water gained</b>
          </span>
          <small>Change in how often water is present, 1984–1999 vs 2000–2020 (−100% to +100%).</small>
        </div>
      )}
      {kind === "water-occurrence" && (
        <div className="pc-ramp">
          <i style={{ background: "linear-gradient(90deg, #ffffff, #bf7fbf, #0000ff)" }} />
          <span>
            <b>rarely</b> <em>sometimes</em> <b>always water</b>
          </span>
          <small>Share of months with surface water, March 1984 – December 2020.</small>
        </div>
      )}
      <p className="pc-note">
        {tiles ? `${tiles.resolution} · ` : ""}Detail appears as you zoom in (country scale or closer).{" "}
        {tiles && (
          <a href={tiles.catalog} target="_blank" rel="noreferrer">
            Dataset <ExternalLink size={10} />
          </a>
        )}
      </p>
      {tiles && <p className="pc-attr">{tiles.attribution}</p>}
    </aside>
  );
}
