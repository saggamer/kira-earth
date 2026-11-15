"""Predictive System-1 targets, honest splits, baselines and forecast-verification scores.

Question asked of every 15-year episode: over the NEXT five years, compared with the LAST five,
does each hazard index fall, stay steady, or rise? Threshold: half of the local interannual σ.
These labels come from what really happened afterwards (NASA POWER), so they cannot be computed
from the inputs by a rule — unlike the earlier severity/regime labels.

Each episode has an input window (15 years ending at its forecast ORIGIN year) and an OUTCOME
interval (origin+1 … origin+5). Splits are horizon-purged: every outcome used for training is
observed before the first calibration origin, and every calibration outcome before the first test
origin, so no partition learns from years another partition is asked to forecast. Sites are held
out as well (20 % of anchors only ever appear in the test set):
  train  : train-pool anchors, origins ≤ 2001 (outcomes ≤ 2006)
  calib  : train-pool anchors, origins 2007–2009 (outcomes ≤ 2014; model selection only)
  test   : held-out anchors, origins ≥ 2015 (outcomes 2016–2025)
assert_purged() enforces this on the actual rows before any fitting.
Score: ranked probability skill score (RPSS) against train-period climatology, the standard
skill measure for 3-category probabilistic forecasts. A question is shown in the app only if its
test RPSS is positive with a 95 % bootstrap interval (resampling whole sites) above zero.
"""
from __future__ import annotations
import hashlib
import numpy as np
from . import signatures as S

TARGETS = {
    "t_mean": "average temperature",
    "hot_days": "number of hot days",
    "heavy_rain": "number of heavy-rain days",
    "dry_spell": "longest dry spell",
}
CLASSES = ["fall", "steady", "rise"]
THRESHOLD = 0.5  # σ
HORIZON = 5
TRAIN_END, CALIB_ENDS, TEST_START = 2001, (2007, 2009), 2015
SPLIT_VERSION = "purged-v1"
OPTIONS = {
    "fall": "fall: the next five years average more than half a typical year-to-year swing lower",
    "steady": "steady: within half a typical year-to-year swing of the last five years",
    "rise": "rise: the next five years average more than half a typical year-to-year swing higher",
}


def label(shift: float) -> str:
    return "rise" if shift > THRESHOLD else "fall" if shift < -THRESHOLD else "steady"


def pool_of(anchor_id: str) -> str:
    return "test" if int(hashlib.sha1(anchor_id.encode()).hexdigest(), 16) % 10 < 2 else "train"


def origin(ep: dict) -> int:
    """Last input year: the forecast is issued at the end of this year."""
    return int(ep["end"])


def outcome_years(ep: dict) -> tuple[int, int]:
    return origin(ep) + 1, origin(ep) + HORIZON


def assert_purged(rows: list[dict]) -> dict:
    """Reject any split where an earlier partition's latest outcome is at or after a later partition's
    first forecast origin. Returns the split manifest that is saved with the evaluation."""
    parts = {}
    for name in ("train", "calib", "test"):
        ends = sorted({int(r["end"]) for r in rows if r["split"] == name})
        if ends:
            parts[name] = {"origins": ends, "first_origin": ends[0], "last_outcome": ends[-1] + HORIZON,
                           "rows": sum(r["split"] == name for r in rows), "sites": len({r["anchor"] for r in rows if r["split"] == name})}
    for a, b in (("train", "calib"), ("calib", "test"), ("train", "test")):
        if a in parts and b in parts and parts[a]["last_outcome"] >= parts[b]["first_origin"]:
            raise ValueError(f"Temporal leakage: {a} outcomes reach {parts[a]['last_outcome']}, "
                             f"at or after the first {b} origin {parts[b]['first_origin']}.")
    train_sites = {r["anchor"] for r in rows if r["split"] in ("train", "calib")}
    if train_sites & {r["anchor"] for r in rows if r["split"] == "test"}:
        raise ValueError("Site leakage: a test site also appears in training or calibration.")
    return {"version": SPLIT_VERSION, "horizon_years": HORIZON, "partitions": parts,
            "rule": "latest outcome of each earlier partition < first forecast origin of each later partition; test sites disjoint"}


def split_of(ep: dict) -> str | None:
    if ep.get("outcome") is None:
        return None
    if pool_of(ep["anchor"]) == "test":
        return "test" if ep["end"] >= TEST_START else None
    if ep["end"] <= TRAIN_END:
        return "train"
    if CALIB_ENDS[0] <= ep["end"] <= CALIB_ENDS[1]:
        return "calib"
    return None


def _trend_word(z: float) -> str:
    a = abs(z)
    if a < .3:
        return "flat"
    side = "rising" if z > 0 else "falling"
    return f"slightly {side}" if a < 1 else side if a < 2 else f"strongly {side}"


def _recent_word(r: float) -> str:
    a = abs(r)
    if a < .3:
        return "recent years on the trend line"
    side = "above" if r > 0 else "below"
    return f"recent years {side} the trend" if a < .8 else f"recent years far {side} the trend"


NAMES = {"t_mean": "mean temperature", "t_max": "day maximum", "t_min": "night minimum", "rain": "rainfall",
         "hot_days": "hot days", "warm_nights": "warm nights", "cold_days": "cold days", "heavy_rain": "heavy-rain days",
         "dry_spell": "dry spell"}


