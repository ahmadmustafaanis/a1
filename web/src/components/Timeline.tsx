import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type Ev } from '../store'

const TOOL_LABEL: Record<string, string> = {
  inspect_volume: 'Reading the scan',
  render_slices: 'Looking at slices',
  run_totalsegmentator: 'Segmenting with TotalSegmentator',
  list_structures: 'Listing structures',
  threshold_region: 'Refining by density',
  edit_labels: 'Cleaning up labels',
  organ_stats: 'Measuring',
  build_meshes: 'Sculpting 3D organs',
  find_liver_lesions: 'Screening the liver',
  report_finding: 'Recording a finding',
  ask_model: 'Second opinion',
  finalize_scene: 'Writing explanations',
  describe_model: 'Reading the model',
  evaluate: 'Evaluating',
  get_weights: 'Reading weights',
  trace: 'Tracing activations',
  feature_sensitivity: 'Probing features',
  edit_weights: 'Editing weights',
  revert_last: 'Reverting edit',
  finish: 'Wrapping up',
}

type Row = { key: string; kind: 'say' | 'think' | 'tool' | 'image' | 'error' | 'finding'; ev: Ev; result?: Ev; progress?: string }

export function useRows(events: Ev[]): Row[] {
  return useMemo(() => {
    const rows: Row[] = []
    const openTool: Record<string, Row> = {}
    for (const e of events) {
      if (e.type === 'say') rows.push({ key: `s${e.i}`, kind: 'say', ev: e })
      else if (e.type === 'thinking') rows.push({ key: `t${e.i}`, kind: 'think', ev: e })
      else if (e.type === 'tool_call') {
        const r: Row = { key: `c${e.i}`, kind: 'tool', ev: e }
        rows.push(r)
        openTool[e.tool] = r
      } else if (e.type === 'tool_progress' && openTool[e.tool]) openTool[e.tool].progress = e.text
      else if (e.type === 'tool_result' && openTool[e.tool]) {
        openTool[e.tool].result = e
        delete openTool[e.tool]
      } else if (e.type === 'wsp_edit' && openTool.edit_weights) {
        const a = e.edit.after
        openTool.edit_weights.result = { ...e, summary: `${e.edit.cells.length} weight(s) → small recall ${Math.round(a.recall_small * 100)}% · FPR ${(a.false_positive_rate * 100).toFixed(1)}%` }
        delete openTool.edit_weights
      } else if (e.type === 'wsp_revert' && openTool.revert_last) {
        openTool.revert_last.result = { ...e, summary: 'reverted' }
        delete openTool.revert_last
      } else if (e.type === 'wsp_done' && openTool.finish) {
        openTool.finish.result = { ...e, summary: 'done' }
        delete openTool.finish
      } else if (e.type === 'image') rows.push({ key: `i${e.i}`, kind: 'image', ev: e })
      else if (e.type === 'error') rows.push({ key: `e${e.i}`, kind: 'error', ev: e })
      else if (e.type === 'finding') rows.push({ key: `f${e.i}`, kind: 'finding', ev: e })
    }
    return rows
  }, [events])
}

