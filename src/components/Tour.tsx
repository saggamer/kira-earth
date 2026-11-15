import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Presentation, X } from "lucide-react";

export type TourStep = {
  /** Which of the challenge's questions this step answers. */
  question: string;
  title: string;
  body: string;
  run: () => void;
};

/** Guided walkthrough for demos: each step drives the app (selects a place, opens a view) and explains it. */
export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = steps[i];
  useEffect(() => {
    step.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, select, textarea")) return;
      if (e.key === "ArrowRight") setI((n) => Math.min(steps.length - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [steps.length, onClose]);
  return (
    <aside className="tour-card glass-panel" aria-label="Guided tour" aria-live="polite">
      <div className="tour-progress" aria-hidden>
        {steps.map((_, n) => (
          <i key={n} className={n < i ? "done" : n === i ? "now" : ""} onClick={() => setI(n)} />
        ))}
      </div>
      <header>
        <span className="tour-mark">
          <Presentation size={15} />
        </span>
        <span className="tour-q">{step.question}</span>
        <span className="tour-n">
          {i + 1}/{steps.length}
        </span>
        <button aria-label="End tour" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="tour-text" key={i}>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
      </div>
      <footer>
        <button disabled={i === 0} onClick={() => setI(i - 1)}>
          <ChevronLeft size={14} /> Back
        </button>
        {i < steps.length - 1 ? (
          <button className="primary" onClick={() => setI(i + 1)}>
            Next <ChevronRight size={14} />
          </button>
        ) : (
          <button className="primary" onClick={onClose}>
            Explore on your own
          </button>
        )}
      </footer>
    </aside>
  );
}
