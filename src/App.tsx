import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Search,
  ArrowUpRight,
  Layers,
  Thermometer,
  Droplets,
  ChevronDown,
  Check,
  Info,
  CalendarDays,
  Crosshair,
  X,
  ArrowRight,
  Command,
  MapPin,
  ChartNoAxesCombined,
  CornerDownLeft,
  EyeOff,
  CircleHelp,
  Calculator,
  BrainCircuit,
  Sprout,
  CloudSun,
  KeyRound,
  Activity,
  ArrowRightLeft,
  Presentation,
  RotateCcw,
} from "lucide-react";
import { Globe, type ViewTarget, type SwipeView } from "./components/Globe";
import { SwipePanel, SWIPE_PRESETS, presetTarget } from "./components/SwipePanel";
import { Tour, type TourStep } from "./components/Tour";
import { PcLayerCard } from "./components/PcLayerCard";
import { Hero, BrandMark, SourceRibbon } from "./components/Hero";
import { PC_MENU, pcTiles, type PcKind, type PcTiles } from "./lib/pc";
import { Timeline } from "./components/Timeline";
import { WeatherViews } from "./components/WeatherViews";
import { DataSources } from "./components/DataSources";
import { useHistoricalData } from "./lib/useHistoricalData";
import {
  InvestigationDialog,
  type InvestigationModal,
} from "./components/InvestigationDialog";
import {
  useEarth,
  places,
  variables,
  type Location,
  type Layer,
  type Variable,
} from "./lib/store";
import { parseCoordinates, formatCoordinates } from "./lib/coordinates";
import { layers, available, type Availability } from "./lib/layers";
import type { ComparisonRequest } from "./lib/regions";
import type { AnalogMap } from "./lib/ai";
import type { TrendMap } from "./lib/trendmap";

const Investigation = lazy(() =>
  import("./components/Investigation").then((m) => ({
    default: m.Investigation,
  })),
);
const TrendsCalculator = lazy(() =>
  import("./components/TrendsCalculator").then((m) => ({
    default: m.TrendsCalculator,
  })),
);
const ForecastPanel = lazy(() =>
  import("./components/ForecastPanel").then((m) => ({ default: m.ForecastPanel })),
);
const ApiKeysMenu = lazy(() =>
  import("./components/ApiKeysMenu").then((m) => ({ default: m.ApiKeysMenu })),
);
const TrendMapPanel = lazy(() =>
  import("./components/TrendMapPanel").then((m) => ({
    default: m.TrendMapPanel,
  })),
);
const ChangeStudio = lazy(() =>
  import("./components/ChangeStudio").then((m) => ({ default: m.ChangeStudio })),
);
const AnalogIntelligence = lazy(() =>
  import("./components/AnalogIntelligence").then((m) => ({
    default: m.AnalogIntelligence,
  })),
);
type Panel = "layers" | "analysis" | null;
type CommandItem = { id: string; title: string; hint: string; run: () => void };
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <button
      className="toggle-row"
      role="switch"
      aria-checked={value}
      onClick={onChange}
    >
      <span>{label}</span>
      <span className={`toggle ${value ? "on" : ""}`}>
        <i />
      </span>
    </button>
  );
}

