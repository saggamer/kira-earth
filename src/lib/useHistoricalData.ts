import { useEffect, useState, useRef } from "react";
import { getAnalysis, type Analysis } from "./store";
import {
  analysisKey,
  validateAnalysis,
  type AnalysisQuery,
} from "./dataIntegrity";

const memory = new Map<string, Analysis>();
const storageKey = "earth-verified-history-v1";
function readSaved(key: string, query: AnalysisQuery): Analysis | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]") as [
      string,
      unknown,
    ][];
    const item = saved.find(([k]) => k === key);
    if (item) return validateAnalysis(item[1], query);
  } catch {
    /* An invalid or unavailable browser cache is never used. */
  }
  return null;
}
function save(key: string, data: Analysis) {
  memory.delete(key);
  memory.set(key, data);
  while (memory.size > 6) memory.delete(memory.keys().next().value!);
  try {
    localStorage.setItem(storageKey, JSON.stringify([...memory]));
  } catch {
    /* Data remains available in memory if storage is full. */
  }
}

export function useHistoricalData(
  active: boolean,
  query: AnalysisQuery,
  reload: number,
) {
  const key = analysisKey(query);
  const lastReload = useRef(reload);
  const [state, update] = useState<{
    key: string;
    data: Analysis | null;
    loading: boolean;
    error: string;
  }>({ key: "", data: null, loading: false, error: "" });
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    let running = false;
    const cached = readSaved(key, query);
    update({ key, data: cached, loading: true, error: "" });
    async function refresh(force = false) {
      if (running || abort.signal.aborted) return;
      running = true;
      update((s) => ({ ...s, loading: true }));
      try {
        const data = await getAnalysis(abort.signal, query, force);
        if (abort.signal.aborted) return;
        save(key, data);
        update({ key, data, loading: false, error: "" });
      } catch (e) {
        if (!abort.signal.aborted)
          update((s) => ({
            ...s,
            loading: false,
            error: e instanceof Error ? e.message : "Data refresh failed.",
          }));
      } finally {
        running = false;
      }
    }
    const force = reload !== lastReload.current;
    lastReload.current = reload;
    void refresh(force);
    const resume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(resume, 300000);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
    // Key captures the complete, rounded request. A new key aborts the previous request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, reload]);
  return state.key === key
    ? state
    : { key, data: null, loading: active, error: "" };
}
