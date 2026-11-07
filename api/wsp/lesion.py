"""lesion_net: a tiny liver-lesion classifier that Opus later edits in weight space.

Pipeline (identical for synthetic training patches and real scans):
  liver ROI -> resample to 1.5 mm iso -> smooth -> hypodense candidates -> 9 features -> MLP.

Training data is procedurally simulated liver tissue with vessels, noise and inserted
lesions (lesion insertion is a standard CT augmentation technique). The training set is
deliberately biased toward large lesions, so the pretrained net under-calls small ones —
that is the failure Opus fixes by editing weights.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from scipy import ndimage
from skimage import measure

ISO = 1.5
FEATURES = [
    "diameter_mm",       # equivalent-sphere diameter
    "log_volume",        # log(mm^3)
    "contrast_hu",       # liver background - candidate mean
    "contrast_snr",      # contrast / background noise
    "sphericity",        # 1 = perfect sphere
    "elongation",        # sqrt(l_max / l_min) of the coordinate covariance
    "edge_sharpness",    # boundary gradient / contrast
    "internal_noise",    # std inside / background std
    "depth_mm",          # distance from liver surface
]
HERE = Path(__file__).resolve().parent
MODEL_PATH = HERE / "lesion_net.pt"
DATA_PATH = HERE / "lesion_data.npz"


# ----------------------------------------------------------------- candidates
def extract_candidates(hu: np.ndarray, liver: np.ndarray, spacing, min_vox: int = 4, exclude: np.ndarray | None = None,
                       min_depth_mm: float = 0.0):
    """Return (features[N,9], centroids_mm[N,3], masks list) of hypodense blobs inside liver."""
    zoom = np.array(spacing, float) / ISO
    hu_i = ndimage.zoom(hu.astype(np.float32), zoom, order=1)
    liv_i = ndimage.zoom(liver.astype(np.float32), zoom, order=1) > 0.5
    core = ndimage.binary_erosion(liv_i, iterations=2)
    if exclude is not None:  # stay clear of neighbouring organs/vessels (segmentation boundary leakage)
        ex = ndimage.zoom(exclude.astype(np.float32), zoom, order=1) > 0.3
        core &= ~ndimage.binary_dilation(ex, iterations=3)
    if core.sum() < 50:
        return np.zeros((0, len(FEATURES)), np.float32), np.zeros((0, 3)), []
    sm = ndimage.gaussian_filter(hu_i, 0.8)
    # local liver background (normalized convolution, ~12 mm) so slow intensity drifts don't merge blobs
    lf = core.astype(np.float32)
    local = ndimage.gaussian_filter(np.where(core, sm, 0), 8) / (ndimage.gaussian_filter(lf, 8) + 1e-3)
    resid = (sm - local)[core]
    bg_std = float(1.4826 * np.median(np.abs(resid - np.median(resid)))) + 1e-3
    bg = float(np.median(sm[core]))
    cand = core & (local - sm > max(12.0, 1.8 * bg_std))
    cc, n = ndimage.label(cand)
    if n == 0:
        return np.zeros((0, len(FEATURES)), np.float32), np.zeros((0, 3)), []
    depth = ndimage.distance_transform_edt(liv_i) * ISO
    grad = ndimage.gaussian_gradient_magnitude(hu_i, 1.0)
    feats, cents, masks = [], [], []
    objs = ndimage.find_objects(cc)
    for k, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        sl = tuple(slice(max(s.start - 2, 0), s.stop + 2) for s in sl)
        m = cc[sl] == k
        nv = int(m.sum())
        if nv < min_vox:
            continue
        vol = nv * ISO ** 3
        diam = (6 * vol / np.pi) ** (1 / 3)
        inside = hu_i[sl][m]
        contrast = float(local[sl][m].mean() - inside.mean())
        coords = np.argwhere(m) * ISO
        cov = np.cov(coords.T) if nv > 3 else np.eye(3)
        ev = np.clip(np.linalg.eigvalsh(cov), 0.25, None)
        elong = float(np.sqrt(ev[-1] / ev[0]))
        try:
            pad = np.pad(m, 1).astype(np.float32)
            v, f, *_ = measure.marching_cubes(ndimage.gaussian_filter(pad, 0.5), 0.5, spacing=(ISO,) * 3)
            area = measure.mesh_surface_area(v, f)
            spher = float(np.clip(np.pi ** (1 / 3) * (6 * vol) ** (2 / 3) / max(area, 1e-3), 0, 1.2))
        except Exception:
            spher = 0.5
        edge = m ^ ndimage.binary_erosion(m)
        sharp = float(grad[sl][edge].mean()) / max(abs(contrast), 1.0) if edge.any() else 0.0
        c_idx = np.argwhere(m).mean(0) + np.array([s.start for s in sl])
        d = float(depth[tuple(np.round(c_idx).astype(int))])
        if d < min_depth_mm:
            continue
        feats.append([diam, np.log(vol), contrast, contrast / bg_std, spher, elong, sharp,
                      float(inside.std()) / bg_std, d])
        cents.append(c_idx * ISO)
        masks.append((sl, m))
    return np.array(feats, np.float32).reshape(-1, len(FEATURES)), np.array(cents).reshape(-1, 3), masks


# ------------------------------------------------------------ synthetic data
def _patch(rng: np.random.Generator, lesion_d: float | None):
    """Simulate a liver block at 0.75 mm, then 'acquire' it at a random scanner spacing."""
    fine = 0.75
    n = 72  # 54 mm cube
    bg = rng.uniform(45, 65)
    tex = ndimage.gaussian_filter(rng.normal(0, 1, (n, n, n)), rng.uniform(1.0, 2.0))
    tex = tex / (tex.std() + 1e-6) * rng.uniform(5, 11)
    vol = bg + tex
    liver = np.ones((n, n, n), bool)
    zz, yy, xx = np.mgrid[:n, :n, :n].astype(np.float32)
    # liver surface: a random plane, fat outside
    if rng.random() < 0.5:
        nrm = rng.normal(size=3)
        nrm /= np.linalg.norm(nrm)
        off = rng.uniform(0.15, 0.45) * n
        sd = (xx - n / 2) * nrm[0] + (yy - n / 2) * nrm[1] + (zz - n / 2) * nrm[2]
        outside = sd > off
        liver &= ~outside
        vol[outside] = rng.uniform(-110, -70)
    # vessels: hypodense tubes (unenhanced blood ~40 HU vs liver ~55)
    for _ in range(rng.integers(1, 5)):
        p0 = rng.uniform(0, n, 3)
        dvec = rng.normal(size=3)
        dvec /= np.linalg.norm(dvec)
        rad = rng.uniform(1.0, 4.0) / fine
        rel = np.stack([zz - p0[0], yy - p0[1], xx - p0[2]], -1)
        proj = rel @ dvec
        dist = np.linalg.norm(rel - proj[..., None] * dvec, axis=-1)
        vmask = (dist < rad) & liver
        vol[vmask] = vol[vmask] * 0.3 + 0.7 * (bg - rng.uniform(8, 25))
    # noise / perfusion blobs: small faint dark spots
    for _ in range(rng.integers(1, 7)):
        c = rng.uniform(8, n - 8, 3)
        r = rng.uniform(1.5, 4.5) / fine
        d2 = ((zz - c[0]) ** 2 + (yy - c[1]) ** 2 + (xx - c[2]) ** 2) / r ** 2
        vol -= rng.uniform(8, 22) * np.exp(-d2 * 1.5) * liver
    centre = None
    if lesion_d is not None:
        centre = rng.uniform(n * 0.3, n * 0.7, 3)
        r = lesion_d / 2 / fine
        ax = r * rng.uniform(0.85, 1.15, 3)
        d2 = ((zz - centre[0]) / ax[0]) ** 2 + ((yy - centre[1]) / ax[1]) ** 2 + ((xx - centre[2]) / ax[2]) ** 2
        lm = ndimage.gaussian_filter((d2 <= 1).astype(np.float32), rng.uniform(0.6, 1.4))
        contrast = rng.uniform(15, 50)
        het = ndimage.gaussian_filter(rng.normal(0, 1, (n, n, n)), 1.2) * rng.uniform(2, 8)
        vol = vol - lm * (contrast + het)
        liver |= d2 <= 1
    vol += rng.normal(0, rng.uniform(4, 10), vol.shape)  # quantum noise
    # acquire at scanner spacing
    if rng.random() < 0.35:  # low-dose / thick-slice protocol
        sp = np.array([rng.uniform(2.0, 3.0), rng.uniform(2.0, 3.0), rng.uniform(2.0, 3.0)])
    else:
        sp = np.array([rng.uniform(0.7, 1.2), rng.uniform(0.7, 1.2), rng.uniform(1.0, 3.0)])
    z = fine / sp
    acq = ndimage.zoom(ndimage.gaussian_filter(vol, (sp / fine) * 0.4), z, order=1)
    liv = ndimage.zoom(liver.astype(np.float32), z, order=0) > 0.5
    c_mm = centre * fine if centre is not None else None
    return acq, liv, sp, c_mm


def make_dataset(n_patches: int, small_frac: float, seed: int):
    rng = np.random.default_rng(seed)
    X, y, d = [], [], []
    for _ in range(n_patches):
        has = rng.random() < 0.6
        if has:
            ld = rng.uniform(6, 12) if rng.random() < small_frac else rng.uniform(15, 35)
        else:
            ld = None
        acq, liv, sp, c_mm = _patch(rng, ld)
        f, cents, _ = extract_candidates(acq, liv, sp)
        for fi, ci in zip(f, cents):
            is_les = c_mm is not None and np.linalg.norm(ci - c_mm) < max(4.0, ld / 2) and fi[0] >= 0.45 * ld
            if c_mm is not None and not is_les and np.linalg.norm(ci - c_mm) < max(4.0, ld / 2):
                continue  # lesion fragment: ambiguous label, skip
            X.append(fi)
            y.append(1.0 if is_les else 0.0)
            d.append(ld if is_les else fi[0])
    return np.array(X, np.float32), np.array(y, np.float32), np.array(d, np.float32)


# ---------------------------------------------------------------------- model
class LesionNet(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.l1 = torch.nn.Linear(len(FEATURES), 16)
        self.l2 = torch.nn.Linear(16, 8)
        self.l3 = torch.nn.Linear(8, 1)

    def forward(self, x, trace: bool = False):
        h1 = torch.relu(self.l1(x))
        h2 = torch.relu(self.l2(h1))
        out = torch.sigmoid(self.l3(h2)).squeeze(-1)
        return (out, h1, h2) if trace else out


@dataclass
class Bundle:
    net: LesionNet
    mu: np.ndarray
    sd: np.ndarray

    def norm(self, X):
        return torch.tensor((X - self.mu) / self.sd, dtype=torch.float32)

    def predict(self, X) -> np.ndarray:
        if len(X) == 0:
            return np.zeros(0)
        with torch.no_grad():
            return self.net(self.norm(X)).numpy()


def metrics(p: np.ndarray, y: np.ndarray, d: np.ndarray, thr: float = 0.5) -> dict:
    pred = p >= thr
    pos, neg = y == 1, y == 0
    small = pos & (d < 12)
    large = pos & (d >= 12)
    r = lambda m: round(float(pred[m].mean()), 3) if m.any() else None
    return {
        "accuracy": round(float((pred == pos).mean()), 3),
        "recall_small": r(small), "recall_large": r(large),
        "false_positive_rate": round(float(pred[neg].mean()), 3),
        "n": int(len(y)), "n_small_lesions": int(small.sum()), "n_large_lesions": int(large.sum()),
    }


def train_and_save():
    print("simulating training set (biased: 1% small lesions)…")
    Xtr, ytr, dtr = make_dataset(1800, small_frac=0.01, seed=1)
    print("simulating clinic val/test sets (45% small lesions)…")
    Xva, yva, dva = make_dataset(500, small_frac=0.45, seed=2)
    Xte, yte, dte = make_dataset(500, small_frac=0.45, seed=3)
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-6
    torch.manual_seed(0)
    net = LesionNet()
    b = Bundle(net, mu, sd)
    opt = torch.optim.Adam(net.parameters(), 1e-2, weight_decay=1e-4)
    Xt, yt = b.norm(Xtr), torch.tensor(ytr)
    for ep in range(600):
        opt.zero_grad()
        loss = torch.nn.functional.binary_cross_entropy(net(Xt), yt)
        loss.backward()
        opt.step()
    print("train", metrics(b.predict(Xtr), ytr, dtr))
    print("val  ", metrics(b.predict(Xva), yva, dva))
    print("test ", metrics(b.predict(Xte), yte, dte))
    torch.save({"state": net.state_dict(), "mu": mu, "sd": sd}, MODEL_PATH)
    np.savez(DATA_PATH, Xva=Xva, yva=yva, dva=dva, Xte=Xte, yte=yte, dte=dte, Xtr=Xtr, ytr=ytr, dtr=dtr)


def load_bundle() -> Bundle:
    ck = torch.load(MODEL_PATH, weights_only=False)
    net = LesionNet()
    net.load_state_dict(ck["state"])
    net.eval()
    return Bundle(net, ck["mu"], ck["sd"])


def load_data():
    return dict(np.load(DATA_PATH))


if __name__ == "__main__":
    train_and_save()
