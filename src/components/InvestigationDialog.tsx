import { useEffect, useRef } from "react";
import {
  X,
  Thermometer,
  Satellite,
  Sparkles,
  Wind,
  ArrowUpRight,
  Download,
  Printer,
} from "lucide-react";
import { Button } from "./ui/button";
import { useEarth, variables, type Analysis } from "../lib/store";
import { interpretation } from "../lib/science";
export type InvestigationModal = "sources" | "report" | null;
function download(data: unknown, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function InvestigationDialog({
  modal,
  setModal,
  data,
}: {
  modal: InvestigationModal;
  setModal: (m: InvestigationModal) => void;
  data: Analysis | null;
}) {
  const { location, variable, start, end } = useEarth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (modal) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [modal]);
  return (
    <dialog
      ref={dialogRef}
      className={`modal ${modal === "report" ? "report-modal" : ""}`}
      onCancel={() => setModal(null)}
      onClick={(e) => {
        if (e.target === e.currentTarget) setModal(null);
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="modal-close"
        aria-label="Close dialog"
        onClick={() => setModal(null)}
      >
        <X size={20} />
      </Button>
      {modal === "sources" ? (
        <>
          <span className="eyebrow">OPEN SCIENCE, EVERY STEP</span>
          <h2>Know your evidence.</h2>
          <p className="modal-intro">
            Different datasets answer different questions. Here’s exactly what
            this foundation uses.
          </p>
          <div className="source-detail">
            <Thermometer size={20} />
            <div>
              <h3>
                NASA POWER <span>CONNECTED</span>
              </h3>
              <p>
                Daily T2M, T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M (humidity), WS10M
                (wind), PS (surface pressure) and GWETROOT (root-zone soil
                wetness) are retrieved for the selected coordinates. These are MERRA-2-derived gridded
                estimates, not station observations or MODIS surface
                temperatures.
              </p>
              <a
                href="https://power.larc.nasa.gov/docs/services/api/temporal/daily/"
                target="_blank"
                rel="noreferrer"
              >
                NASA POWER API documentation <ArrowUpRight size={12} />
              </a>
            </div>
          </div>
          <div className="source-detail">
            <Satellite size={20} />
            <div>
              <h3>
                NASA EOSDIS GIBS <span>CONNECTED</span>
              </h3>
              <p>
                The basemap uses Esri World Imagery with a local NASA Blue
                Marble fallback. Basemap scenes have mixed acquisition dates and
                are not historical measurements. Blue Marble is a reference
                composite. MODIS Terra true-color imagery for the cloud atlas,
                daytime land-surface temperature and GPM IMERG daily
                precipitation rate use dated geographic WMS imagery. Blank areas
                are missing retrievals. IMERG units are mm/hr, not accumulated
                rainfall. Display tile resolution is not native measurement
                resolution.
              </p>
              <a
                href="https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml"
                target="_blank"
                rel="noreferrer"
              >
                Inspect NASA’s layer catalog <ArrowUpRight size={12} />
              </a>
            </div>
          </div>
          <div className="source-detail">
            <Wind size={20} />
            <div>
              <h3>
                ECMWF AIFS <span>CONNECTED</span>
              </h3>
              <p>
                The official ECMWF open-data client retrieves verified AIFS
                Single runs on demand. Six-hour steps include 10 m wind, 2 m
                temperature, mean sea-level pressure, total cloud cover and
                precipitation accumulation. GRIB units, initialization and valid
                times are checked server-side. Model fields are sampled to a 1°
                display grid; wind particles are visually accelerated paths
                through that fixed field, not observed trajectories. Forecast
                precipitation is accumulated mm since initialization, not mm/hr.
              </p>
              <a
                href="https://www.ecmwf.int/en/forecasts/datasets/open-data"
                target="_blank"
                rel="noreferrer"
              >
                ECMWF open-data documentation <ArrowUpRight size={12} />
              </a>
            </div>
          </div>
          <div className="source-detail">
            <Satellite size={20} />
            <div>
              <h3>
                NASA MODIS via Microsoft Planetary Computer <span>CONNECTED</span>
              </h3>
              <p>
                Studio samples NASA MODIS Terra collection 6.1 at the selected point: vegetation (MOD13A1 NDVI), land
                surface temperature (MOD11A2), evapotranspiration (MOD16A3GF) and net primary productivity (MOD17A3HGF),
                quality-screened with each product&apos;s QA flags. Map layers add 10 m annual land cover
                (Impact Observatory / Esri) and JRC Global Surface Water. Accessed anonymously through the Planetary
                Computer STAC and data APIs.
              </p>
              <a href="https://planetarycomputer.microsoft.com/catalog" target="_blank" rel="noreferrer">
                Planetary Computer catalog <ArrowUpRight size={12} />
              </a>
            </div>
          </div>
          <div className="source-detail">
            <Wind size={20} />
            <div>
              <h3>
                Forecasts: WeatherNext 2, ECMWF ENS, Open-Meteo <span>CONNECTED</span>
              </h3>
              <p>
                The default forecast is Google DeepMind WeatherNext 2, a 64-member AI ensemble, served free for
                non-commercial use by Open-Meteo (CC BY 4.0). Probabilities come from the share of ensemble members; the
                ECMWF IFS ensemble and Open-Meteo&apos;s physics blend are alternatives.
              </p>
              <a href="https://open-meteo.com/en/docs/google-weathernext-api" target="_blank" rel="noreferrer">
                WeatherNext 2 on Open-Meteo <ArrowUpRight size={12} />
              </a>
            </div>
          </div>
          <div className="source-detail si-disclosure">
            <Sparkles size={20} />
            <div>
              <h3>
                Use of AI (SI) tools <span>DISCLOSED</span>
              </h3>
              <p>
                <b>Code and documentation:</b> written with the help of an AI coding assistant (Anthropic Claude Code),
                reviewed and tested by the team. <b>In the app:</b> Laya (an open decision model) scores how much past
                trend changes resemble today&apos;s; an optional language model (Claude or a local model) explains the
                skill-verified forecast, and that text is labelled AI-generated in the interface. <b>Forecasts:</b>
                WeatherNext 2 is itself an AI weather model. <b>Demo video:</b> a screen recording of the real app; the
                narration voice is AI-generated (ElevenLabs) and the video carries a visible AI notice. All statistics,
                trends and significance results are computed by deterministic code from the data, not generated. No
                NASA logos or mission insignia are used or generated.
              </p>
            </div>
          </div>
          <div className="method-box">
            <h3>How the investigation works</h3>
            <p>
              Annual temperature means require ≥90% daily coverage. Annual
              precipitation totals require 100%. Theil–Sen slope uses calendar
              years; the two-sided Kendall trend test handles ties. A detrended
              lag-1 screen flags autocorrelation; significance is withheld when
              flagged or when fewer than 10 years are usable. Confidence
              intervals are exploratory if independence fails. Anomalies use the
              stated study-period mean.
            </p>
            <p>
              Full analysis also includes calendar-month seasonal cycles,
              fixed-threshold extremes, complete-year wet/dry spells,
              earlier/later period comparisons, and a 499-sample circular
              moving-block residual bootstrap for annual slope uncertainty. The
              bootstrap is exploratory and assumes stationary, weakly dependent
              detrended residuals. Missing data are not gap-filled. There are no
              interpolated point maps or causal claims. The Trends calculator
              compares fixed regional grid samples and tests both directions of
              lagged prediction against a target-only baseline. Conditional
              response scenarios require historical predictive skill and
              uncertainty checks. The trend map tests every grid cell with
              field-wide false-discovery-rate control; Studio adds seasonal tests,
              a permutation test and the SPI drought index.
            </p>
          </div>
          {data && (
            <details>
              <summary>Inspect this investigation’s provenance</summary>
              <pre>
                {JSON.stringify(
                  {
                    source_url: data.source_url,
                    retrieved_at: data.retrieved_at,
                    metadata: data.metadata,
                  },
                  null,
                  2,
                )}
              </pre>
              <a href={data.source_url} target="_blank" rel="noreferrer">
                Open original NASA response <ArrowUpRight size={12} />
              </a>
            </details>
          )}
          <p className="license-note">
            Basemap attribution: Esri and its data contributors (see on-map
            credits). NASA imagery and POWER data are public-access scientific
            resources; Natural Earth boundaries are public domain. Place search:
            Open-Meteo / GeoNames (CC BY 4.0). This independent project is not
            endorsed by NASA or ECMWF. Interface inspiration: God’s Eye View by
            Bilawal Sidhu (github.com/bilawalsidhu/gods-eye-view); implemented
            independently.
          </p>
        </>
      ) : (
        data && (
          <>
            <span className="eyebrow">EARTH SYSTEM TREND DETECTIVE</span>
            <h2>Investigation report</h2>
            <p className="modal-intro">
              {location.name}, {location.country} · {variables[variable].name} ·{" "}
              {start}–{end}
            </p>
            <div className="report-questions">
              <section>
                <span>01</span>
                <div>
                  <h3>What is changing?</h3>
                  <p>{interpretation(data)}</p>
                </div>
              </section>
              <section>
                <span>02</span>
                <div>
                  <h3>Where is it changing?</h3>
                  <p>
                    Selected coordinate: {location.latitude}°,{" "}
                    {location.longitude}°. NASA POWER provides a gridded
                    estimate. This single-location investigation does not
                    establish spatial or regional differences.
                  </p>
                </div>
              </section>
              <section>
                <span>03</span>
                <div>
                  <h3>How much is it changing?</h3>
                  <p>
                    {data.trend
                      ? `Sen slope: ${data.trend.slope.toFixed(3)} ${data.unit} per decade. Fitted change across usable years: ${data.trend.total_change.toFixed(3)} ${data.unit}. 95% slope interval: ${data.trend.low.toFixed(3)} to ${data.trend.high.toFixed(3)} ${data.unit}/decade.`
                      : "Insufficient usable years for trend estimation."}
                  </p>
                </div>
              </section>
              <section>
                <span>04</span>
                <div>
                  <h3>How has it changed historically?</h3>
                  <p>
                    {data.annual.filter((a) => a.value !== null).length} usable
                    annual values; {data.coverage}% daily coverage. Anomaly
                    baseline: {data.baseline}. Export JSON contains the annual
                    and monthly series.
                  </p>
                </div>
              </section>
              <section>
                <span>05</span>
                <div>
                  <h3>Is the change statistically significant?</h3>
                  <p>
                    {data.trend
                      ? `Two-sided p-value: ${data.trend.p_value.toPrecision(4)}. ${data.trend.significant === true ? "Significant at α = 0.05." : data.trend.significant === false ? "No significant trend established at α = 0.05." : "Significance withheld."}`
                      : "Not assessed."}{" "}
                    {data.warnings.join(" ")}
                  </p>
                </div>
              </section>
            </div>
            <p className="report-provenance">
              Source: {data.source}
              <br />
              Retrieved: {data.retrieved_at}
              <br />
              Location: {location.latitude}, {location.longitude}
            </p>
            <div className="report-actions">
              <Button
                onClick={() =>
                  download(
                    {
                      project: "Earth System Trend Detective",
                      location,
                      period: { start, end },
                      ...data,
                    },
                    `earth-investigation-${location.name.toLowerCase().replaceAll(" ", "-")}.json`,
                  )
                }
              >
                <Download size={15} />
                Export full JSON
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer size={15} />
                Print / save PDF
              </Button>
            </div>
          </>
        )
      )}
    </dialog>
  );
}
