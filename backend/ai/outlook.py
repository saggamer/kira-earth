"""System-2 outlook: an LLM explains what might happen next, only when escalated.

The LLM never sees raw data it could misquote without context: it receives the computed
trend statistics, the plate-scoped analogs, what actually followed those analogs, and
Laya's System-1 scores, and is asked for a short, hedged outlook. A deterministic
analog summary is always returned alongside, so the outlook degrades gracefully.

Providers (env):
  EARTH_LLM_PROVIDER=local   (default) transformers, EARTH_LLM_MODEL (default Qwen/Qwen3.5-0.8B), runs on this machine
  Saved Claude key (API-keys menu or EARTH_ANTHROPIC_KEY): the cloud model, default claude-opus-5-5
  EARTH_LLM_PROVIDER=anthropic  Claude with EARTH_LLM_KEY and EARTH_LLM_MODEL
  EARTH_LLM_PROVIDER=openai  any OpenAI-compatible server: EARTH_LLM_URL (e.g. http://127.0.0.1:11434/v1 for Ollama,
                             http://127.0.0.1:1234/v1 for LM Studio), EARTH_LLM_MODEL, optional EARTH_LLM_KEY
"""
from __future__ import annotations
from functools import lru_cache
import os
import re
import threading
import httpx
from . import signatures as S

PROVIDER = os.getenv("EARTH_LLM_PROVIDER", "local")
MODEL = os.getenv("EARTH_LLM_MODEL", "Qwen/Qwen3.5-0.8B")
LOCAL_MODEL = MODEL if PROVIDER == "local" else "Qwen/Qwen3.5-0.8B"


CLOUD_DEFAULT = "claude-opus-5-5"
_LOCAL_HOSTS = ("://127.0.0.1", "://localhost", "://[::1]", "://0.0.0.0")


def _is_cloud(url: str | None) -> bool:
    return bool(url) and not any(h in url for h in _LOCAL_HOSTS)


def config() -> dict:
    """Environment variables win; then a saved Claude key (the cloud System-2 model); then the
    OpenAI-compatible entry from the API-keys menu; otherwise the small local model.
    `cloud` says whether this is the larger cloud model the similarity gate hands over to."""
    if os.getenv("EARTH_LLM_PROVIDER"):
        url = os.getenv("EARTH_LLM_URL", "http://127.0.0.1:11434/v1")
        provider = PROVIDER
        cloud = provider == "anthropic" or (provider == "openai" and _is_cloud(url))
        model = os.getenv("EARTH_LLM_MODEL") or (CLOUD_DEFAULT if provider == "anthropic" else MODEL)
        return {"provider": provider, "model": model, "url": url, "key": os.getenv("EARTH_LLM_KEY"), "cloud": cloud}
    from .. import keystore
    key = keystore.get("anthropic")
    if key:
        return {"provider": "anthropic", "model": keystore.extra("anthropic", "model") or CLOUD_DEFAULT,
                "url": None, "key": key, "cloud": True}
    url, model = keystore.extra("llm", "url"), keystore.extra("llm", "model")
    if url and model:
        return {"provider": "openai", "model": model, "url": url, "key": keystore.get("llm"), "cloud": _is_cloud(url)}
    return {"provider": "local", "model": LOCAL_MODEL, "url": None, "key": None, "cloud": False}


def config_for(provider: str) -> dict | None:
    """The saved configuration of one API-keys entry, used to test exactly that entry."""
    from .. import keystore
    if provider == "anthropic":
        key = keystore.get("anthropic")
        return {"provider": "anthropic", "model": keystore.extra("anthropic", "model") or CLOUD_DEFAULT,
                "url": None, "key": key, "cloud": True} if key else None
    url, model = keystore.extra("llm", "url"), keystore.extra("llm", "model")
    return {"provider": "openai", "model": model, "url": url, "key": keystore.get("llm"), "cloud": _is_cloud(url)} if url and model else None


def public(cfg: dict | None = None) -> dict:
    cfg = cfg or config()
    return {"provider": cfg["provider"], "model": cfg["model"], "cloud": cfg["cloud"]}
_lock = threading.Lock()

