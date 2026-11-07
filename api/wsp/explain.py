"""Exact, weight-level explanations of one lesion_net decision.

lesion_net is piecewise-linear (ReLU), so for a single input the logit is an exact sum:
    logit = b3 + Σ_j w3_j · h2_j,   h2_j = relu(b2_j + Σ_i w2_ji · h1_i),   h1_i = relu(b1_i + Σ_k w1_ik · z_k)
Inside that input's linear region each feature's contribution is z_k · ∂logit/∂z_k (relative to the
training-mean patient, z = 0), and every edge's "flow" is weight × incoming activation.
That gives an attention-style map of exactly which inputs, units and weights drove the call.
"""
from __future__ import annotations

import numpy as np
import torch

from wsp.lesion import FEATURES, Bundle

GROUPS = ("small_lesion", "large_lesion", "not_lesion")


def _np(t: torch.Tensor) -> np.ndarray:
    return t.detach().numpy().astype(np.float64)


def decompose(b: Bundle, x_raw: np.ndarray) -> dict:
    W1, B1 = _np(b.net.l1.weight), _np(b.net.l1.bias)
    W2, B2 = _np(b.net.l2.weight), _np(b.net.l2.bias)
    W3, B3 = _np(b.net.l3.weight)[0], float(_np(b.net.l3.bias)[0])
    z = (np.asarray(x_raw, np.float64) - b.mu) / b.sd
    p1 = W1 @ z + B1
    h1 = np.maximum(p1, 0)
    p2 = W2 @ h1 + B2
    h2 = np.maximum(p2, 0)
    logit = float(W3 @ h2 + B3)
    a1, a2 = (p1 > 0).astype(float), (p2 > 0).astype(float)
    # gradients inside the linear region
    g_h2 = W3 * a2                       # d logit / d p2 (masked)
    g_h1 = (g_h2 @ W2) * a1              # d logit / d p1
    g_z = g_h1 @ W1                      # d logit / d z
    feat_contrib = z * g_z
    h1_contrib = h1 * (g_h2 @ W2)        # share of logit flowing through each h1 unit
    h2_contrib = h2 * W3
    flow1 = W1 * z[None, :] * a1[:, None]    # input k → h1 i
    flow2 = W2 * h1[None, :] * a2[:, None]   # h1 i → h2 j
    flow3 = W3 * h2                          # h2 j → output
    # each edge's share of the final logit (sign = pushes toward / away from "lesion")
    d_h1 = g_h2 @ W2
    edge1 = flow1 * d_h1[:, None]
    edge2 = flow2 * W3[:, None]
    # one-feature counterfactuals: how far would z_k have to move (locally) to cross 0.5?
    cf = []
    for k, f in enumerate(FEATURES):
        if abs(g_z[k]) > 1e-6:
            dz = -logit / g_z[k]
            cf.append({"feature": f, "delta_std": round(float(dz), 2),
                       "delta_raw": round(float(dz * b.sd[k]), 2), "plausible": bool(abs(dz) < 2.5)})
    return {
        "score": round(float(1 / (1 + np.exp(-logit))), 4),
        "logit": round(logit, 3),
        "baseline_logit": round(float(logit - feat_contrib.sum()), 3),
        "features": [{"name": f, "raw": round(float(x_raw[k]), 2), "z": round(float(z[k]), 2),
                      "contrib": round(float(feat_contrib[k]), 3)} for k, f in enumerate(FEATURES)],
        "h1": [{"unit": f"h1[{i}]", "act": round(float(h1[i]), 3), "contrib": round(float(h1_contrib[i]), 3)} for i in range(len(h1))],
        "h2": [{"unit": f"h2[{j}]", "act": round(float(h2[j]), 3), "contrib": round(float(h2_contrib[j]), 3)} for j in range(len(h2))],
        "flow": {"l1": flow1.round(3).tolist(), "l2": flow2.round(3).tolist(), "l3": flow3.round(3).tolist()},
        "edge_logit": {"l1": edge1.round(3).tolist(), "l2": edge2.round(3).tolist(), "l3": flow3.round(3).tolist()},
        "counterfactuals": sorted(cf, key=lambda c: abs(c["delta_std"]))[:5],
    }


def unit_profiles(b: Bundle, data: dict) -> dict:
    """What each hidden unit responds to across the validation set — the raw material for naming it."""
    X, y, d = data["Xva"], data["yva"], data["dva"]
    groups = {"small_lesion": (y == 1) & (d < 12), "large_lesion": (y == 1) & (d >= 12), "not_lesion": y == 0}
    with torch.no_grad():
        _, h1, h2 = b.net(b.norm(X), trace=True)
    h1, h2 = h1.numpy(), h2.numpy()
    W1 = _np(b.net.l1.weight)
    W2 = _np(b.net.l2.weight)
    W3 = _np(b.net.l3.weight)[0]
    out = {"h1": [], "h2": []}
    for i in range(h1.shape[1]):
        top = np.argsort(-np.abs(W1[i]))[:3]
        out["h1"].append({"unit": f"h1[{i}]",
                          "mean_act": {g: round(float(h1[m, i].mean()), 2) for g, m in groups.items()},
                          "top_inputs": [f"{FEATURES[k]}:{W1[i, k]:+.2f}" for k in top]})
    for j in range(h2.shape[1]):
        top = np.argsort(-np.abs(W2[j]))[:3]
        out["h2"].append({"unit": f"h2[{j}]", "output_weight": round(float(W3[j]), 2),
                          "mean_act": {g: round(float(h2[m, j].mean()), 2) for g, m in groups.items()},
                          "top_inputs": [f"h1[{i}]:{W2[j, i]:+.2f}" for i in top]})
    return out
