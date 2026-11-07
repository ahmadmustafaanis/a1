import { motion } from 'framer-motion'
import { startWsp } from '../api'
import { useStore } from '../store'

const I = {
  explode: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="9" y="9" width="6" height="6" rx="1.5" /><path d="M4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3" /></svg>,
  reassemble: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg>,
  isolate: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg>,
  reset: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>,
  model: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 6.5l10 5M7 17.5l10-5" /></svg>,
  check: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M5 12l5 5 9-10" /></svg>,
}

export default function Toolbar() {
  const explode = useStore((s) => s.explode)
  const offsets = useStore((s) => s.offsets)
  const stage = useStore((s) => s.stage)
  const selected = useStore((s) => s.selected)
  const isolate = useStore((s) => s.isolate)
  const trained = useStore((s) => !!s.wspReport)
  const moved = Object.keys(offsets).length > 0 || explode > 0
  const sep = <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />

  return (
    <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 20, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 7, padding: '0 16px' }}>
      <div className="glass" role="toolbar" aria-label="Scene tools" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 2, padding: 6, borderRadius: 18, maxWidth: '100%' }}>
        <div data-tip="Explode" data-kbd="E" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 6px', height: 36, borderRadius: 12, color: explode > 0 ? 'var(--ink)' : 'var(--ink-2)' }}>
          {I.explode}
          <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => useStore.setState({ explode: +e.target.value })} aria-label="Explode organs apart" style={{ width: 96 }} />
        </div>
        <button className="ibtn" data-tip="Reassemble" data-kbd="R" disabled={!moved} onClick={() => useStore.getState().reassemble()} aria-label="Reassemble">{I.reassemble}</button>
        <button className={`ibtn ${isolate ? 'on' : ''}`} data-tip={isolate ? 'Back to body' : 'Open selection separately'} data-kbd="I" disabled={!selected.length} onClick={() => useStore.setState({ isolate: !isolate, spin: false })} aria-label="Isolate selection">{I.isolate}</button>
        <button className="ibtn" data-tip="Reset view" data-kbd="Esc" onClick={() => { useStore.getState().clearSelection(); useStore.getState().reassemble() }} aria-label="Reset view">{I.reset}</button>
        {sep}
        {trained ? (
          <button className="btn btn-accent" onClick={() => useStore.setState({ wspOpen: true })} style={{ borderRadius: 12 }}>{I.check} Opus-edited model</button>
        ) : (
          <button className="btn btn-accent" disabled={stage !== 'ready'} style={{ opacity: stage === 'ready' ? 1 : 0.5, borderRadius: 12 }} onClick={(e) => startWsp(e.altKey)} data-tip="Opus edits a diagnosis model’s weights directly">
            {I.model} Train custom model
          </button>
        )}
        {sep}
        <button className="btn btn-ghost" onClick={() => useStore.setState({ paletteOpen: true })} style={{ borderRadius: 12, height: 36, gap: 10, color: 'var(--ink-3)' }} aria-label="Open command palette">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          Search
          <span style={{ display: 'flex', gap: 3 }}><span className="kbd">⌘</span><span className="kbd">K</span></span>
        </button>
      </div>
    </motion.div>
  )
}
