import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useRef, useState } from 'react'
import { useStore, type Organ } from '../store'
import { Feed } from './Timeline'

const SYSTEMS: { key: string; label: string }[] = [
  { key: 'lesion', label: 'Findings' },
  { key: 'hepatic', label: 'Liver & gallbladder' },
  { key: 'digestive', label: 'Digestive' },
  { key: 'urinary', label: 'Urinary' },
  { key: 'cardiac', label: 'Heart' },
  { key: 'respiratory', label: 'Lungs' },
  { key: 'arterial', label: 'Arteries' },
  { key: 'venous', label: 'Veins' },
  { key: 'endocrine', label: 'Glands' },
  { key: 'nervous', label: 'Nervous' },
  { key: 'skeletal', label: 'Skeleton' },
  { key: 'muscular', label: 'Muscles' },
  { key: 'other', label: 'Other' },
]

const fmtVol = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} L` : v >= 10 ? `${Math.round(v)} mL` : `${v.toFixed(1)} mL`)

function Eye({ on }: { on: boolean }) {
  return on ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M3 3l18 18M10.6 6.1A10.6 10.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.1 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.2-.9" /></svg>
  )
}

function Structures() {
  const organs = useStore((s) => s.organs)
  const hiddenSystems = useStore((s) => s.hiddenSystems)
  const hiddenIds = useStore((s) => s.hiddenIds)
  const selected = useStore((s) => s.selected)
  const hovered = useStore((s) => s.hovered)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({ lesion: true, hepatic: true, urinary: true })
  const input = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => {
    const list = Object.values(organs)
    const ql = q.trim().toLowerCase()
    return SYSTEMS.map((g) => ({
      ...g,
      items: list
        .filter((o) => o.system === g.key && (!ql || o.label.toLowerCase().includes(ql) || o.name.includes(ql)))
        .sort((a, b) => b.volume_ml - a.volume_ml),
    })).filter((g) => g.items.length)
  }, [organs, q])

  const select = (o: Organ, additive: boolean) => {
    useStore.getState().select(o.id, additive)
    useStore.setState({ isolate: false })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ padding: '10px 12px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px', borderRadius: 11, background: 'rgba(17,18,20,.045)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input id="outliner-search" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a structure" style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontSize: 13, minWidth: 0 }} />
          {q ? (
            <button className="kbd" onClick={() => setQ('')} style={{ cursor: 'pointer' }}>esc</button>
          ) : (
            <span className="kbd">/</span>
          )}
        </div>
      </div>
      <div className="scroll" style={{ flex: 1, padding: '0 6px 10px' }}>
        {groups.map((g) => {
          const sysOn = !hiddenSystems.includes(g.key)
          const isOpen = q ? true : open[g.key] ?? false
          return (
            <div key={g.key} style={{ marginBottom: 2 }}>
              <div className="row-hover" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 6px 0 8px' }}>
                <button onClick={() => setOpen({ ...open, [g.key]: !isOpen })} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, height: '100%', textAlign: 'left' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="3" strokeLinecap="round" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s var(--ease)' }}><path d="M9 6l6 6-6 6" /></svg>
                  <span className="dot" style={{ background: g.items[0].color, opacity: sysOn ? 1 : 0.3 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: sysOn ? 'var(--ink)' : 'var(--ink-3)' }}>{g.label}</span>
                  <span className="mono muted" style={{ fontSize: 11 }}>{g.items.length}</span>
                </button>
                <button className="ibtn" style={{ width: 28, height: 28, borderRadius: 8, color: sysOn ? 'var(--ink-2)' : 'var(--ink-3)' }} onClick={() => useStore.getState().toggleSystem(g.key)} aria-label={`${sysOn ? 'Hide' : 'Show'} ${g.label}`}>
                  <Eye on={sysOn} />
                </button>
              </div>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }} style={{ overflow: 'hidden' }}>
                    {g.items.map((o) => {
                      const on = sysOn && !hiddenIds.includes(o.id)
                      const sel = selected.includes(o.id)
                      const hov = hovered === o.id
                      return (
                        <div
                          key={o.id}
                          className="row-hover"
                          onMouseEnter={() => useStore.setState({ hovered: o.id })}
                          onMouseLeave={() => useStore.getState().hovered === o.id && useStore.setState({ hovered: undefined })}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 6px 0 34px', background: sel ? 'var(--accent-soft)' : hov ? 'rgba(17,18,20,.045)' : undefined }}
                        >
                          <button onClick={(e) => select(o, e.shiftKey || e.metaKey)} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, height: '100%', textAlign: 'left' }}>
                            <span className="dot" style={{ background: o.color, width: 7, height: 7, opacity: on ? 1 : 0.3, boxShadow: o.finding ? '0 0 0 3px rgba(255,59,48,.2)' : undefined }} />
                            <span style={{ fontSize: 12.5, color: on ? (sel ? 'var(--accent)' : 'var(--ink)') : 'var(--ink-3)', fontWeight: sel ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{o.label}</span>
                            <span className="mono muted" style={{ fontSize: 10.5 }}>{fmtVol(o.volume_ml)}</span>
                          </button>
                          <button className="ibtn" style={{ width: 24, height: 24, borderRadius: 7, opacity: hov || !on ? 1 : 0, color: 'var(--ink-3)' }} onClick={() => useStore.getState().toggleOrgan(o.id)} aria-label={`${on ? 'Hide' : 'Show'} ${o.label}`}>
                            <Eye on={on} />
                          </button>
                        </div>
                      )
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
        {!groups.length && <div className="muted" style={{ fontSize: 12.5, padding: '20px 12px', textAlign: 'center' }}>No structure matches “{q}”.</div>}
      </div>
    </div>
  )
}

export default function Sidebar() {
  const tab = useStore((s) => s.sideTab)
  const stage = useStore((s) => s.stage)
  const events = useStore((s) => s.events)
  const nOrgans = useStore((s) => Object.keys(s.organs).length)
  const [collapsed, setCollapsed] = useState(false)
  const live = stage === 'building'
  const steps = events.filter((e) => e.type === 'tool_call').length

  return (
    <motion.aside
      className="glass"
      initial={{ x: -24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ position: 'absolute', left: 16, top: 72, bottom: collapsed ? 'auto' : 88, width: 300, display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 5, maxWidth: 'calc(100vw - 32px)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 8, borderBottom: collapsed ? 0 : '1px solid var(--line)' }}>
        <div className="seg" style={{ flex: 1 }}>
          <button className={tab === 'structures' ? 'on' : ''} style={{ flex: 1 }} onClick={() => { useStore.setState({ sideTab: 'structures' }); setCollapsed(false) }} disabled={!nOrgans}>
            Structures <span className="mono muted" style={{ fontSize: 11, marginLeft: 4 }}>{nOrgans || ''}</span>
          </button>
          <button className={tab === 'process' ? 'on' : ''} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => { useStore.setState({ sideTab: 'process' }); setCollapsed(false) }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: live ? 'var(--accent)' : 'var(--ok)', animation: live ? 'pulse-ring 1.4s infinite' : 'none' }} />
            {live ? <span className="shimmer">Opus working</span> : <>Process <span className="mono muted" style={{ fontSize: 11 }}>{steps}</span></>}
          </button>
        </div>
        <button className="ibtn" style={{ width: 30, height: 30, borderRadius: 9 }} onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .25s var(--ease)' }}><path d="M18 15l-6-6-6 6" /></svg>
        </button>
      </div>
      {!collapsed &&
        (tab === 'structures' && nOrgans ? (
          <Structures />
        ) : (
          <div className="scroll" style={{ padding: 16, flex: 1 }}>
            <Feed events={events} live={live} />
          </div>
        ))}
    </motion.aside>
  )
}
