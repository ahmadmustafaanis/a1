"""Opus 5.5 orchestrates the whole scan → 3D pipeline through tools (Claude Agent SDK, subscription auth)."""
from __future__ import annotations

import asyncio
import json
import os
import traceback
from typing import Any

import numpy as np
from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, ResultMessage, TextBlock,
                              ThinkingBlock, ToolUseBlock, create_sdk_mcp_server, tool)

from anatomy import friendly
from openrouter import ask_model
from scan import Scan, png_b64
from wsp.lesion import FEATURES, ISO, extract_candidates, load_bundle

MODEL = os.environ.get("LUMEN_MODEL", "claude-opus-5-5")
# Subscription auth: the SDK drives the local Claude Code CLI. An API key would switch billing to the API.
os.environ.pop("ANTHROPIC_API_KEY", None)


def _txt(obj: Any) -> dict:
    return {"content": [{"type": "text", "text": obj if isinstance(obj, str) else json.dumps(obj, default=float)}]}


SYSTEM = """You are Lumen, the orchestrator of a 3D medical-scan explainer. You drive every step through tools.
Goal: turn the uploaded CT into an accurate, beautiful, explorable 3D scene where every anatomical structure is its own object, then explain it in plain language.

Work like a careful radiology technologist + teacher:
1. inspect_volume, then look at the scan yourself with render_slices (2-3 positions) to judge body region and quality.
2. Segment. run_totalsegmentator is available (fast=true is right for spacing >= 1.5 mm). You decide; you can also refine with threshold_region / edit_labels.
3. Verify visually: render_slices with overlay=true (coronal) and check the labels make anatomical sense. Fix problems (edit_labels keep_largest for fragmented organs, drop nonsense fragments < 1 mL).
4. build_meshes for every meaningful structure (≥ 1 mL; include ribs and vertebrae individually). Batch them in 2-3 calls.
5. If a liver is present, run find_liver_lesions. Study the close-up crops it returns (zoom_view for more). Full slices are too coarse for <1 cm spots. Radiology heuristics: vessels are elongated (elongation > 2.5) and branch; a focal lesion is round (sphericity ≈ 1, elongation < 1.7), sits away from the hilum/surface and keeps the same shape on axial and coronal views. At 3 mm a real 6-9 mm lesion can look faint — weigh the measured shape features, not just the picture. If something looks like a real focal lesion, call report_finding — even if the lesion model scored it low (say so honestly: that model is known to under-call small lesions).
6. Optionally use ask_model (OpenRouter) for a second opinion from a different vision model on a suspicious slice.
7. finalize_scene with a 2-3 sentence plain-language summary and a 1-2 sentence explanation for EVERY structure you built (keys = structure names exactly as listed). Write for a curious patient at an 8th-grade reading level: what it is, what it does, anything notable in this scan (size vs typical). Never diagnose; say "worth asking your doctor about".

Narrate briefly between tool calls (one short sentence) so the user can follow your reasoning. Be efficient: about 15-25 tool calls total."""


