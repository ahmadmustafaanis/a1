"""Weight-space programming session: Opus reads lesion_net's weights and edits them directly.

No optimizer, no gradients, no training loop: Opus gets read access to weights/activations,
a way to write individual weights, and a validation set. The held-out test set is only used
at the end to report honest before/after numbers.
"""
from __future__ import annotations

import copy
import json
import os
import traceback
from pathlib import Path
from typing import Any

import numpy as np
import torch
from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, ResultMessage, TextBlock,
                              ThinkingBlock, ToolUseBlock, create_sdk_mcp_server, tool)

from events import EventLog
from wsp.lesion import FEATURES, Bundle, load_bundle, load_data, metrics

MODEL = os.environ.get("LUMEN_MODEL", "claude-opus-5-5")
os.environ.pop("ANTHROPIC_API_KEY", None)
LAYERS = {"l1": "hidden layer 1 (9 features → 16 units)", "l2": "hidden layer 2 (16 → 8)", "l3": "output (8 → 1, sigmoid)"}

SYSTEM = """You are doing Weight-Space Programming: improving a neural network by reading and directly editing its weights.
You have NO optimizer and NO gradient tool. Reason about what each unit computes, then write new weight values.

The network is lesion_net, a 3-layer MLP (9 standardized features → 16 → 8 → 1) that classifies liver lesion candidates.
It was trained on data where small lesions (< 12 mm) were rare, so it learned "small ⇒ not a lesion" and misses them.
Target: raise recall on small lesions while keeping the false-positive rate and overall accuracy roughly unchanged
(guardrail: accuracy may not drop more than 0.02; false_positive_rate may not rise more than 0.03).

Suggested approach:
1. describe_model and evaluate to get the baseline.
2. trace groups (small_missed vs small_caught vs false_positive vs large_caught) to see which units separate them,
   and feature_sensitivity to see how inputs drive the score.
3. get_weights for the relevant layers; identify the units that penalize small diameter / log_volume,
   and features that genuinely distinguish small lesions from noise (contrast_snr, sphericity, elongation, edge_sharpness…).
4. Make small, surgical edit_weights calls with a clear reason; check the returned validation metrics; revert_last if it hurts.
5. When satisfied (or after ~12 edits), call finish with a short plain-language summary of what you changed and why.

Narrate each step in one short sentence. Edit as few weights as possible — surgical beats sweeping."""


