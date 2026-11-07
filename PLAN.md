# Novahack build plan — working name **Lumen** (3D scan explainer + weight-space diagnosis)

## Context
Existing tools such as 3Dicom, Visible Patient and 3D Slicer turn a scan into a 3D model and stop there. None of them explain the model to the patient, and none let you take the anatomy apart.
Lumen gives every organ its own movable object. **Opus 5.5 runs the whole pipeline**: segmentation, checking its own results, analysis and explanation. It also does **weight-space programming** on a small diagnosis model: it reads the weights, finds the failure and edits them live, with no training run. That edit is the wow moment. It's built in 6 hours on an M5 with 24 GB of RAM and no GPU server. The demo uses public anonymized CT data and is framed as education, not diagnosis.

## Demo story (3 minutes)
1. Drop in a CT scan. A "thinking timeline" streams Opus's steps: it opens the scan, calls TotalSegmentator, views slices to check the result, merges and splits labels, and builds a mesh for each organ.
2. The organs assemble in 3D, each one a separate clay-like object. Drag any organ out, then press **Reassemble** and everything snaps back with a spring animation. An **Explode** slider pulls everything apart radially.
3. Click an organ, or Shift-click several. It opens on its own focus stage with volume, density in HU, dimensions and normal ranges, plus a plain-language explanation from Opus and a findings card.
4. Open **Train custom model**. The pretrained lesion model misses a small 8 mm liver lesion. Opus reads the weights, runs probes, finds the units responsible and edits a few dozen weights. A live weight heatmap shows which cells changed. Before and after: small-lesion recall goes from ~40% to ~85%, while overall accuracy stays flat. The lesion now lights up red in 3D.

## Architecture
```
web/  (Vite + React + TS)                 api/  (FastAPI, Python 3.12 via uv)
 R3F + drei + framer-motion + zustand  ⇄    /scan upload  → Opus agent loop (SSE stream)
 bright minimal UI                          /organ/:id    → stats + explanation
                                            /wsp          → weight-space session (SSE)
```

### Opus orchestrator (`api/agent.py`)
Runs on your **Claude Code subscription, with no API key**. The Python **Claude Agent SDK** (`claude-agent-sdk`) drives the Claude Code CLI on this Mac, and the CLI uses your logged-in claude.ai account.
- Each tool below is a Python function decorated with `@tool` and bundled with `create_sdk_mcp_server`. They run in the same process, so there's no separate server to manage.
- `ClaudeAgentOptions(model="claude-opus-5-5", allowed_tools=[...], system_prompt=...)`. Built-in file and shell tools are turned off, so Opus can only use our tools.
- The SDK streams each message as it happens (reasoning, tool calls, tool results), and the UI shows them as timeline events over SSE.
- `ANTHROPIC_API_KEY` must stay **unset**, otherwise the SDK bills the API instead of your subscription.
- Subscription usage limits apply. Each Opus agent run uses a big share of them, so cache the demo runs and replay them during rehearsal.
- This is fine for a prototype running on your own machine. A product other people log into would need an API key, since Anthropic doesn't allow apps built on the SDK to offer claude.ai login.

Tools:
- `inspect_volume`: shape, spacing, HU histogram, modality guess
- `render_slices(axis, idx[], window)`: PNG slices passed back as images so Opus can **see** the scan and check segmentations
- `run_totalsegmentator(task, fast, roi_subset)`: optional; Opus decides whether to call it and on which body region
- `threshold_region(hu_range, seed, roi)` and `connected_components`: Opus's own segmentation tools for structures TotalSegmentator misses, and for lesions
- `edit_labels(merge|split|relabel|drop)`: fix and clean up the label map
- `organ_stats(label)`: volume, mean and standard deviation of HU, bounding box, sphericity
- `build_mesh(label, smoothing, decimate)`: marching cubes (scikit-image) → trimesh → one GLB per organ, already centered
- `report_finding(label, kind, evidence, confidence)` and `explain(label, reading_level, language)`
- `ask_model(model, prompt, images?)`: calls any model through **OpenRouter** (key read from `OPENROUTER_API_KEY` in `.env`). Opus decides when to use it:
  - a second opinion from a different vision model on a suspicious slice
  - a fast, cheap model for translating explanations
  - a fallback if your subscription hits its usage limit mid-demo
  
  Every call shows up in the timeline with the model's name.
