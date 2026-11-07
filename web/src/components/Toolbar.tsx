import { motion } from 'framer-motion'
import { useMemo } from 'react'
import { startWsp } from '../api'
import { useStore } from '../store'

const ORDER = ['hepatic', 'digestive', 'urinary', 'cardiac', 'respiratory', 'arterial', 'venous', 'endocrine', 'nervous', 'muscular', 'skeletal', 'lesion', 'other']
const SHORT: Record<string, string> = {
  hepatic: 'Liver', digestive: 'Gut', urinary: 'Urinary', cardiac: 'Heart', respiratory: 'Lungs', arterial: 'Arteries', venous: 'Veins',
  endocrine: 'Glands', nervous: 'Nerves', muscular: 'Muscle', skeletal: 'Bone', lesion: 'Findings', other: 'Other',
}

export default function Toolbar() {
  const organs = useStore((s) => s.organs)
  const hidden = useStore((s) => s.hiddenSystems)
  const explode = useStore((s) => s.explode)
  const offsets = useStore((s) => s.offsets)
  const stage = useStore((s) => s.stage)
  const systems = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of Object.values(organs)) if (!m.has(o.system)) m.set(o.system, o.color)
    return ORDER.filter((s) => m.has(s)).map((s) => ({ s, color: m.get(s)! }))
  }, [organs])
  const moved = Object.keys(offsets).length > 0 || explode > 0

  return (
    <motion.div
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2 }}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 16, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 7, padding: '0 16px' }}
    >
      <div className="glass" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: 6, borderRadius: 999, maxWidth: '100%', overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 4, paddingLeft: 4 }}>
          {systems.map(({ s, color }) => {
            const on = !hidden.includes(s)
            return (
              <button key={s} className="chip" onClick={() => useStore.getState().toggleSystem(s)} style={{ background: on ? 'rgba(255,255,255,.9)' : 'transparent', border: '1px solid ' + (on ? 'var(--line)' : 'transparent'), color: on ? 'var(--ink)' : 'var(--ink-3)', height: 30 }}>
                <span className="dot" style={{ background: color, opacity: on ? 1 : 0.35 }} />
                {SHORT[s]}
              </button>
            )
          })}
        </div>
        <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>
          Explode
          <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => useStore.setState({ explode: +e.target.value })} />
        </label>
        <button className="btn btn-soft" onClick={() => useStore.getState().reassemble()} disabled={!moved} style={{ opacity: moved ? 1 : 0.45 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg>
          Reassemble
        </button>
        <button className="btn btn-accent" disabled={stage !== 'ready'} style={{ opacity: stage === 'ready' ? 1 : 0.5 }} onClick={(e) => startWsp(e.altKey)} title="Opus edits a diagnosis model's weights directly (⌥-click to replay)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 6.5l10 5M7 17.5l10-5" /></svg>
          Train custom model
        </button>
      </div>
    </motion.div>
  )
}
