import { useEffect } from "react";
import {
  CalendarDays,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useEarth } from "../lib/store";
import { available, type Availability } from "../lib/layers";
import { layers } from "../lib/layers";
import { Button } from "./ui/button";
const day = 86400000;
export function Timeline({ catalog }: { catalog: Availability | null }) {
  const { date, start, end, playing, speed, layer, mode, set } = useEarth();
  const intervals = catalog?.[layers[layer].id]?.intervals ?? [];
  const first = intervals[0]?.split("/")[0]?.slice(0, 10);
  const last = intervals.at(-1)?.split("/")[1]?.slice(0, 10);
  const min = first ? Date.parse(first + "T00:00:00Z") : Date.UTC(start, 0, 1),
    max = last
      ? Math.min(Date.parse(last + "T00:00:00Z"), Date.now())
      : Date.UTC(end, 11, 31),
    current = Date.parse(date + "T00:00:00Z");
  const move = (direction: number) => {
    let next = current + direction * day;
    while (
      next >= min &&
      next <= max &&
      !available(new Date(next).toISOString().slice(0, 10), layer, catalog)
    )
      next += direction * day;
    if (next < min || next > max) {
      set({ playing: false });
      return;
    }
    set({ date: new Date(next).toISOString().slice(0, 10) });
  };
  useEffect(() => {
    if (!playing || mode !== "historical") return;
    const timer = window.setInterval(() => move(1), 1400 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, date, start, end, layer, catalog, mode]);
  return (
    <section className="timeline" aria-label="Satellite imagery timeline">
      <div className="timeline-heading">
        <div>
          <span className="eyebrow">TIME EXPLORER</span>
          <span className="timeline-source">
            {layer === "natural"
              ? "Reference composite · not time varying"
              : "Daily satellite imagery"}
          </span>
        </div>
        <label className="timeline-date">
          <CalendarDays size={14} />
          <input
            aria-label="Imagery date"
            type="date"
            value={date}
            min={new Date(min).toISOString().slice(0, 10)}
            max={new Date(max).toISOString().slice(0, 10)}
            onChange={(e) =>
              e.target.value && set({ date: e.target.value, playing: false })
            }
          />
          <span>UTC</span>
        </label>
      </div>
      <div className="timeline-track">
        <div className="playback">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Jump to start"
            onClick={() =>
              set({
                date: new Date(min).toISOString().slice(0, 10),
                playing: false,
              })
            }
          >
            <SkipBack size={14} />
          </Button>
          <Button
            className="play-button"
            size="icon"
            aria-label={playing ? "Pause animation" : "Play daily imagery"}
            disabled={layer === "natural" || mode === "forecast"}
            onClick={() => set({ playing: !playing })}
          >
            {playing ? (
              <Pause size={15} />
            ) : (
              <Play size={15} fill="currentColor" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Jump to end"
            onClick={() =>
              set({
                date: new Date(max).toISOString().slice(0, 10),
                playing: false,
              })
            }
          >
            <SkipForward size={14} />
          </Button>
        </div>
        <div className="scrubber">
          <input
            aria-label="Selected imagery day"
            type="range"
            min={min}
            max={max}
            step={day}
            value={Math.max(min, Math.min(max, current))}
            onChange={(e) =>
              set({
                date: new Date(+e.target.value).toISOString().slice(0, 10),
                playing: false,
              })
            }
          />
          <div className="year-ticks">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>
                {new Date(min + ((max - min) * i) / 6).getUTCFullYear()}
              </span>
            ))}
          </div>
        </div>
        <div className="timeline-step">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous available day"
            onClick={() => move(-1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next available day"
            onClick={() => move(1)}
          >
            <ChevronRight size={16} />
          </Button>
          <select
            aria-label="Animation speed"
            value={speed}
            onChange={(e) => set({ speed: +e.target.value })}
          >
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
        </div>
      </div>
    </section>
  );
}
