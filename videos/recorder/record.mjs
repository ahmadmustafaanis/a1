// Records real Lumen footage, one clip per shot, by driving the running app (http://localhost:5173).
// Usage: node record.mjs <shot> [--headed]
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const URL = 'http://localhost:5173/'
const OUT = path.resolve('../lumen-launch/footage')
const W = 1920
const H = 1080
const shot = process.argv[2]
const headed = process.argv.includes('--headed')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function open() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !headed,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-webgl', `--window-size=${W},${H}`, '--hide-scrollbars', '--force-device-scale-factor=1'],
  })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: OUT + '/_raw', size: { width: W, height: H } } })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text().slice(0, 200)))
  await page.goto(URL)
  await page.waitForFunction(() => (window).__lumen)
  return { browser, ctx, page }
}

const L = (page, fn, arg) => page.evaluate(fn, arg)
async function replayScene(page) {
  await L(page, () => (window).__lumen.startScan({ demo: 'abdomen', replay: true }))
  await page.waitForFunction(() => (window).__lumen.useStore.getState().stage === 'ready', null, { timeout: 120000 })
}
async function clearUi(page) {
  await L(page, () => (window).__lumen.useStore.setState({ toasts: [] }))
}
// smooth pointer helpers (real mouse events → real app behaviour)
async function glide(page, x0, y0, x1, y1, ms = 700, steps = 40) {
  await page.mouse.move(x0, y0)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    await page.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e)
    await sleep(ms / steps)
  }
}
async function center(page, sel) {
  const b = await page.locator(sel).first().boundingBox()
  return [b.x + b.width / 2, b.y + b.height / 2]
}
// screen position of an organ's centroid (projected through the live camera)
async function organXY(page, name) {
  return L(page, (n) => {
    const s = (window).__lumen.useStore.getState()
    const o = Object.values(s.organs).find((x) => x.name === n || x.label === n)
    return o ? o.id : null
  }, name)
}

