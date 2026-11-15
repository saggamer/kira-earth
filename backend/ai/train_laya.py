"""Fine-tune Laya as a predictive System-1: will each hazard index fall, stay steady or rise next?

    backend/.venv/bin/python -m backend.ai.train_laya --baselines-only   # minutes: climatology + logistic
    backend/.venv/bin/python -m backend.ai.train_laya                    # ~1 h on Apple MPS

Labels are real outcomes from the NASA POWER library (see predictive.py for targets and the
time + site split). Laya is compared against climatology and a multinomial logistic regression
that sees the same numbers, on later years at sites it never saw. Per-question temperatures are
fitted on the calibration years. Earlier severity/regime targets were dropped: they were
deterministic functions of the inputs, so accuracy on them measured rule imitation, not skill.
"""
from __future__ import annotations
import argparse
import json
import random
import time
from datetime import datetime, timezone
import numpy as np
import torch
from . import engine
from . import predictive as P
from .laya_model import QTYPES, Scorer, build_sequence, collate, load, render_options
from .laya_system1 import BASE, TUNED, device_name

K = len(P.CLASSES)
LOGISTIC: dict = {}


def causal_baseline(anchor: dict, end: int) -> dict:
    years = anchor["years"]
    keep = [i for i, y in enumerate(years) if y <= end]
    t = [anchor["annual"]["t_mean"][i] for i in keep if anchor["annual"]["t_mean"][i] is not None]
    r = [anchor["annual"]["rain"][i] for i in keep if anchor["annual"]["rain"][i] is not None]
    return {"t_mean": float(np.mean(t)), "rain": float(np.mean(r))}


def build_rows():
    lib = engine.library()
    rows = []
    for e in lib["episodes"]:
        split = P.split_of(e)
        if split is None:
            continue
        a = lib["anchors"][e["anchor"]]
        base = causal_baseline(a, e["end"])
        rows.append({"split": split, "anchor": e["anchor"], "end": e["end"], "plate": e["plate"],
                     "state": P.state_text(e["plate"], base, e), "x": P.features(e, base, a["latitude"]),
                     "y": {k: P.CLASSES.index(P.label(e["outcome"]["shift"][k])) for k in P.TARGETS}})
    return rows


def items_for(rows, tok, cfg, rng=None):
    out = []
    for r in rows:
        for key, qdef in P.questions().items():
            q = Scorer.internal(qdef)
            order = list(range(K))
            if rng is not None:
                rng.shuffle(order)  # option order must not leak the answer
            ids, markers = build_sequence(tok, r["state"], q, cfg["max_len"], cfg["head_max_len"], order)
            if len(markers) != len(render_options(q)):
                raise ValueError("options exceed the head budget")
            y = r["y"][key]
            out.append({"ids": ids, "markers": markers, "qtype": QTYPES["choice"], "order": order, "key": key,
                        "target": [1.0 if o == y else 0.0 for o in order], "y": y, "anchor": r["anchor"]})
    return out


def forward(model, b, device):
    return model(*(b[k].to(device) for k in ("input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype")))


@torch.no_grad()
def predict(model, items, tok, device, batch=16):
    """Class-ordered logits (fall, steady, rise) for each item."""
    model.eval()
    out = []
    for s in range(0, len(items), batch):
        chunk = items[s:s + batch]
        z = forward(model, collate(chunk, tok.pad_token_id), device).float().cpu().numpy()
        for r, it in enumerate(chunk):
            logits = np.empty(K)
            logits[it["order"]] = z[r, :K]
            out.append(logits)
    return np.array(out)


