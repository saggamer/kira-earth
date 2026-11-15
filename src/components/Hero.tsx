import { Activity, MapPin, Presentation, RotateCcw, Ruler, ShieldCheck, TrendingUp } from "lucide-react";
import type { Location } from "../lib/store";

/** Brand mark: an orbit with a rising trend line (same artwork as the favicon). */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset=".55" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#0b1020" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="url(#bm-g)" strokeWidth="4" />
      <path d="M14 40 L24 34 L31 37 L40 26 L50 22" fill="none" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="22" r="4" fill="#fbbf24" />
    </svg>
  );
}

export const QUICK_PLACES: (Location & { dot: string; why: string })[] = [
  { name: "Cairo", country: "Egypt", latitude: 30.0626, longitude: 31.2497, dot: "#fbbf24", why: "warming nights" },
  { name: "Aral Sea", country: "Kazakhstan / Uzbekistan", latitude: 45.0, longitude: 59.8, dot: "#fb7185", why: "shrinking sea" },
  { name: "Manaus", country: "Brazil", latitude: -3.119, longitude: -60.0217, dot: "#34d399", why: "Amazon" },
  { name: "Reykjavík", country: "Iceland", latitude: 64.1466, longitude: -21.9426, dot: "#38bdf8", why: "high latitude" },
  { name: "Coimbatore", country: "India", latitude: 11.0168, longitude: 76.9558, dot: "#c084fc", why: "monsoon" },
];

const QUESTIONS = [
  { icon: Activity, label: "What is changing?", q: "#fbbf24" },
  { icon: MapPin, label: "Where is it changing?", q: "#fb923c" },
  { icon: Ruler, label: "How much?", q: "#38bdf8" },
  { icon: ShieldCheck, label: "Is it significant?", q: "#4ade80" },
];

export function Hero({ onTour, onPlace, tourDone = false }: { onTour: () => void; onPlace: (p: Location) => void; tourDone?: boolean }) {
  return (
    <>
    <div className="hero-shade" aria-hidden />
    <section className="hero" aria-label="Introduction">
      <span className="hero-kicker">
        <i aria-hidden /> Space Apps Challenge 2026 · live NASA data
      </span>
      <h1>
        Find what is <em>changing</em> on Earth, and prove it.
      </h1>
      <p>
        Pick any place. The app tests eight NASA climate variables and 25 years of satellite observations with transparent statistics, then
        shows where, how much, and whether the change is significant.
      </p>
      <div className="hero-questions">
        {QUESTIONS.map(({ icon: Icon, label, q }) => (
          <span key={label} style={{ "--q": q } as React.CSSProperties}>
            <Icon size={14} /> {label}
          </span>
        ))}
      </div>
      <div className="hero-actions">
        {tourDone ? (
          <>
            {/* Tour already taken: lead with exploring, keep a quiet replay */}
            <button className="primary" onClick={() => onPlace(QUICK_PLACES[0])}>
              <TrendingUp size={16} /> Explore Cairo
            </button>
            <button className="replay" onClick={onTour}>
              <RotateCcw size={15} /> Explore tour again
            </button>
          </>
        ) : (
          <>
            <button className="primary" onClick={onTour}>
              <Presentation size={16} /> Take the 2-minute tour
            </button>
            <button onClick={() => onPlace(QUICK_PLACES[0])}>
              <TrendingUp size={16} /> Explore Cairo
            </button>
          </>
        )}
      </div>
      <div className="hero-places">
        <small>Or start somewhere</small>
        <div>
          {QUICK_PLACES.map((p) => (
            <button key={p.name} style={{ "--dot": p.dot } as React.CSSProperties} onClick={() => onPlace(p)} title={p.why}>
              <i aria-hidden /> {p.name}
            </button>
          ))}
        </div>
      </div>
    </section>
    </>
  );
}

const SOURCES = [
  { name: "NASA POWER", dot: "#fbbf24" },
  { name: "NASA MODIS", dot: "#34d399" },
  { name: "NASA GIBS", dot: "#fb7185" },
  { name: "Planetary Computer", dot: "#22d3ee", opt: true },
  { name: "ECMWF", dot: "#38bdf8", opt: true },
  { name: "WeatherNext 2", dot: "#c084fc" },
];

export function SourceRibbon() {
  return (
    <div className="source-ribbon" aria-label="Data sources">
      <b>Data</b>
      {SOURCES.map((s) => (
        <span key={s.name} className={s.opt ? "opt" : ""} style={{ "--dot": s.dot } as React.CSSProperties}>
          <i aria-hidden /> {s.name}
        </span>
      ))}
    </div>
  );
}
