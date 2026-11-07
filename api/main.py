"""Lumen API: upload → Opus-orchestrated 3D scene (SSE), organ Q&A, weight-space session."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from events import EventLog
from scan import CACHE, ROOT, Scan

os.environ.pop("ANTHROPIC_API_KEY", None)  # use the Claude Code subscription

DEMOS = {
    "abdomen": {"file": ROOT / "data" / "demo_abdomen.nii.gz", "title": "Abdomen & pelvis CT",
                "note": "Public anonymized CT (TotalSegmentator sample). A small (~8 mm) liver lesion was digitally inserted for this demo."},
}

app = FastAPI(title="Lumen")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
CACHE.mkdir(exist_ok=True)
app.mount("/files", StaticFiles(directory=str(CACHE)), name="files")

JOBS: dict[str, EventLog] = {}
SCANS: dict[str, Scan] = {}


@app.get("/api/demos")
def demos():
    return [{"id": k, "title": v["title"], "note": v["note"], "available": v["file"].exists()} for k, v in DEMOS.items()]


@app.post("/api/scans")
async def create_scan(file: UploadFile | None = File(None), demo: str | None = Form(None), replay: bool = Form(False)):
    job = uuid.uuid4().hex[:8]
    if demo:
        d = DEMOS.get(demo)
        if not d or not d["file"].exists():
            raise HTTPException(404, "demo not available")
        path, title, note = d["file"], d["title"], d["note"]
    elif file:
        up = CACHE / "uploads"
        up.mkdir(exist_ok=True)
        name = Path(file.filename or "scan.nii.gz").name
        if not (name.endswith(".nii") or name.endswith(".nii.gz")):
            raise HTTPException(400, "Upload a NIfTI CT (.nii or .nii.gz)")
        path = up / f"{job}_{name}"
        with path.open("wb") as f:
            shutil.copyfileobj(file.file, f)
        title, note = name.replace(".nii.gz", "").replace(".nii", ""), None
    else:
        raise HTTPException(400, "file or demo required")

    tmp = EventLog()
    scan = await asyncio.to_thread(Scan.load, path, tmp, title, note)
    rec = scan.dir / "events.jsonl"
    if replay and rec.exists() and (scan.dir / "manifest.json").exists():
        log = EventLog.replay(rec)
        JOBS[job] = log
        SCANS[scan.id] = scan
        return {"job": job, "scanId": scan.id, "replay": True}

    log = EventLog(rec)
    scan.log = log
    JOBS[job] = log
    SCANS[scan.id] = scan
    log.emit("status", stage="loaded", text=f"Loaded {title}", scanId=scan.id, demoNote=note)
    from agent import run_scan_agent

    asyncio.create_task(run_scan_agent(scan))
    return {"job": job, "scanId": scan.id, "replay": False}


@app.get("/api/jobs/{job}/events")
async def events(job: str, start: int = 0):
    log = JOBS.get(job)
    if not log:
        raise HTTPException(404)

    async def gen():
        async for ev in log.stream(start):
            yield {"event": "message", "data": json.dumps(ev, default=str)}
        yield {"event": "end", "data": "{}"}

    return EventSourceResponse(gen(), ping=10)


@app.get("/api/scans/{scan_id}/manifest")
def manifest(scan_id: str):
    p = CACHE / scan_id / "manifest.json"
    if not p.exists():
        raise HTTPException(404)
    return json.loads(p.read_text())


class Ask(BaseModel):
    organs: list[str]
    question: str
    level: str = "plain"


@app.post("/api/scans/{scan_id}/ask")
async def ask(scan_id: str, body: Ask):
    """Free-form question about selected organs, answered by Opus with this scan's measurements."""
    from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, TextBlock, query

    scan = SCANS.get(scan_id)
    p = CACHE / scan_id / "manifest.json"
    man = json.loads(p.read_text()) if p.exists() else {}
    ctx = []
    for o in man.get("organs", []):
        if o["name"] in body.organs or o["label"] in body.organs:
            stats = scan.organ_stats(o["id"]) if (scan and scan.labels is not None and o["id"] < 300) else {}
            ctx.append({"organ": o["label"], "volume_ml": o["volume_ml"], "blurb": o.get("blurb"), **stats})
    findings = man.get("findings", [])
    prompt = (f"Patient question about {', '.join(body.organs)}: {body.question}\n\n"
              f"Measurements from their CT: {json.dumps(ctx, default=float)}\nFindings: {json.dumps(findings, default=float)[:2500]}\n\n"
              "Answer in 3-6 short sentences, plain language (8th-grade), warm and precise. Use their numbers and compare with "
              "typical adult ranges. You are an educational tool, not a diagnosis — suggest asking their doctor where relevant.")
    opts = ClaudeAgentOptions(model=os.environ.get("LUMEN_MODEL", "claude-opus-5-5"), tools=[], setting_sources=[], max_turns=1,
                              system_prompt="You explain a person's own CT anatomy to them clearly and kindly.")
    out = []
    async for m in query(prompt=prompt, options=opts):
        if isinstance(m, AssistantMessage):
            out += [b.text for b in m.content if isinstance(b, TextBlock)]
    return {"answer": "\n".join(out).strip()}


class WspReq(BaseModel):
    scanId: str | None = None
    replay: bool = False