def softmax(z, t=1.0):
    z = z / t
    z = z - z.max(-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(-1, keepdims=True)


def fit_temperature(z, y):
    grid = np.exp(np.linspace(np.log(.2), np.log(8), 80))
    nll = [-np.log(softmax(z, t)[np.arange(len(y)), y] + 1e-12).mean() for t in grid]
    return float(grid[int(np.argmin(nll))])


def evaluate_baselines(rows):
    tr = [r for r in rows if r["split"] == "train"]
    te = [r for r in rows if r["split"] == "test"]
    groups = np.array([r["anchor"] for r in te])
    out, clims = {}, {}
    for key in P.TARGETS:
        ytr = np.array([r["y"][key] for r in tr])
        yte = np.array([r["y"][key] for r in te])
        clim = np.bincount(ytr, minlength=K) / len(ytr)
        clims[key] = clim
        predict_fn, params = P.fit_logistic(np.array([r["x"] for r in tr]), ytr)
        logit = predict_fn(np.array([r["x"] for r in te]))
        LOGISTIC[key] = {"params": params, "predict": predict_fn}
        test_freq = np.bincount(yte, minlength=K) / len(yte)
        out[key] = {"train_frequencies": dict(zip(P.CLASSES, np.round(clim, 4).tolist())),
                    "test_frequencies": dict(zip(P.CLASSES, np.round(test_freq, 4).tolist())),
                    "climatology": P.scores(np.tile(clim, (len(yte), 1)), yte, clim, groups),
                    "logistic": P.scores(logit, yte, clim, groups)}
    return out, clims


def write_logistic_only(rows, counts, manifest, clims, t0):
    """Serve the linear model on the horizon-purged split. L2 strength is chosen on the calibration
    origins only; the test origins are touched once, for the final report."""
    tr = [r for r in rows if r["split"] == "train"]
    ca = [r for r in rows if r["split"] == "calib"]
    te = [r for r in rows if r["split"] == "test"]
    groups = np.array([r["anchor"] for r in te])
    Xtr, Xca, Xte = (np.array([r["x"] for r in part]) for part in (tr, ca, te))
    test, params_all, chosen_l2 = {}, {}, {}
    for key in P.TARGETS:
        ytr, yca, yte = (np.array([r["y"][key] for r in part]) for part in (tr, ca, te))
        grid = {}
        for l2 in (0.1, 1.0, 10.0, 100.0):
            fn, params = P.fit_logistic(Xtr, ytr, l2=l2)
            grid[l2] = (P.rpss(fn(Xca), yca, clims[key]), fn, params)
        l2 = max(grid, key=lambda k: grid[k][0])
        cal_rpss, fn, params = grid[l2]
        chosen_l2[key] = l2
        params_all[key] = params
        logistic = P.scores(fn(Xte), yte, clims[key], groups)
        climo = P.scores(np.tile(clims[key], (len(yte), 1)), yte, clims[key], groups)
        test[key] = {"train_frequencies": dict(zip(P.CLASSES, np.round(clims[key], 4).tolist())),
                     "test_frequencies": dict(zip(P.CLASSES, np.round(np.bincount(yte, minlength=K) / len(yte), 4).tolist())),
                     "climatology": climo, "logistic": logistic, "laya_zero_shot": None, "laya": None,
                     "served_model": "logistic", "served": logistic, "calibration_rpss": {"logistic": round(cal_rpss, 4), "laya": None},
                     "skilful": bool(logistic["rpss_ci"][0] > 0), "l2": l2}
        print(f"{key:11s} l2={l2:<6} calib RPSS {cal_rpss:+.3f} · test RPSS {logistic['rpss']:+.3f} CI {logistic['rpss_ci']} "
              f"skilful {test[key]['skilful']}", flush=True)
    lib = engine.library()
    p = manifest["partitions"]
    evaluation = {
        "trained_at": datetime.now(timezone.utc).isoformat(), "task": "next-5-year direction of hazard indices (fall/steady/rise, ±0.5σ)",
        "targets": P.TARGETS, "classes": P.CLASSES, "threshold_sigma": P.THRESHOLD,
        "split": {"train": f"80% of sites, origins {p['train']['origins'][0]}–{p['train']['origins'][-1]} (outcomes to {p['train']['last_outcome']})",
                  "calibration": f"same sites, origins {p['calib']['origins'][0]}–{p['calib']['origins'][-1]} (outcomes to {p['calib']['last_outcome']}); L2 strength chosen here",
                  "test": f"20% held-out sites, origins {p['test']['origins'][0]}–{p['test']['origins'][-1]} (outcomes {p['test']['first_origin'] + 1}–{p['test']['last_outcome']})"},
        "split_manifest": manifest, "rows": counts,
        "metric": "RPSS vs train-period climatology (baseline); 95% CI from 1000 site-level bootstrap resamples",
        "baseline": "climatology: the class frequencies of the training outcomes",
        "test": test,
        "selection": "Linear model only. Fine-tuned Laya was evaluated on the earlier overlapping split and has not been re-evaluated on the purged split, so it is not served.",
        "climatology": {k: dict(zip(P.CLASSES, np.round(clims[k], 4).tolist())) for k in P.TARGETS},
        "data": "NASA POWER daily (MERRA-2-derived) at PB2002-plate anchors; causal σ; 15-yr windows, 5-yr outcomes",
        "versions": {"split": P.SPLIT_VERSION, "library_built_at": lib.get("built_at"), "library_end_year": lib.get("end_year"),
                     "model": "multinomial logistic regression (L2), backend.ai.predictive.fit_logistic"},
    }
    cfg_path = TUNED / "earth_config.json"
    old = json.loads(cfg_path.read_text()) if cfg_path.exists() else {}
    TUNED.mkdir(parents=True, exist_ok=True)
    cfg_path.write_text(json.dumps({"task": "predictive-v2", "temperature_by_target": old.get("temperature_by_target", {}),
                                    "logistic": params_all, "temperature_by_options": {"choice:3-5": 1.0}, "evaluation": evaluation}, indent=1))
    print(f"saved {cfg_path} · {(time.time() - t0) / 60:.1f} min", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--baselines-only", action="store_true")
    ap.add_argument("--logistic-only", action="store_true",
                    help="re-evaluate and serve the linear model only (horizon-purged split); keeps Laya weights unused")
    ap.add_argument("--episodes", type=int, default=2000, help="training episodes sampled (4 questions each)")
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--train-layers", type=int, default=8)
    ap.add_argument("--lr", type=float, default=5e-5)
    args = ap.parse_args()
    rng = random.Random(1729)
    torch.manual_seed(1729)
    t0 = time.time()
    rows = build_rows()
    manifest = P.assert_purged(rows)
    counts = {s: sum(r["split"] == s for r in rows) for s in ("train", "calib", "test")}
    print(f"rows {counts} · test sites {len({r['anchor'] for r in rows if r['split'] == 'test'})}", flush=True)
    base_scores, clims = evaluate_baselines(rows)
    for k, v in base_scores.items():
        print(f"{k:11s} train freq {v['train_frequencies']} test freq {v['test_frequencies']}\n"
              f"            climatology RPSS {v['climatology']['rpss']:+.3f} · logistic RPSS {v['logistic']['rpss']:+.3f} "
              f"CI {v['logistic']['rpss_ci']} acc {v['logistic']['accuracy']}", flush=True)
    if args.baselines_only:
        return
    if args.logistic_only:
        write_logistic_only(rows, counts, manifest, clims, t0)
        return

    device = device_name()
    model, tok, cfg = load(BASE, device)
    train_rows = rng.sample([r for r in rows if r["split"] == "train"], min(args.episodes, counts["train"]))
    calib_items = items_for([r for r in rows if r["split"] == "calib"], tok, cfg)
    test_rows = [r for r in rows if r["split"] == "test"]
    test_items = items_for(test_rows, tok, cfg)

    def report(z_all, temps):
        out = {}
        for key in P.TARGETS:
            m = np.array([it["key"] == key for it in test_items])
            y = np.array([it["y"] for it in test_items])[m]
            g = np.array([it["anchor"] for it in test_items])[m]
            out[key] = P.scores(softmax(z_all[m], temps.get(key, 1.0)), y, clims[key], g)
        return out

    zero = report(predict(model, test_items, tok, device), {})
    print("base Laya (zero-shot):", {k: v["rpss"] for k, v in zero.items()}, flush=True)

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
    for _ in range(args.epochs):  # fresh option shuffles each epoch
        epoch = items_for(train_rows, tok, cfg, rng)
        rng.shuffle(epoch)
        items += epoch
    total = (len(items) + args.batch - 1) // args.batch
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[args.lr, args.lr * 4], total_steps=total, pct_start=.1)
    model.train()
    running = []
    for step, s in enumerate(range(0, len(items), args.batch), 1):
        b = collate(items[s:s + args.batch], tok.pad_token_id)
        loss = -(b["target"].to(device) * torch.log_softmax(forward(model, b, device), -1)).sum(-1).mean()
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_([*enc, *head], 1.0)
        opt.step()
        sched.step()
        running.append(loss.item())
        if step % 25 == 0 or step == total:
            print(f"step {step}/{total} loss {np.mean(running[-25:]):.3f} · {(time.time() - t0) / 60:.1f} min", flush=True)

    zc = predict(model, calib_items, tok, device)
    temps = {}
    for key in P.TARGETS:
        m = np.array([it["key"] == key for it in calib_items])
        temps[key] = fit_temperature(zc[m], np.array([it["y"] for it in calib_items])[m])
    tuned = report(predict(model, test_items, tok, device), temps)
    # Choose the served model per question on the CALIBRATION years (never on the test set).
    calib_rows = [r for r in rows if r["split"] == "calib"]
    chosen, calib_rpss = {}, {}
    for key in P.TARGETS:
        m = np.array([it["key"] == key for it in calib_items])
        yc = np.array([it["y"] for it in calib_items])[m]
        laya_c = P.rpss(softmax(zc[m], temps[key]), yc, clims[key])
        yl = np.array([r["y"][key] for r in calib_rows])
        log_c = P.rpss(LOGISTIC[key]["predict"](np.array([r["x"] for r in calib_rows])), yl, clims[key])
        calib_rpss[key] = {"laya": round(laya_c, 4), "logistic": round(log_c, 4)}
        chosen[key] = "laya" if laya_c >= log_c else "logistic"
    served = {k: tuned[k] if chosen[k] == "laya" else base_scores[k]["logistic"] for k in P.TARGETS}
    skill = {k: bool(served[k]["rpss_ci"][0] > 0) for k in P.TARGETS}
    print("fine-tuned Laya:", {k: (v["rpss"], v["rpss_ci"]) for k, v in tuned.items()}, "\ncalibration RPSS:", calib_rpss,
          "\nserved:", chosen, "\nskilful:", skill, flush=True)

    evaluation = {
        "trained_at": datetime.now(timezone.utc).isoformat(), "task": "next-5-year direction of hazard indices (fall/steady/rise, ±0.5σ)",
        "targets": P.TARGETS, "classes": P.CLASSES, "threshold_sigma": P.THRESHOLD,
        "split": {"train": f"80% of sites, windows ending ≤{P.TRAIN_END}", "calibration": f"same sites, windows ending {P.CALIB_ENDS[0]}–{P.CALIB_ENDS[1]}",
                  "test": f"20% held-out sites, windows ending ≥{P.TEST_START} (outcomes {P.TEST_START + 1}–2025)"},
        "rows": counts, "train_episodes_used": len(train_rows), "steps": total, "device": device, "hyperparameters": vars(args),
        "metric": "RPSS vs train-period climatology; 95% CI from 1000 site-level bootstrap resamples",
        "test": {k: {**base_scores[k], "laya_zero_shot": zero[k], "laya": tuned[k], "served_model": chosen[k], "served": served[k],
                     "calibration_rpss": calib_rpss[k], "skilful": skill[k]} for k in P.TARGETS},
        "selection": "per question, the model with the higher RPSS on the calibration years is served; skill is then verified on the test set",
        "climatology": {k: dict(zip(P.CLASSES, np.round(clims[k], 4).tolist())) for k in P.TARGETS},
        "data": "NASA POWER daily (MERRA-2-derived) at PB2002-plate anchors; causal σ; 15-yr windows, 5-yr outcomes",
    }
    TUNED.mkdir(parents=True, exist_ok=True)
    from safetensors.torch import save_file
    state = {k: v.detach().to("cpu", torch.bfloat16 if v.is_floating_point() else v.dtype).contiguous() for k, v in model.state_dict().items()}
    save_file(state, str(TUNED / "model.safetensors"))
    (TUNED / "earth_config.json").write_text(json.dumps({"task": "predictive-v2", "temperature_by_target": temps,
                                                         "logistic": {k: LOGISTIC[k]["params"] for k in P.TARGETS},
                                                         "temperature_by_options": {"choice:3-5": 1.0}, "evaluation": evaluation}, indent=1))
    print(f"saved {TUNED} · {(time.time() - t0) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
