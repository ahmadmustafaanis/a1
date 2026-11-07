import { AnimatePresence, motion } from 'framer-motion'
import Inspector from './components/Inspector'
import Landing from './components/Landing'
import Scene from './components/Scene'
import Timeline from './components/Timeline'
import Toolbar from './components/Toolbar'
import WspPanel from './components/WspPanel'
import XrayPanel from './components/Xray'
import ReportPanel from './components/Report'
import { openReport } from './api'
import { useStore } from './store'

function TopBar() {
  const stage = useStore((s) => s.stage)
  const title = useStore((s) => s.title)
  const note = useStore((s) => s.demoNote)
  const n = useStore((s) => Object.keys(s.organs).length)
  return (
    <div style={{ position: 'absolute', left: 16, right: 16, top: 16, height: 44, display: 'flex', alignItems: 'center', gap: 12, zIndex: 8, pointerEvents: 'none' }}>
      <button onClick={() => useStore.setState({ stage: 'landing', organs: {}, events: [], selected: [], wspOpen: false })} style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 17, letterSpacing: '-0.03em' }}>
        <svg width="22" height="22" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="var(--accent)" /><circle cx="16" cy="16" r="6" fill="var(--bg)" /></svg>
        lumen
      </button>
      {stage !== 'landing' && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="glass" style={{ pointerEvents: 'auto', height: 34, borderRadius: 999, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, minWidth: 0 }}>
          <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{title}</span>
          <span className="muted mono" style={{ fontSize: 11.5 }}>{n} structures</span>
          {note && <span className="chip" title={note} style={{ height: 22, fontSize: 11, background: 'var(--accent-soft)', color: 'var(--accent)' }}>Demo case</span>}
        </motion.div>
      )}
      <div style={{ flex: 1 }} />
      {stage !== 'landing' && <div className="muted" style={{ fontSize: 12, pointerEvents: 'auto' }}>Drag organs · Shift-click to multi-select · Double-click to isolate</div>}
      {stage === 'ready' && <ReportButton />}
    </div>
  )
}

function ReportButton() {
  const has = useStore((s) => !!s.report)
  return (
    <button className="btn btn-primary" style={{ pointerEvents: 'auto' }} onClick={() => openReport()} title={has ? 'Open the full report' : 'Generate a full report (creates custom weights first if needed)'}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></svg>
      {has ? 'View report' : 'Generate report'}
    </button>
  )
}

function Summary() {
  const summary = useStore((s) => s.summary)
  const selected = useStore((s) => s.selected.length)
  return (
    <AnimatePresence>
      {summary && !selected && (
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="glass" style={{ position: 'absolute', right: 16, top: 76, width: 320, maxWidth: 'calc(100vw - 32px)', padding: 18, zIndex: 5 }}>
          <div className="eyebrow">Opus’s read of your scan</div>
          <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)' }}>{summary}</p>
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Click any structure to explore it.</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function App() {
  const stage = useStore((s) => s.stage)
  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {stage !== 'landing' && <Scene />}
      <TopBar />
      {stage === 'landing' ? (
        <Landing />
      ) : (
        <>
          <Timeline />
          <Summary />
          <Inspector />
          <Toolbar />
          <WspPanel />
          <XrayPanel />
        </>
      )}
      <ReportPanel />
    </div>
  )
}