@app.post("/api/wsp")
async def start_wsp(body: WspReq):
    from wsp.session import WSPSession

    job = uuid.uuid4().hex[:8]
    sdir = CACHE / body.scanId if body.scanId else None
    rec = (sdir or CACHE) / "wsp_events.jsonl"
    if body.replay and rec.exists():
        JOBS[job] = EventLog.replay(rec, speed=2.0, cap=1.2)
        return {"job": job, "replay": True}
    log = EventLog(rec)
    JOBS[job] = log
    asyncio.create_task(WSPSession(log, sdir).run())
    return {"job": job, "replay": False}


@app.get("/api/health")
def health():
    return {"ok": True}


FEATURE_PLAIN = {
    "diameter_mm": "size", "log_volume": "volume", "contrast_hu": "darkness vs liver", "contrast_snr": "stands out from noise",
    "sphericity": "roundness", "elongation": "elongation", "edge_sharpness": "edge sharpness",
    "internal_noise": "internal texture", "depth_mm": "depth inside liver",
}


def _edits_log(sdir: Path) -> list[dict]:
    p = sdir / "wsp_events.jsonl"
    if not p.exists():
        return []
    out = []
    for l in p.read_text().splitlines():
        e = json.loads(l)
        if e["type"] == "wsp_edit":
            out.append({"reason": e["edit"]["reason"], "cells": e["edit"]["cells"]})
        if e["type"] == "wsp_revert" and out:
            out.pop()
    return out


@app.post("/api/scans/{scan_id}/explain")
async def explain(scan_id: str, force: bool = False):
    """Weight-level explanation of each finding: exact attributions + circuit flow, unit names and narrative by Opus."""
    import numpy as np
    import torch
    from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, TextBlock, query

    from wsp.explain import decompose, unit_profiles
    from wsp.lesion import FEATURES, Bundle, LesionNet, load_bundle, load_data

    sdir = CACHE / scan_id
    feats = sorted(sdir.glob("lesion_*_features.npy"))
    if not feats:
        raise HTTPException(404, "no findings")
    base = load_bundle()
    edited = None
    ep = sdir / "lesion_net_edited.pt"
    if ep.exists():
        ck = torch.load(ep, weights_only=False)
        n = LesionNet()
        n.load_state_dict(ck["state"])
        n.eval()
        edited = Bundle(n, ck["mu"], ck["sd"])
    tag = f"{int(ep.stat().st_mtime) if ep.exists() else 0}"
    cache = sdir / "explain.json"
    if cache.exists() and not force:
        c = json.loads(cache.read_text())
        if c.get("tag") == tag:
            return c

    cases = []
    for f in feats:
        x = np.load(f)
        cases.append({"name": f.name.replace("_features.npy", ""), "base": decompose(base, x),
                      "edited": decompose(edited, x) if edited else None})
    edits = _edits_log(sdir)
    data = load_data()
    profiles = {"original": unit_profiles(base, data), "edited": unit_profiles(edited, data) if edited else None}

    def brief(d):
        return {"score": d["score"], "features": d["features"],
                "top_h1": sorted(d["h1"], key=lambda u: -abs(u["contrib"]))[:6],
                "top_h2": sorted(d["h2"], key=lambda u: -abs(u["contrib"]))[:5], "counterfactuals": d["counterfactuals"]}

    prompt = f"""You are explaining a small neural network's decision about one liver finding to a patient and their doctor.
The network (lesion_net, 9 features → 16 h1 units → 8 h2 units → lesion probability) is piecewise linear, so the numbers below are EXACT
contributions to the logit (positive = pushes toward "lesion"), measured relative to an average candidate.
Feature meanings: {json.dumps(FEATURE_PLAIN)}

Unit activity profiles across the validation set (mean activation per group, top incoming weights):
{json.dumps(profiles['original'], default=float)}

Finding decomposition, ORIGINAL model: {json.dumps(brief(cases[0]['base']), default=float)}
{"Finding decomposition, EDITED model (after Opus's weight-space edits): " + json.dumps(brief(cases[0]['edited']), default=float) if edited else "No edited model yet."}
{"Weight edits made (with reasons): " + json.dumps(edits, default=float)[:4000] if edits else ""}

Return ONLY a JSON object (no prose around it) with:
  "units": {{"h1[i]" or "h2[j]": {{"name": 2-4 word human name, "role": one short sentence}} }} — name the 8-10 units that matter most for this finding,
  "headline": one plain sentence: why the model now says what it says,
  "evidence_for": 2-3 short bullets (features/units pushing toward lesion, cite numbers),
  "evidence_against": 1-3 short bullets,
  "what_changed": one or two sentences on how the weight edits changed the reasoning (or "" if no edits),
  "counterfactual": one sentence: the smallest realistic change that would flip the call,
  "report_sentence": one sentence a radiology report could include, cautious and specific."""
    opts = ClaudeAgentOptions(model=os.environ.get("LUMEN_MODEL", "claude-opus-5-5"), tools=[], setting_sources=[], max_turns=1,
                              system_prompt="You are a precise ML interpretability researcher who also writes clearly for patients.",
                              max_buffer_size=64 * 1024 * 1024)
    text = ""
    async for m in query(prompt=prompt, options=opts):
        if isinstance(m, AssistantMessage):
            text += "".join(b.text for b in m.content if isinstance(b, TextBlock))
    try:
        j = json.loads(text[text.index("{"): text.rindex("}") + 1])
    except Exception:
        j = {"headline": text.strip()[:600], "units": {}}
    out = {"tag": tag, "features": FEATURES, "feature_plain": FEATURE_PLAIN, "cases": cases, "edits": edits,
           "edited_cells": [c for e in edits for c in e["cells"]], "opus": j}
    cache.write_text(json.dumps(out, default=float))
    return out
