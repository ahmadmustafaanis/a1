"""Generates index.html + compositions/*.html for the Lumen hackathon film (see SPEC.md).
Run: python3 build_film.py   (deterministic; edit numbers here, not in the generated files)
"""
import re
from pathlib import Path

ROOT = Path(__file__).parent
COMP = ROOT / "compositions"
COMP.mkdir(exist_ok=True)

INK, GROUND, ACCENT, RED = "#111214", "#F4F3EF", "#2F5BFF", "#FF3B30"

FONTS = """
  @font-face { font-family: 'Geist'; src: url('assets/fonts/geist-sans-latin-400-normal.woff2') format('woff2'); font-weight: 400; }
  @font-face { font-family: 'Geist'; src: url('assets/fonts/geist-sans-latin-500-normal.woff2') format('woff2'); font-weight: 500; }
  @font-face { font-family: 'Geist'; src: url('assets/fonts/geist-sans-latin-600-normal.woff2') format('woff2'); font-weight: 600; }
  @font-face { font-family: 'Geist'; src: url('assets/fonts/geist-sans-latin-700-normal.woff2') format('woff2'); font-weight: 700; }
"""

# per-word blur-in for titles (split once at build, deterministic)
WORDS_JS = """
  function words(sel) {
    // titles are pre-split into <span class="w"> at build time (idempotent: re-running this script never rewrites the DOM)
    return document.querySelectorAll(sel + ' .w');
  }
  function titleIn(tl, sel, at) {
    const ws = words(sel);
    tl.fromTo(ws, { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.16, ease: 'power4.out', stagger: 0.08 }, at);
  }
  function titleOut(tl, sel, at) {
    tl.to(sel + ' .w', { opacity: 0, filter: 'blur(8px)', duration: 0.2, ease: 'power3.in', stagger: 0.03 }, at);
  }
"""

TITLE_CSS = f"""
  .t {{ position: absolute; font-family: 'Geist'; font-weight: 600; color: {INK}; letter-spacing: -0.035em; line-height: 1.02; margin: 0; }}
  .t em {{ font-style: normal; color: {ACCENT}; }}
  .t .w {{ display: inline-block; margin-right: 0.24em; }}
  .q {{ position: absolute; font-family: 'Geist'; font-weight: 500; color: #4A4C52; letter-spacing: -0.01em; margin: 0; }}
"""


def split_words(html):
    """'Pull it <em>apart</em>' -> one <span class="w"> per word; em words keep their accent."""
    out = []
    for m in re.finditer(r"<em>(.*?)</em>|(\S+)", html):
        if m.group(1) is not None:
            out += [f'<span class="w"><em>{w}</em></span>' for w in m.group(1).split()]
        else:
            out.append(f'<span class="w">{m.group(2)}</span>')
    return "".join(out)


def split_titles(body):
    return re.sub(r'(<h1 [^>]*class="t[^"]*"[^>]*>)(.*?)(</h1>)', lambda m: m.group(1) + split_words(m.group(2)) + m.group(3), body)


def scene(cid, dur, css, body, js, extra_root_attrs=""):
    body = split_titles(body)
    (COMP / f"{cid}.html").write_text(f"""<template>
<style>
{FONTS}
  #root {{ position: absolute; inset: 0; overflow: hidden; }}
{TITLE_CSS}
{css}
</style>
<div id="root" data-composition-id="{cid}" data-width="1920" data-height="1080" data-duration="{dur}"{extra_root_attrs}>
{body}
</div>
<script>
  window.__timelines = window.__timelines || {{}};
  const tl = gsap.timeline({{ paused: true }});
{WORDS_JS}
{js}
  window.__timelines["{cid}"] = tl;
</script>
</template>
""")


# ---------------------------------------------------------------- 01 · CT world (0–10)
slices = list(range(0, 21))  # s00 (upper) … s20 (mid-abdomen, kidneys) — a radiologist scrolling down
# decelerating scroll: 0.07 s per slice speeding down to 0.32 s, last slice holds
t, sched = 0.0, []
for i, s in enumerate(slices):
    sched.append((s, round(t, 3)))
    t += 0.07 + 0.25 * (i / (len(slices) - 1)) ** 2.2
imgs = []
for k, (s, st) in enumerate(sched):
    end = sched[k + 1][1] if k + 1 < len(sched) else 10.0
    imgs.append(f'  <img id="ct-s{s:02d}" class="clip ct" src="assets/ct/s{s:02d}.jpg" data-start="{st}" data-duration="{round(end - st, 3)}" alt="">')
