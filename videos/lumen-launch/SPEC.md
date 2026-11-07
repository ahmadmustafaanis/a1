GOAL:    A judge leaves knowing: Lumen turns a CT into your own explorable 3D anatomy, and Opus 5.5 can fix and explain the AI that reads it.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps
TIME:    78 s x 30 = 2340 frames (hard cap 80 s). Music bed ~120 BPM → 15 frames per beat.
LOOK:    Two worlds.
         CT world: #050505 ground, real axial CT slices (MSD liver case, CC BY-SA 4.0) full-bleed, grey only; type white #F4F3EF.
         Lumen world: ground #F4F3EF with a 1200x800 radial lift to #FFFFFF at 50%/35%; ink #111214; secondary #4A4C52;
         accent cobalt #2F5BFF only on the one highlighted word per title and the end card; finding red #FF3B30 only on the lesion.
         Display: Geist Sans 600, 112 px (≈10% of height), tracking -4.5%; quiet lines Geist 500, 40 px, -1%.
         Product footage: real screen recordings of Lumen at 1920x1080, shown full-frame or punched to 1.35–1.8x, never tilted.
         Depth: product frame shadow 0 30px 80px -30px rgba(17,18,20,.25) only when footage is inset; no vignette; grain 0.
OBJECTS: the CT slice (real grey anatomy, ribs, liver, spine); the 3D organs (Lumen's own clay meshes); Opus's process feed;
         the weight heatmap with cobalt-outlined edited cells; the green patient bar; the report document; the lumen mark (cobalt disc + off-white core).
MOTION:  enter expo.out 0.5–0.7 s; move power2.inOut 0.5 s; exit power3.in 0.3 s; camera punch power3.inOut 0.6 s.
         Titles: per-word blur 6px→0 + opacity in 0.13 s, 0.08 s apart, no translate; land and hold dead still; exit blur-out 0.2 s.
         Footage moves only as camera (scale/x/y on a wrapper).
SHOTS:   01  0.0–6.0   CT scroll (slices flick at 12/s, slowing to a stop). "This is a CT scan." 0.3–2.6 → "Can you read it?" 2.8–5.6. Sound: thin pulse. → slice freezes.
         02  6.0–10.0  The frozen slice; "Grey slices." / "Jargon." / "Waiting." beats replaced by one line: "Most people can't." Sound: pulse thins. → slice shrinks into a disc.
         03 10.0–14.0  Colour flood: the slice collapses into the lumen disc while the ground floods to #F4F3EF; "Lumen turns it into you." Sound: music opens + whoosh. → disc becomes the app.
         04 14.0–26.0  Build footage: landing → Instant replay → Opus's process streams while 61 organs assemble. Lines: "Opus 5.5 builds it" / "61 structures. Each its own object." → hard punch-in to the body.
         05 26.0–35.0  Explore footage: hide bowel, drag the kidney out, explode, reassemble. Line: "Pull it apart. Put it back." Clicks on real clicks.
         06 35.0–44.0  Finding footage: ⌘K "liver fi…" → fly to the 8 mm spot; inspector shows lesion_net 0.29. Line: "Opus flags what the model missed".
         07 44.0–58.0  Payoff: weight-space footage, heatmap cells outlined as edited, recall climbs, patient bar turns green.
                       Lines: "So Opus rewrites the model's weights" / "No retraining" → number card "7 → 9 in 10 small lesions caught". Riser into impact on the green bar.
         08 58.0–65.0  X-ray footage: original vs edited circuit, hover the reject unit. Line: "and shows exactly why".
         09 65.0–71.0  Report footage scroll. Line: "A report you can read, hear and keep".
         10 71.0–78.0  End card: disc carried in, wordmark wipes in, "Your scan, explained." then "Built with Claude Opus 5.5" holds 2.5 s.
BANNED:  dark void with small floating UI; glow/particles; purple/blue gradients, glass cards; three cards in a row; title over a dimmed screenshot;
         text moving while read; every element fading-and-sliding-up; logo docked in a corner; invented numbers or UI.
QA:      t=1.5 (slices + title legible), 8.0, 12.0 (flood mid), 20 (organs + feed), 31 (kidney out), 40 (finding + 0.29),
         52 (heatmap edited cells), 56 (number card), 62 (circuit), 68 (report), 75 (end card), 77.9 (final hold); every cut ±0.1 s.
