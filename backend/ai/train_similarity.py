"""Fine-tune Laya to give a calibrated similarity confidence between two trend windows.

    backend/.venv/bin/python -m backend.ai.train_similarity        # ~40 min on Apple MPS

Pairs: each library episode (query) against episodes from the 40 nearest plate-scoped candidates
(the same pool the app re-ranks). Target: the share of the 9 indices whose trend changes match
(similarity.py). Sites are split: 80 % of anchors train (10 % of those calibrate), 20 % test.
Reported on test sites: error of Laya's confidence against the true share, the retrieval score
as a baseline, how often the 70 % gate opens, and whether gated analogs foretold the next 5 years
better than the usual change.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import random
import time
from datetime import datetime, timezone
import numpy as np
import torch
from . import engine
from . import signatures as S
from . import similarity as M
from .laya_model import QTYPES, collate, load
from .predictive import pool_of
from .tectonics import tectonic_context
from .laya_system1 import device_name


def split(anchor: str) -> str:
    if pool_of(anchor) == "test":
        return "test"
    return "calib" if int(hashlib.md5(anchor.encode()).hexdigest(), 16) % 10 == 0 else "train"


def pools(rng, per_split: dict):
    lib = engine.library()
    eps = lib["episodes"]
    plates = {}
    queries = {s: [] for s in per_split}
    for i, e in enumerate(eps):
        if e["n_significant"] > 0 and e["outcome"] is not None:
            queries[split(e["anchor"])].append(i)
    out = {}
    for s, n in per_split.items():
        chosen = rng.sample(queries[s], min(n, len(queries[s])))
        rows = []
        for qi in chosen:
            q = eps[qi]
            a = lib["anchors"][q["anchor"]]
            if q["anchor"] not in plates:
                plates[q["anchor"]] = tectonic_context(a["latitude"], a["longitude"])["searched_plates"]
            cand = engine.candidates(q["vector"], a["baseline"]["t_mean"], a["baseline"]["rain"], a["latitude"], a["longitude"],
                                     plates[q["anchor"]], before_year=q["end"], exclude_anchor=q["anchor"], k=M.POOL)
            if len(cand) >= M.TOP:
                rows.append({"query": qi, "cands": cand})
        out[s] = rows
    return out


def pairs(rows, per_query, rng):
    eps = engine.library()["episodes"]
    out = []
    for r in rows:
        q = eps[r["query"]]
        picks = r["cands"] if per_query is None else rng.sample(r["cands"], min(per_query, len(r["cands"])))
        for i, retrieval in picks:
            out.append({"text": M.pair_text(q, eps[i]), "y": M.true_similarity(q, eps[i]), "retrieval": retrieval,
                        "query": r["query"], "cand": i})
    return out


def platt(d, y):
    a = torch.tensor(1.0, dtype=torch.float64, requires_grad=True)
    b = torch.tensor(0.0, dtype=torch.float64, requires_grad=True)
    dt, yt = torch.tensor(d, dtype=torch.float64), torch.tensor(y, dtype=torch.float64)
    opt = torch.optim.LBFGS([a, b], max_iter=200, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.binary_cross_entropy_with_logits(a * dt + b, yt)
        loss.backward()
        return loss
    opt.step(closure)
    return float(a.detach()), float(b.detach())


def metrics(p, y):
    return {"n": int(len(y)), "mae": round(float(np.abs(p - y).mean()), 4), "pearson_r": round(float(np.corrcoef(p, y)[0, 1]), 4),
            "mean_predicted": round(float(p.mean()), 4), "mean_true": round(float(y.mean()), 4)}


def gate_report(rows, conf_by_pair, rng_mean):
    """Per test query: Laya keeps its 5 most confident of 40; does the gate agree with the true share,
    and did gated analogs foretell the next 5 years better than the usual (train-mean) change?"""
    eps = engine.library()["episodes"]
    rec = []
    for r in rows:
        q = eps[r["query"]]
        conf = np.array([conf_by_pair[(r["query"], i)] for i, _ in r["cands"]])
        top = np.argsort(-conf)[:M.TOP]
        picked = [r["cands"][j][0] for j in top]
        avg = float(conf[top].mean())
        true_avg = float(np.mean([M.true_similarity(q, eps[i]) for i in picked]))
        actual = np.array([q["outcome"]["shift"][k] for k in S.KEYS])
        analog = np.mean([[eps[i]["outcome"]["shift"][k] for k in S.KEYS] for i in picked], axis=0)
        rec.append({"avg": avg, "true": true_avg, "err_analog": float(np.sqrt(((analog - actual) ** 2).mean())),
                    "err_mean": float(np.sqrt(((rng_mean - actual) ** 2).mean()))})
    passes = np.array([x["avg"] >= M.GATE for x in rec])
    true_pass = np.array([x["true"] >= M.GATE for x in rec])

    def rmse(sel, key):
        return round(float(np.mean([x[key] for x, s in zip(rec, sel) if s])), 4) if sel.any() else None
    return {"queries": len(rec), "gate_open_rate": round(float(passes.mean()), 4), "true_open_rate": round(float(true_pass.mean()), 4),
            "gate_agreement": round(float((passes == true_pass).mean()), 4),
            "mean_confidence_vs_true": metrics(np.array([x["avg"] for x in rec]), np.array([x["true"] for x in rec])),
            "outcome_rmse_sigma": {"gate_open": {"analogs": rmse(passes, "err_analog"), "usual_change": rmse(passes, "err_mean"), "n": int(passes.sum())},
                                   "gate_closed": {"analogs": rmse(~passes, "err_analog"), "usual_change": rmse(~passes, "err_mean"), "n": int((~passes).sum())}}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-queries", type=int, default=600)
    ap.add_argument("--per-query", type=int, default=6)
    ap.add_argument("--test-queries", type=int, default=160)
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--train-layers", type=int, default=8)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--recalibrate", action="store_true", help="reuse saved weights; refit calibration and re-evaluate")
    args = ap.parse_args()
    rng = random.Random(4242)
    torch.manual_seed(4242)
    t0 = time.time()
    P = pools(rng, {"train": args.train_queries, "calib": 120, "test": args.test_queries})
    train = pairs(P["train"], args.per_query, rng)
    calib = pairs(P["calib"], args.per_query, rng)
    test_all = pairs(P["test"], None, rng)            # all 40 per query: needed for the re-ranking/gate report
    print(f"pairs train {len(train)} calib {len(calib)} test {len(test_all)} ({len(P['test'])} queries) · "
          f"true similarity mean {np.mean([p['y'] for p in train]):.3f}", flush=True)
    lib = engine.library()
    train_mean = np.mean([[lib["episodes"][r["query"]]["outcome"]["shift"][k] for k in S.KEYS] for r in P["train"]], axis=0)

    # Baseline: the retrieval score, linearly mapped to the true share on training pairs.
    rx, ry = np.array([p["retrieval"] for p in train]), np.array([p["y"] for p in train])
    slope, icpt = np.polyfit(rx, ry, 1)
    ty = np.array([p["y"] for p in test_all])
    baseline = metrics(np.clip(slope * np.array([p["retrieval"] for p in test_all]) + icpt, 0, 1), ty)
    print("retrieval-score baseline:", baseline, flush=True)

    device = device_name()
    if args.recalibrate:
        model, tok, cfg = load(M.BASE, device, M.TUNED / "model.safetensors")
        old = json.loads((M.TUNED / "earth_config.json").read_text())["evaluation"]
        return finish(args, model, tok, cfg, P, train, calib, test_all, ty, baseline, old["test"]["laya_zero_shot"],
                      train_mean, old["steps"], device, t0, save_weights=False)
    model, tok, cfg = load(M.BASE, device)

    def score(items):
        return M.match_logit(model, tok, cfg, [p["text"] for p in items])

    d_cal = score(calib)
    a0, b0 = platt(d_cal, np.array([p["y"] for p in calib]))
    zero = metrics(M.calibrate(score(test_all), a0, b0), ty)
    print("base Laya (zero-shot, calibrated):", zero, flush=True)

    for prm in model.parameters():
        prm.requires_grad = False
    for layer in model.encoder.layers[-args.train_layers:]:
        for prm in layer.parameters():
            prm.requires_grad = True
    for prm in model.encoder.final_norm.parameters():
        prm.requires_grad = True
    head = [p for n, p in model.named_parameters() if not n.startswith("encoder.") and not n.startswith("act_head")]
    for p in head:
        p.requires_grad = True
    enc = [p for p in model.encoder.parameters() if p.requires_grad]
    opt = torch.optim.AdamW([{"params": enc, "lr": args.lr}, {"params": head, "lr": args.lr * 4}], weight_decay=.01)
    items = []
    for _ in range(args.epochs):
        epoch = []
        for p in train:
            order = (0, 1) if rng.random() < .5 else (1, 0)        # option order must not leak the answer
            ids, markers = M.encode(tok, cfg, p["text"], order)
            target = [p["y"], 1 - p["y"]]                          # soft target: share of matching indices
            epoch.append({"ids": ids, "markers": markers, "qtype": QTYPES["choice"], "target": [target[o] for o in order]})
        rng.shuffle(epoch)
        items += epoch
    total = (len(items) + args.batch - 1) // args.batch
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[args.lr, args.lr * 4], total_steps=total, pct_start=.1)
    model.train()
    running = []
    for step, s in enumerate(range(0, len(items), args.batch), 1):
        b = collate(items[s:s + args.batch], tok.pad_token_id)
        z = model(*(b[k].to(device) for k in ("input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype")))
        loss = -(b["target"].to(device) * torch.log_softmax(z, -1)).sum(-1).mean()
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_([*enc, *head], 1.0)
        opt.step()
        sched.step()
        running.append(loss.item())
        if step % 25 == 0 or step == total:
            print(f"step {step}/{total} loss {np.mean(running[-25:]):.3f} · {(time.time() - t0) / 60:.1f} min", flush=True)
    model.eval()
    finish(args, model, tok, cfg, P, train, calib, test_all, ty, baseline, zero, train_mean, total, device, t0)


def finish(args, model, tok, cfg, P, train, calib, test_all, ty, baseline, zero, train_mean, total, device, t0, save_weights=True):
    def score(items):
        return M.match_logit(model, tok, cfg, [p["text"] for p in items])
    d_cal, y_cal = score(calib), np.array([p["y"] for p in calib])
    q = np.linspace(0, 100, 101)
    cal = {"type": "quantile", "x": np.percentile(d_cal, q).tolist(), "y": np.percentile(y_cal, q).tolist()}
    a, b = platt(d_cal, y_cal)
    d_test = score(test_all)
    platt_metrics = metrics(M.calibrate(d_test, a, b), ty)
    p_test = M.quantile_map(d_test, cal)
    tuned = metrics(p_test, ty)
    conf = {(p["query"], p["cand"]): float(c) for p, c in zip(test_all, p_test)}
    gate = gate_report(P["test"], conf, train_mean)
    print("fine-tuned Laya (quantile):", tuned, "\nPlatt:", platt_metrics, "\ngate:", json.dumps(gate), flush=True)

    evaluation = {
        "trained_at": datetime.now(timezone.utc).isoformat(), "task": "similarity confidence between two 15-year trend windows",
        "definition": "share of the 9 indices whose trend changes match: same direction (flat = |z|<0.3σ/decade) and within 0.5σ/decade or 35%",
        "gate": M.GATE, "pool": M.POOL, "top": M.TOP,
        "split": "80% of anchor sites train (10% of those calibrate), 20% held-out sites test",
        "pairs": {"train": len(train), "calib": len(calib), "test": len(test_all)}, "steps": total, "device": device,
        "hyperparameters": vars(args), "calibration": "quantile mapping on calibration sites (Platt scaling kept the 70% gate shut)",
        "test": {"retrieval_baseline": baseline, "laya_zero_shot": zero, "laya": tuned, "laya_platt": platt_metrics}, "gate_report": gate,
    }
    M.TUNED.mkdir(parents=True, exist_ok=True)
    from safetensors.torch import save_file
    state = {k: v.detach().to("cpu", torch.bfloat16 if v.is_floating_point() else v.dtype).contiguous() for k, v in model.state_dict().items()}
    if save_weights:
        save_file(state, str(M.TUNED / "model.safetensors"))
    (M.TUNED / "earth_config.json").write_text(json.dumps({"task": "similarity-v1", "calibration": cal, "platt": {"a": a, "b": b},
                                                           "evaluation": evaluation}, indent=1))
    print(f"saved {M.TUNED} · {(time.time() - t0) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