def build_tools(scan: Scan):
    log = scan.log
    state: dict[str, Any] = {"final": None, "cands": None}
    slice_n = {"n": 0}

    def save_png(b: bytes) -> str:
        d = scan.dir / "slices"
        d.mkdir(exist_ok=True)
        slice_n["n"] += 1
        fn = f"s{slice_n['n']}.png"
        (d / fn).write_bytes(b)
        return f"/files/{scan.id}/slices/{fn}"

    @tool("inspect_volume", "Shape, spacing, physical extent and HU distribution of the CT.", {})
    async def inspect_volume(args):
        r = scan.inspect()
        log.emit("tool_result", tool="inspect_volume", summary=f"{r['extent_mm_LR_AP_SI']} mm · {r['spacing_mm']} mm voxels", data=r)
        return _txt(r)

    @tool("render_slices", "Render CT slices as an image you can look at. positions are fractions 0-1 along the axis. "
          "window: soft|lung|bone|liver. overlay=true colors current segmentation labels.",
          {"type": "object", "properties": {
              "axis": {"type": "string", "enum": ["axial", "coronal", "sagittal"]},
              "positions": {"type": "array", "items": {"type": "number"}},
              "window": {"type": "string", "enum": ["soft", "lung", "bone", "liver"]},
              "overlay": {"type": "boolean"}}, "required": ["axis", "positions"]})
    async def render_slices(args):
        b = await asyncio.to_thread(scan.render_slices, args["axis"], args["positions"][:4], args.get("window", "soft"),
                                    bool(args.get("overlay", False)))
        url = save_png(b)
        log.emit("image", tool="render_slices", url=url, caption=f"{args['axis']} · {args.get('window', 'soft')}" +
                 (" · labels" if args.get("overlay") else ""))
        log.emit("tool_result", tool="render_slices", summary=f"{len(args['positions'][:4])} {args['axis']} slices")
        return {"content": [{"type": "image", "data": png_b64(b), "mimeType": "image/png"}]}

    @tool("zoom_view", "Close-up axial+coronal crops centred on points (mm, same frame as center_mm from find_liver_lesions).",
          {"type": "object", "properties": {"points": {"type": "array", "items": {"type": "object", "properties": {
              "label": {"type": "string"}, "center_mm": {"type": "array", "items": {"type": "number"}}}}},
              "fov_mm": {"type": "number"}, "window": {"type": "string", "enum": ["soft", "liver", "bone"]}}, "required": ["points"]})
    async def zoom_view(args):
        items = [(p.get("label", "point"), np.array(p["center_mm"], float)) for p in args["points"][:4]]
        b = await asyncio.to_thread(scan.render_zoom, items, float(args.get("fov_mm", 60)), args.get("window", "liver"))
        url = save_png(b)
        log.emit("image", tool="zoom_view", url=url, caption=f"close-up · {len(items)} points")
        log.emit("tool_result", tool="zoom_view", summary=f"{len(items)} close-ups")
        return {"content": [{"type": "image", "data": png_b64(b), "mimeType": "image/png"}]}

    @tool("run_totalsegmentator", "Run TotalSegmentator (117 structures) on this CT. Results are cached per scan.",
          {"type": "object", "properties": {"fast": {"type": "boolean"},
                                            "roi_subset": {"type": "array", "items": {"type": "string"}}}})
    async def run_totalsegmentator(args):
        r = await scan.run_totalsegmentator(bool(args.get("fast", True)), args.get("roi_subset"))
        if "error" in r:
            log.emit("tool_result", tool="run_totalsegmentator", summary="failed", data=r)
            return _txt(r)
        rows = r["structures"]
        log.emit("tool_result", tool="run_totalsegmentator", summary=f"{len(rows)} structures found" + (" (cached)" if r["cached"] else ""),
                 data={"structures": [x["name"] for x in rows]})
        return _txt(r)

    @tool("list_structures", "Current label map: id, name, volume in mL.", {"min_ml": float})
    async def list_structures(args):
        if scan.labels is None:
            return _txt("no labels yet")
        vox = float(np.prod(scan.spacing)) / 1000
        rows = [r for r in scan.label_table() if r["volume_ml"] >= float(args.get("min_ml", 0) or 0)]
        return _txt(rows)

    @tool("threshold_region", "Create a new structure from an HU range, optionally only inside an existing structure.",
          {"type": "object", "properties": {"name": {"type": "string"}, "hu_min": {"type": "number"}, "hu_max": {"type": "number"},
                                            "within": {"type": "string"}, "min_ml": {"type": "number"}},
           "required": ["name", "hu_min", "hu_max"]})
    async def threshold_region(args):
        r = await asyncio.to_thread(scan.threshold_region, args["name"], args["hu_min"], args["hu_max"], args.get("within"),
                                    float(args.get("min_ml", 0.05)))
        log.emit("tool_result", tool="threshold_region", summary=f"{r.get('name')}: {r.get('volume_ml')} mL", data=r)
        return _txt(r)

    @tool("edit_labels", "Edit the label map. op: merge (targets→first, optional new_name) | drop | rename | keep_largest.",
          {"type": "object", "properties": {"op": {"type": "string", "enum": ["merge", "drop", "rename", "keep_largest"]},
                                            "targets": {"type": "array", "items": {"type": "string"}},
                                            "new_name": {"type": "string"}}, "required": ["op", "targets"]})
    async def edit_labels(args):
        r = await asyncio.to_thread(scan.edit_labels, args["op"], args["targets"], args.get("new_name"))
        log.emit("tool_result", tool="edit_labels", summary=f"{args['op']} {', '.join(args['targets'][:4])}", data=r)
        return _txt(r)

    @tool("organ_stats", "Measurements for one structure: volume, dimensions, HU stats, sphericity, laterality.", {"target": str})
    async def organ_stats(args):
        r = await asyncio.to_thread(scan.organ_stats, args["target"])
        log.emit("tool_result", tool="organ_stats", summary=f"{r.get('friendly')}: {r.get('volume_ml')} mL, {r.get('hu_mean')} HU", data=r)
        return _txt(r)

    @tool("build_meshes", "Build a separate smooth 3D mesh for each listed structure (names or ids). Appears live in the viewer.",
          {"type": "object", "properties": {"targets": {"type": "array", "items": {"type": "string"}}}, "required": ["targets"]})
    async def build_meshes(args):
        built, skipped = [], []
        for t in args["targets"]:
            try:
                e = await asyncio.to_thread(scan.build_mesh, t)
            except Exception as ex:  # keep going
                e = None
                skipped.append(f"{t} ({ex})")
            if e:
                built.append(e["name"])
                log.emit("mesh", organ=e)
            elif t not in [s.split(" ")[0] for s in skipped]:
                skipped.append(t)
        log.emit("tool_result", tool="build_meshes", summary=f"{len(built)} meshes built", data={"built": built, "skipped": skipped})
        return _txt({"built": built, "skipped": skipped})

    @tool("find_liver_lesions", "Detect hypodense focal candidates inside the liver and score them with lesion_net "
          "(a small classifier; known weakness: under-calls lesions < 12 mm). Returns candidates + a zoomed slice image.", {})
    async def find_liver_lesions(args):
        lid = scan.id_of("liver")
        if scan.labels is None or lid is None or not (scan.labels == lid).any():
            return _txt("no liver segmented")

        def run():
            feats, cents, masks = extract_candidates(scan.vol, scan.labels == lid, scan.spacing,
                                                    exclude=(scan.labels > 0) & (scan.labels != lid), min_depth_mm=9)
            b = load_bundle()
            p = b.predict(feats)
            order = np.argsort(-(feats[:, 0] * feats[:, 3] * (feats[:, 0] >= 4))) if len(feats) else []
            return feats, cents, masks, p, order

        feats, cents, masks, p, order = await asyncio.to_thread(run)
        state["cands"] = (feats, cents, masks, p)
        rows = []
        for k in list(order)[:8]:
            f = feats[k]
            rows.append({"candidate": int(k), "lesion_net_score": round(float(p[k]), 3),
                         **{n: round(float(v), 2) for n, v in zip(FEATURES, f)},
                         "center_mm": [round(float(c)) for c in cents[k]]})
        content = [{"type": "text", "text": json.dumps({"n_candidates": int(len(feats)), "top_by_conspicuity": rows})}]
        if rows:
            items = [(f"cand {r['candidate']} (score {r['lesion_net_score']:.2f})", cents[r["candidate"]]) for r in rows[:4]]
            b = await asyncio.to_thread(scan.render_zoom, items, 60, "liver")
            url = save_png(b)
            log.emit("image", tool="find_liver_lesions", url=url, caption="close-ups of the top 4 candidates")
            content.append({"type": "text", "text": "Close-ups: each candidate is centred between the yellow ticks (axial left, coronal right)."})
            content.append({"type": "image", "data": png_b64(b), "mimeType": "image/png"})
        log.emit("tool_result", tool="find_liver_lesions", summary=f"{len(feats)} candidates · max score {float(p.max()) if len(p) else 0:.2f}",
                 data={"top": rows[:4]})
        return {"content": content}

    @tool("report_finding", "Record a finding on a lesion candidate; it becomes a red 3D object.",
          {"type": "object", "properties": {"candidate": {"type": "integer"}, "title": {"type": "string"},
                                            "detail": {"type": "string"}, "severity": {"type": "string", "enum": ["info", "watch", "important"]}},
           "required": ["candidate", "title", "detail"]})
    async def report_finding(args):
        if not state["cands"]:
            return _txt("run find_liver_lesions first")
        feats, cents, masks, p = state["cands"]
        k = int(args["candidate"])
        sl, m = masks[k]
        origin = np.array([s.start for s in sl]) * ISO
        fid = 300 + len(scan.findings)
        name = f"lesion_{len(scan.findings) + 1}"
        f = {"id": fid, "candidate": k, "name": name, "title": args["title"], "detail": args["detail"],
             "severity": args.get("severity", "watch"), "organ": "liver",
             "diameter_mm": round(float(feats[k][0]), 1), "lesion_net_score": round(float(p[k]), 3),
             "features": {n: round(float(v), 3) for n, v in zip(FEATURES, feats[k])}}
        e = await asyncio.to_thread(scan.mesh_from_mask, fid, name, m, (ISO,) * 3, origin, float(m.sum()) * ISO ** 3 / 1000,
                                    6, 4000, {"label": f"Finding: {args['title']}", "system": "lesion", "color": "#FF3B30", "finding": True})
        if e:
            e["name"] = name
            f["mesh"] = e
            log.emit("mesh", organ=e)
        scan.findings.append(f)
        np.save(scan.dir / f"{name}_features.npy", feats[k])
        log.emit("finding", finding=f)
        return _txt({"ok": True, "finding": name})

    @tool("ask_model", "Consult another model via OpenRouter. Vision-capable IDs: 'google/gemini-3.8-flash', 'openai/gpt-6.1-terra', "
          "'x-ai/grok-4.7', 'qwen/qwen3.8-max-prime'. "
          "Optionally attach CT slices for a visual second opinion.",
          {"type": "object", "properties": {"model": {"type": "string"}, "prompt": {"type": "string"},
                                            "slice_axis": {"type": "string", "enum": ["axial", "coronal", "sagittal"]},
                                            "slice_positions": {"type": "array", "items": {"type": "number"}},
                                            "window": {"type": "string"}}, "required": ["model", "prompt"]})
    async def ask(args):
        imgs = []
        if args.get("slice_axis") and args.get("slice_positions"):
            b = await asyncio.to_thread(scan.render_slices, args["slice_axis"], args["slice_positions"][:3], args.get("window", "soft"), False)
            imgs.append(png_b64(b))
        log.emit("tool_progress", tool="ask_model", text=f"asking {args['model']}…")
        ans = await ask_model(args["model"], args["prompt"], imgs)
        log.emit("tool_result", tool="ask_model", summary=f"{args['model']} answered", data={"model": args["model"], "answer": ans[:1200]})
        return _txt(ans)

    @tool("finalize_scene", "Finish: summary + per-structure plain-language explanations (keys = structure names).",
          {"type": "object", "properties": {"summary": {"type": "string"},
                                            "explanations": {"type": "object", "additionalProperties": {"type": "string"}}},
           "required": ["summary", "explanations"]})
    async def finalize_scene(args):
        man = scan.manifest(args["summary"], args.get("explanations") or {})
        state["final"] = man
        log.emit("manifest", manifest=man)
        return _txt({"ok": True, "organs": len(man["organs"])})

    tools = [inspect_volume, render_slices, zoom_view, run_totalsegmentator, list_structures, threshold_region, edit_labels,
             organ_stats, build_meshes, find_liver_lesions, report_finding, ask, finalize_scene]
    return tools, state


