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


def _closest_call(sdir: Path, base):
    """Recompute liver candidates from the cached CT + segmentation; return the highest-scoring one."""
    import nibabel as nib
    import numpy as np

    from wsp.lesion import extract_candidates

    segs = sorted(sdir.glob("seg_*.nii.gz"))
    if not segs or not (sdir / "ct.nii.gz").exists():
        return None
    img = nib.as_closest_canonical(nib.load(str(sdir / "ct.nii.gz")))
    vol = np.asarray(img.dataobj, np.float32)
    seg = np.asarray(nib.as_closest_canonical(nib.load(str(segs[0]))).dataobj)
    liver = seg == 5
    if liver.sum() < 100:
        return None
    feats, cents, _ = extract_candidates(vol, liver, img.header.get_zooms()[:3], exclude=(seg > 0) & ~liver, min_depth_mm=9)
    if not len(feats):
        return None
    p = base.predict(feats)
    k = int(np.argmax(p))
    return feats[k], {"candidates_checked": int(len(feats)), "score_original": round(float(p[k]), 3),
                      "diameter_mm": round(float(feats[k][0]), 1), "center_mm": [round(float(c)) for c in cents[k]]}


@app.post("/api/scans/{scan_id}/explain")
async def explain(scan_id: str, force: bool = False):
    return await build_explain(scan_id, force)