scene("ct", 10, f"""
  #ct-ground {{ position: absolute; inset: 0; background: #050505; }}
  #ct-stage {{ position: absolute; left: 860px; top: 0; width: 1080px; height: 1080px; }}
  .ct {{ position: absolute; left: 860px; top: 0; width: 1080px; height: 1080px; }}
  #ct-t1, #ct-t2, #ct-t3 {{ left: 110px; top: 410px; width: 660px; font-size: 96px; color: {GROUND}; }}
  #ct-t3 {{ top: 360px; }}
  #ct-q {{ left: 124px; top: 610px; width: 640px; font-size: 38px; color: #8D8F95; }}
  #ct-disc {{ position: absolute; left: 960px; top: 540px; width: 1080px; height: 1080px; margin: -540px 0 0 -540px; border-radius: 50%; background: {ACCENT}; opacity: 0; }}
""", f"""
  <div id="ct-ground" class="clip" data-start="0" data-duration="10"></div>
  <div id="ct-mover">
{chr(10).join(imgs)}
  </div>
  <h1 id="ct-t1" class="t clip" data-start="0.25" data-duration="2.55">This is a CT scan</h1>
  <h1 id="ct-t2" class="t clip" data-start="2.9" data-duration="3.0">Can you read it?</h1>
  <h1 id="ct-t3" class="t clip" data-start="6.1" data-duration="3.1">Most people <em>can't</em></h1>
  <p id="ct-q" class="q clip" data-start="6.7" data-duration="2.5">Grey slices. Medical words.</p>
  <div id="ct-disc" class="clip" data-start="9.2" data-duration="0.8"></div>
""", f"""
  titleIn(tl, '#ct-t1', 0.25);
  titleOut(tl, '#ct-t1', 2.55);
  titleIn(tl, '#ct-t2', 2.9);
  titleOut(tl, '#ct-t2', 5.65);
  titleIn(tl, '#ct-t3', 6.1);
  tl.fromTo('#ct-q', {{ opacity: 0, filter: 'blur(6px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: 0.3, ease: 'power3.out' }}, 6.75);
  titleOut(tl, '#ct-t3', 8.95);
  tl.to('#ct-q', {{ opacity: 0, filter: 'blur(8px)', duration: 0.2, ease: 'power3.in' }}, 8.95);
  // the last slice slides to centre and collapses into the lumen disc (carried into the next world)
  tl.fromTo('#ct-mover', {{ x: 0, scale: 1 }}, {{ x: -440, duration: 0.55, ease: 'power2.inOut' }}, 8.75);
  tl.to('#ct-mover', {{ scale: 0.12, duration: 0.55, ease: 'power3.in', transformOrigin: '1400px 540px' }}, 9.3);
  tl.fromTo('#ct-disc', {{ scale: 0.6, opacity: 0 }}, {{ scale: 0.12, opacity: 1, duration: 0.5, ease: 'power3.in' }}, 9.35);
""")

# ---------------------------------------------------------------- 02 · reveal (10–14)
scene("reveal", 4, f"""
  #rv-dark {{ position: absolute; inset: 0; background: #050505; }}
  #rv-flood {{ position: absolute; inset: 0; background: radial-gradient(1200px 800px at 50% 35%, #FFFFFF 0%, {GROUND} 55%, #ECEBE5 100%); }}
  #rv-disc {{ position: absolute; left: 960px; top: 540px; width: 130px; height: 130px; margin: -65px 0 0 -65px; border-radius: 50%; background: {ACCENT}; }}
  #rv-core {{ position: absolute; left: 50%; top: 50%; width: 60px; height: 60px; margin: -30px 0 0 -30px; border-radius: 50%; background: {GROUND}; }}
  #rv-t {{ left: 160px; top: 380px; width: 1600px; font-size: 112px; }}
  #rv-t2 {{ left: 160px; top: 510px; width: 1600px; font-size: 112px; }}
""", f"""
  <div id="rv-dark" class="clip" data-start="0" data-duration="4"></div>
  <div id="rv-flood" class="clip" data-start="0" data-duration="4"></div>
  <div id="rv-disc" class="clip" data-start="0" data-duration="1.6"><div id="rv-core"></div></div>
  <h1 id="rv-t" class="t clip" data-start="0.9" data-duration="2.9">Lumen turns it into</h1>
  <h1 id="rv-t2" class="t clip" data-start="1.2" data-duration="2.6">your own <em>anatomy</em></h1>
""", f"""
  // colour flood out of the disc
  tl.fromTo('#rv-flood', {{ clipPath: 'circle(3.4% at 50% 50%)' }}, {{ clipPath: 'circle(75% at 50% 50%)', duration: 0.7, ease: 'power2.inOut' }}, 0.05);
  tl.fromTo('#rv-core', {{ scale: 0 }}, {{ scale: 1, duration: 0.35, ease: 'expo.out' }}, 0.0);
  tl.to('#rv-disc', {{ x: -720, y: -60, scale: 0.55, duration: 0.6, ease: 'power3.inOut' }}, 0.55);
  tl.to('#rv-disc', {{ opacity: 0, duration: 0.25, ease: 'power3.in' }}, 1.2);
  titleIn(tl, '#rv-t', 0.9);
  titleIn(tl, '#rv-t2', 1.25);
  titleOut(tl, '#rv-t', 3.45);
  titleOut(tl, '#rv-t2', 3.5);
""")

