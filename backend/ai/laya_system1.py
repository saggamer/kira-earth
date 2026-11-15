"""Laya (Convai Innovations, Apache-2.0) as a predictive System-1.

Laya is a 421M-parameter ModernBERT decision model: one forward pass per question scores its
options and returns probabilities, never free text. It is asked, for four hazard indices,
whether the next five years will fall, stay steady or rise relative to the last five
(see predictive.py). It was fine-tuned on real NASA POWER outcomes (train_laya.py) and every
answer carries its verified skill on later years at unseen sites: answers whose skill is not
established are returned with skilful=False and must not be presented as forecasts.

How unusual the current change is (plate-history percentile) and which hazard regime the trends
indicate are computed by deterministic rules in engine.py; a learned model added nothing there.

Weights: backend/ai/models/laya-earth (predictive fine-tune). The base checkpoint in
backend/ai/models/laya has no skill on this task and is never used for answers.
"""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
import json
import os
import threading
import numpy as np
from . import predictive as P

MODELS = Path(__file__).parent / "models"
BASE = MODELS / "laya"
TUNED = MODELS / "laya-earth"
_lock = threading.Lock()


def device_name() -> str:
    import torch
    if os.getenv("LAYA_DEVICE"):
        return os.environ["LAYA_DEVICE"]
    return "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"


SHIPPED = Path(__file__).parent / "data" / "system1-config.json"   # tracked copy for deployments without model weights


def earth_config() -> dict | None:
    f = TUNED / "earth_config.json"
    if not f.exists():
        f = SHIPPED
    if not f.exists():
        return None
    cfg = json.loads(f.read_text())
    return cfg if cfg.get("task") == "predictive-v2" else None


class EarthLaya:
    def __init__(self):
        from .laya_model import load, Scorer
        cfg = earth_config()
        if cfg is None:
            raise RuntimeError("Predictive Laya weights are missing. Run: backend/.venv/bin/python -m backend.ai.train_laya")
        model, tok, mcfg = load(BASE, device_name(), TUNED / "model.safetensors")
        self.temps = cfg["temperature_by_target"]
        self.report = cfg["evaluation"]
        self.logistic = cfg.get("logistic", {})
        self.scorer = Scorer(model, tok, mcfg, {"choice:3-5": 1.0})

    def score(self, state: str) -> dict:
        with _lock:
            return self.scorer.system_one(state, P.questions())["answers"]


@lru_cache(maxsize=1)
def model() -> EarthLaya:
    return EarthLaya()


def needs_laya() -> bool:
    """True only if some question is served by Laya. When the linear model won every question on
    the calibration years, the 0.9 GB network is never loaded."""
    cfg = earth_config()
    return bool(cfg) and any(v.get("served_model") == "laya" for v in cfg["evaluation"]["test"].values())


def available() -> tuple[bool, str]:
    if earth_config() is None:
        return False, "Predictive System-1 is not trained; run backend.ai.train_laya."
    if not needs_laya():
        return True, ""
    if not (BASE / "model.safetensors").exists() or not (TUNED / "model.safetensors").exists():
        return False, "Laya weights are missing (backend/ai/models/laya, laya-earth)."
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False, "PyTorch/transformers are not installed in the backend environment."
    return True, ""


def retemper(probs: dict, t: float) -> dict:
    """Apply the calibration temperature fitted on held-out years (softmax(z/T) = p^(1/T) renormalised)."""
    p = np.array([max(probs[c], 1e-12) for c in P.CLASSES]) ** (1 / t)
    p /= p.sum()
    return {c: round(float(v), 4) for c, v in zip(P.CLASSES, p)}


def run(plate: str, baseline: dict, sig: dict, latitude: float) -> dict:
    ok, why = available()
    if not ok:
        return {"status": "unavailable", "reason": why}
    cfg = earth_config()
    report, logistic = cfg["evaluation"], cfg.get("logistic", {})
    state = P.state_text(plate, baseline, sig)
    raw = model().score(state) if needs_laya() else None
    test = report["test"]
    x = P.features(sig, baseline, latitude)
    outlook = {}
    for key, label in P.TARGETS.items():
        ev = test[key]
        source = ev.get("served_model", "laya")
        laya_p = retemper(raw[key]["probabilities"], cfg["temperature_by_target"][key]) if raw and key in cfg.get("temperature_by_target", {}) else None
        if (source == "logistic" and key in logistic) or laya_p is None:
            probs = {c: round(float(v), 4) for c, v in zip(P.CLASSES, P.logistic_predict(logistic[key], x)[0])}
            source = "logistic"
        else:
            probs, source = laya_p, "laya"
        served = ev.get("served") or ev["logistic"]
        clim = report["climatology"][key]
        best = max(probs, key=probs.get)
        outlook[key] = {"label": label, "probabilities": probs, "most_likely": best, "climatology": clim, "source": source,
                        "laya_probabilities": laya_p, "skilful": bool(ev["skilful"]), "rpss": served["rpss"],
                        "rpss_ci": served["rpss_ci"], "laya_rpss": (ev.get("laya") or {}).get("rpss"), "logistic_rpss": ev["logistic"]["rpss"],
                        "accuracy": served["accuracy"]}
    served = sorted({o["source"] for o in outlook.values()})
    name = {"laya": "convaiinnovations/laya (ModernBERT-large, 421M), predictive fine-tune",
            "logistic": "multinomial logistic regression on the trend signature"}
    return {"status": "ok", "weights": "fine-tuned", "model": " + ".join(name[s] for s in served), "laya_loaded": raw is not None,
            "task": report["task"], "horizon_years": 5, "outlook": outlook, "evaluation": report, "state": state}