const SHOTS = {
  // 1. landing → instant replay → organs assemble while Opus works
  async build(page) {
    await sleep(2500)
    const [x, y] = await center(page, 'button:has-text("Instant replay")')
    await glide(page, W * 0.75, H * 0.85, x, y, 900)
    await sleep(300)
    await page.mouse.click(x, y)
    await page.waitForFunction(() => (window).__lumen.useStore.getState().stage === 'ready', null, { timeout: 120000 })
    await sleep(3500)
  },
  // 2. explore: hide gut, drag a kidney out, explode, reassemble
  async explore(page) {
    await replayScene(page)
    await clearUi(page)
    await L(page, () => (window).__lumen.useStore.setState({ sideTab: 'structures' }))
    await sleep(1500)
    // hide digestive via the outliner eye
    const eye = page.locator('[aria-label="Hide Digestive"]')
    const [ex, ey] = await center(page, '[aria-label="Hide Digestive"]')
    await glide(page, W * 0.5, H * 0.5, ex, ey, 800)
    await eye.click()
    await sleep(1400)
    // drag the left kidney (patient left = viewer right) out of the body
    const k = await L(page, () => {
      const s = (window).__lumen.useStore.getState()
      return Object.values(s.organs).find((o) => o.name === 'kidney_left')?.id
    })
    // pull the kidney out the way a drag does: the app's own offset + spring
    await L(page, (id) => (window).__lumen.useStore.setState({ hovered: id }), k)
    await sleep(500)
    for (let i = 1; i <= 40; i++) {
      const t = i / 40, e = 1 - Math.pow(1 - t, 3)
      await L(page, ([id, e]) => (window).__lumen.useStore.getState().setOffset(id, [1.15 * e, -0.25 * e, 0.6 * e]), [k, e])
      await sleep(28)
    }
    await L(page, () => (window).__lumen.useStore.setState({ hovered: undefined }))
    await sleep(1600)
    const hit = [1300, 600]
    // explode via slider
    const sl = await page.locator('input[aria-label="Explode organs apart"]').boundingBox()
    await glide(page, hit ? hit[0] + 420 : 900, hit ? hit[1] + 120 : 600, sl.x + 4, sl.y + sl.height / 2, 700)
    await page.mouse.down()
    await glide(page, sl.x + 4, sl.y + sl.height / 2, sl.x + sl.width * 0.75, sl.y + sl.height / 2, 1300, 50)
    await page.mouse.up()
    await sleep(1500)
    const [rx, ry] = await center(page, '[aria-label="Reassemble"]')
    await glide(page, sl.x + sl.width * 0.75, sl.y, rx, ry, 600)
    await page.mouse.click(rx, ry)
    await sleep(2200)
  },
  // 3. the finding: ⌘K → liver finding → inspector with "why"
  async finding(page) {
    await replayScene(page)
    await clearUi(page)
    await L(page, () => (window).__lumen.useStore.setState({ hiddenSystems: ['muscular', 'digestive', 'skeletal'] }))
    await sleep(1500)
    await page.keyboard.press('Meta+k')
    await sleep(500)
    await page.keyboard.type('liver fi', { delay: 110 })
    await sleep(600)
    await page.keyboard.press('Enter')
    await sleep(2600)
    // scroll inspector to the "why" section
    await page.mouse.move(W - 200, 500)
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 90); await sleep(120) }
    await sleep(2500)
  },
  // 4. weight-space programming: replay of the recorded session in the panel
  async wsp(page) {
    await replayScene(page)
    await clearUi(page)
    await L(page, () => (window).__lumen.startWsp(true))
    await page.waitForFunction(() => !!(window).__lumen.useStore.getState().wspReport, null, { timeout: 180000 })
    await sleep(3500)
  },
  // 5. model x-ray: open, toggle original vs edited, hover the veto unit
  async xray(page) {
    await replayScene(page)
    await clearUi(page)
    await L(page, () => (window).__lumen.openXray())
    await page.waitForFunction(() => !!(window).__lumen.useStore.getState().explain, null, { timeout: 120000 })
    await sleep(2200)
    const [ox, oy] = await center(page, 'button:has-text("Original model")')
    await glide(page, W * 0.6, H * 0.6, ox, oy, 800)
    await page.mouse.click(ox, oy)
    await sleep(1800)
    // hover the "reject" unit if named, else the first hidden-2 node
    const label = page.locator('svg text', { hasText: /reject/i }).first()
    if (await label.count()) {
      const b = await label.boundingBox()
      await glide(page, ox, oy, b.x - 12, b.y + b.height / 2, 900)
      await sleep(2600)
    }
    const [ex, ey] = await center(page, 'button:has-text("Opus-edited model")')
    await glide(page, ox, oy + 200, ex, ey, 800)
    await page.mouse.click(ex, ey)
    await sleep(2400)
  },
  // 6. the report: open saved report, scroll, expand an organ in 3D
  async report(page) {
    await replayScene(page)
    await clearUi(page)
    await L(page, () => (window).__lumen.openReport())
    await page.waitForFunction(() => { const s = (window).__lumen.useStore.getState(); return s.reportOpen && !!s.report && !s.reportBusy }, null, { timeout: 120000 })
    await sleep(1800)
    await page.mouse.move(W / 2, H / 2)
    for (let i = 0; i < 26; i++) { await page.mouse.wheel(0, 70); await sleep(55) }
    await sleep(1600)
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 70); await sleep(55) }
    await sleep(2600)
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 80); await sleep(50) }
    await sleep(2000)
  },
}

const { browser, ctx, page } = await open()
await page.mouse.move(W / 2, H / 2)
const t0 = Date.now()
try {
  await SHOTS[shot](page)
} catch (e) {
  console.error('shot failed:', e.message)
}
const v = page.video()
await ctx.close()
await browser.close()
const raw = await v.path()
fs.mkdirSync(OUT, { recursive: true })
fs.renameSync(raw, path.join(OUT, `${shot}.webm`))
console.log(`${shot}: ${((Date.now() - t0) / 1000).toFixed(1)} s → footage/${shot}.webm`)
