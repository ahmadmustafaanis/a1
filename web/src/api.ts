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
    summary: undefined, title: opts.file?.name ?? 'Abdomen & pelvis CT', lesionFlagged: false, wspReport: undefined, explain: undefined, xrayOpen: false,
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
}

export async function startWsp(replay: boolean) {
  const st = useStore.getState()
  st.set({ wspOpen: true, wspEvents: [], wspReport: undefined })
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