function ToolIcon({ done }: { done: boolean }) {
  return done ? (
    <span style={{ width: 18, height: 18, borderRadius: 99, background: 'rgba(24,160,88,.12)', color: 'var(--ok)', display: 'grid', placeItems: 'center', flex: 'none' }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M5 12l5 5 9-10" /></svg>
    </span>
  ) : (
    <span style={{ width: 18, height: 18, borderRadius: 99, border: '2px solid var(--accent)', borderTopColor: 'transparent', flex: 'none', animation: 'spin .8s linear infinite' }} />
  )
}

export function Feed({ events, live }: { events: Ev[]; live: boolean }) {
  const rows = useRows(events)
  const end = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    // scrollIntoView returns a Promise in newer browsers — never return it from an effect
    void end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [rows.length])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <AnimatePresence initial={false}>
        {rows.map((r) => (
          <motion.div key={r.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
            {r.kind === 'say' && (
              <button onClick={() => setOpen(open === r.key ? null : r.key)} style={{ textAlign: 'left', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)', display: '-webkit-box', WebkitLineClamp: open === r.key ? 80 : 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                {String(r.ev.text).replace(/\*\*/g, '')}
              </button>
            )}
            {r.kind === 'think' && (
              <button onClick={() => setOpen(open === r.key ? null : r.key)} style={{ textAlign: 'left', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-3)', fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: open === r.key ? 40 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {r.ev.text}
              </button>
            )}
            {r.kind === 'tool' && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,.7)', border: '1px solid var(--line)' }}>
                <ToolIcon done={!!r.result || !live} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{TOOL_LABEL[r.ev.tool] ?? r.ev.tool}</div>
                  <div className="mono muted" style={{ fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.result?.summary ?? r.progress ?? r.ev.tool}
                  </div>
                  {r.ev.tool === 'edit_weights' && r.ev.input?.reason && (
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.45 }}>{r.ev.input.reason}</div>
                  )}
                  {r.ev.tool === 'ask_model' && r.result?.data?.answer && (
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.45 }}>
                      <b style={{ fontWeight: 600 }}>{r.result.data.model}:</b> {String(r.result.data.answer).slice(0, 280)}…
                    </div>
                  )}
                </div>
              </div>
            )}
            {r.kind === 'image' && (
              <figure style={{ margin: 0 }}>
                <img src={r.ev.url} alt={r.ev.caption} style={{ width: '100%', borderRadius: 12, display: 'block', border: '1px solid var(--line)', background: '#000' }} />
                <figcaption className="mono muted" style={{ fontSize: 10.5, marginTop: 4 }}>Opus looked at · {r.ev.caption}</figcaption>
              </figure>
            )}
            {r.kind === 'finding' && (
              <div
                onClick={() => {
                  const st = useStore.getState()
                  const liver = Object.values(st.organs).find((o) => o.name === 'liver')
                  useStore.setState({ selected: [r.ev.finding.id, ...(liver ? [liver.id] : [])], isolate: false })
                }}
                style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--danger-soft)', color: '#b3261e', fontSize: 13, lineHeight: 1.45, cursor: 'pointer' }}>
                <b style={{ fontWeight: 600 }}>{r.ev.finding.title}</b>
                <div style={{ color: 'var(--ink-2)', marginTop: 2 }}>{r.ev.finding.detail}</div>
              </div>
            )}
            {r.kind === 'error' && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{r.ev.text}</div>}
          </motion.div>
        ))}
      </AnimatePresence>
      <div ref={end} />
    </div>
  )
}

export default function Timeline() {
  const events = useStore((s) => s.events)
  const stage = useStore((s) => s.stage)
  const organCount = useStore((s) => Object.keys(s.organs).length)
  const [collapsed, setCollapsed] = useState(false)
  const live = stage === 'building'
  const last = [...events].reverse().find((e) => e.type === 'tool_call')
  return (
    <motion.aside
      className="glass"
      initial={{ x: -30, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      style={{ position: 'absolute', left: 16, top: 76, bottom: collapsed ? 'auto' : 16, width: collapsed ? 220 : 340, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'width .35s cubic-bezier(.2,.8,.2,1)', zIndex: 5, maxWidth: 'calc(100vw - 32px)' }}
    >
      <button onClick={() => setCollapsed(!collapsed)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: collapsed ? 0 : '1px solid var(--line)', textAlign: 'left' }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: live ? 'var(--accent)' : 'var(--ok)', animation: live ? 'pulse-ring 1.4s infinite' : 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{live ? <span className="shimmer">Opus is working</span> : 'Opus’s process'}</div>
          <div className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {live ? (last ? (TOOL_LABEL[last.tool] ?? last.tool) : 'Starting…') : `${organCount} structures · ${events.filter((e) => e.type === 'tool_call').length} steps`}
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .3s', color: 'var(--ink-3)' }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {!collapsed && (
        <div className="scroll" style={{ padding: 16, flex: 1 }}>
          <Feed events={events} live={live} />
        </div>
      )}
    </motion.aside>
  )
}
