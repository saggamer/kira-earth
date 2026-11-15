import type { ReactNode } from "react";

/** Plain-language definitions for the statistics vocabulary used across the app. */
export const GLOSSARY = {
  sigma:
    "σ/decade: the trend per decade divided by how much the variable normally swings from year to year. 1σ/decade means the change in ten years equals a typical year-to-year swing, so different units can be compared.",
  theilsen:
    "Theil–Sen slope: the median of the slopes between every pair of years. Robust to outliers; reported per decade.",
  mk: "Mann–Kendall test: counts how often later years are higher than earlier years. p < 0.05 means a trend this consistent would be rare if there were no trend.",
  fdr: "False discovery rate (Benjamini–Hochberg): when many things are tested at once, some look significant by luck. FDR control keeps the expected share of false alarms at 5%.",
  permutation:
    "Permutation test: the years are shuffled thousands of times to see what trends chance alone produces. If the real record beats nearly all shuffles, the trend is unlikely to be luck.",
  autocorrelation:
    "Autocorrelation: when one year resembles the next (after removing the trend), ordinary tests become over-confident, so the app withholds a significance claim.",
  anomaly: "Anomaly: the difference from the average over the chosen period. Above the mean is orange, below is blue.",
  lst: "Land surface temperature: how hot the ground itself is, measured from orbit by MODIS. It is related to, but not the same as, the 2 m air temperature from NASA POWER.",
  ndvi: "NDVI (Normalized Difference Vegetation Index): greenness measured from red and near-infrared light. About 0.1 for desert, 0.3–0.5 for crops and grassland, above 0.6 for dense forest.",
} as const;

export function Term({ k, children }: { k: keyof typeof GLOSSARY; children: ReactNode }) {
  return (
    <span className="term" tabIndex={0} role="note" aria-label={`${typeof children === "string" ? children : ""}: ${GLOSSARY[k]}`} data-def={GLOSSARY[k]}>
      {children}
    </span>
  );
}