- Done when Opus calls `finalize_scene(manifest)`.

### Weight-space model (`api/wsp/`)
- `lesion_net`: a small MLP that takes 12 features per lesion candidate (size, HU contrast, shape, location) through layers of 32 and 16 units to a lesion/no-lesion score, about 1k weights in total. Trained in advance with normal training (gradient descent) on lesion candidates from MSD Task03 Liver. Its weak spot is intentional: small lesions are underrepresented in the training data.
- Tools Opus gets: `get_weights(layer)`, `forward_trace(sample)` for per-unit activations, `eval(split, slice=small|all)`, `propose_edit(layer, idx, new_values)`, which runs on a copy and checks against a guard set, and `commit_edit` / `revert`. Every edit is logged with a reason.
- No training run happens during the demo. Opus reasons about the weights directly and edits them, as in the MIT "Sparks of Weight-Space Programming" post.

### UI (`web/`)
- **Bright, minimal**: off-white `#F6F6F3` background, ink `#111` text, one accent (cobalt `#2F5BFF`), red for findings. Geist font. Floating frosted-glass panels, soft contact shadows, generous whitespace.
- Organs use pastel clay materials (MeshPhysicalMaterial with clearcoat) with soft studio lighting and ambient occlusion (N8AO). Hovering an organ adds a rim light; selecting one dims the rest to ghosts.
- Interactions:
  - Drag organs (drei `DragControls` constrained to the camera plane)
  - **Reassemble** with spring animation
  - Explode slider
  - Shift-click to select several organs
  - A focus stage for selected organs
  - A ⌘K command bar for asking about any organ
  - A collapsible timeline drawer on the left
- Weight panel: a heatmap grid per layer, with cells pulsing as Opus edits them and a before/after metric card.

## Data
- Demo CT: MSD Task03 Liver case with a small tumor (CC BY-SA). Cached results ensure the demo never waits on stage.
- Model weights for TotalSegmentator are downloaded before the demo. It runs on CPU with `--fast` (~1–2 minutes on the M5). Try `mps` first.

## 6-hour schedule (stop features at the cut line)
| Hour | Backend | Frontend |
|---|---|---|
| 0–1 | Set up uv env, install TotalSegmentator and pre-download models, download MSD case, write `build_mesh` and `organ_stats` | Scaffold Vite + R3F, design tokens, load placeholder GLBs |
| 1–2 | Opus agent loop + tools + SSE; run end to end on the demo case and cache it | Organ scene: drag, Reassemble, explode, selection |
| 2–3 | Pretrain `lesion_net`, build the weak-spot eval, wsp tools | Focus stage, stats card, timeline drawer streaming |
| 3–4 | Weight-space agent session + edit log | Weight heatmap + before/after card |
| 4–5 | Live upload path, explanations at different reading levels | Polish: lighting, motion, empty and loading states |
| **cut line** | VR mode, more scan types, other languages | ⌘K command bar, mobile layout |
| 5–6 | Rehearse the demo, add fallbacks to cached runs | Record a backup video of the demo |

## Needs from you
- No API key is needed. Log in once with your Claude subscription by running `claude login`. If `claude` isn't installed on your system, install it first with `npm i -g @anthropic-ai/claude-code`.
- About 3 GB of disk for TotalSegmentator models and the MSD case (650 GB free).

## Verification
- `uv run api` and `npm run dev`, then upload the demo CT. The timeline should stream, more than 20 organs should appear, and drag plus Reassemble should work.
- Click the liver: stats should match `organ_stats` and the lesion finding should be shown.
- Run the weight-space session: small-lesion recall should go up, overall accuracy should change by less than 2 points, and the edit log should list every weight that changed.
- Test the whole flow in the browser pane.