async def build_explain(scan_id: str, force: bool = False):
    """Weight-level explanation of each finding: exact attributions + circuit flow, unit names and narrative by Opus."""
    import numpy as np
    import torch
    from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, TextBlock, query

    from wsp.explain import decompose, unit_profiles, weight_diff
    from wsp.lesion import FEATURES, Bundle, LesionNet, load_bundle, load_data

    sdir = CACHE / scan_id
    if not sdir.exists():
        raise HTTPException(404, "unknown scan")
    base = load_bundle()
    feats = sorted(sdir.glob("lesion_*_features.npy"))
    closest = None
    if not feats:
        # No finding reported: explain the closest call — the most lesion-like spot — and why it was NOT flagged.
        closest = await asyncio.to_thread(_closest_call, sdir, base)
        if closest is None:
            raise HTTPException(404, "No liver lesion candidates in this scan, so there is no model decision to explain.")
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
        cases.append({"name": f.name.replace("_features.npy", ""), "kind": "finding", "base": decompose(base, x),
                      "edited": decompose(edited, x) if edited else None})
    if closest is not None:
        x, info = closest
        cases.append({"name": "closest_call", "kind": "closest_call", "info": info, "base": decompose(base, x),
                      "edited": decompose(edited, x) if edited else None})
    edits = _edits_log(sdir)
    data = load_data()
    profiles = {"original": unit_profiles(base, data), "edited": unit_profiles(edited, data) if edited else None}

    def brief(d):
        return {"score": d["score"], "features": d["features"],
                "top_h1": sorted(d["h1"], key=lambda u: -abs(u["contrib"]))[:6],
                "top_h2": sorted(d["h2"], key=lambda u: -abs(u["contrib"]))[:5], "counterfactuals": d["counterfactuals"]}

    if closest is None:
        subject = "one liver finding that was reported"
    elif closest[1]["score_original"] >= 0.5:
        subject = ("the spot lesion_net scored MOST lesion-like in this liver. Opus (the orchestrating assistant) reviewed the images and "
                   f"did NOT report it, judging it non-lesional (e.g. vessel, fissure or edge artifact). Details: {json.dumps(closest[1])}. "
                   "Explain what drove the model's high score, which features argue it is not a lesion, and why a human-style review matters")
    else:
        subject = ("the MOST lesion-like spot in this liver, which the model scored below threshold and which was NOT reported "
                   f"(the scan had no findings). Details: {json.dumps(closest[1])}. Explain why it was not called a lesion; reassure without overclaiming")
    prompt = f"""You are explaining a small neural network's decision about {subject} to a patient and their doctor.
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
    out = {"tag": tag, "kind": cases[0]["kind"], "features": FEATURES, "feature_plain": FEATURE_PLAIN, "cases": cases, "edits": edits,
           "edited_cells": weight_diff(base, edited) if edited else [], "opus": j}
    cache.write_text(json.dumps(out, default=float))
    return out


@app.get("/api/scans/{scan_id}/wsp")
def saved_wsp(scan_id: str):
    """The last completed weight-space session for this scan (all events), so the UI can reopen it without retraining."""
    p = CACHE / scan_id / "wsp_events.jsonl"
    if not p.exists():
        raise HTTPException(404, "no saved session")
    evs = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    if not any(e["type"] == "wsp_done" for e in evs):
        raise HTTPException(404, "session not finished")
    diff = _true_diff(CACHE / scan_id)
    if diff is not None:
        for e in evs:
            if e["type"] == "wsp_done":
                n = e["report"].get("n_params", 305)
                e["report"]["weights_changed"] = len(diff)
                e["report"]["pct_changed"] = round(100 * len(diff) / n, 2)
    return evs


def _true_diff(sdir: Path):
    import torch

    from wsp.explain import weight_diff
    from wsp.lesion import Bundle, LesionNet, load_bundle

    ep = sdir / "lesion_net_edited.pt"
    if not ep.exists():
        return None
    ck = torch.load(ep, weights_only=False)
    n = LesionNet()
    n.load_state_dict(ck["state"])
    return weight_diff(load_bundle(), Bundle(n, ck["mu"], ck["sd"]))


@app.get("/api/scans/{scan_id}/explain")
def saved_explain(scan_id: str):
    """Cached Model X-ray analysis (no Opus call)."""
    p = CACHE / scan_id / "explain.json"
    if not p.exists():
        raise HTTPException(404, "no saved analysis")
    c = json.loads(p.read_text())
    ep = CACHE / scan_id / "lesion_net_edited.pt"
    if c.get("tag") != f"{int(ep.stat().st_mtime) if ep.exists() else 0}":
        raise HTTPException(404, "analysis is out of date")
    diff = _true_diff(CACHE / scan_id)
    if diff is not None:
        c["edited_cells"] = diff
    return c


# ----------------------------------------------------------------------------- full report
REPORT_SYSTEM = ("You write patient-facing imaging reports for an educational 3D CT explainer. You are precise, warm and honest "
                 "about uncertainty. You never diagnose; you explain, interpret and suggest sensible next steps.")


async def _opus_json(prompt: str, system: str) -> dict:
    from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, TextBlock, query

    opts = ClaudeAgentOptions(model=os.environ.get("LUMEN_MODEL", "claude-opus-5-5"), tools=[], setting_sources=[], max_turns=1,
                              system_prompt=system, max_buffer_size=64 * 1024 * 1024)
    text = ""
    async for m in query(prompt=prompt, options=opts):
        if isinstance(m, AssistantMessage):
            text += "".join(b.text for b in m.content if isinstance(b, TextBlock))
    try:
        return json.loads(text[text.index("{"): text.rindex("}") + 1])
    except Exception:
        return {"impression": text.strip()[:1500]}


async def run_report(scan_id: str, log: EventLog) -> None:
    from wsp.session import WSPSession

    sdir = CACHE / scan_id
    try:
        man = json.loads((sdir / "manifest.json").read_text())

        # 1) custom weights — generate them if this scan doesn't have them yet
        if not (sdir / "lesion_net_edited.pt").exists():
            log.emit("report_stage", stage="weights", status="running", text="Opus is creating custom weights for this scan")
            wlog = EventLog(sdir / "wsp_events.jsonl")
            task = asyncio.create_task(WSPSession(wlog, sdir).run())
            async for ev in wlog.stream():
                log.emit(ev["type"], **{k: v for k, v in ev.items() if k not in ("i", "t", "type")})
            await task
            log.emit("report_stage", stage="weights", status="done", text="Custom weights ready")
        else:
            log.emit("report_stage", stage="weights", status="skipped", text="Using this scan's existing custom weights")

        wsp = None
        wp = sdir / "wsp_events.jsonl"
        if wp.exists():
            for l in wp.read_text().splitlines():
                e = json.loads(l)
                if e["type"] == "wsp_done":
                    wsp = e["report"]
            diff = _true_diff(sdir)
            if wsp and diff is not None:
                wsp["weights_changed"] = len(diff)
                wsp["pct_changed"] = round(100 * len(diff) / wsp.get("n_params", 305), 2)

        # 2) model X-ray for the finding (or the closest call)
        log.emit("report_stage", stage="explain", status="running", text="Tracing why the model decided")
        ex = None
        try:
            ex = await build_explain(scan_id)
            log.emit("explain_ready", explain=ex)
        except HTTPException as he:
            log.emit("report_stage", stage="explain", status="skipped", text=str(he.detail))
        log.emit("report_stage", stage="explain", status="done", text="Model reasoning traced")

        # 3) Opus writes the report
        log.emit("report_stage", stage="write", status="running", text="Opus is writing your report")
        organs = [{"name": o["name"], "label": o["label"], "system": o["system"], "volume_ml": o["volume_ml"], "note": o.get("blurb", "")}
                  for o in man["organs"] if not o.get("finding")]
        brief_ex = None
        if ex:
            c = ex["cases"][0]
            brief_ex = {"kind": ex.get("kind"), "info": c.get("info"), "score_original": c["base"]["score"],
                        "score_edited": c["edited"]["score"] if c.get("edited") else None,
                        "top_features_edited": sorted((c["edited"] or c["base"])["features"], key=lambda f: -abs(f["contrib"]))[:5],
                        "opus_xray": ex.get("opus")}
        prompt = f"""Write a complete report for this person's CT, based ONLY on the data below.

