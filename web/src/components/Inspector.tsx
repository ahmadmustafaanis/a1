import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { askOrgans } from '../api'
import { useStore } from '../store'
import Compare from './Compare'
import { AttributionBars, fetchExplain, openXray } from './Xray'

const SYSTEM_NAME: Record<string, string> = {
  digestive: 'Digestive', hepatic: 'Liver & gallbladder', urinary: 'Urinary', respiratory: 'Respiratory', cardiac: 'Heart',
  arterial: 'Arteries', venous: 'Veins', skeletal: 'Skeleton', muscular: 'Muscle', endocrine: 'Glands', nervous: 'Nervous', lesion: 'Finding', other: 'Other',
}

export default function Inspector() {
  const selected = useStore((s) => s.selected)
  const organs = useStore((s) => s.organs)
  const findings = useStore((s) => s.findings)
  const isolate = useStore((s) => s.isolate)
  const spin = useStore((s) => s.spin)
  const lesionFlagged = useStore((s) => s.lesionFlagged)
  const patient = useStore((s) => s.wspPatient)
  const explain = useStore((s) => s.explain)
  const explainLoading = useStore((s) => s.explainLoading)
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const list = selected.map((id) => organs[id]).filter(Boolean)
  const totalMl = list.reduce((a, o) => a + o.volume_ml, 0)

  const ask = async (question: string) => {
    if (!question.trim() || busy) return
    setBusy(true)
    setAnswer({ q: question, a: '' })
    const a = await askOrgans(list.map((o) => o.name), question)
    setAnswer({ q: question, a })
    setBusy(false)
    setQ('')
  }

  return (
    <AnimatePresence>
      {list.length > 0 && (
        <motion.aside
          key="insp"
          className="glass"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 260 }}
          style={{ position: 'absolute', right: 16, top: 76, width: 360, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100% - 172px)', display: 'flex', flexDirection: 'column', zIndex: 6, overflow: 'hidden' }}
        >
          <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="eyebrow">{list.length > 1 ? `${list.length} selected` : SYSTEM_NAME[list[0].system] ?? list[0].system}</div>
              <div style={{ flex: 1 }} />
              {isolate && (
                <button className="btn btn-soft" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={() => useStore.setState({ spin: !spin })} title="Auto-rotate">
                  {spin ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" /></svg>
                  )}
                  {spin ? 'Stop' : 'Spin'}
                </button>
              )}
              <button className="btn btn-soft" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={() => useStore.setState({ isolate: !isolate, spin: false })}>
                {isolate ? 'Back to body' : 'Open separately'}
              </button>
              <button className="btn btn-ghost" style={{ height: 28, width: 28, padding: 0, justifyContent: 'center' }} onClick={() => useStore.getState().clearSelection()} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <h2 style={{ margin: '8px 0 0', fontSize: 26, letterSpacing: '-0.03em', fontWeight: 600, lineHeight: 1.1 }}>
              {list.length === 1 ? list[0].label : list.map((o) => o.label).join(' + ')}
            </h2>
            {list.length > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {list.map((o) => (
                  <span key={o.id} className="chip"><span className="dot" style={{ background: o.color }} />{o.label}</span>
                ))}
              </div>
            )}
          </div>

          <div className="scroll" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Stat label="Volume" value={totalMl >= 1000 ? (totalMl / 1000).toFixed(2) : totalMl.toFixed(1)} unit={totalMl >= 1000 ? 'L' : 'mL'} />
              <Stat label={list.length > 1 ? 'Structures' : 'Mesh detail'} value={list.length > 1 ? String(list.length) : (list[0].faces / 1000).toFixed(1)} unit={list.length > 1 ? '' : 'k faces'} />
            </div>

            {list.map((o) => {
              const f = findings.find((x) => x.name === o.name)
              const pat = patient.find((p) => p.name === o.name)
              return (
                <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {list.length > 1 && <div style={{ fontWeight: 600, fontSize: 13 }}>{o.label}</div>}
                  {o.blurb && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)' }}>{o.blurb}</p>}
                  {f && (
                    <div style={{ padding: 12, borderRadius: 14, background: 'var(--danger-soft)', fontSize: 13, lineHeight: 1.5 }}>
                      <div style={{ fontWeight: 600, color: '#b3261e' }}>{f.title}</div>
                      <div style={{ color: 'var(--ink-2)', marginTop: 4 }}>{f.detail}</div>
                      <div className="mono" style={{ fontSize: 11, marginTop: 8, color: 'var(--ink-3)' }}>
                        ≈{f.diameter_mm} mm · lesion_net {pat ? `${pat.before.toFixed(2)} → ${pat.after.toFixed(2)}` : f.lesion_net_score.toFixed(2)}
                        {lesionFlagged ? ' · now detected ✓' : ''}
                      </div>
                    </div>
                  )}
                  {f && <Compare compact />}
                  {f && (
                    <div style={{ padding: 14, borderRadius: 16, background: 'rgba(255,255,255,.8)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="eyebrow" style={{ flex: 1 }}>Why the AI decided</div>
                        {explain && <span className="mono muted" style={{ fontSize: 11 }}>{Math.round((explain.cases[0].edited ?? explain.cases[0].base).score * 100)}% lesion</span>}
                      </div>
                      {explain ? (
                        <>
                          {explain.opus?.headline && <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{explain.opus.headline}</div>}
                          <AttributionBars ex={explain} max={5} />
                          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => openXray()}>
                            Open Model X-ray
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>Opus can read lesion_net’s weights and trace exactly which measurements and neurons produced this score.</div>
                          <button className="btn btn-accent" style={{ alignSelf: 'flex-start' }} disabled={explainLoading} onClick={() => fetchExplain()}>
                            {explainLoading ? <span>Reading the weights…</span> : 'Explain with Opus'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Ask Opus</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {(list.length > 1 ? ['How do these work together?', 'Are their sizes normal?'] : ['Is this size normal?', 'What does it do?', 'What should I ask my doctor?']).map((s) => (
                  <button key={s} className="chip" onClick={() => ask(s)} style={{ cursor: 'pointer' }}>{s}</button>
                ))}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); ask(q) }} style={{ display: 'flex', gap: 6, background: '#fff', borderRadius: 999, border: '1px solid var(--line)', padding: 4 }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask about ${list.length > 1 ? 'these' : list[0].label.toLowerCase()}…`} style={{ flex: 1, border: 0, outline: 0, background: 'transparent', padding: '0 12px', minWidth: 0 }} />
                <button className="btn btn-accent" style={{ height: 30, width: 30, padding: 0, justifyContent: 'center' }} disabled={busy} aria-label="Ask">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
              </form>
              {answer && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.6 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{answer.q}</div>
                  {answer.a ? <div style={{ whiteSpace: 'pre-wrap' }}>{answer.a.split('**').map((t, i) => (i % 2 ? <b key={i} style={{ fontWeight: 600 }}>{t}</b> : t))}</div> : <div className="shimmer">Opus is thinking…</div>}
                </motion.div>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 14, background: 'rgba(255,255,255,.75)', border: '1px solid var(--line)' }}>
      <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em', marginTop: 2 }}>
        {value}<span className="muted" style={{ fontSize: 12, fontWeight: 500, marginLeft: 4 }}>{unit}</span>
      </div>
    </div>
  )
}