# ---------------------------------------------------------------- footage scenes
def footage_scene(cid, dur, src, titles, cam, extra_css="", extra_body="", extra_js="", enter=None):
    """titles: list of (id, html, start, dur, css) ; cam: list of (at, dur, scale, x, y, ease)"""
    tbody = "\n".join(f'  <h1 id="{cid}-{tid}" class="t clip" data-start="{st}" data-duration="{d}">{html}</h1>' for tid, html, st, d, _ in titles)
    tcss = "\n".join(f"  #{cid}-{tid} {{ {c} }}" for tid, _, _, _, c in titles)
    tjs = "\n".join(f"  titleIn(tl, '#{cid}-{tid}', {st});\n  titleOut(tl, '#{cid}-{tid}', {round(st + d - 0.28, 2)});" for tid, _, st, d, _ in titles)
    cjs = "\n".join(f"  tl.to('#{cid}-cam', {{ scale: {s}, x: {x}, y: {y}, duration: {d}, ease: '{e}' }}, {at});" for at, d, s, x, y, e in cam)
    ejs = enter or f"  tl.fromTo('#{cid}-cam', {{ scale: 1.035, filter: 'blur(6px)' }}, {{ scale: 1, filter: 'blur(0px)', duration: 0.35, ease: 'power3.out' }}, 0);"
    scene(cid, dur, f"""
  #{cid}-ground {{ position: absolute; inset: 0; background: {GROUND}; }}
  #{cid}-cam {{ position: absolute; inset: 0; transform-origin: 50% 50%; }}
  #{cid}-v {{ position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; object-fit: contain; }}
  .t.f {{ font-size: 64px; }}
{tcss}
{extra_css}
""", f"""
  <div id="{cid}-ground" class="clip" data-start="0" data-duration="{dur}"></div>
  <div id="{cid}-cam">
    <video id="{cid}-v" class="clip" src="assets/footage/{src}.mp4" data-start="0" data-duration="{dur}" muted playsinline></video>
  </div>
{tbody}
{extra_body}
""", f"""
{ejs}
{cjs}
{tjs}
{extra_js}
""")


TOP = "left: 360px; top: 150px; width: 1200px; font-size: 60px; text-align: left;"

# 04 · build (14–24, 10 s)
footage_scene("build", 10.0, "build", [
    ("t1", "Opus 5.5 builds it, <em>live</em>", 2.3, 3.6, TOP),
    ("t2", "Every organ, its own <em>object</em>", 6.3, 3.5, TOP),
], [
    (2.0, 0.6, 1.0, 0, 0, "power2.inOut"),
], enter="  tl.fromTo('#build-cam', { scale: 1.06, filter: 'blur(8px)', opacity: 0 }, { scale: 1, filter: 'blur(0px)', opacity: 1, duration: 0.45, ease: 'power3.out' }, 0);")

# 05 · explore (24–33.77, 9.767 s): kidney pulled out at ~3.1–4.4, explode ~6.2–8.1
footage_scene("explore", 9.767, "explore", [
    ("t1", "Pull it <em>apart</em>", 1.6, 4.2, TOP),
    ("t2", "Put it back", 7.95, 1.75, TOP),
], [
    (2.6, 0.6, 1.32, -260, 70, "power3.inOut"),
    (5.2, 0.6, 1.0, 0, 0, "power3.inOut"),
])

