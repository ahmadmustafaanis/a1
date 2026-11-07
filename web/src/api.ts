import { capture } from './components/Scene'
import { useStore, type Ev } from './store'

function listen(job: string, onEvent: (e: Ev) => void): Promise<void> {
  return new Promise((resolve) => {
    const es = new EventSource(`/api/jobs/${job}/events`)
    es.onmessage = (m) => onEvent(JSON.parse(m.data))
    es.addEventListener('end', () => {
      es.close()
      resolve()
    })
    es.onerror = () => {
      es.close()
      resolve()
    }
  })
}

export async function startScan(opts: { file?: File; demo?: string; replay?: boolean }) {
  const st = useStore.getState()
  st.set({
    stage: 'building', events: [], organs: {}, findings: [], selected: [], offsets: {}, explode: 0, isolate: false, hiddenSystems: ['muscular'],
    summary: undefined, title: opts.file?.name ?? 'Abdomen & pelvis CT', lesionFlagged: false, wspReport: undefined, explain: undefined, xrayOpen: false, report: undefined, reportShots: undefined, reportOpen: false,
  })
  const fd = new FormData()
  if (opts.file) fd.append('file', opts.file)
  if (opts.demo) fd.append('demo', opts.demo)
  fd.append('replay', String(!!opts.replay))
  const r = await fetch('/api/scans', { method: 'POST', body: fd })
  if (!r.ok) {
    st.pushEvent({ i: -1, t: 0, type: 'error', text: (await r.text()).slice(0, 300) })
    return
  }
  const { job, scanId } = await r.json()
  useStore.setState({ scanId })
  await listen(job, (e) => useStore.getState().pushEvent(e))
  if (useStore.getState().stage !== 'ready') useStore.setState({ stage: 'ready' })
  await loadSaved()
}

/** Restore this scan's finished training session and Model X-ray analysis, if they exist. */
export async function loadSaved() {
  const { scanId } = useStore.getState()
  if (!scanId) return
  const [w, x] = await Promise.all([fetch(`/api/scans/${scanId}/wsp`), fetch(`/api/scans/${scanId}/explain`)])
  if (w.ok) {
    const evs: Ev[] = await w.json()
    useStore.setState({ wspEvents: [] })
    for (const e of evs) useStore.getState().pushWsp(e)
    useStore.setState({ wspPulse: {} })
  }
  if (x.ok) useStore.setState({ explain: await x.json() })
  const r = await fetch(`/api/scans/${scanId}/report`)
  if (r.ok) useStore.setState({ report: await r.json() })
}

/** Full report: (custom weights if missing) → model X-ray → Opus writes it; meanwhile we photograph the 3D scene. */
export async function startReport() {
  const st = useStore.getState()
  useStore.setState({ reportOpen: true, reportBusy: true, reportEvents: [], report: undefined, reportShots: undefined, wspOpen: false, xrayOpen: false })
  const shotsP = capture.run ? capture.run() : Promise.resolve([])
  const r = await fetch(`/api/scans/${st.scanId}/report`, { method: 'POST' })
  if (!r.ok) {
    useStore.setState({ reportBusy: false, reportEvents: [{ i: 0, t: 0, type: 'error', text: `Could not start the report (${r.status}).` }] })
    return
  }
  const { job } = await r.json()
  await listen(job, (e) => {
    const s = useStore.getState()
    useStore.setState({ reportEvents: [...s.reportEvents, e] })
    if (e.type.startsWith('wsp_')) s.pushWsp(e)
    if (e.type === 'explain_ready') useStore.setState({ explain: e.explain })
    if (e.type === 'report_ready') useStore.setState({ report: e.report })
  })
  useStore.setState({ reportShots: await shotsP, reportBusy: false })
}

/** Open the saved report (re-photographing the scene if needed), or generate one. */
export async function openReport() {
  const st = useStore.getState()
  if (!st.report) return startReport()
  useStore.setState({ reportOpen: true })
  if (!st.reportShots && capture.run) {
    useStore.setState({ reportBusy: true })
    const shots = await capture.run()
    useStore.setState({ reportShots: shots, reportBusy: false })
  }
}

export async function startWsp(replay: boolean) {
  const st = useStore.getState()
  st.set({ wspOpen: true, wspEvents: [], wspReport: undefined, explain: undefined, lesionFlagged: false })
  const r = await fetch('/api/wsp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scanId: st.scanId, replay }),
  })
  const { job } = await r.json()
  await listen(job, (e) => useStore.getState().pushWsp(e))
}

export async function askOrgans(organs: string[], question: string): Promise<string> {
  const { scanId } = useStore.getState()
  const r = await fetch(`/api/scans/${scanId}/ask`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organs, question }),
  })
  if (!r.ok) return 'Could not reach Opus right now.'
  return (await r.json()).answer
}