HAZARD_GUIDE = {
    "heat": "Heatwave: persistent regionally extreme day/night heat, often with persistent high pressure; days to weeks.",
    "warm_nights": "Heat stress: warm nights reduce recovery; humidity controls heat stress.",
    "heat_drought": "Drought + wildfire weather: hot air, rainfall deficit and dry fuels; weeks to seasons.",
    "drying": "Drought: persistent rainfall deficit, soil-moisture decline, negative SPI/SPEI; weeks to seasons.",
    "extreme_rain": "Extreme rainfall / flash flood: high rainfall rate over wet catchments raises flood risk; minutes to days.",
    "warm_wet_extremes": "Warmer air holds more moisture: heavier rain events alongside heat; flood and heat risks together.",
    "cooling": "Cold wave: sharp or persistent low-temperature anomalies, frost; days.",
    "wetting": "Wetter regime: higher seasonal totals; flood risk depends on intensity and soil saturation.",
    "no_clear_regime": "No single hazard regime is indicated by significant trends.",
}

SYSTEM = ("You are a careful Earth-science analyst. Use ONLY the facts given. Never invent events, dates, places or "
          "statistics. Present only skill-verified probabilities as outlooks; say plainly when there is no verified skill. "
          "Write plain sentences, no markdown tables.")

_WORD = {"rise": "rise", "steady": "stay near its recent level", "fall": "fall"}


def grounded_summary(ctx: dict) -> list[str]:
    """Deterministic statements from System-1 probabilities and their verified skill (no LLM)."""
    sys1 = ctx.get("system1") or {}
    if sys1.get("status") != "ok":
        return ["No predictive System-1 result is available; only the observed trends can be described."]
    out = []
    for key, o in sys1["outlook"].items():
        p, c = o["probabilities"], o["climatology"]
        if o["skilful"]:
            out.append(f"{o['label'].capitalize()}: {p['rise'] * 100:.0f}% chance to rise, {p['steady'] * 100:.0f}% steady, "
                       f"{p['fall'] * 100:.0f}% to fall over the next 5 years (usual rates {c['rise'] * 100:.0f}% / {c['steady'] * 100:.0f}% / "
                       f"{c['fall'] * 100:.0f}%); skill verified on later years at unseen sites.")
        else:
            out.append(f"{o['label'].capitalize()}: no verified forecast skill; do not predict its direction.")
    return out


def confidence_rating(ctx: dict) -> dict:
    """Deterministic EVIDENCE-STRENGTH rating (not a calibrated probability): verified skill × how far the
    skill-verified probabilities depart from the usual rates. Analog resemblance is reported beside it but
    does not raise or lower it, because resemblance is not forecast skill."""
    sys1 = ctx.get("system1") or {}
    if sys1.get("status") != "ok":
        return {"label": "low", "score": 0.0, "basis": "System-1 is unavailable, so there is no verified outlook."}
    skilful = [o for o in sys1["outlook"].values() if o["skilful"]]
    if not skilful:
        return {"label": "low", "score": 0.0, "basis": "None of the System-1 questions has verified skill on held-out sites."}
    # Sharpness: total-variation distance from climatology (0 = says nothing new, 1 = certain and unusual).
    shift = max(sum(abs(o["probabilities"][k] - o["climatology"][k]) for k in o["probabilities"]) / 2 for o in skilful)
    skill = max(o["rpss"] for o in skilful)
    score = min(1.0, shift * 2) * min(1.0, skill / .2)
    sim = ctx.get("similarity") or {}
    note = ""
    if sim.get("status") == "ok" and sim.get("analogs"):
        note = f" Past matches resemble today's trends at {sim['average'] * 100:.0f}% (resemblance, not skill; not used in this rating)."
    label = "high" if score >= .5 else "moderate" if score >= .2 else "low"
    return {"label": label, "score": round(score, 3), "kind": "evidence strength (heuristic, not calibrated against outcomes)",
            "basis": f"{len(skilful)} of {len(sys1['outlook'])} questions have verified skill (best RPSS {skill:.2f}); "
                     f"the strongest probability departs from the usual rate by {shift * 100:.0f} percentage points.{note}"}


def analog_lines(ctx: dict) -> list[str]:
    """The Laya-selected analogs, their resemblance score and what followed them (context, never a forecast)."""
    sim = ctx.get("similarity") or {}
    if sim.get("status") != "ok" or not sim.get("analogs"):
        return []
    out = [f"CONTEXT ONLY, NOT A FORECAST. Laya resemblance score (estimated share of the 9 trend changes that look alike; it is not the "
           f"probability that anything will happen), average of the {len(sim['analogs'])} closest past episodes: {sim['average'] * 100:.0f}% "
           f"(gate {sim['gate'] * 100:.0f}%). On held-out sites, what followed close matches was not a better forecast than the usual change. "
           "What followed each in the next 5 years, versus its last 5 (σ = local year-to-year swing):"]
    for c in sim["analogs"]:
        sh = c["outcome"]["shift"]
        moved = sorted(S.KEYS, key=lambda k: -abs(sh[k]))[:4]
        out.append(f"- {c['period'][0]}–{c['period'][1]} on plate {c['plate']}, similarity {c['laya_similarity'] * 100:.0f}%: "
                   + ", ".join(f"{S.INDICES[k]['label']} {sh[k]:+.1f}σ" for k in moved))
    return out


