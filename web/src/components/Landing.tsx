import { motion } from 'framer-motion'
import { useRef, useState } from 'react'
import { startScan } from '../api'
import { requireAuth } from '../auth'
import { useStore } from '../store'

const ease = [0.2, 0.8, 0.2, 1] as const

const FEATURES = [
  {
    title: 'Every organ, separately',
    text: 'Opus segments the scan and turns each structure into its own 3D object you can pull apart.',
    icon: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" />,
  },
  {
    title: 'Explained in plain words',
    text: 'Measurements, findings and what they mean, at a reading level that respects you.',
    icon: <path d="M4 5h16v11H8l-4 4zM8 9h8M8 12h5" />,
  },
  {
    title: 'An AI you can audit',
    text: 'Opus edits a diagnosis model’s weights directly, then shows you exactly why it decided.',
    icon: <><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 6.5l10 5M7 17.5l10-5" /></>,
  },
]

function LibraryLink() {
  const user = useStore((s) => s.user)
  return (
    <button className="btn btn-ghost" style={{ height: 42, padding: '0 14px', borderRadius: 13 }} onClick={() => requireAuth(() => useStore.setState({ libraryOpen: true }))}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h6v16H4zM14 4h6v16h-6z" /></svg>
      {user ? 'My reports' : 'Sign in to see reports'}
    </button>
  )
}

export default function Landing() {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const go = (file?: File) => file && startScan({ file })

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto' }} className="scroll">
      {/* ambient light */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <motion.div animate={{ x: [0, 40, 0], y: [0, -20, 0] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', width: 620, height: 620, left: '8%', top: '-18%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(47,91,255,.16), transparent 65%)', filter: 'blur(20px)' }} />
        <motion.div animate={{ x: [0, -30, 0], y: [0, 30, 0] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', width: 560, height: 560, right: '4%', top: '22%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,107,74,.13), transparent 65%)', filter: 'blur(24px)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(17,18,20,.07) 1px, transparent 1px)', backgroundSize: '22px 22px', maskImage: 'radial-gradient(ellipse 60% 55% at 50% 40%, #000 30%, transparent 75%)', WebkitMaskImage: 'radial-gradient(ellipse 60% 55% at 50% 40%, #000 30%, transparent 75%)' }} />
      </div>

      <div style={{ position: 'relative', minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '96px 16px 48px' }}>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease }} style={{ width: 'min(600px, 100%)', textAlign: 'center' }}>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px 0 6px', borderRadius: 999, background: 'rgba(255,255,255,.75)', boxShadow: 'var(--shadow-sm)', fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 26 }}>
            <span style={{ height: 20, padding: '0 8px', borderRadius: 999, background: 'var(--ink)', color: '#fff', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>New</span>
            Built with Claude Opus 5.5 and weight-space programming
          </motion.div>
          <h1 style={{ fontSize: 'clamp(48px, 9vw, 92px)', lineHeight: 0.95, letterSpacing: '-0.055em', fontWeight: 600, margin: 0 }}>
            See inside<span style={{ color: 'var(--accent)' }}>.</span>
          </h1>
          <p style={{ fontSize: 18, color: 'var(--ink-2)', lineHeight: 1.5, margin: '22px auto 36px', maxWidth: 470, letterSpacing: '-0.01em' }}>
            Drop in a CT scan. Opus takes it apart into every organ, bone and vessel, so you can hold your own anatomy and ask it anything.
          </p>

          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); go(e.dataTransfer.files?.[0]) }}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Upload a CT scan"
            className="glass"
            style={{ padding: '30px 24px', cursor: 'pointer', borderRadius: 26, outline: over ? '2px solid var(--accent)' : '1.5px dashed rgba(17,18,20,.14)', outlineOffset: -10, transition: 'outline-color .2s, transform .25s var(--ease)', transform: over ? 'scale(1.015)' : 'none' }}
          >
            <motion.div animate={over ? { y: -3 } : { y: 0 }} style={{ width: 48, height: 48, borderRadius: 15, margin: '0 auto 12px', display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg, #fff, #eef2ff)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>
            </motion.div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{over ? 'Release to upload' : 'Drop a CT scan here'}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>or click to browse · NIfTI (.nii, .nii.gz)</div>
            <input ref={input} type="file" accept=".nii,.gz" hidden onChange={(e) => go(e.target.files?.[0])} />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" style={{ height: 42, padding: '0 18px', borderRadius: 13 }} onClick={() => startScan({ demo: 'abdomen' })}>
              Try the demo scan
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
            <button className="btn btn-soft" style={{ height: 42, padding: '0 16px', borderRadius: 13 }} onClick={() => startScan({ demo: 'abdomen', replay: true })} data-tip="Replays a recorded Opus run in ~20 s">
              Instant replay
            </button>
            <LibraryLink />
          </div>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, width: 'min(860px, 100%)', marginTop: 64 }}>
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + i * 0.08, duration: 0.6, ease }}
              style={{ padding: 18, borderRadius: 20, background: 'rgba(255,255,255,.6)', boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(10px)' }}>
              <div style={{ width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center', background: '#fff', boxShadow: 'var(--shadow-sm)', marginBottom: 12, color: 'var(--ink)' }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{f.icon}</svg>
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>{f.title}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)', marginTop: 4 }}>{f.text}</div>
            </motion.div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 36 }}>An educational tool. Not a medical device and not a diagnosis.</p>
      </div>
    </div>
  )
}