Scan: {man.get('title')} · {len(organs)} structures segmented. Demo note: {man.get('demoNote') or 'none'}
Opus's scan summary: {man.get('summary')}
Structures (volume, existing plain-language note): {json.dumps(organs, default=float)[:9000]}
Findings: {json.dumps(man.get('findings', []), default=float)[:3000]}
Custom diagnosis model (Opus edited lesion_net's weights directly, no retraining), held-out results: {json.dumps(wsp, default=float)[:2500] if wsp else 'not available'}
Model X-ray of the {'finding' if ex and ex.get('kind') == 'finding' else 'closest call'}: {json.dumps(brief_ex, default=float)[:4000] if brief_ex else 'not available'}

Return ONLY a JSON object with:
  "impression": 3-5 plain sentences — the overall picture,
  "key_points": 3-5 short bullets,
  "organs": [{{"name": exact structure name, "status": "typical" | "attention" | "incomplete", "note": one sentence interpretation using its volume}}] — cover the 10-16 most relevant structures (main organs, vessels; group repetitive bones/muscles into one entry each with name "skeleton" / "muscles"),
  "findings": [{{"name": finding name, "interpretation": 2-3 sentences, "possibilities": 2-4 short items (e.g. "simple cyst", "hemangioma"), "certainty": one short phrase}}],
  "ai_reasoning": 2-3 sentences explaining in plain words what the custom model weighed and how Opus's weight edits changed it, including any trade-off,
  "suggestions": [{{"title": short, "detail": one or two sentences, "urgency": "routine" | "soon" | "discuss"}}] — 3-5 sensible next steps,
  "questions_for_doctor": 3-5 questions,
  "limitations": 3-4 short honest bullets (resolution, demo data, model scope, not a diagnosis)."""
        rep = await _opus_json(prompt, REPORT_SYSTEM)
        import time as _t

        out = {"scanId": scan_id, "created": int(_t.time()), "title": man.get("title"), "demoNote": man.get("demoNote"),
               "summary": man.get("summary"), "nOrgans": len(organs), "findings": man.get("findings", []),
               "organs": {o["name"]: {"label": o["label"], "volume_ml": o["volume_ml"], "system": o["system"]} for o in organs},
               "wsp": wsp, "opus": rep}
        (sdir / "report.json").write_text(json.dumps(out, default=float))
        log.emit("report_stage", stage="write", status="done", text="Report ready")
        log.emit("report_ready", report=out)
    except Exception as exc:  # surface to the UI
        import traceback

        log.emit("error", text=f"{type(exc).__name__}: {exc}", trace=traceback.format_exc()[-1500:])
    finally:
        log.finish()


@app.post("/api/scans/{scan_id}/report")
async def start_report(scan_id: str):
    if not (CACHE / scan_id / "manifest.json").exists():
        raise HTTPException(404, "scan not ready")
    job = uuid.uuid4().hex[:8]
    log = EventLog(CACHE / scan_id / "report_events.jsonl")
    JOBS[job] = log
    asyncio.create_task(run_report(scan_id, log))
    return {"job": job}


@app.get("/api/scans/{scan_id}/report")
def saved_report(scan_id: str):
    p = CACHE / scan_id / "report.json"
    if not p.exists():
        raise HTTPException(404, "no report yet")
    return json.loads(p.read_text())
