"""Laya similarity confidence: how closely does a past episode's trend change match today's?

For each of the 9 climate indices a trend change "matches" when both windows move the same way
(rising / falling / flat, flat = |z| < 0.3σ per decade) with similar strength (within 0.5σ per
decade, or 35 % of the larger trend). The similarity of two windows is the share of the 9 indices
that match, so 70 % ≈ 6–7 of 9 trend changes alike.

Laya reads both trend patterns in words and numbers and answers "match / no match"; its
calibrated P(match) is the similarity confidence. It re-ranks the 40 nearest plate-scoped
episodes and keeps the 5 it is most confident about. When their average confidence is ≥ 70 %
the System-2 model is asked to predict what may happen next from those analogs (main.py).
"""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
import json
import threading
import numpy as np
from . import engine
from . import signatures as S
from .predictive import NAMES, _trend_word

MODELS = Path(__file__).parent / "models"
BASE = MODELS / "laya"
TUNED = MODELS / "laya-similarity"
GATE = 0.70
POOL = 40
TOP = 5
FLAT = 0.3
OPTIONS = {"match": "the two periods' trend changes are alike in direction and strength",
           "different": "the two periods' trend changes differ"}
QUESTION = {"type": "choice", "criteria": dict(OPTIONS),
            "instructions": "Do the past episode's climate trend changes match the current site's?"}
_lock = threading.Lock()


def _direction(z: float) -> int:
    return 0 if abs(z) < FLAT else 1 if z > 0 else -1


def index_match(za: float, zb: float) -> bool:
    return _direction(za) == _direction(zb) and abs(za - zb) <= max(.5, .35 * max(abs(za), abs(zb)))


def true_similarity(a: dict, b: dict) -> float:
    """Share of the 9 indices whose trend changes match (the quantity Laya is trained to estimate)."""
    return float(np.mean([index_match(a["trends"][k]["z"], b["trends"][k]["z"]) for k in S.KEYS]))


def matches(a: dict, b: dict) -> list[str]:
    return [k for k in S.KEYS if index_match(a["trends"][k]["z"], b["trends"][k]["z"])]


def pair_text(a: dict, b: dict) -> str:
    """Current window a vs past episode b, index by index. Only trends: no outcomes, no locations."""
    rows = []
    for k in S.KEYS:
        ta, tb = a["trends"][k], b["trends"][k]
        rows.append(f"{NAMES[k]}: {_trend_word(ta['z'])} {ta['z']:+.1f}{'*' if ta['significant'] else ''}"
                    f" | {_trend_word(tb['z'])} {tb['z']:+.1f}{'*' if tb['significant'] else ''}")
    return "Trend change per decade in local standard deviations, current site | past episode (* significant): " + "; ".join(rows) + "."


# ---------------------------------------------------------------- model
def config() -> dict | None:
    f = TUNED / "earth_config.json"
    if not f.exists() or not (TUNED / "model.safetensors").exists():
        return None
    cfg = json.loads(f.read_text())
    return cfg if cfg.get("task") == "similarity-v1" else None


def available() -> tuple[bool, str]:
    if not (BASE / "model.safetensors").exists():
        return False, "Laya checkpoint not downloaded (backend/ai/models/laya)."
    if config() is None:
        return False, "Laya similarity weights are missing; run backend.ai.train_similarity."
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False, "PyTorch/transformers are not installed in the backend environment."
    return True, ""


def encode(tok, cfg, text: str, order: tuple[int, int] = (0, 1)):
    from .laya_model import Scorer, build_sequence
    return build_sequence(tok, text, Scorer.internal(QUESTION), cfg["max_len"], cfg["head_max_len"], list(order))


def match_logit(model, tok, cfg, texts: list[str], batch: int = 16, orders=None) -> np.ndarray:
    """Logit(match) − logit(different) for each text (option order undone)."""
    import torch
    from .laya_model import QTYPES, collate
    device = next(model.parameters()).device
    orders = orders or [(0, 1)] * len(texts)
    out = []
    with torch.no_grad():
        for s in range(0, len(texts), batch):
            items = []
            for t, o in zip(texts[s:s + batch], orders[s:s + batch]):
                ids, markers = encode(tok, cfg, t, o)
                items.append({"ids": ids, "markers": markers, "qtype": QTYPES["choice"]})
            b = collate(items, tok.pad_token_id)
            z = model(*(b[k].to(device) for k in ("input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"))).float().cpu().numpy()
            for r, o in enumerate(orders[s:s + batch]):
                zz = np.empty(2)
                zz[list(o)] = z[r, :2]
                out.append(zz[0] - zz[1])
    return np.array(out)


def calibrate(d: np.ndarray, a: float, b: float) -> np.ndarray:
    return 1 / (1 + np.exp(-(a * d + b)))


def quantile_map(d: np.ndarray, cal: dict) -> np.ndarray:
    """Map Laya's match logit onto the true-share scale by matching quantiles on calibration sites.
    Platt scaling estimates the conditional mean, which pulls high similarities toward the average
    and would keep a 70 % gate shut even for genuinely close matches; quantile mapping keeps Laya's
    ranking and gives its confidences the same spread as the true shares."""
    return np.clip(np.interp(d, cal["x"], cal["y"]), 0, 1)


class Similarity:
    def __init__(self):
        from .laya_model import load
        from .laya_system1 import device_name
        cfg = config()
        if cfg is None:
            raise RuntimeError("Laya similarity weights are missing. Run: backend/.venv/bin/python -m backend.ai.train_similarity")
        self.model, self.tok, self.mcfg = load(BASE, device_name(), TUNED / "model.safetensors")
        self.cal = cfg["calibration"]
        self.report = cfg["evaluation"]

    def confidence(self, texts: list[str]) -> np.ndarray:
        with _lock:
            d = match_logit(self.model, self.tok, self.mcfg, texts)
        if self.cal.get("type") == "quantile":
            return quantile_map(d, self.cal)
        return calibrate(d, self.cal["a"], self.cal["b"])


@lru_cache(maxsize=1)
def model() -> Similarity:
    return Similarity()


def run(state: dict, latitude: float, longitude: float, plates: list[str]) -> dict:
    """Score the 40 nearest plate-scoped episodes with Laya; keep the 5 most similar."""
    ok, why = available()
    if not ok:
        return {"status": "unavailable", "reason": why}
    sig, base = state["signature"], state["baseline"]
    pool = engine.candidates(sig["vector"], base["t_mean"], base["rain"], latitude, longitude, plates, k=POOL)
    if not pool:
        return {"status": "ok", "analogs": [], "average": 0.0, "gate": GATE, "passes": False, "pool": 0, "evaluation": model().report}
    lib = engine.library()
    texts = [pair_text(sig, lib["episodes"][i]) for i, _ in pool]
    conf = model().confidence(texts)
    order = np.argsort(-conf)[:TOP]
    cards = []
    for n, j in enumerate(order):
        i, retrieval = pool[j]
        card = engine.analog_card(i, retrieval, "ABCDE"[n])
        card["laya_similarity"] = round(float(conf[j]), 3)
        card["matching_indices"] = matches(sig, lib["episodes"][i])
        cards.append(card)
    avg = float(np.mean([c["laya_similarity"] for c in cards]))
    return {"status": "ok", "analogs": cards, "average": round(avg, 3), "gate": GATE, "passes": avg >= GATE, "pool": len(pool),
            "model": "convaiinnovations/laya (ModernBERT-large, 421M), similarity fine-tune", "evaluation": model().report}