# 06 · finding (33.77–41.6, 7.833 s)
footage_scene("finding", 7.833, "finding", [
    ("t1", "Opus flags an 8 mm spot", 0.3, 2.4, "left: 360px; top: 460px; width: 1200px; font-size: 60px;"),
    ("t2", "The model scored it <em>29%</em>", 4.3, 3.3, "left: 360px; top: 150px; width: 1100px; font-size: 60px;"),
], [
    (4.6, 0.6, 1.38, 360, -20, "power3.inOut"),
])

# 07 · weight-space payoff (41.6–55.77, 14.167 s); payoff card lands at local 10.9
footage_scene("wsp", 14.167, "wsp", [
    ("t1", "So Opus rewrites the model's <em>weights</em>", 0.4, 4.6, "left: 160px; top: 52px; width: 1600px; font-size: 56px; text-align: center;"),
    ("t2", "No retraining. 7 of 305 weights.", 5.4, 4.6, "left: 160px; top: 52px; width: 1600px; font-size: 56px; text-align: center;"),
], [
    (10.3, 0.65, 0.6, -390, 30, "power3.inOut"),
], extra_css=f"""
  #wsp-card {{ position: absolute; left: 1210px; top: 330px; width: 640px; }}
  #wsp-num {{ font-family: 'Geist'; font-weight: 600; font-size: 132px; letter-spacing: -0.05em; color: {INK}; line-height: 1; }}
  #wsp-num em {{ font-style: normal; color: {ACCENT}; }}
  #wsp-lab {{ font-family: 'Geist'; font-weight: 500; font-size: 36px; color: #4A4C52; margin-top: 18px; letter-spacing: -0.01em; line-height: 1.25; }}
  #wsp-pt {{ font-family: 'Geist'; font-weight: 500; font-size: 30px; color: #4A4C52; margin-top: 34px; display: flex; gap: 14px; align-items: center; }}
  #wsp-pt b {{ color: #18A058; font-weight: 600; }}
""", extra_body="""
  <div id="wsp-card" class="clip" data-start="10.6" data-duration="3.567">
    <div id="wsp-num">72% → <em>90%</em></div>
    <div id="wsp-lab">small lesions caught,<br>on cases it never saw</div>
    <div id="wsp-pt">This patient's spot: 29% → <b>64%</b></div>
  </div>
""", extra_js="""
  tl.fromTo('#wsp-num', { opacity: 0, x: 60, filter: 'blur(10px)' }, { opacity: 1, x: 0, filter: 'blur(0px)', duration: 0.5, ease: 'expo.out' }, 10.75);
  tl.fromTo('#wsp-lab', { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.3, ease: 'power3.out' }, 11.05);
  tl.fromTo('#wsp-pt', { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.3, ease: 'power3.out' }, 11.6);
""", enter="  tl.fromTo('#wsp-cam', { x: 260, filter: 'blur(18px)' }, { x: 0, filter: 'blur(0px)', duration: 0.3, ease: 'power3.out' }, 0);")

# 08 · x-ray (55.77–63.37, 7.6 s)
footage_scene("xray", 7.6, "xray", [
    ("t1", "…and shows exactly <em>why</em>", 0.35, 6.9, "left: 160px; top: 948px; width: 1600px; font-size: 56px; text-align: center;"),
], [
    (3.6, 0.6, 1.22, 250, 40, "power3.inOut"),
    (6.6, 0.5, 1.0, 0, 0, "power3.inOut"),
])

# 09 · report (63.37–72.27, 8.9 s): title column on the left of the document
footage_scene("report", 8.9, "report", [
    ("t1", "Read it", 0.4, 8.3, "left: 70px; top: 330px; width: 420px; font-size: 76px;"),
    ("t2", "Hear it", 1.5, 7.2, "left: 70px; top: 430px; width: 420px; font-size: 76px;"),
    ("t3", "<em>Keep</em> it", 2.6, 6.1, "left: 70px; top: 530px; width: 420px; font-size: 76px;"),
], [])

