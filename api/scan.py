"""Scan state + the imaging operations Opus calls as tools."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import nibabel as nib
import numpy as np
import trimesh
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import measure

from anatomy import TOTAL_LABELS, color_of, friendly, system_of
from events import EventLog

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
SCALE = 0.01  # mm -> scene units (1 unit = 10 cm)


def ras_to_scene(p: np.ndarray) -> np.ndarray:
    """RAS mm -> three.js (x: viewer-right = patient-left, y: superior, z: anterior)."""
    return np.stack([-p[..., 0], p[..., 2], p[..., 1]], axis=-1) * SCALE


@dataclass
class Scan:
    id: str
    dir: Path
    log: EventLog
    vol: np.ndarray  # HU, canonical RAS voxel order
    spacing: tuple[float, float, float]
    affine: np.ndarray
    labels: np.ndarray | None = None
    names: dict[int, str] = field(default_factory=dict)
    meshes: dict[int, dict[str, Any]] = field(default_factory=dict)
    findings: list[dict[str, Any]] = field(default_factory=list)
    center_mm: np.ndarray | None = None
    title: str = ""
    demo_note: str | None = None

    # ------------------------------------------------------------------ load
    @classmethod
    def load(cls, ct_path: Path, log: EventLog, title: str = "", demo_note: str | None = None) -> "Scan":
        img = nib.as_closest_canonical(nib.load(str(ct_path)))
        vol = np.asarray(img.dataobj, dtype=np.float32)
        h = hashlib.sha1(vol.tobytes() + str(vol.shape).encode()).hexdigest()[:10]
        d = CACHE / h
        d.mkdir(parents=True, exist_ok=True)
        canon = d / "ct.nii.gz"
        if not canon.exists():
            nib.save(nib.Nifti1Image(vol, img.affine), str(canon))
        sp = tuple(float(s) for s in img.header.get_zooms()[:3])
        s = cls(id=h, dir=d, log=log, vol=vol, spacing=sp, affine=img.affine, title=title, demo_note=demo_note)
        body = vol > -500
        idx = np.argwhere(body) if body.any() else np.argwhere(np.ones_like(vol, bool))
        s.center_mm = idx.mean(0) * np.array(sp)
        return s

    def mm(self, idx: np.ndarray) -> np.ndarray:
        return np.asarray(idx, dtype=np.float64) * np.array(self.spacing)

    def scene(self, idx_mm: np.ndarray) -> np.ndarray:
        return ras_to_scene(idx_mm - self.center_mm)

    # --------------------------------------------------------------- inspect
    def inspect(self) -> dict[str, Any]:
        v = self.vol
        ext = [round(n * s) for n, s in zip(v.shape, self.spacing)]
        pct = np.percentile(v[:: 2, :: 2, :: 2], [1, 5, 25, 50, 75, 95, 99]).round(0).tolist()
        air = float((v < -900).mean())
        lung = float(((v > -900) & (v < -500)).mean())
        bone = float((v > 300).mean())
        return {
            "shape_voxels": list(v.shape),
            "spacing_mm": [round(s, 2) for s in self.spacing],
            "extent_mm_LR_AP_SI": ext,
            "hu_percentiles_1_5_25_50_75_95_99": pct,
            "fraction_air": round(air, 3),
            "fraction_lung_density": round(lung, 3),
            "fraction_bone_density": round(bone, 3),
            "modality_guess": "CT" if pct[0] < -800 else "unknown (no air at -1000 HU)",
        }

    # ---------------------------------------------------------------- slices
    def render_slices(self, axis: str, positions: list[float], window: str = "soft", overlay: bool = False) -> bytes:
        win = {"soft": (40, 400), "lung": (-600, 1500), "bone": (400, 1800), "liver": (60, 160)}.get(window, (40, 400))
        lo, hi = win[0] - win[1] / 2, win[0] + win[1] / 2
        ax = {"axial": 2, "coronal": 1, "sagittal": 0}[axis]
        tiles = []
        rng = np.random.default_rng(0)
        palette = {k: tuple(int(c) for c in rng.integers(60, 255, 3)) for k in range(1, 400)}
        for p in positions:
            k = int(np.clip(round(p * (self.vol.shape[ax] - 1)), 0, self.vol.shape[ax] - 1))
            sl = np.take(self.vol, k, axis=ax)
            g = np.clip((sl - lo) / (hi - lo), 0, 1)
            rgb = np.stack([g, g, g], -1)
            if overlay and self.labels is not None:
                lab = np.take(self.labels, k, axis=ax)
                col = np.zeros_like(rgb)
                for lv in np.unique(lab):
                    if lv == 0:
                        continue
                    col[lab == lv] = np.array(palette.get(int(lv), (255, 0, 0))) / 255
                m = (lab > 0)[..., None]
                rgb = np.where(m, rgb * 0.55 + col * 0.45, rgb)
            # orient for radiology display
            sp = [s for i, s in enumerate(self.spacing) if i != ax]
            img = np.rot90(rgb, 1)
            if axis in ("axial", "coronal"):  # radiology convention: patient right on image left
                img = np.fliplr(img)
            pil = Image.fromarray((img * 255).astype(np.uint8))
            w, h = pil.size
            # physical aspect
            pil = pil.resize((max(64, int(w * sp[0])), max(64, int(h * sp[1]))))
            pil.thumbnail((360, 360))
            canvas = Image.new("RGB", (pil.width, pil.height + 18), "white")
            canvas.paste(pil, (0, 18))
            ImageDraw.Draw(canvas).text((4, 3), f"{axis} {p:.2f} (#{k}) {window}", fill="black")
            tiles.append(canvas)
        W = sum(t.width for t in tiles) + 6 * (len(tiles) - 1)
        H = max(t.height for t in tiles)
        out = Image.new("RGB", (W, H), "white")
        x = 0
        for t in tiles:
            out.paste(t, (x, 0))
            x += t.width + 6
        buf = io.BytesIO()
        out.save(buf, "PNG")
        return buf.getvalue()

    def render_zoom(self, items: list[tuple[str, np.ndarray]], fov_mm: float = 60, window: str = "liver") -> bytes:
        """Close-up axial + coronal crops (fov_mm wide) centred on each mm point, upscaled for inspection."""
        win = {"soft": (40, 400), "liver": (50, 140), "bone": (400, 1800)}.get(window, (50, 140))
        lo, hi = win[0] - win[1] / 2, win[0] + win[1] / 2
        sp = np.array(self.spacing)
        tiles = []
        for label, c_mm in items:
            c = np.round(np.asarray(c_mm) / sp).astype(int)
            c = np.clip(c, 0, np.array(self.vol.shape) - 1)
            half = np.maximum((fov_mm / 2 / sp).astype(int), 4)
            pair = []
            for axis in ("axial", "coronal"):
                ax = 2 if axis == "axial" else 1
                # light 3D denoise (like a soft-tissue reconstruction kernel) before slicing
                lo3 = np.maximum(c - half - 3, 0)
                hi3 = np.minimum(c + half + 4, np.array(self.vol.shape))
                block = ndimage.gaussian_filter(self.vol[lo3[0]:hi3[0], lo3[1]:hi3[1], lo3[2]:hi3[2]], 0.7)
                full = np.full(self.vol.shape, -1000, np.float32)
                full[lo3[0]:hi3[0], lo3[1]:hi3[1], lo3[2]:hi3[2]] = block
                sl = np.take(full, c[ax], axis=ax)
                a, b = [i for i in range(3) if i != ax]
                pad = np.pad(sl, ((half[a], half[a]), (half[b], half[b])), constant_values=-1000)
                crop = pad[c[a]:c[a] + 2 * half[a] + 1, c[b]:c[b] + 2 * half[b] + 1]
                g = np.clip((crop - lo) / (hi - lo), 0, 1)
                img = np.fliplr(np.rot90(g, 1))
                pil = Image.fromarray((img * 255).astype(np.uint8)).resize((200, 200), Image.BICUBIC).convert("RGB")
                d = ImageDraw.Draw(pil)
                for (x0, y0, x1, y1) in [(84, 100, 92, 100), (108, 100, 116, 100), (100, 84, 100, 92), (100, 108, 100, 116)]:
                    d.line((x0, y0, x1, y1), fill=(255, 210, 0), width=1)
                pair.append(pil)
            canvas = Image.new("RGB", (406, 222), "white")
            canvas.paste(pair[0], (0, 22))
            canvas.paste(pair[1], (206, 22))
            ImageDraw.Draw(canvas).text((4, 5), f"{label} · axial | coronal · {int(fov_mm)} mm field", fill="black")
            tiles.append(canvas)
        out = Image.new("RGB", (406 * min(2, len(tiles)), 222 * ((len(tiles) + 1) // 2)), "white")
        for i, t in enumerate(tiles):
            out.paste(t, ((i % 2) * 406, (i // 2) * 222))
        buf = io.BytesIO()
        out.save(buf, "PNG")
        return buf.getvalue()

    # ------------------------------------------------------ totalsegmentator
    async def run_totalsegmentator(self, fast: bool = True, roi_subset: list[str] | None = None) -> dict[str, Any]:
        tag = "fast" if fast else "full"
        if roi_subset:
            tag += "_" + hashlib.sha1(",".join(sorted(roi_subset)).encode()).hexdigest()[:6]
        out = self.dir / f"seg_{tag}.nii.gz"
        cached = out.exists()
        if not cached:
            exe = Path(sys.executable).parent / "TotalSegmentator"
            cmd = [str(exe), "-i", str(self.dir / "ct.nii.gz"), "-o", str(out), "--ml", "--device", "mps"]
            if fast:
                cmd.append("--fast")
            if roi_subset:
                cmd += ["--roi_subset", *roi_subset]
            proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            tail = []
            assert proc.stdout
            async for line in proc.stdout:
                t = line.decode(errors="ignore").strip()
                if t and not any(x in t.lower() for x in ("warn", "%|", "cite", "deprecat")):
                    tail = (tail + [t])[-6:]
                    self.log.emit("tool_progress", tool="run_totalsegmentator", text=t[:160])
            await proc.wait()
            if proc.returncode != 0 or not out.exists():
                return {"error": "TotalSegmentator failed", "log_tail": tail}
        seg = np.asarray(nib.as_closest_canonical(nib.load(str(out))).dataobj).astype(np.int16)
        self.labels = seg
        self.names = {k: v for k, v in TOTAL_LABELS.items()}
        return {"cached": cached, "structures": self.label_table()}

    def label_table(self, min_voxels: int = 1) -> list[dict[str, Any]]:
        assert self.labels is not None
        ids, counts = np.unique(self.labels, return_counts=True)
        vox_ml = float(np.prod(self.spacing)) / 1000
        rows = []
        for i, c in zip(ids.tolist(), counts.tolist()):
            if i == 0 or c < min_voxels:
                continue
            rows.append({"id": i, "name": self.names.get(i, f"label_{i}"), "volume_ml": round(c * vox_ml, 1)})
        return rows

    # --------------------------------------------------------- label editing
    def _new_id(self) -> int:
        used = set(self.names) | ({int(x) for x in np.unique(self.labels)} if self.labels is not None else set())
        return max([200, *used]) + 1

    def threshold_region(self, name: str, hu_min: float, hu_max: float, within: str | None = None,
                         min_ml: float = 0.05, smooth_sigma: float = 0.7) -> dict[str, Any]:
        if self.labels is None:
            self.labels = np.zeros(self.vol.shape, np.int16)
        v = ndimage.gaussian_filter(self.vol, smooth_sigma) if smooth_sigma > 0 else self.vol
        m = (v >= hu_min) & (v <= hu_max)
        if within:
            wid = self.id_of(within)
            if wid is None:
                return {"error": f"unknown structure {within}"}
            inside = ndimage.binary_erosion(self.labels == wid, iterations=1)
            m &= inside
        cc, n = ndimage.label(m)
        vox_ml = float(np.prod(self.spacing)) / 1000
        sizes = ndimage.sum(np.ones_like(cc), cc, index=np.arange(1, n + 1)) if n else []
        keep = [i + 1 for i, s in enumerate(sizes) if s * vox_ml >= min_ml]
        nid = self._new_id()
        mask = np.isin(cc, keep)
        if within:
            self.labels[mask] = nid
        else:
            self.labels[mask & (self.labels == 0)] = nid
        self.names[nid] = name
        return {"id": nid, "name": name, "components": len(keep), "volume_ml": round(float(mask.sum()) * vox_ml, 2)}

    def id_of(self, name_or_id: str | int) -> int | None:
        if isinstance(name_or_id, int) or str(name_or_id).isdigit():
            return int(name_or_id)
        for k, v in self.names.items():
            if v == name_or_id:
                return k
        return None

    def edit_labels(self, op: str, targets: list[str], new_name: str | None = None) -> dict[str, Any]:
        assert self.labels is not None
        ids = [self.id_of(t) for t in targets]
        if any(i is None for i in ids):
            return {"error": f"unknown in {targets}"}
        if op == "merge":
            nid = ids[0]
            for i in ids[1:]:
                self.labels[self.labels == i] = nid
                self.names.pop(i, None)
            if new_name:
                self.names[nid] = new_name
            return {"ok": True, "id": nid, "name": self.names[nid]}
        if op == "drop":
            for i in ids:
                self.labels[self.labels == i] = 0
            return {"ok": True, "dropped": targets}
        if op == "rename":
            self.names[ids[0]] = new_name or self.names[ids[0]]
            return {"ok": True}
        if op == "keep_largest":
            for i in ids:
                cc, n = ndimage.label(self.labels == i)
                if n > 1:
                    sizes = ndimage.sum(np.ones_like(cc), cc, index=np.arange(1, n + 1))
                    big = int(np.argmax(sizes)) + 1
                    self.labels[(cc > 0) & (cc != big)] = 0
            return {"ok": True}
        return {"error": f"unknown op {op}"}

    # ------------------------------------------------------------------ stats
    def organ_stats(self, target: str | int) -> dict[str, Any]:
        assert self.labels is not None
        i = self.id_of(target)
        m = self.labels == i
        n = int(m.sum())
        if n == 0:
            return {"error": "empty"}
        idx = np.argwhere(m)
        lo, hi = idx.min(0), idx.max(0)
        dims = ((hi - lo + 1) * np.array(self.spacing)).round(0).tolist()
        hu = self.vol[m]
        vol_ml = n * float(np.prod(self.spacing)) / 1000
        # sphericity via surface area of a quick mesh
        try:
            pad = np.pad(m[lo[0]:hi[0] + 1, lo[1]:hi[1] + 1, lo[2]:hi[2] + 1], 1)
            verts, faces, *_ = measure.marching_cubes(pad.astype(np.float32), 0.5, spacing=self.spacing)
            area = measure.mesh_surface_area(verts, faces)
            v_mm3 = vol_ml * 1000
            spher = float(np.pi ** (1 / 3) * (6 * v_mm3) ** (2 / 3) / area)
        except Exception:
            spher = None
        cut = self.vol.shape[0] // 2
        side_frac = float((idx[:, 0] < cut).mean())
        return {
            "id": i, "name": self.names.get(i), "friendly": friendly(self.names.get(i, "")),
            "volume_ml": round(vol_ml, 1),
            "dimensions_mm_LR_AP_SI": dims,
            "hu_mean": round(float(hu.mean()), 1), "hu_std": round(float(hu.std()), 1),
            "hu_p5_p95": [round(float(x), 0) for x in np.percentile(hu, [5, 95])],
            "sphericity": round(spher, 3) if spher else None,
            "fraction_in_patient_left_half": round(side_frac, 2),
            "touches_scan_edge": bool((lo == 0).any() or (hi == np.array(self.vol.shape) - 1).any()),
        }

    # ----------------------------------------------------------------- meshes
    def build_mesh(self, target: str | int, smoothing: int = 12, max_faces: int = 9000) -> dict[str, Any] | None:
        assert self.labels is not None
        i = self.id_of(target)
        m = self.labels == i
        if m.sum() < 8:
            return None
        idx = np.argwhere(m)
        lo = np.maximum(idx.min(0) - 3, 0)
        hi = np.minimum(idx.max(0) + 4, np.array(m.shape))
        crop = m[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
        name = self.names.get(i, f"label_{i}")
        vol_ml = float(m.sum()) * float(np.prod(self.spacing)) / 1000
        return self.mesh_from_mask(i, name, crop, self.spacing, lo * np.array(self.spacing), vol_ml, smoothing, max_faces)

    def mesh_from_mask(self, i: int, name: str, crop: np.ndarray, spacing, origin_mm, vol_ml: float,
                       smoothing: int = 12, max_faces: int = 9000, extra: dict | None = None) -> dict[str, Any] | None:
        crop = np.pad(crop.astype(np.float32), 2)
        origin_mm = np.asarray(origin_mm, float) - 2 * np.array(spacing)
        target_sp = 1.2
        zoom = np.clip(np.array(spacing) / target_sp, 0.35, 3.0)
        up = ndimage.zoom(crop, zoom, order=1)
        up = ndimage.gaussian_filter(up, 0.9)
        up = np.pad(up, 1)
        if up.max() < 0.5:
            return None
        new_sp = np.array(spacing) / zoom
        verts, faces, _, _ = measure.marching_cubes(up, 0.5, spacing=tuple(new_sp))
        verts = verts - new_sp + origin_mm  # undo pad, add crop offset → mm
        sv = self.scene(verts)
        faces = faces[:, ::-1]  # keep outward normals after axis swap
        tm = trimesh.Trimesh(sv, faces, process=True)
        try:
            trimesh.smoothing.filter_taubin(tm, iterations=smoothing)
        except Exception:
            pass
        if len(tm.faces) > max_faces:
            try:
                import fast_simplification

                v2, f2 = fast_simplification.simplify(np.asarray(tm.vertices, np.float32), np.asarray(tm.faces), 1 - max_faces / len(tm.faces))
                tm = trimesh.Trimesh(v2, f2, process=True)
            except Exception:
                pass
        if tm.volume < 0:
            tm.invert()
        centroid = tm.centroid.copy()
        tm.apply_translation(-centroid)
        mdir = self.dir / "meshes"
        mdir.mkdir(exist_ok=True)
        fn = f"{i}.glb"
        tm.export(str(mdir / fn))
        entry = {
            "id": i, "name": name, "label": friendly(name), "system": system_of(name), "color": color_of(name),
            "url": f"/files/{self.id}/meshes/{fn}", "position": [round(float(c), 4) for c in centroid],
            "faces": int(len(tm.faces)),
            "volume_ml": round(vol_ml, 2),
            **(extra or {}),
        }
        self.meshes[i] = entry
        return entry

    # ---------------------------------------------------------------- outputs
    def manifest(self, summary: str = "", explanations: dict[str, str] | None = None) -> dict[str, Any]:
        expl = explanations or {}
        organs = []
        for e in self.meshes.values():
            organs.append({**e, "blurb": expl.get(e["name"]) or expl.get(e["label"]) or ""})
        man = {
            "scanId": self.id, "title": self.title, "summary": summary, "demoNote": self.demo_note,
            "spacing": self.spacing, "organs": organs, "findings": self.findings,
        }
        (self.dir / "manifest.json").write_text(json.dumps(man, indent=1, default=float))
        return man


def png_b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def clear_meshes(d: Path) -> None:
    shutil.rmtree(d / "meshes", ignore_errors=True)
