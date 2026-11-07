"""Build the demo case: public TotalSegmentator sample CT + one digitally inserted small liver lesion.

Usage: uv run python make_demo.py [diameter_mm] [contrast_hu]
"""
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
src = ROOT / "data" / "example_ct.nii.gz"
seg_p = ROOT / "cache" / "example_ct" / "seg.nii.gz"
out = ROOT / "data" / "demo_abdomen.nii.gz"

diam = float(sys.argv[1]) if len(sys.argv) > 1 else 9.0
contrast = float(sys.argv[2]) if len(sys.argv) > 2 else 38.0

img = nib.as_closest_canonical(nib.load(str(src)))
vol = np.asarray(img.dataobj, np.float32)
sp = np.array(img.header.get_zooms()[:3], float)
seg = np.asarray(nib.as_closest_canonical(nib.load(str(seg_p))).dataobj)
liver = seg == 5
depth = ndimage.distance_transform_edt(liver, sampling=sp)
# a spot deep in the right lobe
cand = np.argwhere(depth > 22)
c = cand[np.argmax(cand[:, 0] - 0.3 * np.abs(cand[:, 2] - cand[:, 2].mean()))]
print("lesion centre voxel", c, "depth mm", depth[tuple(c)])

# render at 0.5 mm super-resolution then area-average to the scan grid (realistic partial volume)
f = 6
r = diam / 2
lo = c - 3
grid = np.mgrid[0:7 * f, 0:7 * f, 0:7 * f].astype(np.float32)
pos = [(lo[i] + (grid[i] + 0.5) / f) * sp[i] for i in range(3)]
cmm = (c + 0.5) * sp
d2 = sum(((pos[i] - cmm[i]) / (r * s)) ** 2 for i, s in enumerate([1.0, 0.92, 1.06]))
fine = ndimage.gaussian_filter((d2 <= 1).astype(np.float32), 1.5)
coarse = fine.reshape(7, f, 7, f, 7, f).mean((1, 3, 5))
sl = tuple(slice(lo[i], lo[i] + 7) for i in range(3))
vol[sl] -= coarse * contrast
nib.save(nib.Nifti1Image(vol, img.affine), str(out))
print("saved", out)