class WSPSession:
    def __init__(self, log: EventLog, scan_dir: Path | None = None):
        self.log = log
        self.base = load_bundle()
        self.work = Bundle(copy.deepcopy(self.base.net), self.base.mu, self.base.sd)
        self.history: list[dict[str, torch.Tensor]] = []
        self.data = load_data()
        self.scan_dir = scan_dir
        self.edits: list[dict[str, Any]] = []
        self.changed: set[tuple[str, str, int, int]] = set()

    # helpers -----------------------------------------------------------
    def eval(self, b: Bundle, split: str = "va") -> dict:
        X, y, d = self.data[f"X{split}"], self.data[f"y{split}"], self.data[f"d{split}"]
        return metrics(b.predict(X), y, d)

    def groups(self, b: Bundle) -> dict[str, np.ndarray]:
        X, y, d = self.data["Xva"], self.data["yva"], self.data["dva"]
        p = b.predict(X)
        pos = y == 1
        return {
            "small_missed": np.where(pos & (d < 10) & (p < 0.5))[0],
            "small_caught": np.where(pos & (d < 10) & (p >= 0.5))[0],
            "large_caught": np.where(pos & (d >= 10) & (p >= 0.5))[0],
            "false_positive": np.where(~pos & (p >= 0.5))[0],
            "true_negative": np.where(~pos & (p < 0.5))[0],
        }

    def weights_snapshot(self, b: Bundle) -> dict:
        out = {}
        for ln in LAYERS:
            layer = getattr(b.net, ln)
            out[ln] = {"weight": layer.weight.detach().numpy().round(4).tolist(), "bias": layer.bias.detach().numpy().round(4).tolist()}
        return out

    def patient_scores(self) -> list[dict]:
        if not self.scan_dir:
            return []
        rows = []
        for f in sorted(self.scan_dir.glob("lesion_*_features.npy")):
            x = np.load(f)[None]
            rows.append({"name": f.name.replace("_features.npy", ""), "before": round(float(self.base.predict(x)[0]), 3),
                         "after": round(float(self.work.predict(x)[0]), 3)})
        return rows

    # tools -------------------------------------------------------------
    def build_tools(self):
        S = self
        log = self.log
        txt = lambda o: {"content": [{"type": "text", "text": o if isinstance(o, str) else json.dumps(o, default=float)}]}

        @tool("describe_model", "Architecture, feature list with training-set mean/std, parameter count.", {})
        async def describe_model(args):
            n = sum(p.numel() for p in S.work.net.parameters())
            r = {"layers": LAYERS, "activation": "ReLU, ReLU, sigmoid", "threshold": 0.5, "n_params": n,
                 "features": [{"i": i, "name": f, "train_mean": round(float(m), 3), "train_std": round(float(s), 3)}
                              for i, (f, m, s) in enumerate(zip(FEATURES, S.base.mu, S.base.sd))],
                 "note": "inputs are standardized: (x - train_mean) / train_std"}
            log.emit("tool_result", tool="describe_model", summary=f"{n} weights · 9→16→8→1")
            return txt(r)

        @tool("evaluate", "Metrics of the current (edited) model on the validation set.", {})
        async def evaluate(args):
            m = S.eval(S.work)
            log.emit("tool_result", tool="evaluate", summary=f"small recall {m['recall_small']} · FPR {m['false_positive_rate']}", data=m)
            return txt(m)

        @tool("get_weights", "Weights and biases of one layer. weight[row=output unit][col=input].",
              {"type": "object", "properties": {"layer": {"type": "string", "enum": list(LAYERS)}}, "required": ["layer"]})
        async def get_weights(args):
            ln = args["layer"]
            layer = getattr(S.work.net, ln)
            W = layer.weight.detach().numpy().round(3)
            cols = FEATURES if ln == "l1" else [f"{'h1' if ln == 'l2' else 'h2'}[{j}]" for j in range(W.shape[1])]
            log.emit("wsp_focus", layer=ln)
            log.emit("tool_result", tool="get_weights", summary=f"{ln}: {W.shape[0]}×{W.shape[1]}")
            return txt({"layer": ln, "inputs": cols, "weight": W.tolist(), "bias": layer.bias.detach().numpy().round(3).tolist()})

        @tool("trace", "Mean standardized inputs and mean hidden activations (h1, h2) for a group of validation candidates, "
              "plus a few individual examples. groups: small_missed, small_caught, large_caught, false_positive, true_negative.",
              {"type": "object", "properties": {"group": {"type": "string"}, "n_examples": {"type": "integer"}}, "required": ["group"]})
        async def trace(args):
            g = S.groups(S.work).get(args["group"], np.array([], int))
            if len(g) == 0:
                return txt({"group": args["group"], "count": 0})
            X = S.work.norm(S.data["Xva"][g])
            with torch.no_grad():
                out, h1, h2 = S.work.net(X, trace=True)
            k = int(args.get("n_examples", 3) or 3)
            r = {"group": args["group"], "count": int(len(g)),
                 "mean_input_std_units": dict(zip(FEATURES, X.mean(0).numpy().round(2).tolist())),
                 "mean_h1": h1.mean(0).numpy().round(2).tolist(), "frac_h1_active": (h1 > 0).float().mean(0).numpy().round(2).tolist(),
                 "mean_h2": h2.mean(0).numpy().round(2).tolist(), "mean_score": round(float(out.mean()), 3),
                 "examples": [{"raw": dict(zip(FEATURES, S.data["Xva"][g[i]].round(2).tolist())), "score": round(float(out[i]), 3)}
                              for i in range(min(k, len(g)))]}
            log.emit("tool_result", tool="trace", summary=f"{args['group']}: {len(g)} · mean score {r['mean_score']}")
            return txt(r)

        @tool("feature_sensitivity", "For a group: average change in output score when each input feature is raised by +1 std.",
              {"group": str})
        async def feature_sensitivity(args):
            g = S.groups(S.work).get(args["group"], np.array([], int))
            if len(g) == 0:
                return txt("empty group")
            X = S.work.norm(S.data["Xva"][g])
            with torch.no_grad():
                base = S.work.net(X)
                res = {}
                for i, f in enumerate(FEATURES):
                    X2 = X.clone()
                    X2[:, i] += 1
                    res[f] = round(float((S.work.net(X2) - base).mean()), 3)
            log.emit("tool_result", tool="feature_sensitivity", summary=f"{args['group']}", data=res)
            return txt(res)

        @tool("edit_weights", "Directly set weight values. Each edit: layer (l1|l2|l3), param (weight|bias), row, col (weight only), value. "
              "Returns validation metrics after the edit.",
              {"type": "object", "properties": {
                  "edits": {"type": "array", "items": {"type": "object", "properties": {
                      "layer": {"type": "string"}, "param": {"type": "string"}, "row": {"type": "integer"},
                      "col": {"type": "integer"}, "value": {"type": "number"}}, "required": ["layer", "param", "row", "value"]}},
                  "reason": {"type": "string"}}, "required": ["edits", "reason"]})
        async def edit_weights(args):
            before = S.eval(S.work)
            S.history.append(copy.deepcopy(S.work.net.state_dict()))
            cells = []
            with torch.no_grad():
                for e in args["edits"][:40]:
                    layer = getattr(S.work.net, e["layer"])
                    if e["param"] == "bias":
                        old = float(layer.bias[e["row"]])
                        layer.bias[e["row"]] = float(e["value"])
                        key = (e["layer"], "bias", e["row"], -1)
                    else:
                        old = float(layer.weight[e["row"], e["col"]])
                        layer.weight[e["row"], e["col"]] = float(e["value"])
                        key = (e["layer"], "weight", e["row"], e["col"])
                    S.changed.add(key)
                    cells.append({"layer": key[0], "param": key[1], "row": key[2], "col": key[3],
                                  "old": round(old, 4), "new": round(float(e["value"]), 4)})
            after = S.eval(S.work)
            entry = {"n": len(S.edits) + 1, "reason": args["reason"], "cells": cells, "before": before, "after": after}
            S.edits.append(entry)
            log.emit("wsp_edit", edit=entry, changed_total=len(S.changed), patient=S.patient_scores())
            return txt({"validation_before": before, "validation_after": after, "weights_changed_so_far": len(S.changed)})

        @tool("revert_last", "Undo the most recent edit_weights call.", {})
        async def revert_last(args):
            if not S.history:
                return txt("nothing to revert")
            S.work.net.load_state_dict(S.history.pop())
            last = S.edits.pop() if S.edits else None
            if last:
                for c in last["cells"]:
                    S.changed.discard((c["layer"], c["param"], c["row"], c["col"]))
            m = S.eval(S.work)
            log.emit("wsp_revert", weights=S.weights_snapshot(S.work), metrics=m, changed_total=len(S.changed))
            return txt(m)

        @tool("finish", "End the session with a plain-language summary of the edits.", {"summary": str})
        async def finish(args):
            S.final_report(args["summary"])
            return txt("done")

        return [describe_model, evaluate, get_weights, trace, feature_sensitivity, edit_weights, revert_last, finish]

    def final_report(self, summary: str) -> None:
        from wsp.explain import weight_diff

        n = sum(p.numel() for p in self.work.net.parameters())
        self.changed = {(c["layer"], c["param"], c["row"], c["col"]) for c in weight_diff(self.base, self.work)}
        rep = {"summary": summary, "val_before": self.eval(self.base), "val_after": self.eval(self.work),
               "test_before": self.eval(self.base, "te"), "test_after": self.eval(self.work, "te"),
               "weights_changed": len(self.changed), "n_params": n,
               "pct_changed": round(100 * len(self.changed) / n, 2), "edits": len(self.edits),
               "patient": self.patient_scores()}
        if self.scan_dir:
            torch.save({"state": self.work.net.state_dict(), "mu": self.work.mu, "sd": self.work.sd}, self.scan_dir / "lesion_net_edited.pt")
        self.report = rep
        self.log.emit("wsp_done", report=rep, weights=self.weights_snapshot(self.work))

    async def run(self) -> None:
        log = self.log
        self.report = None
        log.emit("wsp_start", weights=self.weights_snapshot(self.base), metrics=self.eval(self.base),
                 features=FEATURES, patient=self.patient_scores())
        tools = self.build_tools()
        server = create_sdk_mcp_server(name="wsp", version="1.0.0", tools=tools)
        opts = ClaudeAgentOptions(model=MODEL, system_prompt=SYSTEM, mcp_servers={"wsp": server}, tools=[],
                                  allowed_tools=[f"mcp__wsp__{t.name}" for t in tools], permission_mode="bypassPermissions",
                                  setting_sources=[], max_turns=50, thinking={"type": "adaptive", "display": "summarized"},
                                  max_buffer_size=64 * 1024 * 1024)
        try:
            async with ClaudeSDKClient(options=opts) as client:
                await client.query("Improve lesion_net on small lesions by editing its weights. Begin.")
                async for msg in client.receive_response():
                    if isinstance(msg, AssistantMessage):
                        for b in msg.content:
                            if isinstance(b, ThinkingBlock) and b.thinking.strip():
                                log.emit("thinking", text=b.thinking.strip()[:1500])
                            elif isinstance(b, TextBlock) and b.text.strip():
                                log.emit("say", text=b.text.strip())
                            elif isinstance(b, ToolUseBlock):
                                log.emit("tool_call", id=b.id, tool=b.name.replace("mcp__wsp__", ""), input=b.input)
                    elif isinstance(msg, ResultMessage):
                        log.emit("result", turns=msg.num_turns, ms=msg.duration_ms)
            if self.report is None:
                self.final_report("Session ended.")
        except Exception as ex:
            log.emit("error", text=f"{type(ex).__name__}: {ex}", trace=traceback.format_exc()[-1500:])
            if self.report is None and self.edits:
                self.final_report("Session ended early.")
        finally:
            log.finish()
