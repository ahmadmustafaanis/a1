import { create } from 'zustand'
import { organColor } from './palette'

export type Organ = {
  id: number
  name: string
  label: string
  system: string
  color: string
  url: string
  position: [number, number, number]
  volume_ml: number
  faces: number
  blurb?: string
  finding?: boolean
}

export type Finding = {
  id: number
  name: string
  title: string
  detail: string
  severity: string
  organ: string
  diameter_mm: number
  lesion_net_score: number
}

export type Ev = { i: number; t: number; type: string; [k: string]: any }

export type WspCell = { layer: string; param: string; row: number; col: number; old: number; new: number }
export type Weights = Record<string, { weight: number[][]; bias: number[] }>
export type Metrics = {
  accuracy: number
  recall_small: number
  recall_large: number
  false_positive_rate: number
  n: number
}

type State = {
  stage: 'landing' | 'building' | 'ready'
  scanId?: string
  title?: string
  demoNote?: string | null
  summary?: string
  events: Ev[]
  organs: Record<number, Organ>
  findings: Finding[]
  selected: number[]
  hovered?: number
  isolate: boolean
  spin: boolean
  explode: number
  offsets: Record<number, [number, number, number]>
  hiddenSystems: string[]
  hiddenIds: number[]
  paletteOpen: boolean
  sideTab: 'structures' | 'process'
  toasts: { id: number; text: string; sub?: string; kind?: 'ok' | 'info' | 'warn' }[]
  toast: (text: string, sub?: string, kind?: 'ok' | 'info' | 'warn') => void
  toggleOrgan: (id: number) => void
  dragging: boolean
  assembleTick: number

  wspOpen: boolean
  wspEvents: Ev[]
  wspWeights?: Weights
  wspBase?: Weights
  wspFeatures: string[]
  wspMetrics0?: Metrics
  wspMetrics?: Metrics
  wspPulse: Record<string, number>
  wspReport?: any
  wspPatient: { name: string; before: number; after: number }[]
  lesionFlagged: boolean
  explain?: any
  explainLoading: boolean
  explainError?: string
  xrayOpen: boolean
  reportOpen: boolean
  reportBusy: boolean
  report?: any
  reportEvents: Ev[]
  reportShots?: { key: string; title: string; caption: string; url: string }[]

  set: (p: Partial<State>) => void
  pushEvent: (e: Ev) => void
  pushWsp: (e: Ev) => void
  select: (id: number, additive: boolean) => void
  clearSelection: () => void
  setOffset: (id: number, o: [number, number, number]) => void
  reassemble: () => void
  toggleSystem: (s: string) => void
}

const norm = (o: Organ): Organ => ({
  ...o,
  color: organColor(o.name, o.color),
  label: o.finding ? 'Liver finding' : o.label,
})

export const cellKey = (c: { layer: string; param: string; row: number; col: number }) =>
  `${c.layer}:${c.param}:${c.row}:${c.col}`

