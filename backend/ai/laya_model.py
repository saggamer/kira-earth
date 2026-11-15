"""Minimal, self-contained Laya decision model.

Re-implements the published architecture of convaiinnovations/laya (Apache-2.0,
© Convai Innovations): a ModernBERT-large encoder plus a 2-layer transformer decision head
that scores one [MASK] marker per option. Only the checkpoint's data files are loaded
(model.safetensors, encoder/config.json, tokenizer/*, rl_agent_config.json); no Python code
shipped with the download is imported or executed.
"""
from __future__ import annotations
import json
import math
from pathlib import Path
import numpy as np
import torch
import torch.nn as nn

QTYPES = {"choice": 0, "score": 1, "noul": 2}
QTYPE_NAMES = {v: k for k, v in QTYPES.items()}


def render_options(q: dict) -> list[str]:
    t, crit = q["t"], q.get("crit")
    if t == "choice":
        return [k if not v else f"{k}: {v}" for k, v in crit.items()]
    if t == "score":
        return [f"level {i}: {c}" for i, c in enumerate(crit)]
    crit = crit or {}
    return ["false: " + (crit.get("false") or "no, the statement does not hold"),
            "true: " + (crit.get("true") or "yes, the statement holds")]


def build_sequence(tok, state: str, q: dict, max_len: int, head_max_len: int, order: list[int] | None = None):
    """[CLS] <type> question: instructions [SEP] [MASK] opt0 [MASK] opt1 … [SEP] state [SEP]."""
    opts = render_options(q)
    order = order if order is not None else list(range(len(opts)))
    m = tok.mask_token
    head = tok(f"{q['t']} question: {str(q['ins']).replace(m, ' ')}", add_special_tokens=False)["input_ids"]
    opt_ids = [[tok.mask_token_id] + tok(" " + opts[i].replace(m, " "), add_special_tokens=False)["input_ids"][:48] for i in order]
    budget = head_max_len - sum(map(len, opt_ids))
    if budget < 16:
        per = max(4, (head_max_len - 16) // max(1, len(opt_ids)))
        opt_ids = [o[:per] for o in opt_ids]
        budget = head_max_len - sum(map(len, opt_ids))
    ids = [tok.cls_token_id] + head[:max(8, budget)] + [tok.sep_token_id]
    markers = []
    for o in opt_ids:
        markers.append(len(ids))
        ids.extend(o)
    ids.append(tok.sep_token_id)
    room = max(0, max_len - len(ids) - 1)
    ids = ids + tok(state.replace(m, " "), add_special_tokens=False)["input_ids"][:room] + [tok.sep_token_id]
    return ids[:max_len], [p for p in markers if p < max_len]


class DecisionModel(nn.Module):
    def __init__(self, encoder: nn.Module, head_layers: int = 2, n_act: int = 2, dropout: float = .1):
        super().__init__()
        self.encoder = encoder
        d = encoder.config.hidden_size
        layer = nn.TransformerEncoderLayer(d, max(1, d // 64), 4 * d, dropout, batch_first=True, norm_first=True)
        self.head = nn.TransformerEncoder(layer, head_layers, enable_nested_tensor=False)
        self.type_emb = nn.Embedding(3, d)
        self.scorer = nn.Sequential(nn.LayerNorm(d), nn.Linear(d, d), nn.GELU(), nn.Linear(d, 1))
        # Unused here; kept so the published state dict loads strictly.
        self.act_head = nn.Sequential(nn.Linear(d + 4, 256), nn.GELU(), nn.Linear(256, n_act))
        self.register_buffer("temperature", torch.ones(3))

    def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
        h = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        h = h + self.type_emb(qtype)[:, None, :]
        pad = ~attention_mask.bool()
        for layer in self.head.layers:
            h = layer(h, src_key_padding_mask=pad)
        g = torch.gather(h, 1, marker_pos.clamp(min=0)[:, :, None].expand(-1, -1, h.size(-1)))
        return self.scorer(g).squeeze(-1).float().masked_fill(~marker_mask, -1e4)


def temp_bucket(qtype: int, k: int) -> str:
    size = "2" if k <= 2 else "3-5" if k <= 5 else "6-10" if k <= 10 else "11+"
    return f"{QTYPE_NAMES[int(qtype)]}:{size}"


def confidence(p: np.ndarray) -> float:
    """1 − normalised entropy of the option distribution (Laya's confidence definition)."""
    k = len(p)
    if k < 2:
        return 1.0
    return float(1 - -(p * np.log(np.clip(p, 1e-12, 1))).sum() / math.log(k))


def collate(items: list[dict], pad_id: int):
    n, L = len(items), max(len(it["ids"]) for it in items)
    k = max(len(it["markers"]) for it in items)
    ids = torch.full((n, L), pad_id, dtype=torch.long)
    att = torch.zeros((n, L), dtype=torch.long)
    mpos = torch.zeros((n, k), dtype=torch.long)
    mmask = torch.zeros((n, k), dtype=torch.bool)
    target = torch.zeros((n, k))
    for i, it in enumerate(items):
        ids[i, :len(it["ids"])] = torch.tensor(it["ids"])
        att[i, :len(it["ids"])] = 1
        mpos[i, :len(it["markers"])] = torch.tensor(it["markers"])
        mmask[i, :len(it["markers"])] = True
        if "target" in it:
            target[i, :len(it["target"])] = torch.tensor(it["target"], dtype=torch.float32)
    return {"input_ids": ids, "attention_mask": att, "marker_pos": mpos, "marker_mask": mmask,
            "qtype": torch.tensor([it["qtype"] for it in items]), "target": target}


def load(base_dir: Path, device: str, weights: Path | None = None):
    from safetensors.torch import load_file
    from transformers import AutoConfig, AutoModel, AutoTokenizer
    cfg = json.loads((base_dir / "rl_agent_config.json").read_text())
    tok = AutoTokenizer.from_pretrained(str(base_dir / "tokenizer"))
    enc = AutoModel.from_config(AutoConfig.from_pretrained(str(base_dir / "encoder")), attn_implementation="sdpa")
    model = DecisionModel(enc, cfg["head_layers"], len(cfg["act_costs"]) + 1)
    model.load_state_dict(load_file(str(weights or base_dir / "model.safetensors")), strict=True)
    model.encoder.config.reference_compile = False
    return model.to(device).eval(), tok, cfg


class Scorer:
    """system_one(state, questions) with per-bucket temperature calibration."""

    def __init__(self, model, tok, cfg, temperatures: dict | None = None):
        self.model, self.tok, self.cfg = model, tok, cfg
        self.temps = {**cfg.get("temperature_by_options", {}), **(temperatures or {})}
        self.device = next(model.parameters()).device

    @staticmethod
    def internal(qdef: dict) -> dict:
        crit = qdef.get("criteria")
        if qdef["type"] == "choice" and isinstance(crit, list):
            crit = {c: None for c in crit}
        return {"t": qdef["type"], "ins": qdef["instructions"], "crit": crit}

    @torch.no_grad()
    def system_one(self, state: str, questions: dict) -> dict:
        ids, items, qs = list(questions), [], []
        for qid in ids:
            q = self.internal(questions[qid])
            seq, markers = build_sequence(self.tok, state, q, self.cfg["max_len"], self.cfg["head_max_len"])
            if len(markers) != len(render_options(q)):
                raise ValueError(f"question {qid!r}: options exceed the head token budget")
            items.append({"ids": seq, "markers": markers, "qtype": QTYPES[q["t"]]})
            qs.append(q)
        b = collate(items, self.tok.pad_token_id)
        logits = self.model(*(b[k].to(self.device) for k in ("input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"))).cpu().numpy()
        out = {}
        for r, (qid, q) in enumerate(zip(ids, qs)):
            k = len(items[r]["markers"])
            z = logits[r, :k] / self.temps.get(temp_bucket(QTYPES[q["t"]], k), 1.0)
            p = np.exp(z - z.max())
            p /= p.sum()
            if q["t"] == "choice":
                keys = list(q["crit"])
                out[qid] = {"choice": keys[int(p.argmax())], "probabilities": {kk: round(float(v), 4) for kk, v in zip(keys, p)}, "confidence": round(confidence(p), 4)}
            else:
                out[qid] = {"score": round(float((np.arange(k) * p).sum()), 4), "probabilities": {str(i): round(float(v), 4) for i, v in enumerate(p)},
                            "confidence": round(confidence(p), 4)}
        return {"answers": out, "input_tokens": int(b["attention_mask"].sum())}