def build_prompt(ctx: dict) -> str:
    sig = ctx["signature"]
    sigs = [f"- {S.INDICES[k]['label']}: {sig['trends'][k]['slope']:+.2f} {S.INDICES[k]['unit']}/decade ({sig['trends'][k]['z']:+.1f}σ/decade, "
            f"p={sig['trends'][k]['p']:.3f}{', significant' if sig['trends'][k]['significant'] else ''})" for k in S.KEYS]
    regime = sig["regime"]
    return "\n".join([
        f"Location: {ctx['location']} ({ctx['latitude']:.2f}, {ctx['longitude']:.2f}); tectonic plate {ctx['tectonics']['plate_name']}.",
        f"Trend window {sig['start']}–{sig['end']} (NASA POWER, MERRA-2-derived). {sig['n_significant']} of 9 indices significant. "
        f"Change magnitude is at the {min(ctx['percentile'], 99.9):.1f}th percentile of {ctx['pool_size']} historical episodes on the searched plates.",
        "Current trends:", *sigs,
        *analog_lines(ctx),
        "System-1 outlook for the next 5 years versus the last 5 (evaluated forecast odds; base LIKELY NEXT only on lines marked skill verified):",
        *[f"- {g}" for g in grounded_summary(ctx)],
        f"Hazard reference: {HAZARD_GUIDE.get(regime, '')}",
        "",
        f"Computed evidence strength (do not change it): {confidence_rating(ctx)['label']}.",
        "Write exactly three short labelled lines, each one or two sentences:",
        ("LIKELY NEXT: the skill-verified outlook in plain words. You may add whether the past matches were consistent with it, but never "
         "state a direction for an index from the past matches alone, and say nothing about indices without verified skill."
         if analog_lines(ctx) else "LIKELY NEXT: the skill-verified outlook above in plain words; say nothing about indices without verified skill."),
        "HAZARDS TO WATCH: which events from the hazard reference become more plausible, and why.",
        "MONITOR: which variables to keep checking.",
    ])


@lru_cache(maxsize=1)
def _local():
    import torch
    from transformers import AutoModelForImageTextToText, AutoTokenizer
    device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(LOCAL_MODEL)
    model = AutoModelForImageTextToText.from_pretrained(LOCAL_MODEL, dtype=torch.float16 if device != "cpu" else torch.float32).to(device).eval()
    return tok, model, device