export const useStore = create<State>((set, get) => ({
  stage: 'landing',
  events: [],
  organs: {},
  findings: [],
  selected: [],
  isolate: false,
  spin: false,
  explode: 0,
  offsets: {},
  hiddenSystems: ['muscular'],
  hiddenIds: [],
  paletteOpen: false,
  sideTab: 'process',
  toasts: [],
  dragging: false,
  assembleTick: 0,
  wspOpen: false,
  wspEvents: [],
  wspFeatures: [],
  wspPulse: {},
  wspPatient: [],
  lesionFlagged: false,
  explainLoading: false,
  xrayOpen: false,
  reportOpen: false,
  reportBusy: false,
  reportEvents: [],

  set: (p) => set(p),
  toast: (text, sub, kind = 'ok') => {
    const id = Date.now() + Math.random()
    set({ toasts: [...get().toasts, { id, text, sub, kind }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4200)
  },
  toggleOrgan: (id) => {
    const h = get().hiddenIds
    set({ hiddenIds: h.includes(id) ? h.filter((x) => x !== id) : [...h, id] })
  },
  pushEvent: (e) => {
    const s = get()
    const patch: Partial<State> = { events: [...s.events, e] }
    if (e.type === 'status' && e.scanId) patch.scanId = e.scanId
    if (e.type === 'status' && e.demoNote !== undefined) patch.demoNote = e.demoNote
    if (e.type === 'mesh') patch.organs = { ...s.organs, [e.organ.id]: norm(e.organ) }
    if (e.type === 'finding') patch.findings = [...s.findings.filter((f) => f.id !== e.finding.id), e.finding]
    if (e.type === 'manifest') {
      const m = e.manifest
      const organs: Record<number, Organ> = {}
      for (const o of m.organs) organs[o.id] = norm(o)
      Object.assign(patch, {
        organs,
        findings: m.findings || [],
        summary: m.summary,
        scanId: m.scanId,
        title: m.title || s.title,
        demoNote: m.demoNote,
        stage: 'ready',
        sideTab: 'structures',
      })
      if (s.stage === 'building') setTimeout(() => get().toast(`${m.organs.length} structures ready`, m.findings?.length ? `${m.findings.length} finding flagged by Opus` : 'No findings flagged'), 300)
    }
    set(patch)
  },
  pushWsp: (e) => {
    const s = get()
    const patch: Partial<State> = { wspEvents: [...s.wspEvents, e] }
    if (e.type === 'wsp_start') {
      Object.assign(patch, {
        wspWeights: e.weights, wspBase: e.weights, wspFeatures: e.features, wspMetrics0: e.metrics,
        wspMetrics: e.metrics, wspPatient: e.patient || [], wspReport: undefined, wspPulse: {},
      })
    }
    if (e.type === 'wsp_edit') {
      const w: Weights = JSON.parse(JSON.stringify(s.wspWeights || {}))
      const pulse = { ...s.wspPulse }
      for (const c of e.edit.cells as WspCell[]) {
        if (!w[c.layer]) continue
        if (c.param === 'bias') w[c.layer].bias[c.row] = c.new
        else w[c.layer].weight[c.row][c.col] = c.new
        pulse[cellKey(c)] = Date.now()
      }
      Object.assign(patch, { wspWeights: w, wspPulse: pulse, wspMetrics: e.edit.after, wspPatient: e.patient || s.wspPatient })
    }
    if (e.type === 'wsp_revert') Object.assign(patch, { wspWeights: e.weights, wspMetrics: e.metrics })
    if (e.type === 'wsp_done') {
      Object.assign(patch, { wspReport: e.report, wspWeights: e.weights, wspPatient: e.report.patient || [], explain: undefined })
      if ((e.report.patient || []).some((p: any) => p.after >= 0.5)) patch.lesionFlagged = true
      if (s.wspEvents.length && e.t > 0.5 && !s.wspReport) {
        const r = e.report
        setTimeout(() => get().toast('Opus-edited model ready', `${r.weights_changed} weights changed · small-lesion recall ${Math.round(r.test_before.recall_small * 100)}% → ${Math.round(r.test_after.recall_small * 100)}%`), 200)
      }
    }
    set(patch)
  },
  select: (id, additive) => {
    const sel = get().selected
    if (additive) set({ selected: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] })
    else set({ selected: sel.length === 1 && sel[0] === id ? [] : [id] })
  },
  clearSelection: () => set({ selected: [], isolate: false, spin: false }),
  setOffset: (id, o) => set({ offsets: { ...get().offsets, [id]: o } }),
  reassemble: () => set({ offsets: {}, explode: 0, assembleTick: get().assembleTick + 1 }),
  toggleSystem: (sys) => {
    const h = get().hiddenSystems
    set({ hiddenSystems: h.includes(sys) ? h.filter((x) => x !== sys) : [...h, sys] })
  },
}))
