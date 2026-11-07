import { useStore } from './store'

const KEY = 'lumen.session'

/** Token lives in localStorage (per-browser convenience); the server is the source of truth. */
function readToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
function writeToken(t: string | null) {
  try {
    if (t) localStorage.setItem(KEY, t)
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: session lasts for this tab only */
  }
}

export async function authFetch(url: string, init: RequestInit = {}) {
  const token = useStore.getState().token
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const r = await fetch(url, { ...init, headers })
  if (r.status === 401 && token) {
    writeToken(null)
    useStore.setState({ user: undefined, token: undefined })
  }
  return r
}

async function errText(r: Response) {
  try {
    return (await r.json()).detail ?? `Error ${r.status}`
  } catch {
    return `Error ${r.status}`
  }
}

export async function restoreSession() {
  const token = readToken()
  if (!token) return
  useStore.setState({ token })
  const r = await authFetch('/api/auth/me')
  if (r.ok) useStore.setState({ user: await r.json() })
}

export async function signIn(mode: 'login' | 'register', username: string, password: string, name?: string): Promise<string | null> {
  const r = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password, name }) })
  if (!r.ok) return errText(r)
  const j = await r.json()
  writeToken(j.token)
  const after = useStore.getState().afterAuth
  useStore.setState({ token: j.token, user: j.user, authOpen: false, afterAuth: undefined })
  useStore.getState().toast(mode === 'register' ? `Welcome, ${j.user.name}` : `Signed in as ${j.user.name}`, undefined, 'info')
  after?.()
  return null
}

export async function signOut() {
  await authFetch('/api/auth/logout', { method: 'POST' })
  writeToken(null)
  useStore.setState({ user: undefined, token: undefined, libraryOpen: false, savedId: undefined })
  useStore.getState().toast('Signed out', undefined, 'info')
}

/** Ask for sign-in first if needed, then run the action. */
export function requireAuth(action: () => void) {
  if (useStore.getState().user) action()
  else useStore.setState({ authOpen: 'login', afterAuth: action })
}

function thumbFrom(dataUrl: string): Promise<string> {
  return new Promise((res) => {
    const img = new Image()
    img.onload = () => {
      const w = 420
      const h = Math.round((img.height / img.width) * w)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d')!.drawImage(img, 0, 0, w, h)
      res(c.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => res('')
    img.src = dataUrl
  })
}

export async function saveReport() {
  const s = useStore.getState()
  if (!s.scanId || !s.report) return
  useStore.setState({ saving: true })
  try {
    const shots = s.reportShots ?? []
    const thumb = shots[0] ? await thumbFrom(shots[0].url) : undefined
    const r = await authFetch('/api/me/reports', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scanId: s.scanId, title: s.report.title, shots, thumb }),
    })
    if (!r.ok) return s.toast('Could not save the report', await errText(r), 'warn')
    const j = await r.json()
    useStore.setState({ savedId: j.id })
    s.toast('Saved to My reports', j.title)
  } finally {
    useStore.setState({ saving: false })
  }
}

export type SavedMeta = { id: string; title: string; saved: number; scanId: string; thumb?: string; nOrgans?: number; nFindings: number; impression: string }

export async function listReports(): Promise<SavedMeta[]> {
  const r = await authFetch('/api/me/reports')
  return r.ok ? r.json() : []
}

export async function deleteReport(id: string) {
  const r = await authFetch(`/api/me/reports/${id}`, { method: 'DELETE' })
  if (r.ok && useStore.getState().savedId === id) useStore.setState({ savedId: undefined })
  return r.ok
}

/** Reopen a saved report — restores the scan, its custom model and the X-ray too. */
export async function openSaved(id: string) {
  const r = await authFetch(`/api/me/reports/${id}`)
  if (!r.ok) return useStore.getState().toast('Could not open the report', await errText(r), 'warn')
  const b = await r.json()
  const st = useStore.getState()
  useStore.setState({
    stage: 'building', events: [], organs: {}, findings: [], selected: [], offsets: {}, explode: 0, isolate: false,
    hiddenSystems: ['muscular'], hiddenIds: [], wspEvents: [], wspReport: undefined, explain: undefined, lesionFlagged: false,
    libraryOpen: false, wspOpen: false, xrayOpen: false,
  })
  if (b.manifest?.organs) st.pushEvent({ i: 0, t: 0, type: 'manifest', manifest: b.manifest })
  for (const e of b.wspEvents ?? []) useStore.getState().pushWsp(e)
  useStore.setState({ wspPulse: {}, explain: b.explain ?? undefined, report: b.report, reportShots: b.shots, reportOpen: true, savedId: b.id, stage: 'ready', events: b.events ?? [] })
  if (b.restored) useStore.getState().toast('Scan restored from your saved copy', 'Its 3D models and analysis were brought back', 'info')
}