def state_text(plate: str, baseline: dict, sig: dict) -> str:
    """What System-1 sees: the window's trends and where recent years sit, never the future.
    Words first (language models read categories more reliably than digits), numbers after."""
    t = sig["trends"]
    rows = "; ".join(f"{NAMES[k]}: {_trend_word(t[k]['z'])}{' (significant)' if t[k]['significant'] else ''}, "
                     f"{_recent_word(t[k].get('recent', 0))} [{t[k]['z']:+.1f}, {t[k].get('recent', 0):+.1f}]" for k in S.KEYS)
    climate = "hot" if baseline["t_mean"] > 22 else "warm" if baseline["t_mean"] > 14 else "cool" if baseline["t_mean"] > 4 else "cold"
    wet = "very dry" if baseline["rain"] < 250 else "dry" if baseline["rain"] < 600 else "moist" if baseline["rain"] < 1500 else "wet"
    return (f"A {climate}, {wet} site on plate {plate} (mean {baseline['t_mean']:.0f}C, {baseline['rain']:.0f} mm/yr). "
            f"Fifteen-year trends ending {sig['end']}: {rows}.")


def question(key: str) -> dict:
    return {"type": "choice", "criteria": dict(OPTIONS),
            "instructions": f"Over the next five years, compared with the last five, how will this site's {TARGETS[key]} change?"}


def questions() -> dict:
    return {k: question(k) for k in TARGETS}


def features(ep: dict, baseline: dict, lat: float) -> np.ndarray:
    """Numeric inputs for the statistical baseline: same information as the Laya state text."""
    t = ep["trends"]
    z = [t[k]["z"] for k in S.KEYS]
    r = [t[k].get("recent", 0.0) for k in S.KEYS]
    sig = [float(t[k]["significant"]) for k in S.KEYS]
    return np.array([*z, *r, *sig, baseline["t_mean"] / 10, np.log1p(max(baseline["rain"], 0)) / 3, abs(lat) / 45], dtype=float)


# ---------------------------------------------------------------- verification
def rps(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Ranked probability score for ordered categories (fall < steady < rise); p: n×3, y: n ints."""
    obs = np.zeros_like(p)
    obs[np.arange(len(y)), y] = 1
    return ((np.cumsum(p, 1) - np.cumsum(obs, 1)) ** 2).sum(1) / (p.shape[1] - 1)


def rpss(p: np.ndarray, y: np.ndarray, clim: np.ndarray) -> float:
    ref = rps(np.tile(clim, (len(y), 1)), y).mean()
    return float(1 - rps(p, y).mean() / ref) if ref > 0 else 0.0


def bootstrap_rpss(p, y, clim, groups, n: int = 1000, seed: int = 7) -> tuple[float, float]:
    """95 % interval resampling whole sites (episodes from one site are correlated)."""
    rng = np.random.default_rng(seed)
    ids = np.unique(groups)
    idx = {g: np.where(groups == g)[0] for g in ids}
    ref_all = rps(np.tile(clim, (len(y), 1)), y)
    mod_all = rps(p, y)
    vals = []
    for _ in range(n):
        pick = np.concatenate([idx[g] for g in rng.choice(ids, len(ids))])
        ref = ref_all[pick].mean()
        vals.append(1 - mod_all[pick].mean() / ref if ref > 0 else 0.0)
    lo, hi = np.percentile(vals, [2.5, 97.5])
    return float(lo), float(hi)


def ece(p: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    conf, pred = p.max(1), p.argmax(1)
    correct = (pred == y).astype(float)
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            total += m.mean() * abs(conf[m].mean() - correct[m].mean())
    return float(total)


def scores(p: np.ndarray, y: np.ndarray, clim: np.ndarray, groups: np.ndarray) -> dict:
    lo, hi = bootstrap_rpss(p, y, clim, groups)
    return {"n": int(len(y)), "rpss": round(rpss(p, y, clim), 4), "rpss_ci": [round(lo, 4), round(hi, 4)],
            "accuracy": round(float((p.argmax(1) == y).mean()), 4), "ece": round(ece(p, y), 4),
            "log_loss": round(float(-np.log(np.clip(p[np.arange(len(y)), y], 1e-9, 1)).mean()), 4)}


def fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = 1.0, iters: int = 400):
    """Multinomial logistic regression (L2) with standardised inputs; returns predict_proba."""
    import torch
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Xt = torch.tensor((X - mu) / sd, dtype=torch.float64)
    yt = torch.tensor(y)
    W = torch.zeros(X.shape[1], 3, dtype=torch.float64, requires_grad=True)
    b = torch.zeros(3, dtype=torch.float64, requires_grad=True)
    opt = torch.optim.LBFGS([W, b], max_iter=iters, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.cross_entropy(Xt @ W + b, yt) + l2 / len(y) * (W ** 2).sum()
        loss.backward()
        return loss
    opt.step(closure)
    params = {"mu": mu.tolist(), "sd": sd.tolist(), "W": W.detach().numpy().tolist(), "b": b.detach().numpy().tolist()}
    return lambda Xn: logistic_predict(params, Xn), params


def logistic_predict(params: dict, X: np.ndarray) -> np.ndarray:
    z = ((np.atleast_2d(X) - np.array(params["mu"])) / np.array(params["sd"])) @ np.array(params["W"]) + np.array(params["b"])
    z -= z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)
