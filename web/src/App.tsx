import { AnimatePresence, motion } from 'framer-motion'
import { useEffect } from 'react'
import { openReport } from './api'
import { restoreSession } from './auth'
import { AuthModal, Library, UserMenu } from './components/Account'
import Inspector from './components/Inspector'
import Landing from './components/Landing'
import Palette from './components/Palette'
import ReportPanel from './components/Report'
import Scene from './components/Scene'
import Sidebar from './components/Sidebar'
import Toasts from './components/Toasts'
import Toolbar from './components/Toolbar'
import WspPanel from './components/WspPanel'
import XrayPanel from './components/Xray'
import { ListenButton } from './speak'
import { useStore } from './store'

function TopBar() {
  const stage = useStore((s) => s.stage)
  const title = useStore((s) => s.title)
  const note = useStore((s) => s.demoNote)
  const n = useStore((s) => Object.keys(s.organs).length)
  const nf = useStore((s) => s.findings.length)
  return (
    <div style={{ position: 'absolute', left: 16, right: 16, top: 16, height: 40, display: 'flex', alignItems: 'center', gap: 10, zIndex: 8, pointerEvents: 'none' }}>
      <button
        onClick={() => useStore.setState({ stage: 'landing', organs: {}, events: [], selected: [], wspOpen: false, reportOpen: false, xrayOpen: false })}
        style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 17, letterSpacing: '-0.035em', height: 40, padding: '0 6px' }}
        aria-label="Lumen home"
      >
        <svg width="22" height="22" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="var(--accent)" /><circle cx="16" cy="16" r="6" fill="var(--bg)" /></svg>
        lumen
      </button>
      {stage !== 'landing' && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minWidth: 0 }}>
          <span style={{ color: 'var(--ink-3)' }}>/</span>
          <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{title}</span>
          {n > 0 && <span className="chip mono" style={{ height: 22, fontSize: 11 }}>{n} structures</span>}
          {nf > 0 && <span className="chip" style={{ height: 22, fontSize: 11, background: 'var(--danger-soft)', color: '#b3261e' }}><span className="dot" style={{ background: 'var(--danger)', width: 6, height: 6 }} />{nf} finding</span>}
          {note && <span className="chip" data-tip={note.length > 70 ? note.slice(0, 68) + '…' : note} data-tip-pos="bottom" style={{ height: 22, fontSize: 11, background: 'var(--accent-soft)', color: 'var(--accent)' }}>Demo case</span>}
        </motion.div>
      )}
      <div style={{ flex: 1 }} />
      {stage === 'ready' && <ReportButton />}
      <UserMenu />
    </div>
  )
}

function ReportButton() {
  const has = useStore((s) => !!s.report)
  return (
    <button className="btn btn-primary" style={{ pointerEvents: 'auto', borderRadius: 12 }} onClick={() => openReport()} data-tip={has ? 'Open the full report' : 'Creates custom weights first if needed'} data-tip-pos="bottom">
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
        <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }} className="glass" style={{ position: 'absolute', right: 16, top: 72, width: 340, maxWidth: 'calc(100vw - 32px)', padding: 18, zIndex: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="eyebrow" style={{ flex: 1 }}>Opus’s read of your scan</div>
            <ListenButton id="summary" text={summary} />
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)' }}>{summary}</p>
          <div className="muted" style={{ fontSize: 12, marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            Click any structure, or press <span className="kbd">⌘</span><span className="kbd">K</span> to jump to one.
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Keyboard-first: ⌘K palette, / find, R reassemble, E explode, I isolate, Esc steps back out of whatever is open. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (s.stage !== 'landing') useStore.setState({ paletteOpen: !s.paletteOpen })
        return
      }
      if (e.key === 'Escape') {
        if (s.paletteOpen) return useStore.setState({ paletteOpen: false })
        if (s.authOpen) return useStore.setState({ authOpen: false, afterAuth: undefined })
        if (s.libraryOpen) return useStore.setState({ libraryOpen: false })
        if (typing) return (e.target as HTMLElement).blur()
        if (s.reportOpen) return useStore.setState({ reportOpen: false })
        if (s.xrayOpen) return useStore.setState({ xrayOpen: false })
        if (s.wspOpen) return useStore.setState({ wspOpen: false })
        if (s.isolate) return useStore.setState({ isolate: false, spin: false })
        if (s.selected.length) return s.clearSelection()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || s.stage === 'landing' || s.paletteOpen || s.authOpen || s.libraryOpen || s.reportOpen || s.xrayOpen || s.wspOpen) return
      const k = e.key.toLowerCase()
      if (k === '/') {
        e.preventDefault()
        useStore.setState({ sideTab: 'structures' })
        setTimeout(() => document.getElementById('outliner-search')?.focus(), 30)
      } else if (k === 'r') s.reassemble()
      else if (k === 'e') useStore.setState({ explode: s.explode > 0.05 ? 0 : 0.6 })
      else if (k === 'i' && s.selected.length) useStore.setState({ isolate: !s.isolate, spin: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  const stage = useStore((s) => s.stage)
  useShortcuts()
  useEffect(() => {
    restoreSession()
  }, [])
  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {stage !== 'landing' && <Scene />}
      <TopBar />
      {stage === 'landing' ? (
        <Landing />
      ) : (
        <>
          <Sidebar />
          <Summary />
          <Inspector />
          <Toolbar />
          <WspPanel />
          <XrayPanel />
        </>
      )}
      <ReportPanel />
      <Library />
      <Palette />
      <AuthModal />
      <Toasts />
    </div>
  )
}
