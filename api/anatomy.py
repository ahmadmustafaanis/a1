"""Label names, friendly names, body systems and colors for segmented structures."""
from __future__ import annotations

import re

from totalsegmentator.map_to_binary import class_map

TOTAL_LABELS: dict[int, str] = dict(class_map["total"])

# Pastel "clay" palette per system — tuned for a bright, off-white stage.
SYSTEM_COLORS = {
    "digestive": "#F2B8A0",
    "hepatic": "#C9776B",
    "urinary": "#E8A3A8",
    "respiratory": "#BFD7EA",
    "cardiac": "#D9666F",
    "arterial": "#E0575F",
    "venous": "#6F8FD8",
    "skeletal": "#EFE7DA",
    "muscular": "#D99A8B",
    "endocrine": "#E9C46A",
    "nervous": "#F4DDA8",
    "lesion": "#FF3B30",
    "other": "#CFCFCF",
}

_RULES: list[tuple[str, str]] = [
    (r"liver|gallbladder", "hepatic"),
    (r"spleen|stomach|pancreas|esophagus|bowel|duodenum|colon", "digestive"),
    (r"kidney|bladder|prostate", "urinary"),
    (r"lung|trachea", "respiratory"),
    (r"heart|atrial", "cardiac"),
    (r"aorta|artery|brachiocephalic_trunk", "arterial"),
    (r"vein|vena|venous", "venous"),
    (r"vertebra|rib|sacrum|hip|femur|humerus|scapula|clavicula|sternum|skull|costal", "skeletal"),
    (r"gluteus|autochthon|iliopsoas|muscle", "muscular"),
    (r"adrenal|thyroid", "endocrine"),
    (r"brain|spinal_cord", "nervous"),
    (r"lesion|tumor|mass|cyst", "lesion"),
]


def system_of(name: str) -> str:
    for pat, sys in _RULES:
        if re.search(pat, name):
            return sys
    return "other"


def friendly(name: str) -> str:
    n = name.replace("_", " ")
    n = re.sub(r"\bvertebrae (\w+)", r"\1 vertebra", n)
    n = re.sub(r"\b(left|right) (\d+)$", r"\1 \2", n)
    n = n.replace("vena", "vein").replace("clavicula", "clavicle").replace("autochthon", "deep back muscle")
    # "kidney right" -> "Right kidney"
    m = re.match(r"^(.*) (left|right)( \d+)?$", n)
    if m:
        n = f"{m.group(2)} {m.group(1)}{m.group(3) or ''}"
    return n[:1].upper() + n[1:]


def color_of(name: str) -> str:
    return SYSTEM_COLORS[system_of(name)]