def _generate_local(prompt: str, system: str = SYSTEM, max_new_tokens: int = 230) -> str:
    import torch
    tok, model, device = _local()
    text = tok.apply_chat_template([{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                                   tokenize=False, add_generation_prompt=True, enable_thinking=False)
    inputs = tok(text, return_tensors="pt").to(device)
    with _lock, torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False, repetition_penalty=1.1)
    return tok.decode(out[0, inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()


def _generate_openai(prompt: str, system: str = SYSTEM, max_new_tokens: int = 400, cfg: dict | None = None) -> str:
    cfg = cfg or config()
    url = cfg["url"].rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {cfg['key']}"} if cfg.get("key") else {}
    r = httpx.post(url, headers=headers, timeout=180, json={"model": cfg["model"], "temperature": .2, "max_tokens": max_new_tokens,
                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]})
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()


def _generate_anthropic(prompt: str, system: str, max_new_tokens: int, cfg: dict) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=cfg["key"], timeout=180.0, max_retries=2)
    # Claude Opus 5.5 always thinks; low effort keeps a short, grounded outlook quick. A refused request
    # falls back server-side to another model instead of returning nothing.
    response = client.beta.messages.create(
        model=cfg["model"], max_tokens=max(1024, max_new_tokens * 4), system=system,
        messages=[{"role": "user", "content": prompt}], output_config={"effort": "low"},
        betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    if response.stop_reason == "refusal":
        raise RuntimeError("The cloud model declined this request.")
    return "".join(b.text for b in response.content if b.type == "text").strip()


def complete(prompt: str, system: str = SYSTEM, max_new_tokens: int = 230, cfg: dict | None = None) -> tuple[str, dict]:
    """Run the configured System-2 model (or `cfg`). Returns the text and the public part of the config (never the key)."""
    cfg = cfg or config()
    if cfg["provider"] == "anthropic":
        return _generate_anthropic(prompt, system, max_new_tokens, cfg), public(cfg)
    if cfg["provider"] == "openai":
        return _generate_openai(prompt, system, max_new_tokens, cfg), public(cfg)
    return _generate_local(prompt, system, max_new_tokens), public(cfg)


def parse(text: str) -> dict:
    sections = {}
    keys = {"LIKELY NEXT": "likely_next", "HAZARDS TO WATCH": "hazards", "CONFIDENCE": "confidence", "MONITOR": "monitor"}
    current = None
    for line in text.replace("**", "").splitlines():
        line = line.strip(" -*#")
        hit = next((k for k in keys if line.upper().startswith(k)), None)
        if hit:
            current = keys[hit]
            sections[current] = line[len(hit):].lstrip(" :").strip()
        elif current and line:
            sections[current] = (sections[current] + " " + line).strip()
    return sections


_NUMBER = re.compile(r"[-+]?\d+(?:\.\d+)?")


def guard_numbers(sections: dict, prompt: str) -> tuple[dict, int]:
    """Drop generated sentences that cite numbers absent from the evidence given to the model."""
    allowed = {float(n) for n in _NUMBER.findall(prompt)} | {float(n) for n in range(0, 11)}
    removed = 0
    clean = {}
    for key, text in sections.items():
        kept = []
        for sentence in re.split(r"(?<=[.!?])\s+", text):
            nums = [float(n) for n in _NUMBER.findall(sentence)]
            if any(min(abs(n - a) for a in allowed) > 1e-6 and min(abs(abs(n) - abs(a)) for a in allowed) > 1e-6 for n in nums):
                removed += 1
                continue
            kept.append(sentence)
        if kept:
            clean[key] = " ".join(kept)
    return clean, removed


_DIRECTION = re.compile(r"\b(ris\w*|increas\w*|fall\w*|decreas\w*|declin\w*|drop\w*|more|fewer|less|higher|lower|longer|shorter|wetter|drier|hotter|warmer|cooler|grow\w*)\b", re.I)
_TOPIC = {"t_mean": r"(average|mean)\s+temperature|temperatures?\b|warming|cooling", "hot_days": r"hot\s+days?|heat",
          "heavy_rain": r"heavy[- ]rain|rain(fall)?|downpour|flood", "dry_spell": r"dry\s+spells?|drought|dry\b"}


def guard_directions(sections: dict, ctx: dict) -> tuple[dict, int]:
    """Provenance check on LIKELY NEXT: drop sentences that give a direction for a System-1 question
    whose skill is not verified (a numeric whitelist alone cannot catch this)."""
    sys1 = ctx.get("system1") or {}
    if sys1.get("status") != "ok" or "likely_next" not in sections:
        return sections, 0
    unverified = [k for k, o in sys1["outlook"].items() if not o["skilful"]]
    verified = [k for k, o in sys1["outlook"].items() if o["skilful"]]
    kept, removed = [], 0
    for sentence in re.split(r"(?<=[.!?])\s+", sections["likely_next"]):
        hits_bad = any(re.search(_TOPIC[k], sentence, re.I) for k in unverified)
        hits_ok = any(re.search(_TOPIC[k], sentence, re.I) for k in verified)
        if hits_bad and not hits_ok and _DIRECTION.search(sentence):
            removed += 1
            continue
        kept.append(sentence)
    out = dict(sections)
    if kept:
        out["likely_next"] = " ".join(kept)
    else:
        out.pop("likely_next")
    return out, removed


def generate(ctx: dict) -> dict:
    prompt = build_prompt(ctx)
    rating = confidence_rating(ctx)
    cfg = config()
    result = {"grounded": grounded_summary(ctx), "provider": cfg["provider"], "model": cfg["model"], "cloud": cfg["cloud"],
              "prompt": prompt, "confidence": rating}
    try:
        text, _ = complete(prompt)
        sections, removed = guard_numbers(parse(text), prompt)
        sections, removed_dir = guard_directions(sections, ctx)
        result["removed_unsupported_sentences"] = removed + removed_dir
        result["removed_unverified_directions"] = removed_dir
        sections["confidence"] = f"Evidence strength: {rating['label']} (computed from verified skill, not generated; not a calibrated probability). {rating['basis']}"
        result.update({"status": "ok", "text": text, "sections": sections})
    except Exception as exc:  # the deterministic analog summary remains available
        result.update({"status": "unavailable", "reason": f"{type(exc).__name__}: {exc}"[:300]})
    return result