async def run_scan_agent(scan: Scan) -> None:
    log = scan.log
    tools, state = build_tools(scan)
    server = create_sdk_mcp_server(name="lumen", version="1.0.0", tools=tools)
    opts = ClaudeAgentOptions(
        model=MODEL,
        system_prompt=SYSTEM,
        mcp_servers={"lumen": server},
        tools=[],
        allowed_tools=[f"mcp__lumen__{t.name}" for t in tools],
        permission_mode="bypassPermissions",
        setting_sources=[],
        max_turns=60,
        cwd=str(scan.dir),
        thinking={"type": "adaptive", "display": "summarized"},
        max_buffer_size=64 * 1024 * 1024,
    )
    # The demo note (lesion was inserted) is shown to humans only — Opus must find it on its own.
    prompt = f"A new CT has been uploaded ('{scan.title or 'scan'}'). Build the 3D scene."
    log.emit("status", stage="agent", text=f"Opus 5.5 is taking over ({MODEL})")
    try:
        async with ClaudeSDKClient(options=opts) as client:
            await client.query(prompt)
            async for msg in client.receive_response():
                if isinstance(msg, AssistantMessage):
                    for b in msg.content:
                        if isinstance(b, ThinkingBlock) and b.thinking.strip():
                            log.emit("thinking", text=b.thinking.strip()[:1500])
                        elif isinstance(b, TextBlock) and b.text.strip():
                            log.emit("say", text=b.text.strip())
                        elif isinstance(b, ToolUseBlock):
                            log.emit("tool_call", id=b.id, tool=b.name.replace("mcp__lumen__", ""), input=_short(b.input))
                elif isinstance(msg, ResultMessage):
                    log.emit("result", turns=msg.num_turns, ms=msg.duration_ms, cost_usd=getattr(msg, "total_cost_usd", None))
        if not state["final"]:  # agent stopped early — still ship what was built
            log.emit("manifest", manifest=scan.manifest("", {}))
    except Exception as ex:
        log.emit("error", text=f"{type(ex).__name__}: {ex}", trace=traceback.format_exc()[-1500:])
        if scan.meshes:
            log.emit("manifest", manifest=scan.manifest("", {}))
    finally:
        log.finish()


def _short(x: Any) -> Any:
    s = json.dumps(x, default=str)
    return x if len(s) < 600 else json.loads(s[:0] or "{}") | {"_truncated": s[:600]}
