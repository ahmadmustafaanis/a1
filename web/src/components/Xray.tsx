import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useStore } from '../store'

export type Decomp = {
  score: number
  logit: number
  features: { name: string; raw: number; z: number; contrib: number }[]
  h1: { unit: string; act: number; contrib: number }[]
  h2: { unit: string; act: number; contrib: number }[]
  edge_logit: { l1: number[][]; l2: number[][]; l3: number[] }
  counterfactuals: { feature: string; delta_std: number; delta_raw: number; plausible: boolean }[]
}
export type Explain = {
  kind?: 'finding' | 'closest_call'
  features: string[]
  feature_plain: Record<string, string>
  cases: { name: string; kind?: string; info?: { candidates_checked: number; score_original: number; diameter_mm: number }; base: Decomp; edited: Decomp | null }[]
  edited_cells: { layer: string; param: string; row: number; col: number; old: number; new: number }[]
  opus: {
    units?: Record<string, { name: string; role: string }>
    headline?: string
    evidence_for?: string[]
    evidence_against?: string[]
    what_changed?: string
    counterfactual?: string
    report_sentence?: string
  }
}

const POS = '#FF6B4A'
const NEG = '#2F5BFF'

export async function fetchExplain(force = false): Promise<Explain | null> {
  const { scanId } = useStore.getState()
  useStore.setState({ explainLoading: true, explainError: undefined })
  try {
    const r = await fetch(`/api/scans/${scanId}/explain${force ? '?force=true' : ''}`, { method: 'POST' })
    if (!r.ok) {
      let msg = `Explanation failed (${r.status}).`
      try {
        msg = (await r.json()).detail ?? msg
      } catch { /* not json */ }
      useStore.setState({ explainError: msg })
      return null
    }
    const j = (await r.json()) as Explain
    useStore.setState({ explain: j })
    return j
  } catch {
    useStore.setState({ explainError: 'Could not reach the Lumen API.' })
    return null
  } finally {
    useStore.setState({ explainLoading: false })
  }
}

/** Open the X-ray, reusing the saved analysis when there is one. */
export function openXray() {
  const st = useStore.getState()
  useStore.setState({ xrayOpen: true, wspOpen: false })
  if (!st.explain) fetchExplain()
}

/** Diverging bars: each feature's exact contribution to the decision (ghost = original model). */
export function AttributionBars({ ex, max = 9 }: { ex: Explain; max?: number }) {
  const c = ex.cases[0]
  const cur = c.edited ?? c.base
  const rows = [...cur.features].sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, max)
  const lim = Math.max(...cur.features.map((f) => Math.abs(f.contrib)), ...c.base.features.map((f) => Math.abs(f.contrib)), 0.1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((f) => {
        const b = c.base.features.find((x) => x.name === f.name)!
        const w = (v: number) => `${(Math.abs(v) / lim) * 50}%`
        return (
          <div key={f.name} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 44px', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${f.name} = ${f.raw} (${f.z >= 0 ? '+' : ''}${f.z}σ vs an average candidate)`}>
              {(ex.feature_plain[f.name] ?? f.name).replace(' (vessel-like)', '')}
              <span className="muted"> · {f.z < -0.5 ? 'low' : f.z > 0.5 ? 'high' : 'avg'}</span>
            </span>
            <div style={{ position: 'relative', height: 12 }}>
              <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--line)' }} />
              {c.edited && (
                <div style={{ position: 'absolute', top: 3, height: 6, borderRadius: 3, background: b.contrib >= 0 ? POS : NEG, opacity: 0.22, width: w(b.contrib), [b.contrib >= 0 ? 'left' : 'right']: '50%' }} />
              )}
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: w(f.contrib) }}
                transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
                style={{ position: 'absolute', top: 0, height: 12, borderRadius: 4, background: f.contrib >= 0 ? POS : NEG, [f.contrib >= 0 ? 'left' : 'right']: '50%' }}
              />
            </div>
            <span className="mono" style={{ fontSize: 11, textAlign: 'right', color: f.contrib >= 0 ? '#c2410c' : NEG }}>{f.contrib >= 0 ? '+' : ''}{f.contrib.toFixed(1)}</span>
          </div>
        )
      })}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--ink-3)', padding: '0 44px 0 158px' }}>
        <span>← not a lesion</span>
        <span>lesion →</span>
      </div>
    </div>
  )
}

