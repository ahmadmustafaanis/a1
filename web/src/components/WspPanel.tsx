import { AnimatePresence, animate, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { cellKey, useStore, type Weights } from '../store'
import { Feed } from './Timeline'
import { fetchExplain } from './Xray'

const FEATURE_SHORT: Record<string, string> = {
  diameter_mm: 'size', log_volume: 'vol', contrast_hu: 'contrast', contrast_snr: 'SNR', sphericity: 'round',
  elongation: 'elong', edge_sharpness: 'edge', internal_noise: 'texture', depth_mm: 'depth',
}

function color(v: number) {
  const t = Math.max(-1, Math.min(1, v / 2))
  // negative → cobalt, positive → coral, 0 → paper
  const [r, g, b] = t < 0 ? [47, 91, 255] : [255, 107, 74]
  const a = Math.abs(t)
  return `rgb(${Math.round(250 + (r - 250) * a)},${Math.round(249 + (g - 249) * a)},${Math.round(246 + (b - 246) * a)})`
}

function Grid({ layer, w, base, cols, rowLabel }: { layer: string; w: Weights; base?: Weights; cols: string[]; rowLabel: string }) {
  const pulse = useStore((s) => s.wspPulse)
  const L = w[layer]
  if (!L) return null
  const now = Date.now()
  const size = layer === 'l1' ? 20 : layer === 'l2' ? 16 : 22
  const cell = (val: number, key: string, changed: boolean, title: string) => {
    const recent = pulse[key] && now - pulse[key] < 2500
    return (
      <motion.div
        key={key}
        title={title}
        animate={{ backgroundColor: color(val), scale: recent ? [1, 1.35, 1] : 1 }}
        transition={{ duration: recent ? 0.6 : 0.4 }}
        style={{
          width: size, height: size, borderRadius: 5,
          boxShadow: changed ? '0 0 0 2px var(--accent), 0 0 12px rgba(47,91,255,.45)' : 'inset 0 0 0 1px rgba(17,18,20,.05)',
          animation: recent ? 'pulse-ring 1s 2' : undefined, zIndex: changed ? 1 : 0,
        }}
      />
    )
  }
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `28px repeat(${cols.length}, ${size}px) 10px ${size}px`, gap: 3, alignItems: 'end' }}>
        <div />
        {cols.map((c) => (
          <div key={c} className="mono muted" style={{ fontSize: 9, writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: layer === 'l1' ? 48 : 26, textAlign: 'left' }}>{c}</div>
        ))}
        <div />
        <div className="mono muted" style={{ fontSize: 9, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>bias</div>
        {L.weight.map((row, r) => (
          <FragmentRow key={r}>
            <div className="mono muted" style={{ fontSize: 9.5, textAlign: 'right', paddingRight: 4, lineHeight: `${size}px` }}>{rowLabel}{r}</div>
            {row.map((v, c) => {
              const k = cellKey({ layer, param: 'weight', row: r, col: c })
              const b0 = base?.[layer]?.weight[r][c]
              return cell(v, k, b0 !== undefined && Math.abs(b0 - v) > 1e-6, `${layer}[${r},${c}] = ${v.toFixed(3)}${b0 !== undefined && Math.abs(b0 - v) > 1e-6 ? ` (was ${b0.toFixed(3)})` : ''}`)
            })}
            <div />
            {(() => {
              const k = cellKey({ layer, param: 'bias', row: r, col: -1 })
              const b0 = base?.[layer]?.bias[r]
              return cell(L.bias[r], k, b0 !== undefined && Math.abs(b0 - L.bias[r]) > 1e-6, `bias ${L.bias[r].toFixed(3)}`)
            })()}
          </FragmentRow>
        ))}
      </div>
    </div>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function Num({ value, digits = 0, suffix = '' }: { value: number; digits?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(value)
  useEffect(() => {
    const c = animate(prev.current, value, { duration: 0.9, ease: [0.2, 0.8, 0.2, 1], onUpdate: (v) => { if (ref.current) ref.current.textContent = v.toFixed(digits) + suffix } })
    prev.current = value
    return () => c.stop()
  }, [value, digits, suffix])
  return <span ref={ref}>{value.toFixed(digits) + suffix}</span>
}

export default function WspPanel() {
  const open = useStore((s) => s.wspOpen)
  const w = useStore((s) => s.wspWeights)
  const base = useStore((s) => s.wspBase)
  const feats = useStore((s) => s.wspFeatures)
  const m0 = useStore((s) => s.wspMetrics0)
  const m = useStore((s) => s.wspMetrics)
  const events = useStore((s) => s.wspEvents)
  const report = useStore((s) => s.wspReport)
  const patient = useStore((s) => s.wspPatient)
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 500)
    return () => clearInterval(t)
  }, [])
  const live = !!events.length && !report && !events.some((e) => e.type === 'error')
  let changed = 0
  if (w && base) for (const l of Object.keys(w)) {
    w[l].weight.forEach((row, r) => row.forEach((v, c) => { if (Math.abs(v - base[l].weight[r][c]) > 5e-4) changed++ }))
    w[l].bias.forEach((v, r) => { if (Math.abs(v - base[l].bias[r]) > 5e-4) changed++ })
  }
  const nParams = w ? Object.values(w).reduce((a, L) => a + L.weight.length * L.weight[0].length + L.bias.length, 0) : 0

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(244,243,239,.55)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <motion.div
            className="glass"
            initial={{ y: 40, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            style={{ width: 'min(1180px, 100%)', height: 'min(760px, 100%)', background: 'var(--glass-strong)', display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', overflow: 'hidden', borderRadius: 28 }}
          >
            <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18, borderRight: '1px solid var(--line)', minWidth: 0, overflow: 'auto' }} className="scroll">
              <div>
                <div className="eyebrow">Weight-space programming · lesion_net</div>
                <h2 style={{ margin: '6px 0 4px', fontSize: 28, letterSpacing: '-0.035em', fontWeight: 600 }}>Opus is rewriting the model.</h2>
                <div className="muted" style={{ fontSize: 13.5 }}>No gradients. No training run. Opus reads each weight, reasons about what it does, and writes new values.</div>
              </div>
              {w && (
                <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>Layer 1 · features → 16</div>
                    <Grid layer="l1" w={w} base={base} cols={feats.map((f) => FEATURE_SHORT[f] ?? f)} rowLabel="h" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                    <div>
                      <div className="eyebrow" style={{ marginBottom: 8 }}>Layer 2 · 16 → 8</div>
                      <Grid layer="l2" w={w} base={base} cols={Array.from({ length: 16 }, (_, i) => `h${i}`)} rowLabel="g" />
                    </div>
                    <div>
                      <div className="eyebrow" style={{ marginBottom: 8 }}>Output · 8 → lesion?</div>
                      <Grid layer="l3" w={w} base={base} cols={Array.from({ length: 8 }, (_, i) => `g${i}`)} rowLabel="y" />
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="dot" style={{ background: color(-2) }} />negative</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="dot" style={{ background: color(2) }} />positive</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="dot" style={{ background: '#fff', boxShadow: '0 0 0 2px var(--accent)' }} />edited by Opus</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
              <div style={{ padding: '22px 24px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div className="eyebrow">Small-lesion recall (&lt;12 mm)</div>
                    <div style={{ fontSize: 46, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1.05, marginTop: 4 }}>
                      {m0 && <span className="muted" style={{ fontSize: 26, fontWeight: 500 }}>{Math.round(m0.recall_small * 100)}% → </span>}
                      {m ? <Num value={m.recall_small * 100} suffix="%" /> : '—'}
                    </div>
                  </div>
                  <button className="btn btn-ghost" style={{ height: 30, width: 30, padding: 0, justifyContent: 'center' }} onClick={() => useStore.setState({ wspOpen: false })} aria-label="Close">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <Mini label="False alarms" v={m ? `${(m.false_positive_rate * 100).toFixed(1)}%` : '—'} />
                  <Mini label="Accuracy" v={m ? `${(m.accuracy * 100).toFixed(1)}%` : '—'} />
                  <Mini label="Weights edited" v={`${changed}/${nParams || '—'}`} />
                </div>
                {patient.map((p) => (
                  <div key={p.name} style={{ padding: 12, borderRadius: 14, background: p.after >= 0.5 ? 'rgba(24,160,88,.08)' : 'var(--danger-soft)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 500 }}>
                      <span>Your scan · liver finding</span>
                      <span className="mono">{p.before.toFixed(2)} → <b>{p.after.toFixed(2)}</b></span>
                    </div>
                    <div style={{ position: 'relative', height: 8, borderRadius: 99, background: 'rgba(17,18,20,.08)', marginTop: 8 }}>
                      <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1.5, background: 'var(--ink-3)' }} />
                      <motion.div animate={{ width: `${Math.max(3, p.after * 100)}%` }} transition={{ duration: 0.9 }} style={{ height: '100%', borderRadius: 99, background: p.after >= 0.5 ? 'var(--ok)' : 'var(--danger)' }} />
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{p.after >= 0.5 ? 'The edited model now detects the lesion Opus spotted.' : 'Original model misses this lesion (threshold 0.50).'}</div>
                  </div>
                ))}
              </div>
              <div className="scroll" style={{ padding: '16px 24px', flex: 1, minHeight: 0 }}>
                {!events.length && <div className="shimmer">Connecting to Opus…</div>}
                <Feed events={events} live={live} />
                {report && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 14, padding: 16, borderRadius: 16, background: 'var(--ink)', color: '#fff' }}>
                    <div className="eyebrow" style={{ color: 'rgba(255,255,255,.55)' }}>Held-out test set</div>
                    <div style={{ fontSize: 15, fontWeight: 500, marginTop: 6, lineHeight: 1.45 }}>
                      Small-lesion recall {Math.round(report.test_before.recall_small * 100)}% → {Math.round(report.test_after.recall_small * 100)}%, false alarms {(report.test_before.false_positive_rate * 100).toFixed(1)}% → {(report.test_after.false_positive_rate * 100).toFixed(1)}%, by editing {report.weights_changed} weights ({report.pct_changed}% of the model).
                    </div>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,.7)', marginTop: 8, lineHeight: 1.5 }}>{report.summary}</div>
                    <button className="btn" style={{ marginTop: 12, background: '#fff', color: 'var(--ink)' }} onClick={() => { useStore.setState({ wspOpen: false, xrayOpen: true }); fetchExplain() }}>
                      See why it decides → Model X-ray
                    </button>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Mini({ label, v }: { label: string; v: string }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,.8)', border: '1px solid var(--line)' }}>
      <div className="eyebrow" style={{ fontSize: 9.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 500, marginTop: 2 }}>{v}</div>
    </div>
  )
}
