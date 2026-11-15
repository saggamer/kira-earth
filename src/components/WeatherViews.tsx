import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  Globe2,
  Map as MapIcon,
  Wind,
  Cloud,
  X,
  ArrowUpRight,
  Play,
  Pause,
  RefreshCw,
  Layers,
  Info,
  ChevronDown,
} from "lucide-react";
import { useEarth } from "../lib/store";
import { validateWeather } from "../lib/dataIntegrity";
import { DataSources } from "./DataSources";
import {
  weatherVariables,
  sampleField,
  sampleWeather,
  type WeatherField,
  type WeatherVariable,
} from "../lib/weather";

export function WeatherViews({
  onActivate,
  onClouds,
  onSources,
  onHistory,
  extraNav,
}: {
  onActivate: () => void;
  onClouds: () => void;
  onSources: () => void;
  onHistory: () => void;
  /** Extra buttons rendered at the start of the top-right navigation (forecast, API keys). */
  extraNav?: React.ReactNode;
}) {
  const {
    sceneMode,
    viewsOpen,
    weatherActive,
    weatherData,
    weatherVariable,
    windFlow,
    isobars,
    flowSpeed,
    weatherLead,
    weatherLoading,
    weatherError,
    location,
    selected,
    set,
  } = useEarth();
  const [minimized, setMinimized] = useState(false);
  const [reload, setReload] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [followLatest, setFollowLatest] = useState(true);
  const [latestChecked, setLatestChecked] = useState<string | null>(null);
  const forceLatest = useRef(false);
  const run = useRef<string | null>(null);
  const cache = useRef(new Map<string, WeatherField>());
  useEffect(() => {
    if (!weatherActive) {
      run.current = null;
      return;
    }
    const abort = new AbortController();
    const key = `${run.current || "latest"}-${weatherLead}`;
    const cached = run.current ? cache.current.get(key) : null;
    if (cached) {
      set({ weatherData: cached, weatherLoading: false, weatherError: "" });
      return;
    }
    set({ weatherLoading: true, weatherError: "" });
    const params = new URLSearchParams({ lead: String(weatherLead) });
    const requestedRun = run.current;
    if (requestedRun) params.set("run", requestedRun);
    else if (forceLatest.current) params.set("refresh", "true");
    forceLatest.current = false;
    fetch(`/api/weather?${params}`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) {
          const e = await response.json().catch(() => ({}));
          throw new Error(e.detail || "ECMWF data could not be retrieved.");
        }
        return validateWeather(
          await response.json(),
          weatherLead,
          requestedRun,
        );
      })
      .then((data) => {
        if (abort.signal.aborted) return;
        run.current = data.initialization
          .slice(0, 13)
          .replaceAll("-", "")
          .replace("T", "");
        cache.current.set(`${run.current}-${weatherLead}`, data);
        if (data.latest_checked_at) setLatestChecked(data.latest_checked_at);
        set({ weatherData: data, weatherLoading: false, weatherError: "" });
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          set({
            weatherError: e.message,
            weatherLoading: false,
          });
          setPlaying(false);
        }
      });
    return () => abort.abort();
  }, [weatherActive, weatherLead, reload, set]);
  useEffect(() => {
    if (!weatherActive || !followLatest || playing) return;
    const refresh = () => {
      if (
        document.visibilityState !== "visible" ||
        useEarth.getState().weatherLoading
      )
        return;
      run.current = null;
      setReload((n) => n + 1);
    };
    const timer = setInterval(refresh, 300000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [weatherActive, followLatest, playing]);
  const refreshLatest = () => {
    setPlaying(false);
    run.current = null;
    forceLatest.current = true;
    setReload((n) => n + 1);
  };
  useEffect(() => {
    if (!playing || !weatherActive || weatherLoading || weatherError) return;
    const timer = setTimeout(() => {
      if (weatherLead >= 72) {
        setPlaying(false);
        return;
      }
      set({ weatherLead: weatherLead + 6 });
    }, 2200);
    return () => clearTimeout(timer);
  }, [playing, weatherActive, weatherLoading, weatherError, weatherLead, set]);
  const atmosphere = () => {
    onActivate();
    set({
      weatherActive: true,
      weatherVariable: "wind",
      windFlow: true,
      isobars: true,
      layer: "natural",
      playing: false,
      viewsOpen: false,
    });
  };
  const closeWeather = () => {
    set({ weatherActive: false, weatherError: "", weatherLoading: false });
    setPlaying(false);
  };
  const utc = (value: string) =>
    new Date(value).toLocaleString("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " UTC";
  return (
    <>
      <nav className="view-navigation" aria-label="Map and atmospheric views">
        {extraNav}
        <button
          className="view-mode-button"
          aria-label={
            sceneMode === "3d"
              ? "Switch to 2D global map"
              : "Switch to 3D globe"
          }
          title={sceneMode === "3d" ? "Flatten the Earth" : "Return to globe"}
          onClick={() => set({ sceneMode: sceneMode === "3d" ? "2d" : "3d" })}
        >
          {sceneMode === "3d" ? <MapIcon size={15} /> : <Globe2 size={15} />}
          <span>{sceneMode === "3d" ? "2D" : "3D"}</span>
        </button>
        <button
          className={viewsOpen ? "active" : ""}
          aria-label="Open weather views"
          aria-expanded={viewsOpen}
          onClick={() => set({ viewsOpen: !viewsOpen })}
        >
          <Wind size={16} />
          <span>Views</span>
        </button>
      </nav>
      {viewsOpen && (
        <section
          className="weather-view-menu glass-panel"
          aria-label="Weather views"
        >
          <div className="popover-header">
            <span>A DIFFERENT PERSPECTIVE</span>
            <button
              aria-label="Close weather views"
              onClick={() => set({ viewsOpen: false })}
            >
              <X size={15} />
            </button>
          </div>
          <button
            className="weather-preset"
            onClick={() => {
              onActivate();
              closeWeather();
              set({ sceneMode: "3d", viewsOpen: false, layer: "natural" });
            }}
          >
            <span className="preset-orb earth-orb">
              <Globe2 size={21} />
            </span>
            <span>
              <strong>The living Earth</strong>
              <small>Explore our planet in three dimensions</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
          <button
            className="weather-preset"
            onClick={() => {
              closeWeather();
              set({ viewsOpen: false });
              onClouds();
            }}
          >
            <span className="preset-orb cloud-orb">
              <Cloud size={21} />
            </span>
            <span>
              <strong>Global cloud atlas</strong>
              <small>2D · NASA satellite true-color imagery</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
          <button className="weather-preset" onClick={atmosphere}>
            <span className="preset-orb wind-orb">
              <Wind size={22} />
            </span>
            <span>
              <strong>Atmospheric flow</strong>
              <small>ECMWF AIFS · wind, clouds & isobars</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
          <p className="view-menu-note">
            Satellite imagery and model forecasts are separate sources. Open a
            view to inspect its timestamp.
          </p>
        </section>
      )}
      {weatherActive && (
        <section
          className={`weather-console glass-panel ${minimized ? "is-minimized" : ""}`}
          aria-label="Atmospheric weather controls"
        >
          <div className="weather-console-heading">
            <span>
              <span className="dot" />
              {selected ? "LOCATION INTELLIGENCE" : "ATMOSPHERIC FLOW"}
            </span>
            <button
              aria-label={
                minimized
                  ? "Expand weather controls"
                  : "Minimize weather controls"
              }
              onClick={() => setMinimized(!minimized)}
            >
              <ChevronDown size={14} />
            </button>
            <button
              aria-label="Close atmospheric weather"
              onClick={closeWeather}
            >
              <X size={15} />
            </button>
          </div>
          {minimized && (
            <div className="weather-mini-meta">
              {weatherVariables[weatherVariable].name}
              {weatherError && (
                <span className="weather-stale">
                  Refresh unavailable · previous verified field
                </span>
              )}
              <span>
                {weatherData
                  ? utc(weatherData.valid_time)
                  : weatherLoading
                    ? "Loading verified forecast…"
                    : "Forecast unavailable"}
              </span>
            </div>
          )}
          {selected && (
            <DataSources
              active="weather"
              onHistory={onHistory}
              onWeather={() => {}}
            />
          )}
          <div className="forecast-source">
            <strong>ECMWF AIFS Single</strong>
            <span>WEATHER FORECAST</span>
          </div>
          <div
            className={`data-health ${weatherError ? "is-stale" : ""}`}
            role="status"
          >
            <span className="health-dot" />
            <div>
              <strong>
                {weatherLoading
                  ? "Checking forecast data…"
                  : weatherError
                    ? weatherData
                      ? "Previous verified forecast"
                      : "Connection unavailable"
                    : followLatest
                      ? "Following latest model run"
                      : "Model run pinned"}
              </strong>
              <small>
                {latestChecked
                  ? `Latest run checked ${utc(latestChecked)}`
                  : "Provider check pending"}
                {playing
                  ? " · paused during playback"
                  : " · checks every 5 min when following"}
              </small>
            </div>
          </div>
          {weatherError && (
            <div className="weather-unavailable">
              <Info size={15} />
              <p>{weatherError}</p>
              <button onClick={refreshLatest}>
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          )}
          {(!weatherError || weatherData) && (
            <>
              {weatherData && selected && (
                <div className="forecast-point">
                  <strong>{location.name}</strong>
                  <p className="point-valid-time">
                    Valid {utc(weatherData.valid_time)} · +
                    {weatherData.lead_hours}h forecast
                  </p>
                  <div>
                    {(
                      [
                        "wind",
                        "temperature",
                        "pressure",
                        "cloud",
                        "precipitation",
                      ] as WeatherVariable[]
                    ).map((key) => {
                      const value = sampleWeather(
                        weatherData,
                        key,
                        location.longitude,
                        location.latitude,
                      );
                      return (
                        <span key={key}>
                          <small>{weatherVariables[key].name}</small>
                          <b>
                            {value == null
                              ? "Unavailable"
                              : value.toFixed(key === "cloud" ? 0 : 1) +
                                " " +
                                weatherVariables[key].unit}
                          </b>
                        </span>
                      );
                    })}
                  </div>
                  {(() => {
                    const u = sampleField(
                        weatherData,
                        "u",
                        location.longitude,
                        location.latitude,
                      ),
                      v = sampleField(
                        weatherData,
                        "v",
                        location.longitude,
                        location.latitude,
                      );
                    return u != null && v != null && Math.hypot(u, v) > 0.1 ? (
                      <p>
                        Wind from{" "}
                        {(
                          ((Math.atan2(-u, -v) * 180) / Math.PI + 360) %
                          360
                        ).toFixed(0)}
                        ° · interpolated display-grid sample
                      </p>
                    ) : (
                      <p>
                        Interpolated display-grid sample; not a station
                        observation.
                      </p>
                    );
                  })()}
                </div>
              )}
              <label className="weather-field-select">
                <Layers size={14} />
                <select
                  aria-label="Atmospheric weather variable"
                  value={weatherVariable}
                  onChange={(e) =>
                    set({ weatherVariable: e.target.value as WeatherVariable })
                  }
                >
                  {Object.entries(weatherVariables).map(([key, config]) => (
                    <option key={key} value={key}>
                      {config.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </label>
              <div
                className="weather-scale"
                style={{
                  background: `linear-gradient(to right,${weatherVariables[weatherVariable].colors.join(",")})`,
                }}
              />
              <div className="weather-scale-labels">
                <span>{weatherVariables[weatherVariable].range[0]}</span>
                <span>{weatherVariables[weatherVariable].unit}</span>
                <span>
                  {weatherVariables[weatherVariable].range[1]}
                  {weatherVariable === "cloud" ? "" : "+"}
                </span>
              </div>
              <div className="weather-switches">
                <button
                  role="switch"
                  aria-checked={windFlow}
                  onClick={() => set({ windFlow: !windFlow })}
                >
                  <Wind size={13} />
                  <span>Wind flow</span>
                  <span className={`toggle ${windFlow ? "on" : ""}`}>
                    <i />
                  </span>
                </button>
                <button
                  role="switch"
                  aria-checked={isobars}
                  onClick={() => set({ isobars: !isobars })}
                >
                  <Layers size={13} />
                  <span>Isobars · 4 hPa</span>
                  <span className={`toggle ${isobars ? "on" : ""}`}>
                    <i />
                  </span>
                </button>
              </div>
              {weatherLoading && (
                <div className="forecast-loading">
                  <span className="loader" />{" "}
                  {weatherData
                    ? `Loading +${weatherLead}h; current field remains visible`
                    : "Retrieving and decoding real ECMWF fields…"}
                </div>
              )}
              {weatherData && (
                <div className="forecast-times">
                  <div>
                    <span>INITIALIZED</span>
                    <strong>{utc(weatherData.initialization)}</strong>
                  </div>
                  <div>
                    <span>DISPLAYED · +{weatherData.lead_hours}h</span>
                    <strong>{utc(weatherData.valid_time)}</strong>
                  </div>
                  <small>
                    Native {weatherData.native_resolution} · displayed at 1°
                    <br />
                    Particles follow modeled 10 m wind, visually accelerated.
                  </small>
                </div>
              )}
              <div className="forecast-playback">
                <button
                  aria-label={
                    playing ? "Pause forecast playback" : "Play forecast steps"
                  }
                  disabled={!weatherData || weatherLoading}
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? (
                    <Pause size={13} />
                  ) : (
                    <Play size={13} fill="currentColor" />
                  )}
                </button>
                <input
                  aria-label="Forecast lead hours"
                  type="range"
                  min="0"
                  max="72"
                  step="6"
                  value={weatherLead}
                  onChange={(e) => {
                    setPlaying(false);
                    set({ weatherLead: +e.target.value });
                  }}
                />
                <span title="Requested forecast lead">+{weatherLead}h</span>
              </div>
              <button
                className="follow-latest"
                role="switch"
                aria-checked={followLatest}
                onClick={() => {
                  setFollowLatest(!followLatest);
                  if (!followLatest) refreshLatest();
                }}
              >
                <span className={`toggle ${followLatest ? "on" : ""}`}>
                  <i />
                </span>
                <span>Follow latest available run</span>
                <small>5 min</small>
              </button>
              <div className="forecast-speed">
                <label>
                  Flow speed
                  <select
                    aria-label="Wind visualization speed"
                    value={flowSpeed}
                    onChange={(e) => set({ flowSpeed: +e.target.value })}
                  >
                    <option value=".5">0.5×</option>
                    <option value="1">1×</option>
                    <option value="2">2×</option>
                  </select>
                </label>
                <button
                  onClick={refreshLatest}
                  title="Refresh latest available model run"
                  aria-label="Refresh weather run"
                  disabled={weatherLoading}
                >
                  <RefreshCw size={12} />
                </button>
                <button onClick={onSources}>
                  Sources <ArrowUpRight size={11} />
                </button>
              </div>
            </>
          )}
          {weatherData && (
            <details className="weather-provenance">
              <summary>Forecast provenance</summary>
              <p>{weatherData.provenance.processing}</p>
              <p>{weatherData.provenance.license}</p>
              {weatherData.provenance.source_urls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  Original ECMWF GRIB2 <ArrowUpRight size={10} />
                </a>
              ))}
            </details>
          )}
        </section>
      )}
    </>
  );
}
