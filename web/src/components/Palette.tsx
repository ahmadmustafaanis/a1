import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { openReport, startWsp } from '../api'
import { useStore } from '../store'
import { openXray } from './Xray'

type Item = { id: string; group: string; label: string; hint?: string; kbd?: string; dot?: string; run: () => void }

/** ⌘K — jump to any structure or action without hunting through panels. */
export default function Palette() {
  const open = useStore((s) => s.paletteOpen)
  const organs = useStore((s) => s.organs)
  const trained = useStore((s) => !!s.wspReport)
  const hasReport = useStore((s) => !!s.report)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setI(0)
      setTimeout(() => input.current?.focus(), 20)
    }
  }, [open])

  const items: Item[] = useMemo(() => {
    const close = () => useStore.setState({ paletteOpen: false })
    const st = () => useStore.getState()
    const act = (id: string, label: string, run: () => void, hint?: string, kbd?: string): Item => ({ id, group: 'Actions', label, hint, kbd, run: () => { close(); run() } })
    const actions: Item[] = [
      act('report', hasReport ? 'View report' : 'Generate full report', () => openReport(), 'Images, explanations, suggestions'),
      act('model', trained ? 'Open Opus-edited model' : 'Train custom model', () => (trained ? useStore.setState({ wspOpen: true }) : startWsp(false)), 'Weight-space programming'),
      act('xray', 'Model X-ray', () => openXray(), 'Why the AI decided'),
      act('reassemble', 'Reassemble organs', () => st().reassemble(), undefined, 'R'),
      act('explode', 'Explode / collapse view', () => useStore.setState({ explode: st().explode > 0.05 ? 0 : 0.6 }), undefined, 'E'),
      act('isolate', 'Open selection separately', () => st().selected.length && useStore.setState({ isolate: !st().isolate, spin: false }), undefined, 'I'),
      act('showall', 'Show everything', () => useStore.setState({ hiddenSystems: [], hiddenIds: [] })),
      act('organs', 'Organs only (hide bone, muscle, bowel)', () => useStore.setState({ hiddenSystems: ['skeletal', 'muscular', 'digestive'], hiddenIds: [] })),
      act('reset', 'Reset view', () => { st().clearSelection(); st().reassemble() }, undefined, 'Esc'),
    ]
    const findings: Item[] = Object.values(organs).filter((o) => o.finding).map((o) => ({
      id: `f${o.id}`, group: 'Findings', label: o.label, dot: '#ff3b30', hint: 'Fly to finding',
      run: () => useStore.setState({ paletteOpen: false, selected: [o.id], isolate: false }),
    }))
    const structures: Item[] = Object.values(organs).filter((o) => !o.finding).sort((a, b) => a.label.localeCompare(b.label)).map((o) => ({
      id: `o${o.id}`, group: 'Structures', label: o.label, dot: o.color,
      hint: o.volume_ml >= 1000 ? `${(o.volume_ml / 1000).toFixed(2)} L` : `${Math.round(o.volume_ml)} mL`,
      run: () => {
        const s = useStore.getState()
        useStore.setState({ paletteOpen: false, selected: [o.id], isolate: false, hiddenSystems: s.hiddenSystems.filter((x) => x !== o.system), hiddenIds: s.hiddenIds.filter((x) => x !== o.id) })
      },
    }))
    return [...actions, ...findings, ...structures]
  }, [organs, trained, hasReport])

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (!ql) return items.filter((x) => x.group !== 'Structures').concat(items.filter((x) => x.group === 'Structures').slice(0, 6))
    const score = (x: Item) => {
      const l = x.label.toLowerCase()
      if (l.startsWith(ql)) return 0
      if (l.split(' ').some((w) => w.startsWith(ql))) return 1
      if (l.includes(ql)) return 2
      return 9
    }
    return items.map((x) => [x, score(x)] as const).filter(([, s]) => s < 9).sort((a, b) => a[1] - b[1]).map(([x]) => x)
  }, [items, q])

  useEffect(() => {
    list.current?.querySelector(`[data-idx="${i}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [i])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(shown.length - 1, x + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
    if (e.key === 'Enter') { e.preventDefault(); shown[i]?.run() }
    if (e.key === 'Escape') { e.preventDefault(); useStore.setState({ paletteOpen: false }) }
  }

  let lastGroup = ''
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onMouseDown={() => useStore.setState({ paletteOpen: false })}
          style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(240,239,234,.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh', paddingInline: 16 }}>
          <motion.div onMouseDown={(e) => e.stopPropagation()} initial={{ y: -8, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -6, scale: 0.98, opacity: 0 }} transition={{ type: 'spring', damping: 30, stiffness: 420 }}
            className="glass" style={{ width: 'min(620px, 100%)', background: 'rgba(255,255,255,.94)', borderRadius: 20, overflow: 'hidden' }} role="dialog" aria-label="Command palette">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 56, borderBottom: '1px solid var(--line)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0) }} onKeyDown={onKey} placeholder="Search structures, findings and actions…" style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontSize: 16 }} aria-label="Search" />
              <span className="kbd">esc</span>
            </div>
            <div ref={list} className="scroll" style={{ maxHeight: 380, padding: 6 }}>
              {shown.map((x, idx) => {
                const head = x.group !== lastGroup ? ((lastGroup = x.group), true) : false
                return (
                  <div key={x.id}>
                    {head && <div className="eyebrow" style={{ padding: '10px 10px 6px', fontSize: 10.5 }}>{x.group}</div>}
                    <button data-idx={idx} onMouseMove={() => setI(idx)} onClick={() => x.run()}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 10px', borderRadius: 10, textAlign: 'left', background: idx === i ? 'rgba(17,18,20,.06)' : 'transparent' }}>
                      {x.dot ? <span className="dot" style={{ background: x.dot }} /> : <span style={{ width: 8, height: 8, borderRadius: 3, border: '1.5px solid var(--ink-3)' }} />}
                      <span style={{ fontSize: 14, flex: 1 }}>{x.label}</span>
                      {x.hint && <span className="muted mono" style={{ fontSize: 11.5 }}>{x.hint}</span>}
                      {x.kbd && <span className="kbd">{x.kbd}</span>}
                      {idx === i && <span className="kbd">↵</span>}
                    </button>
                  </div>
                )
              })}
              {!shown.length && <div className="muted" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>Nothing matches “{q}”.</div>}
            </div>
            <div style={{ display: 'flex', gap: 14, padding: '9px 16px', borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-3)' }}>
              <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
              <span><span className="kbd">↵</span> open</span>
              <span style={{ flex: 1 }} />
              <span><span className="kbd">R</span> reassemble · <span className="kbd">E</span> explode · <span className="kbd">I</span> isolate · <span className="kbd">/</span> find</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