# ---------------------------------------------------------------- 10 · end card (72.27–78, 5.733 s)
scene("endcard", 5.733, f"""
  #ec-ground {{ position: absolute; inset: 0; background: radial-gradient(1200px 800px at 50% 40%, #FFFFFF 0%, {GROUND} 55%, #ECEBE5 100%); }}
  #ec-lock {{ position: absolute; left: 0; right: 0; top: 380px; height: 170px; display: flex; align-items: center; justify-content: center; gap: 34px; }}
  #ec-disc {{ position: relative; width: 150px; height: 150px; border-radius: 50%; background: {ACCENT}; flex: none; }}
  #ec-core {{ position: absolute; left: 50%; top: 50%; width: 68px; height: 68px; margin: -34px 0 0 -34px; border-radius: 50%; background: {GROUND}; }}
  #ec-word {{ font-family: 'Geist'; font-weight: 600; font-size: 168px; letter-spacing: -0.06em; color: {INK}; line-height: 1; }}
  #ec-line {{ left: 0; right: 0; top: 600px; font-size: 56px; text-align: center; }}
  #ec-sub {{ left: 0; right: 0; top: 700px; font-size: 32px; text-align: center; }}
""", f"""
  <div id="ec-ground" class="clip" data-start="0" data-duration="5.733"></div>
  <div id="ec-lock" class="clip" data-start="0" data-duration="5.733">
    <div id="ec-disc"><div id="ec-core"></div></div>
    <div id="ec-word">lumen</div>
  </div>
  <h1 id="ec-line" class="t clip" data-start="1.3" data-duration="4.433">Your scan, <em>explained</em></h1>
  <p id="ec-sub" class="q clip" data-start="2.0" data-duration="3.733">Built with Claude Opus 5.5</p>
""", f"""
  tl.fromTo('#ec-ground', {{ clipPath: 'inset(8% 18% 8% 18% round 28px)' }}, {{ clipPath: 'inset(0% 0% 0% 0% round 0px)', duration: 0.6, ease: 'power2.inOut' }}, 0);
  tl.fromTo('#ec-disc', {{ y: -620, scale: 0.6 }}, {{ y: 0, scale: 1, duration: 0.75, ease: 'back.out(1.3)' }}, 0.15);
  tl.fromTo('#ec-core', {{ scale: 0 }}, {{ scale: 1, duration: 0.4, ease: 'expo.out' }}, 0.75);
  tl.fromTo('#ec-word', {{ clipPath: 'inset(0 100% 0 0)', x: -30 }}, {{ clipPath: 'inset(0 0% 0 0)', x: 0, duration: 0.55, ease: 'power3.out' }}, 0.8);
  titleIn(tl, '#ec-line', 1.3);
  tl.fromTo('#ec-sub', {{ opacity: 0, filter: 'blur(6px)' }}, {{ opacity: 1, filter: 'blur(0px)', duration: 0.3, ease: 'power3.out' }}, 2.0);
""")

# ---------------------------------------------------------------- index
SCENES = [("ct", 0, 10), ("reveal", 10, 4), ("build", 14, 10.0), ("explore", 24, 9.767), ("finding", 33.767, 7.833),
          ("wsp", 41.6, 14.167), ("xray", 55.767, 7.6), ("report", 63.367, 8.9), ("endcard", 72.267, 5.733)]
TOTAL = 78.0
hosts = "\n".join(
    f'    <div id="{c}" data-composition-id="{c}" data-composition-src="compositions/{c}.html" data-start="{s}" data-duration="{d}" '
    f'data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>' for c, s, d in SCENES)

# sound: each effect's peak lands one frame (0.033 s) after its picture
PEAK = {"riser": 2.621, "whoosh-a": 0.613, "whoosh-b": 0.444, "click": 0.1}
def sfx(id_, f, picture_t, vol):
    return f'    <audio id="{id_}" class="clip" src="assets/audio/{f}.mp3" data-start="{round(picture_t + 0.033 - PEAK[f], 3)}" data-volume="{vol}"></audio>'
audio = "\n".join([
    # music: start on the track's first beat (4.0 s) so its lift lands with the colour flood
    f'    <audio id="music" class="clip" src="assets/audio/music.wav" data-start="0" data-duration="{TOTAL}" data-media-start="4.0" data-volume="0.85" data-fade-in="0.6" data-fade-out="2.4"></audio>',
    sfx("sfx-flood", "whoosh-a", 10.35, 0.9),
    sfx("sfx-click", "click", 14.77, 1.0),
    sfx("sfx-whip", "whoosh-b", 41.62, 0.85),
    sfx("sfx-payoff", "riser", 41.6 + 10.75, 0.9),
    sfx("sfx-end", "whoosh-a", 72.4, 0.7),
])
(ROOT / "index.html").write_text(f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: {GROUND}; }}
      #base {{ position: absolute; inset: 0; background: {GROUND}; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1920" data-height="1080" data-motion-blur="on">
    <div id="base" class="clip" data-start="0" data-duration="{TOTAL}" data-track-index="0"></div>
{hosts}
{audio}
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
""")
print("built", len(SCENES), "scenes,", TOTAL, "s")