export default function App() {
  const state = useEarth();
  const {
    location,
    selected,
    selectionVersion,
    variable,
    layer,
    start,
    end,
    date,
    set,
    select,
  } = state;
  const [panel, setPanel] = useState<Panel>(null);
  const [investigationTarget, setInvestigationTarget] = useState<number | null>(
    null,
  );
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [trendsOpen, setTrendsOpen] = useState(false);
  const [comparisonMap, setComparisonMap] = useState<ComparisonRequest | null>(
    null,
  );
  const [reload, setReload] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [keysVersion, setKeysVersion] = useState(0);
  const [trendMapOpen, setTrendMapOpen] = useState(false);
  const [trendMap, setTrendMap] = useState<TrendMap | null>(null);
  const [trendMapAuto, setTrendMapAuto] = useState(false);
  const [swipe, setSwipe] = useState<SwipeView | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  // Once the tour has been taken (finished or ended), the app stops promoting it and offers a replay instead.
  const [tourDone, setTourDone] = useState(() => {
    try {
      return localStorage.getItem("earth.tour.done.v1") === "1";
    } catch {
      return false;
    }
  });
  const endTour = () => {
    setTourOpen(false);
    setTourDone(true);
    try {
      localStorage.setItem("earth.tour.done.v1", "1");
    } catch {
      /* private mode: the replay button simply resets next visit */
    }
  };
  // Microsoft Planetary Computer overlay (land cover by year, JRC surface water).
  const [pc, setPc] = useState<{ kind: PcKind; year: number | null } | null>(null);
  const [pcTile, setPcTile] = useState<PcTiles | null>(null);
  const [pcError, setPcError] = useState("");
  useEffect(() => {
    if (!pc) {
      setPcTile(null);
      return;
    }
    let live = true;
    setPcError("");
    pcTiles(pc.kind, pc.year)
      .then((t) => live && setPcTile(t))
      .catch((e) => live && setPcError((e as Error).message));
    return () => {
      live = false;
    };
  }, [pc?.kind, pc?.year]); // eslint-disable-line react-hooks/exhaustive-deps
  const showPc = (kind: PcKind) => {
    setPc({ kind, year: kind === "landcover" ? 2023 : null });
    setSwipe(null);
    setPanel(null);
    set({ layer: "natural", weatherActive: false, playing: false });
    setTimelineOpen(false);
  };
  const openSwipe = (preset = 0) => {
    const p = SWIPE_PRESETS[preset];
    setStudioOpen(false);
    setAiOpen(false);
    setForecastOpen(false);
    setTrendMapOpen(false);
    setTrendsOpen(false);
    setPanel(null);
    setQuestionsOpen(false);
    setSearchOpen(false);
    setQuery("");
    setTimelineOpen(false);
    set({ weatherActive: false, layer: "natural", playing: false, sceneMode: "3d", viewsOpen: false });
    setSwipe((s) => ({
      layer: p.layer,
      left: p.left,
      right: p.right,
      target: presetTarget(p, (s?.target?.n ?? 0) + 1),
    }));
  };
  const openTrendMap = (auto = false) => {
    setTrendMapAuto(auto);
    setSwipe(null);
    setStudioOpen(false);
    setTrendMapOpen(true);
    setTrendsOpen(false);
    setSearchOpen(false);
    setQuery("");
    setPanel(null);
    setQuestionsOpen(false);
    set({ weatherActive: false, layer: "natural", playing: false });
  };
  const [analogMap, setAnalogMap] = useState<AnalogMap | null>(null);
  const [focus, setFocus] = useState<{
    latitude: number;
    longitude: number;
    n: number;
  } | null>(null);
  const openForecast = () => {
    if (!selected) return;
    setStudioOpen(false);
    setAiOpen(false);
    setPanel(null);
    setTrendsOpen(false);
    setQuestionsOpen(false);
    setSearchOpen(false);
    setForecastOpen(true);
  };
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<"scan" | "seasons" | "spiral" | "stripes" | "significance">("scan");
  const openStudio = (tab: typeof studioTab = "scan") => {
    if (!useEarth.getState().selected) return;
    setStudioTab(tab);
    setStudioOpen(true);
    setAiOpen(false);
    setForecastOpen(false);
    setPanel(null);
    setTrendsOpen(false);
    setQuestionsOpen(false);
    setSearchOpen(false);
    setQuery("");
  };
  const openAI = () => {
    setStudioOpen(false);
    setForecastOpen(false);
    setAiOpen(true);
    setQuestionsOpen(false);
    setTrendsOpen(false);
    setSearchOpen(false);
    setQuery("");
  };
  const { data, loading, error } = useHistoricalData(
    panel === "analysis" &&
      selected &&
      investigationTarget === selectionVersion,
    {
      latitude: location.latitude,
      longitude: location.longitude,
      parameter: variable,
      start,
      end,
    },
    reload,
  );
  const [catalog, setCatalog] = useState<Availability | null>(null);
  const [catalogChecked, setCatalogChecked] = useState("");
  const [catalogError, setCatalogError] = useState(false);
  const [modal, setModal] = useState<InvestigationModal>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Location[]>(places);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchStatus, setSearchStatus] = useState("GO TO A LOCATION");
  const [rangeStart, setRangeStart] = useState(start);
  const [rangeEnd, setRangeEnd] = useState(end);
  const [viewTarget, setViewTarget] = useState<ViewTarget | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSelection = useRef(selectionVersion);
  const coordinates = parseCoordinates(query);

  useEffect(() => {
    const c = new AbortController();
    let running = false;
    let providerLoaded = false;
    fetch("/data/availability.json", { signal: c.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!c.signal.aborted && !providerLoaded) setCatalog(d);
      })
      .catch(() => {});
    const refresh = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const r = await fetch("/api/imagery/availability", {
          signal: c.signal,
        });
        if (!r.ok) throw new Error();
        const d = await r.json();
        for (const config of [
          layers.temperature,
          layers.precipitation,
          layers.clouds,
        ]) {
          const item = d.layers?.[config.id];
          if (
            !item ||
            !Array.isArray(item.intervals) ||
            !Number.isFinite(Date.parse(item.default))
          )
            throw new Error();
        }
        if (!c.signal.aborted) {
          providerLoaded = true;
          setCatalog(d.layers);
          setCatalogChecked(d.checked_at);
          setCatalogError(false);
        }
      } catch {
        if (!c.signal.aborted) setCatalogError(true);
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 600000);
    window.addEventListener("online", refresh);
    return () => {
      c.abort();
      clearInterval(timer);
      window.removeEventListener("online", refresh);
    };
  }, []);
  // A target reveals only its location card. Science needs an explicit command.
  useEffect(() => {
    if (lastSelection.current === selectionVersion) return;
    lastSelection.current = selectionVersion;
    setPanel(null);
    setQuestionsOpen(false);
    setViewTarget(null);
  }, [selectionVersion]);

  const choose = (p: Location) => {
    select(p);
    setSearchOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };
  const investigate = (v: Variable) => {
    if (!selected) return;
    set({ variable: v, mode: "historical", weatherActive: false });
    setInvestigationTarget(selectionVersion);
    setPanel("analysis");
    setQuestionsOpen(false);
    setSearchOpen(false);
    setQuery("");
  };
  const showLayer = (l: Layer) => {
    if (l !== "natural") setPc(null);
    setQuestionsOpen(false);
    set({ layer: l, mode: "historical", playing: false, weatherActive: false });
    setTimelineOpen(l !== "natural");
    setPanel(null);
    setSearchOpen(false);
    setQuery("");
  };
  const clear = () => {
    setComparisonMap(null);
    setStudioOpen(false);
    setAiOpen(false);
    setForecastOpen(false);
    setAnalogMap(null);
    setTrendsOpen(false);
    set({
      selected: false,
      layer: "natural",
      playing: false,
      weatherActive: false,
      viewsOpen: false,
      sceneMode: "3d",
    });
    setPanel(null);
    setTimelineOpen(false);
    setQuestionsOpen(false);
    setSearchOpen(false);
    setViewTarget(null);
  };
  const clouds = () => {
    showLayer("clouds");
    set({
      sceneMode: "2d",
      opacity: 1,
      weatherActive: false,
      date: catalog?.[layers.clouds.id]?.default.slice(0, 10) ?? date,
    });
  };
  const commands: CommandItem[] = [
    ...(selected
      ? [
          {
            id: "studio",
            title: "Change studio: what is changing here?",
            hint: "8 NASA POWER variables + SPI drought index ranked · seasons · climate spiral · stripes · significance lab",
            run: () => openStudio("scan"),
          },
          {
            id: "spiral",
            title: "Climate spiral",
            hint: "Animated monthly anomalies for the selected place",
            run: () => openStudio("spiral"),
          },
          {
            id: "stripes",
            title: "Warming stripes for every variable",
            hint: "Annual anomalies as colour stripes",
            run: () => openStudio("stripes"),
          },
          {
            id: "ai",
            title: "Analog intelligence (AI)",
            hint: "On demand · Laya System-1 · tectonic-plate historical analogs",
            run: openAI,
          },
          {
            id: "forecast",
            title: "Weather forecast & prediction",
            hint: "16-day forecast · ECMWF ensemble probabilities · local climate context",
            run: openForecast,
          },
        ]
      : []),
    {
      id: "keys",
      title: "API keys",
      hint: "Add forecast, NASA FIRMS and LLM provider keys",
      run: () => {
        setSearchOpen(false);
        setQuery("");
        setKeysOpen(true);
      },
    },
    {
      id: "trend-map",
      title: "Trend map",
      hint: "Where is it changing? Per-cell trends · FDR field significance",
      run: () => openTrendMap(),
    },
    {
      id: "swipe",
      title: "Then & now satellite swipe",
      hint: "NASA GIBS imagery on two dates · Aral Sea, Great Salt Lake, Lake Poopó, Lake Mead",
      run: () => openSwipe(0),
    },
    ...PC_MENU.map((m) => ({
      id: `pc-${m.kind}`,
      title: `${m.title} (Planetary Computer)`,
      hint: m.hint,
      run: () => {
        setSearchOpen(false);
        setQuery("");
        showPc(m.kind);
      },
    })),
    {
      id: "tour",
      title: "Guided tour",
      hint: "What, where, how much, and is it significant: a 9-step walkthrough",
      run: () => {
        setSearchOpen(false);
        setQuery("");
        setTourOpen(true);
      },
    },
    {
      id: "trends",
      title: "Regional trends calculator",
      hint: "Compare climate regions · A → B and B → A scenarios",
      run: () => {
        setTrendsOpen(true);
        setSearchOpen(false);
        setQuery("");
        setPanel(null);
        setQuestionsOpen(false);
      },
    },
    {
      id: "2d",
      title: "2D global climate map",
      hint: "Flatten Earth into a world map",
      run: () => {
        set({ sceneMode: "2d" });
        setSearchOpen(false);
        setQuery("");
      },
    },
    {
      id: "3d",
      title: "3D Earth globe",
      hint: "Return to a spherical Earth",
      run: () => {
        set({ sceneMode: "3d" });
        setSearchOpen(false);
        setQuery("");
      },
    },
    {
      id: "clouds",
      title: "Global cloud atlas",
      hint: "NASA satellite clouds · 2D map",
      run: clouds,
    },
    {
      id: "flow",
      title: "Atmospheric flow wind forecast",
      hint: "ECMWF AIFS · animated wind and isobars",
      run: () => {
        setPanel(null);
        setSearchOpen(false);
        setTimelineOpen(false);
        setQuery("");
        set({
          weatherActive: true,
          windFlow: true,
          isobars: true,
          layer: "natural",
          playing: false,
        });
      },
    },
    {
      id: "views",
      title: "Open weather views",
      hint: "3D globe · 2D clouds · atmospheric flow",
      run: () => {
        set({ viewsOpen: true });
        setSearchOpen(false);
        setQuery("");
      },
    },
    ...(selected
      ? [
          {
            id: "temperature",
            title: "Investigate temperature trends",
            hint: "NASA POWER · selected location",
            run: () => investigate("T2M"),
          },
          {
            id: "rainfall",
            title: "Investigate rainfall trends",
            hint: "NASA POWER · selected location",
            run: () => investigate("PRECTOTCORR"),
          },
          {
            id: "humidity",
            title: "Investigate humidity trends",
            hint: "NASA POWER RH2M · selected location",
            run: () => investigate("RH2M"),
          },
          {
            id: "wind",
            title: "Investigate wind speed trends",
            hint: "NASA POWER WS10M · selected location",
            run: () => investigate("WS10M"),
          },
          {
            id: "pressure",
            title: "Investigate surface pressure trends",
            hint: "NASA POWER PS · selected location",
            run: () => investigate("PS"),
          },
          {
            id: "soil",
            title: "Investigate soil moisture trends",
            hint: "NASA POWER GWETROOT · selected location",
            run: () => investigate("GWETROOT"),
          },
        ]
      : []),
    {
      id: "layers",
      title: "Show imagery layers",
      hint: "Reference imagery · MODIS · IMERG",
      run: () => {
        setPanel("layers");
        setSearchOpen(false);
        setQuery("");
      },
    },
    {
      id: "satellite-temperature",
      title: "Show surface temperature imagery",
      hint: "NASA MODIS · satellite retrieval",
      run: () => showLayer("temperature"),
    },
    {
      id: "satellite-rain",
      title: "Show precipitation imagery",
      hint: "NASA GPM IMERG · mm/hr",
      run: () => showLayer("precipitation"),
    },
    {
      id: "hide",
      title: "Hide panels",
      hint: "Return to the Earth",
      run: () => {
        setPanel(null);
        setTimelineOpen(false);
        setSearchOpen(false);
        set({ playing: false });
        setQuery("");
      },
    },
    {
      id: "sources",
      title: "Sources and methods",
      hint: "Inspect provenance and limitations",
      run: () => {
        setModal("sources");
        setSearchOpen(false);
        setQuery("");
      },
    },
  ];
  const commandQuery = query.trim().replace(/^>/, "").trim().toLowerCase();
  const matchingCommands = query.startsWith(">")
    ? commands.filter(
        (c) =>
          !commandQuery ||
          (c.title + " " + c.hint).toLowerCase().includes(commandQuery),
      )
    : query.length >= 3
      ? commands.filter((c) =>
          (c.title + " " + c.hint).toLowerCase().includes(commandQuery),
        )
      : [];

  useEffect(() => {
    const c = new AbortController();
    const term = query.trim();
    if (term.length < 2) {
      setResults(places);
      setSearchStatus("GO TO A LOCATION");
      return;
    }
    if (parseCoordinates(term)) {
      setResults([]);
      setSearchStatus("DECIMAL COORDINATES · WGS84");
      return;
    }
    if (term.startsWith(">")) {
      setResults([]);
      setSearchStatus("COMMANDS");
      return;
    }
    if (/^[+-]?\d/.test(term)) {
      setResults([]);
      setSearchStatus("USE LATITUDE, LONGITUDE · e.g. 11.0168, 76.9558");
      return;
    }
    const local = places.filter((p) =>
      (p.name + " " + p.country).toLowerCase().includes(term.toLowerCase()),
    );
    if (local.length) {
      setResults(local);
      setSearchStatus("MATCHING LOCATIONS");
      return;
    }
    setResults([]);
    setSearchStatus("SEARCHING LOCATIONS…");
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: c.signal,
        });
        if (!r.ok) throw new Error();
        const items = await r.json();
        if (!c.signal.aborted) {
          setResults(items);
          setSearchStatus(
            items.length ? "SEARCH RESULTS" : "NO LOCATIONS FOUND",
          );
        }
      } catch {
        if (!c.signal.aborted) {
          setResults([]);
          setSearchStatus(
            "SEARCH UNAVAILABLE · USE COORDINATES OR CLICK THE GLOBE",
          );
        }
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const input =
        e.target instanceof HTMLElement &&
        /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      if (
        (e.key === "k" && (e.metaKey || e.ctrlKey)) ||
        (!input && e.key === "/")
      ) {
        e.preventDefault();
        inputRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setQuestionsOpen(false);
        if (!modal) {
          setPanel(null);
          setTimelineOpen(false);
          set({ playing: false });
        }
      }
    };
    const outside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setSearchOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", outside);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", outside);
    };
  }, [modal, set]);
  const submitSearch = () => {
    if (coordinates)
      choose({
        name: "Coordinate target",
        country: "WGS84 geographic point",
        ...coordinates,
      });
    else if (
      matchingCommands.length &&
      (!results.length || query.startsWith(">"))
    )
      matchingCommands[0].run();
    else if (results[0]) choose(results[0]);
  };
  const applyRange = () => {
    if (rangeStart > rangeEnd) return;
    set({
      start: rangeStart,
      end: rangeEnd,
      date:
        date < `${rangeStart}-01-01`
          ? `${rangeStart}-01-01`
          : date > `${rangeEnd}-12-31`
            ? `${rangeEnd}-12-31`
            : date,
      playing: false,
    });
  };
  const closePanel = () => setPanel(null);
  const closeAll = () => {
    setStudioOpen(false);
    setAiOpen(false);
    setTrendMapOpen(false);
    setSwipe(null);
    setForecastOpen(false);
    setTrendsOpen(false);
    setPanel(null);
    setQuestionsOpen(false);
    setTimelineOpen(false);
    set({ weatherActive: false, layer: "natural", viewsOpen: false, sceneMode: "3d" });
  };
  const cairo: Location = { name: "Cairo", country: "Egypt", latitude: 30.0626, longitude: 31.2497 };
  const atCairo = () => {
    const l = useEarth.getState().location;
    if (!useEarth.getState().selected || l.latitude !== cairo.latitude || l.longitude !== cairo.longitude) select(cairo);
  };
  const tourSteps: TourStep[] = [
    {
      question: "The challenge",
      title: "What is changing, where, how much, and is it significant?",
      body: "This tour drives the app for you. Every number is computed live from NASA records (POWER daily estimates and GIBS satellite imagery) with transparent, documented statistics. Use ← → to step.",
      run: closeAll,
    },
    {
      question: "What is changing?",
      title: "Eight variables, one ranking",
      body: "The Change Studio tests all 8 NASA POWER variables plus a standard drought index (SPI) at Cairo with one method (Theil–Sen slope, Mann–Kendall test) and ranks them by change relative to normal year-to-year swings, so °C, mm and kPa become comparable.",
      run: () => {
        closeAll();
        atCairo();
        openStudio("scan");
      },
    },
    {
      question: "When in the year?",
      title: "The seasonal fingerprint",
      body: "The same test for every calendar month. Dots mark the cells that stay significant after false-discovery-rate control across all 96 month × variable tests.",
      run: () => {
        atCairo();
        openStudio("seasons");
      },
    },
    {
      question: "How much?",
      title: "A climate spiral for one place",
      body: "45 years of monthly anomalies, one loop per year. Loops drifting outward mean the variable has risen; the Stripes tab shows the same record as one coloured band per year.",
      run: () => {
        atCairo();
        openStudio("spiral");
      },
    },
    {
      question: "Is it significant?",
      title: "Beat chance, not just a p-value",
      body: "The years are shuffled 2,000 times to show what chance alone produces. A change is called significant only if it beats the shuffles, passes record-length and autocorrelation screens, and survives multiple-testing control.",
      run: () => {
        atCairo();
        openStudio("significance");
      },
    },
    {
      question: "Is the data reliable?",
      title: "Checked by a second, independent record",
      body: "NASA POWER is model-derived, so the Studio also samples 25 years of quality-screened NASA MODIS satellite observations at the same point through Microsoft Planetary Computer. Cloudy or low-quality pixels are rejected, and years are built from calendar-month anomalies so missing seasons cannot fake a trend. When both records agree and are significant the trend is marked \u201cconfirmed by satellite\u201d: corroboration, not proof.",
      run: () => {
        atCairo();
        openStudio("scan");
        window.setTimeout(() => document.querySelector(".cs-group.sat")?.scrollIntoView({ behavior: "smooth", block: "start" }), 900);
      },
    },
    {
      question: "Where is it changing?",
      title: "The spatial trend map",
      body: "The test is repeated on every NASA POWER grid cell in a 5° box around Cairo, with field-wide false-discovery-rate control. Hatched cells are significant; colour shows the slope. A first run fetches 80 records and can take a few minutes.",
      run: () => {
        atCairo();
        openTrendMap(true);
      },
    },
    {
      question: "Can we see it from space?",
      title: "Then & now: the Aral Sea",
      body: "NASA MODIS true-colour images from August 2000 and August 2024, split by a divider you can drag across the globe. Try the other presets: Great Salt Lake, Lake Poopó and Lake Mead.",
      run: () => openSwipe(0),
    },
    {
      question: "What changed on the ground?",
      title: "10 m land cover, 2017 → 2023",
      body: "Annual Sentinel-2 land-cover maps from the Planetary Computer show Egypt's New Administrative Capital rising east of Cairo: built area in this area grows from about 6% to 19% of the land. Layers → Planetary Computer adds land cover and 1984–2020 surface-water change anywhere.",
      run: () => openSwipe(4),
    },
    {
      question: "What may come next?",
      title: "Analog intelligence",
      body: "Laya scores how much past trend changes on the same tectonic plates resemble today's (resemblance, not a probability). At 70% or more, a larger cloud model explains the skill-verified 5-year odds, which were tested on a horizon-purged split, using the past matches only as context.",
      run: () => {
        closeAll();
        select(cairo); // always fly back: the previous step leaves the camera over the new capital
        openAI();
      },
    },
    {
      question: "Your turn",
      title: "Explore any place on Earth",
      body: "Search a place or click the globe, then open Studio, Trends, AI or Compare. Press ⌘K (or type > in the search) for every command.",
      run: () => undefined,
    },
  ];

  return (
    <div
      className={`earth-app ${state.weatherActive ? "has-weather" : ""} ${state.sceneMode === "2d" ? "is-flat" : ""} ${selected ? "has-target" : ""} ${panel === "analysis" ? "has-analysis" : ""} ${timelineOpen ? "has-timeline" : ""} ${tourOpen ? "touring" : ""} ${swipe ? "swiping" : ""}`}
    >
      <main className="earth-stage" aria-label="Interactive Earth">
        <Globe
          catalog={catalog}
          onViewChange={setViewTarget}
          onReset={clear}
          comparison={comparisonMap}
          analogs={aiOpen ? analogMap : null}
          focus={focus}
          trendMap={trendMapOpen ? trendMap : null}
          swipe={swipe}
          pcOverlay={pc ? pcTile : null}
        />
      </main>

      <header className="earth-navigation" aria-label="Earth navigation">
        <button
          className="earth-identity"
          aria-label="About Earth System Trend Detective"
          title="Earth System Trend Detective · sources and methods"
          onClick={() => setModal("sources")}
        >
          <BrandMark />
          <span className="brand-text">
            <b>Trend Detective</b>
            <span>Earth System · Space Apps 2026</span>
          </span>
        </button>
        <div className="command-search" ref={searchRef}>
          <form
            className="command-input"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch();
            }}
          >
            <Search size={16} />
            <input
              ref={inputRef}
              aria-label="Search by place name, coordinates, or command"
              placeholder="Go to a place or coordinates…"
              value={query}
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              autoComplete="off"
              spellCheck={false}
              aria-expanded={searchOpen}
              aria-controls="location-results"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <X size={13} />
              </button>
            ) : (
              <kbd>⌘ K</kbd>
            )}
          </form>
          {searchOpen && (
            <div id="location-results" className="command-results">
              <div className="search-kicker">{searchStatus}</div>
              {coordinates && (
                <button
                  className="search-result coordinate-result"
                  onClick={() =>
                    choose({
                      name: "Coordinate target",
                      country: "WGS84 geographic point",
                      ...coordinates,
                    })
                  }
                >
                  <Crosshair size={17} />
                  <span>
                    <strong>
                      {formatCoordinates(
                        coordinates.latitude,
                        coordinates.longitude,
                      )}
                    </strong>
                    <small>Fly to these coordinates</small>
                  </span>
                  <CornerDownLeft size={14} />
                </button>
              )}
              {results.map((p, i) => (
                <button
                  className="search-result"
                  key={`${p.name}-${i}`}
                  onClick={() => choose(p)}
                >
                  <MapPin size={15} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.country}</small>
                  </span>
                  <ArrowUpRight size={13} />
                </button>
              ))}
              {matchingCommands.length > 0 && (
                <>
                  {!query.startsWith(">") && (
                    <div className="search-kicker command-section">
                      COMMANDS
                    </div>
                  )}
                  {matchingCommands.map((c) => (
                    <button
                      className="search-result"
                      key={c.id}
                      onClick={c.run}
                    >
                      <Command size={14} />
                      <span>
                        <strong>{c.title}</strong>
                        <small>{c.hint}</small>
                      </span>
                      <CornerDownLeft size={13} />
                    </button>
                  ))}
                </>
              )}
              <div className="search-help">
                <span>
                  City, region, or <b>11.0168, 76.9558</b>
                </span>
                <button onClick={() => setQuery(">")}>
                  Commands <Command size={10} />
                </button>
              </div>
            </div>
          )}
        </div>
      </header>
      <WeatherViews
        onActivate={() => {
          setQuestionsOpen(false);
          setPanel(null);
          setTimelineOpen(false);
        }}
        onHistory={() => investigate(variable)}
        onClouds={clouds}
        onSources={() => setModal("sources")}
        extraNav={
          <>
            {selected && (
              <button
                className={`fc-nav ${forecastOpen ? "active" : ""}`}
                aria-label="Open weather forecast"
                title="Weather forecast"
                aria-expanded={forecastOpen}
                onClick={() => (forecastOpen ? setForecastOpen(false) : openForecast())}
              >
                <CloudSun size={16} />
                <span>Forecast</span>
              </button>
            )}
            <button
              className={`compare-nav ${swipe ? "active" : ""}`}
              aria-label="Then and now satellite comparison"
              title="Then & now satellite swipe"
              aria-pressed={!!swipe}
              onClick={() => (swipe ? setSwipe(null) : openSwipe(0))}
            >
              <ArrowRightLeft size={15} />
              <span>Compare</span>
            </button>
            <button
              className={`tour-nav ${tourOpen ? "active" : ""} ${tourDone ? "done" : ""}`}
              aria-label={tourDone ? "Explore the tour again" : "Start guided tour"}
              title={tourDone ? "Explore the tour again" : "Guided tour"}
              onClick={() => (tourOpen ? endTour() : setTourOpen(true))}
            >
              {tourDone ? <RotateCcw size={15} /> : <Presentation size={15} />}
              <span>{tourDone ? "Tour again" : "Tour"}</span>
            </button>
            <button
              className="key-nav"
              aria-label="Manage API keys"
              title="API keys"
              onClick={() => setKeysOpen(true)}
            >
              <KeyRound size={15} />
            </button>
          </>
        }
      />

      {forecastOpen && selected && (
        <Suspense
          fallback={
            <div className="trends-opening glass-panel" role="status">
              <span className="loader" />
              Opening forecast…
            </div>
          }
        >
          <ForecastPanel
            onClose={() => setForecastOpen(false)}
            onKeys={() => setKeysOpen(true)}
            keysVersion={keysVersion}
          />
        </Suspense>
      )}
      {pc && !swipe && (
        <PcLayerCard
          kind={pc.kind}
          year={pcTile?.year ?? pc.year}
          tiles={pcTile && pcTile.kind === pc.kind ? pcTile : null}
          error={pcError}
          onYear={(year) => setPc((p) => (p ? { ...p, year } : p))}
          onClose={() => setPc(null)}
        />
      )}
      {swipe && (
        <SwipePanel view={swipe} catalog={catalog} onChange={setSwipe} onClose={() => setSwipe(null)} />
      )}
      {tourOpen && <Tour steps={tourSteps} onClose={endTour} />}
      {!selected && !tourOpen && !swipe && !pc && !trendMapOpen && !state.weatherActive && !state.viewsOpen && !searchOpen && (
        <>
          <Hero
            onTour={() => setTourOpen(true)}
            tourDone={tourDone}
            onPlace={(p) => {
              choose(p);
              if (p.name === "Cairo") window.setTimeout(() => openStudio("scan"), 50);
            }}
          />
          <SourceRibbon />
        </>
      )}
      {keysOpen && (
        <Suspense fallback={null}>
          <ApiKeysMenu
            onClose={() => setKeysOpen(false)}
            onSaved={() => setKeysVersion((n) => n + 1)}
          />
        </Suspense>
      )}

      {!selected && viewTarget && (
        <button
          className="explore-view glass-panel"
          onClick={() =>
            choose({
              name: "Selected area",
              country: "Center of the current view",
              latitude: viewTarget.latitude,
              longitude: viewTarget.longitude,
            })
          }
        >
          <Crosshair size={15} />
          <span>
            Explore this area
            <small>
              {formatCoordinates(viewTarget.latitude, viewTarget.longitude)}
            </small>
          </span>
          <ArrowRight size={15} />
        </button>
      )}

      {selected && (
        <section
          className="target-dock glass-panel"
          aria-label="Selected location"
        >
          <div className="target-location">
            <span className="target-indicator">
              <Crosshair size={20} />
            </span>
            <div>
              <span className="target-kicker">LOCATION ACQUIRED</span>
              <h1>
                {location.name}
                <span>{location.country}</span>
              </h1>
              <p>{formatCoordinates(location.latitude, location.longitude)}</p>
            </div>
          </div>
          <div className="target-actions">
            <button
              className={panel === "analysis" ? "active" : ""}
              onClick={() => investigate(variable)}
              aria-label="Investigate this location"
              aria-expanded={panel === "analysis"}
            >
              <ChartNoAxesCombined size={16} />
              <span>Investigate</span>
              <ArrowUpRight size={12} />
            </button>
            <button
              className={panel === "layers" ? "active" : ""}
              onClick={() => setPanel(panel === "layers" ? null : "layers")}
              aria-label="Map layers"
              aria-expanded={panel === "layers"}
            >
              <Layers size={16} />
              <span>Layers</span>
            </button>
            <button
              className="clear-target"
              aria-label="Clear selected location and hide data"
              title="Clear selection"
              onClick={clear}
            >
              <X size={16} />
            </button>
          </div>
        </section>
      )}

      {selected && (
        <button
          className={`questions-launcher glass-panel ${questionsOpen ? "active" : ""}`}
          aria-label="Open guided questions"
          aria-expanded={questionsOpen}
          aria-controls="guided-questions"
          onClick={() => setQuestionsOpen(!questionsOpen)}
        >
          <CircleHelp size={19} />
          <span>Questions</span>
        </button>
      )}

      {questionsOpen && selected && (
        <section
          className="questions-popover glass-panel"
          id="guided-questions"
          aria-label="Guided questions"
        >
          <div className="popover-header">
            <span>WHAT DO YOU WANT TO KNOW?</span>
            <button
              aria-label="Close investigation commands"
              onClick={() => setQuestionsOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <button
            className="investigation-command"
            onClick={() => investigate("T2M")}
          >
            <span className="command-icon warm">
              <Thermometer size={21} />
            </span>
            <span>
              <strong>Is it getting warmer here?</strong>
              <small>Investigate long-term temperature</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
          <button
            className="investigation-command"
            onClick={() => investigate("PRECTOTCORR")}
          >
            <span className="command-icon cool">
              <Droplets size={21} />
            </span>
            <span>
              <strong>How is rainfall changing?</strong>
              <small>Investigate annual precipitation</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
          <button
            className="investigation-command"
            onClick={() => investigate("GWETROOT")}
          >
            <span className="command-icon soil">
              <Sprout size={21} />
            </span>
            <span>
              <strong>Is the soil drying out?</strong>
              <small>Investigate root-zone soil wetness</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
          <p>
            NASA POWER · {start}–{end} · real historical estimates
          </p>
        </section>
      )}

      {selected && (
        <button
          className="trends-launcher glass-panel"
          aria-label="Open regional trends calculator"
          onClick={() => {
            setTrendsOpen(true);
            setPanel(null);
            setQuestionsOpen(false);
            setTimelineOpen(false);
          }}
        >
          <Calculator size={19} />
          <span>Trends</span>
        </button>
      )}

      {selected && (
        <button
          className={`ai-launcher glass-panel ${aiOpen ? "active" : ""}`}
          aria-label="Open on-demand analog intelligence"
          aria-expanded={aiOpen}
          onClick={() => (aiOpen ? setAiOpen(false) : openAI())}
        >
          <BrainCircuit size={19} />
          <span>AI</span>
        </button>
      )}
      {selected && (
        <button
          className={`studio-launcher glass-panel ${studioOpen ? "active" : ""}`}
          aria-label="Open change studio"
          aria-expanded={studioOpen}
          onClick={() => (studioOpen ? setStudioOpen(false) : openStudio("scan"))}
        >
          <Activity size={19} />
          <span>Studio</span>
        </button>
      )}
      {studioOpen && selected && (
        <Suspense
          fallback={
            <div className="trends-opening glass-panel" role="status">
              <span className="loader" />
              Opening change studio…
            </div>
          }
        >
          <ChangeStudio
            initialTab={studioTab}
            onClose={() => setStudioOpen(false)}
            onInvestigate={(v) => {
              setStudioOpen(false);
              investigate(v);
            }}
          />
        </Suspense>
      )}
      {aiOpen && selected && (
        <Suspense
          fallback={
            <div className="trends-opening glass-panel" role="status">
              <span className="loader" />
              Opening analog intelligence…
            </div>
          }
        >
          <AnalogIntelligence
            onKeys={() => setKeysOpen(true)}
            keysVersion={keysVersion}
            onClose={() => setAiOpen(false)}
            onMap={setAnalogMap}
            onFly={(latitude, longitude) =>
              setFocus((f) => ({ latitude, longitude, n: (f?.n ?? 0) + 1 }))
            }
          />
        </Suspense>
      )}

      {panel === "layers" && (
        <section
          className="layer-popover glass-panel"
          aria-label="Imagery layer controls"
        >
          <div className="popover-header">
            <span>SEE THE EARTH DIFFERENTLY</span>
            <button aria-label="Close layer controls" onClick={closePanel}>
              <X size={14} />
            </button>
          </div>
          <div className="layer-options">
            {(
              ["natural", "temperature", "precipitation", "clouds"] as Layer[]
            ).map((l) => (
              <button
                key={l}
                className={layer === l ? "active" : ""}
                onClick={() => showLayer(l)}
              >
                <span className={`layer-thumbnail ${l}`} />
                <span>
                  <strong>{layers[l].name}</strong>
                  <small>
                    {l === "natural"
                      ? "Esri · NASA reference fallback"
                      : l === "temperature"
                        ? "MODIS Terra · daytime · °C"
                        : l === "clouds"
                          ? "MODIS Terra · satellite true color"
                          : "GPM IMERG · precipitation rate · mm/hr"}
                  </small>
                </span>
                {layer === l ? <Check size={14} /> : <ArrowUpRight size={14} />}
              </button>
            ))}
          </div>
          <div className="layer-options layer-pc">
            <span className="layer-pc-title">MICROSOFT PLANETARY COMPUTER</span>
            {PC_MENU.map((m) => (
              <button key={m.kind} className={pc?.kind === m.kind ? "active" : ""} onClick={() => (pc?.kind === m.kind ? setPc(null) : showPc(m.kind))}>
                <span className={`layer-thumbnail pc-${m.kind}`} />
                <span>
                  <strong>{m.title}</strong>
                  <small>{m.hint}</small>
                </span>
                {pc?.kind === m.kind ? <Check size={14} /> : <ArrowUpRight size={14} />}
              </button>
            ))}
          </div>
          <div className="layer-settings">
            <Toggle
              label="Country boundaries"
              value={state.borders}
              onChange={() => set({ borders: !state.borders })}
            />
            <Toggle
              label="Place labels"
              value={state.labels}
              onChange={() => set({ labels: !state.labels })}
            />
            {layer !== "natural" && (
              <label className="opacity-control">
                <span>
                  Overlay opacity
                  <strong>{Math.round(state.opacity * 100)}%</strong>
                </span>
                <input
                  aria-label="Overlay opacity"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={state.opacity}
                  onChange={(e) => set({ opacity: +e.target.value })}
                />
              </label>
            )}
          </div>
        </section>
      )}

      {panel === "analysis" && selected && (
        <section
          className="analysis-drawer glass-panel"
          aria-label="Location trend investigation"
        >
          <div className="drawer-header">
            <span>
              <span className="dot" /> LOCATION INTELLIGENCE
            </span>
            <button
              aria-label="Close trend investigation"
              title="Return to globe"
              onClick={closePanel}
            >
              <X size={17} />
            </button>
          </div>
          <DataSources
            active="history"
            onHistory={() => {}}
            onWeather={() => {
              setPanel(null);
              setTimelineOpen(false);
              setQuestionsOpen(false);
              set({
                weatherActive: true,
                layer: "natural",
                playing: false,
                viewsOpen: false,
              });
            }}
          />
          <div className="analysis-controls">
            <label>
              VARIABLE
              <select
                aria-label="Investigation variable"
                value={variable}
                onChange={(e) => set({ variable: e.target.value as Variable })}
              >
                {Object.entries(variables).map(([key, v]) => (
                  <option key={key} value={key}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="analysis-period">
              <CalendarDays size={13} />
              <input
                aria-label="Investigation start year"
                type="number"
                min="1981"
                max={new Date().getFullYear() - 1}
                value={rangeStart}
                onChange={(e) => setRangeStart(+e.target.value)}
              />
              <span>—</span>
              <input
                aria-label="Investigation end year"
                type="number"
                min="1981"
                max={new Date().getFullYear() - 1}
                value={rangeEnd}
                onChange={(e) => setRangeEnd(+e.target.value)}
              />
              <button
                aria-label="Apply investigation date range"
                disabled={
                  rangeStart > rangeEnd ||
                  rangeStart < 1981 ||
                  rangeEnd >= new Date().getFullYear()
                }
                onClick={applyRange}
              >
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
          <Suspense
            fallback={
              <div className="panel-loading">
                <span className="loader" />
                Opening investigation…
              </div>
            }
          >
            <Investigation
              data={data}
              loading={loading}
              error={error}
              retry={() => setReload((n) => n + 1)}
              onReport={() => setModal("report")}
              onSources={() => setModal("sources")}
            />
          </Suspense>
        </section>
      )}

      {layer !== "natural" && (
        <section
          className="active-layer glass-panel"
          aria-label="Active satellite imagery"
        >
          <div>
            <span className="dot satellite-dot" />
            <strong>{layers[layer].name}</strong>
            <button
              aria-label="Hide satellite imagery"
              title="Remove imagery overlay"
              onClick={() => showLayer("natural")}
            >
              <EyeOff size={14} />
            </button>
          </div>
          <p>
            {layers[layer].source} · {date} UTC
          </p>
          <button
            className="latest-imagery"
            disabled={!catalog?.[layers[layer].id]}
            onClick={() =>
              set({
                date: catalog![layers[layer].id].default.slice(0, 10),
                playing: false,
              })
            }
          >
            <ArrowUpRight size={12} />
            Latest available{" "}
            <span>
              {catalog?.[layers[layer].id]?.default.slice(0, 10) || "Checking…"}
            </span>
          </button>
          <small className={catalogError ? "weather-stale" : ""}>
            {catalogError
              ? "Catalog refresh unavailable · saved dates shown"
              : catalogChecked
                ? `NASA catalog checked ${new Date(catalogChecked).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`
                : "Saved NASA catalog · checking for updates…"}
          </small>
          {layer !== "clouds" && (
            <img
              src={
                layer === "temperature"
                  ? "/data/temperature-legend.svg"
                  : "/data/precipitation-legend.svg"
              }
              alt={`Official NASA ${layers[layer].name} legend (${layers[layer].unit})`}
            />
          )}
          <small>
            {layers[layer].resolution}
            {catalog && !available(date, layer, catalog)
              ? " · No imagery catalogued for this date"
              : ""}
          </small>
          <button
            className="timeline-toggle"
            onClick={() => setTimelineOpen(!timelineOpen)}
          >
            <CalendarDays size={12} />
            {timelineOpen ? "Hide timeline" : "Explore time"}
            <ChevronDown size={11} />
          </button>
        </section>
      )}
      {timelineOpen && layer !== "natural" && (
        <div className="timeline-overlay glass-panel">
          <button
            className="timeline-close"
            aria-label="Close timeline"
            onClick={() => {
              setTimelineOpen(false);
              set({ playing: false });
            }}
          >
            <X size={14} />
          </button>
          <Timeline catalog={catalog} />
        </div>
      )}

      <div className="earth-footnote">
        <button
          aria-label="Data sources and project information"
          onClick={() => setModal("sources")}
        >
          <Info size={12} />
        </button>
        <span>Esri · NASA / Natural Earth</span>
      </div>
      <InvestigationDialog modal={modal} setModal={setModal} data={data} />
      {trendMapOpen && (
        <Suspense
          fallback={
            <div className="trends-opening glass-panel" role="status">
              <span className="loader" />
              Opening trend map…
            </div>
          }
        >
          <TrendMapPanel
            autoRun={trendMapAuto}
            onClose={() => setTrendMapOpen(false)}
            onResult={setTrendMap}
          />
        </Suspense>
      )}
      {trendsOpen && (
        <Suspense
          fallback={
            <div className="trends-opening glass-panel" role="status">
              <span className="loader" />
              Opening regional calculator…
            </div>
          }
        >
          <TrendsCalculator
            onClose={() => setTrendsOpen(false)}
            onTrendMap={() => openTrendMap()}
            onMap={(q) => {
              setComparisonMap(q);
              set({ weatherActive: false, layer: "natural", playing: false });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