function Circuit({ ex, d, showEdits }: { ex: Explain; d: Decomp; showEdits: boolean }) {
  const [hover, setHover] = useState<string | null>(null)
  const W = 660
  const H = 520
  const X = { in: 150, h1: 330, h2: 490, out: 610 }
  const ys = (n: number, i: number) => 30 + ((H - 60) * (i + 0.5)) / n
  const units = ex.opus.units ?? {}
  const edited = useMemo(() => new Set(ex.edited_cells.filter((c) => c.param === 'weight').map((c) => `${c.layer}:${c.row}:${c.col}`)), [ex])

  const edges = useMemo(() => {
    const out: { k: string; x1: number; y1: number; x2: number; y2: number; v: number; layer: string; ed: boolean }[] = []
    const take = (layer: 'l1' | 'l2', M: number[][], nIn: number, nOut: number, xa: number, xb: number, top: number) => {
      const all: [number, number, number][] = []
      M.forEach((row, r) => row.forEach((v, c) => all.push([r, c, v])))
      all.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]))
      for (const [r, c, v] of all.slice(0, top)) {
        if (Math.abs(v) < 0.02) continue
        out.push({ k: `${layer}:${r}:${c}`, x1: xa, y1: ys(nIn, c), x2: xb, y2: ys(nOut, r), v, layer, ed: edited.has(`${layer}:${r}:${c}`) })
      }
    }
    take('l1', d.edge_logit.l1, 9, 16, X.in, X.h1, 34)
    take('l2', d.edge_logit.l2, 16, 8, X.h1, X.h2, 26)
    d.edge_logit.l3.forEach((v, j) => {
      if (Math.abs(v) > 0.02) out.push({ k: `l3:0:${j}`, x1: X.h2, y1: ys(8, j), x2: X.out, y2: H / 2, v, layer: 'l3', ed: edited.has(`l3:0:${j}`) })
    })
    return out
  }, [d, edited]) // eslint-disable-line react-hooks/exhaustive-deps
  const vmax = Math.max(...edges.map((e) => Math.abs(e.v)), 0.1)
  const actMax = Math.max(...d.h1.map((u) => u.act), ...d.h2.map((u) => u.act), 0.1)
  const fmax = Math.max(...d.features.map((f) => Math.abs(f.contrib)), 0.1)
  const hovered = hover ? edges.filter((e) => e.k.includes(hover)) : []
  void hovered

  const node = (id: string, x: number, y: number, act: number, contrib: number, label?: string, align: 'l' | 'r' = 'r') => {
    const r = 3.5 + 7 * Math.min(1, act / actMax)
    const named = units[id]
    const on = hover === id
    return (
      <g key={id} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
        <circle cx={x} cy={y} r={r + 6} fill="transparent" />
        <circle cx={x} cy={y} r={r} fill={act <= 0 ? '#fff' : contrib >= 0 ? POS : NEG} fillOpacity={act <= 0 ? 1 : 0.25 + 0.75 * Math.min(1, Math.abs(contrib) / 2.5)} stroke={act <= 0 ? 'rgba(17,18,20,.18)' : contrib >= 0 ? POS : NEG} strokeWidth={on ? 2.5 : 1.2} style={{ transition: 'all .6s cubic-bezier(.2,.8,.2,1)' }} />
        {(named || label) && (
          <text x={align === 'r' ? x + r + 6 : x - r - 6} y={y + 3.5} fontSize={named ? 10.5 : 10} textAnchor={align === 'r' ? 'start' : 'end'} fill={named ? 'var(--ink)' : 'var(--ink-3)'} fontWeight={named ? 500 : 400} style={{ pointerEvents: 'none' }}>
            {label ?? named?.name}
          </text>
        )}
      </g>
    )
  }

  const tip = hover && (units[hover] || hover.startsWith('f:')) ? hover : null

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" /></filter>
        </defs>
        {['inputs', 'hidden 1', 'hidden 2', 'decision'].map((t, i) => (
          <text key={t} x={[X.in, X.h1, X.h2, X.out][i]} y={14} textAnchor="middle" fontSize={9.5} fill="var(--ink-3)" letterSpacing=".08em">{t.toUpperCase()}</text>
        ))}
        {edges.map((e) => {
          const dim = hover && !e.k.split(':').slice(1).some(() => true) ? 1 : 1
          const relevant = !hover || (hover.startsWith('h1') && ((e.layer === 'l1' && `h1[${e.k.split(':')[1]}]` === hover) || (e.layer === 'l2' && `h1[${e.k.split(':')[2]}]` === hover))) ||
            (hover.startsWith('h2') && ((e.layer === 'l2' && `h2[${e.k.split(':')[1]}]` === hover) || (e.layer === 'l3' && `h2[${e.k.split(':')[2]}]` === hover))) ||
            (hover.startsWith('f:') && e.layer === 'l1' && `f:${e.k.split(':')[2]}` === hover)
          const mx = (e.x1 + e.x2) / 2
          const path = `M${e.x1},${e.y1} C${mx},${e.y1} ${mx},${e.y2} ${e.x2},${e.y2}`
          const sw = 0.6 + 6 * (Math.abs(e.v) / vmax)
          return (
            <g key={e.k} style={{ transition: 'opacity .3s' }} opacity={(relevant ? 1 : 0.08) * dim}>
              {showEdits && e.ed && <path d={path} stroke={NEG} strokeWidth={sw + 5} fill="none" opacity={0.35} filter="url(#glow)" />}
              <path d={path} stroke={e.v >= 0 ? POS : NEG} strokeOpacity={0.25 + 0.6 * (Math.abs(e.v) / vmax)} strokeWidth={sw} fill="none" strokeDasharray={showEdits && e.ed ? '5 3' : undefined} style={{ transition: 'stroke-width .6s, stroke-opacity .6s' }} />
            </g>
          )
        })}
        {d.features.map((f, k) => (
          <g key={f.name} onMouseEnter={() => setHover(`f:${k}`)} onMouseLeave={() => setHover(null)}>
            <rect x={X.in - 8 - (Math.abs(f.contrib) / fmax) * 46} y={ys(9, k) - 4} width={(Math.abs(f.contrib) / fmax) * 46} height={8} rx={3} fill={f.contrib >= 0 ? POS : NEG} opacity={0.0} />
            <circle cx={X.in} cy={ys(9, k)} r={5} fill={f.contrib >= 0 ? POS : NEG} fillOpacity={0.2 + 0.8 * Math.min(1, Math.abs(f.contrib) / fmax)} />
            <text x={X.in - 12} y={ys(9, k) + 3.5} textAnchor="end" fontSize={11} fill="var(--ink-2)">{(ex.feature_plain[f.name] ?? f.name).replace(' (vessel-like)', '')} · {f.z < -0.5 ? 'low' : f.z > 0.5 ? 'high' : 'avg'}</text>
          </g>
        ))}
        {d.h1.map((u, i) => node(u.unit, X.h1, ys(16, i), u.act, u.contrib))}
        {d.h2.map((u, j) => node(u.unit, X.h2, ys(8, j), u.act, u.contrib))}
        <g>
          <circle cx={X.out} cy={H / 2} r={20} fill={d.score >= 0.5 ? 'rgba(24,160,88,.14)' : 'rgba(255,59,48,.12)'} stroke={d.score >= 0.5 ? 'var(--ok)' : 'var(--danger)'} strokeWidth={1.5} />
          <text x={X.out} y={H / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink)">{Math.round(d.score * 100)}%</text>
          <text x={X.out} y={H / 2 + 36} textAnchor="middle" fontSize={10} fill="var(--ink-3)">lesion</text>
        </g>
      </svg>
      <AnimatePresence>
        {tip && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass" style={{ position: 'absolute', left: 12, bottom: 8, maxWidth: 360, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.45, borderRadius: 14 }}>
            {tip.startsWith('f:') ? (() => {
              const f = d.features[+tip.slice(2)]
              return <><b style={{ fontWeight: 600 }}>{ex.feature_plain[f.name]}</b> · value {f.raw} ({f.z >= 0 ? '+' : ''}{f.z}σ vs average) · contributes {f.contrib >= 0 ? '+' : ''}{f.contrib.toFixed(2)}</>
            })() : (
              <><b style={{ fontWeight: 600 }}>{units[tip].name}</b> <span className="mono muted" style={{ fontSize: 10.5 }}>{tip}</span><div style={{ color: 'var(--ink-2)', marginTop: 2 }}>{units[tip].role}</div></>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function XrayPanel() {
  const open = useStore((s) => s.xrayOpen)
  const ex = useStore((s) => s.explain)
  const loading = useStore((s) => s.explainLoading)
  const error = useStore((s) => s.explainError)
  const [which, setWhich] = useState<'base' | 'edited'>('edited')
  const c = ex?.cases[0]
  const d = c ? (which === 'edited' && c.edited ? c.edited : c.base) : null
  const [copied, setCopied] = useState(false)

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'absolute', inset: 0, zIndex: 25, background: 'rgba(244,243,239,.55)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={() => useStore.setState({ xrayOpen: false })}>
          <motion.div onClick={(e) => e.stopPropagation()} className="glass" initial={{ y: 40, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            style={{ width: 'min(1180px, 100%)', height: 'min(780px, 100%)', background: 'var(--glass-strong)', display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)', overflow: 'hidden', borderRadius: 28 }}>
            <div className="scroll" style={{ padding: 26, borderRight: '1px solid var(--line)', minWidth: 0 }}>
              <div className="eyebrow">Model X-ray · lesion_net · {c?.kind === 'closest_call' ? 'closest call (not reported)' : 'your liver finding'}</div>
              <h2 style={{ margin: '6px 0 4px', fontSize: 28, letterSpacing: '-0.035em', fontWeight: 600 }}>
                {c?.kind === 'closest_call' ? 'Why nothing was flagged.' : 'Why the AI decided.'}
              </h2>
              {c?.kind === 'closest_call' && c.info && (
                <div style={{ fontSize: 13, color: 'var(--ink-2)', margin: '4px 0 6px' }}>
                  No finding was reported. This is the most lesion-like of {c.info.candidates_checked} spots checked in the liver (≈{c.info.diameter_mm} mm).
                </div>
              )}
              <div className="muted" style={{ fontSize: 13.5 }}>Every line is real signal flowing through the network for <i>this</i> finding. Thicker means more influence. <span style={{ color: '#c2410c' }}>Coral</span> pushes toward “lesion”, <span style={{ color: NEG }}>blue</span> pushes away. Hover a unit to see what Opus found it does.</div>
              {c?.edited && (
                <div style={{ display: 'inline-flex', marginTop: 14, padding: 3, borderRadius: 999, background: 'rgba(17,18,20,.06)' }}>
                  {(['base', 'edited'] as const).map((w) => (
                    <button key={w} onClick={() => setWhich(w)} className="btn" style={{ height: 30, fontSize: 12.5, background: which === w ? (w === 'edited' ? 'var(--accent)' : '#fff') : 'transparent', color: which === w && w === 'edited' ? '#fff' : undefined, boxShadow: which === w ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>
                      {w === 'base' ? `Original model · ${Math.round(c.base.score * 100)}%` : `Opus-edited model · ${Math.round(c.edited!.score * 100)}%`}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                {loading && !ex && <div className="shimmer" style={{ padding: 40 }}>Opus is reading the network’s weights… (about 30 s the first time)</div>}
                {!loading && !ex && error && (
                  <div style={{ padding: 20, borderRadius: 16, background: 'var(--danger-soft)', color: '#b3261e', fontSize: 13.5, lineHeight: 1.5 }}>
                    {error}
                    <div><button className="btn btn-soft" style={{ marginTop: 10, color: 'var(--ink)' }} onClick={() => fetchExplain(true)}>Try again</button></div>
                  </div>
                )}
                {ex && d && <Circuit ex={ex} d={d} showEdits={which === 'edited'} />}
              </div>
              {which === 'edited' && c?.edited && (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <svg width="26" height="8"><path d="M1 4h24" stroke={NEG} strokeWidth="2.5" strokeDasharray="5 3" /></svg>
                  connection Opus rewrote ({ex?.edited_cells.length} weights)
                </div>
              )}
            </div>

            <div className="scroll" style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.4 }}>
                  {ex?.opus.headline ?? (loading ? <span className="shimmer">Opus is reading the weights…</span> : error ? <span className="muted">No explanation available.</span> : null)}
                </div>
                <button className="btn btn-ghost" style={{ height: 30, width: 30, padding: 0, justifyContent: 'center' }} onClick={() => useStore.setState({ xrayOpen: false })} aria-label="Close">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
              {ex && (
                <>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 10 }}>What drove the Opus-edited model’s decision {c?.edited ? '(faint = original model)' : ''}</div>
                    <AttributionBars ex={ex} />
                  </div>
                  <Bullets title="Evidence for a lesion" items={ex.opus.evidence_for} color={POS} />
                  <Bullets title="Evidence against" items={ex.opus.evidence_against} color={NEG} />
                  {ex.opus.what_changed && <Block title="What Opus's weight edits changed" text={ex.opus.what_changed} />}
                  {ex.opus.counterfactual && <Block title="What would flip the call" text={ex.opus.counterfactual} />}
                  {ex.opus.report_sentence && (
                    <div style={{ padding: 14, borderRadius: 16, background: 'var(--ink)', color: '#fff' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <div className="eyebrow" style={{ color: 'rgba(255,255,255,.55)', flex: 1 }}>For the report</div>
                        <button className="btn" style={{ height: 24, fontSize: 11, color: '#fff', background: 'rgba(255,255,255,.12)', padding: '0 10px' }} onClick={() => { navigator.clipboard?.writeText(ex.opus.report_sentence!); setCopied(true); setTimeout(() => setCopied(false), 1400) }}>
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 6 }}>{ex.opus.report_sentence}</div>
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                    Contributions are exact for this input. lesion_net is piecewise-linear, so they sum to its output and are measured against an average candidate. Unit names are Opus’s reading of the weights and activations.
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Bullets({ title, items, color }: { title: string; items?: string[]; color: string }) {
  if (!items?.length) return null
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((t, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>
            <span className="dot" style={{ background: color, marginTop: 7 }} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}>{text}</div>
    </div>
  )
}
