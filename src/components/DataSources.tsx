import { History, Radio } from "lucide-react";

export function DataSources({
  active,
  onHistory,
  onWeather,
}: {
  active: "history" | "weather";
  onHistory: () => void;
  onWeather: () => void;
}) {
  return (
    <nav className="data-source-tabs" aria-label="Location data source">
      <button aria-pressed={active === "history"} onClick={onHistory}>
        <History size={14} />
        <span>
          Climate history<small>NASA POWER</small>
        </span>
      </button>
      <button aria-pressed={active === "weather"} onClick={onWeather}>
        <Radio size={14} />
        <span>
          Latest weather<small>ECMWF forecast</small>
        </span>
      </button>
    </nav>
  );
}
