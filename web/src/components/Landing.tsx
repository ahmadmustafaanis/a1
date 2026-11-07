import { motion } from 'framer-motion'
import { useRef, useState } from 'react'
import { startScan } from '../api'

export default function Landing() {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const go = (file?: File) => file && startScan({ file })

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 16 }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ width: 'min(560px, 100%)', textAlign: 'center' }}
      >
        <div className="eyebrow" style={{ marginBottom: 18 }}>Opus 5.5 · weight-space programming</div>
        <h1 style={{ fontSize: 'clamp(44px, 8vw, 76px)', lineHeight: 0.98, letterSpacing: '-0.045em', fontWeight: 600, margin: 0 }}>
          See inside.
        </h1>
        <p style={{ fontSize: 17, color: 'var(--ink-2)', lineHeight: 1.5, margin: '18px auto 34px', maxWidth: 440 }}>
          Drop in a CT scan. Opus takes it apart into every organ, bone and vessel, so you can hold your own anatomy and ask it anything.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            go(e.dataTransfer.files?.[0])
          }}
          onClick={() => input.current?.click()}
          className="glass"
          style={{
            padding: '30px 24px', cursor: 'pointer', borderRadius: 28,
            outline: over ? '2px solid var(--accent)' : '1px dashed rgba(17,18,20,.18)', outlineOffset: -10,
            transition: 'outline-color .2s, transform .2s', transform: over ? 'scale(1.01)' : 'none',
          }}
        >
          <div style={{ width: 44, height: 44, borderRadius: 14, margin: '0 auto 12px', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>
          </div>
          <div style={{ fontWeight: 600 }}>Drop a CT scan</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>NIfTI · .nii or .nii.gz</div>
          <input ref={input} type="file" accept=".nii,.gz" hidden onChange={(e) => go(e.target.files?.[0])} />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => startScan({ demo: 'abdomen' })}>
            Try the demo scan
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
          <button className="btn btn-ghost" onClick={() => startScan({ demo: 'abdomen', replay: true })} title="Replays a recorded Opus run">
            Instant replay
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 34 }}>An educational tool. Not a medical device and not a diagnosis.</p>
      </motion.div>
    </div>
  )
}
