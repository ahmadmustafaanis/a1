import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { deleteReport, listReports, openSaved, requireAuth, signIn, signOut, type SavedMeta } from '../auth'
import { useStore } from '../store'

const spring = { type: 'spring', damping: 28, stiffness: 320 } as const

function Field(props: { label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; autoFocus?: boolean; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>{props.label}</span>
      <input
        type={props.type ?? 'text'} value={props.value} onChange={(e) => props.onChange(e.target.value)} autoComplete={props.autoComplete} autoFocus={props.autoFocus}
        style={{ height: 42, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line)', background: '#fff', fontSize: 14, outline: 'none', transition: 'border-color .15s, box-shadow .15s' }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 4px rgba(47,91,255,.12)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.boxShadow = 'none' }}
      />
      {props.hint && <span className="muted" style={{ fontSize: 11.5 }}>{props.hint}</span>}
    </label>
  )
}

export function AuthModal() {
  const mode = useStore((s) => s.authOpen)
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [name, setN] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setErr(null); setP('') }, [mode])
  const close = () => useStore.setState({ authOpen: false, afterAuth: undefined })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mode || busy) return
    setBusy(true)
    setErr(await signIn(mode, username, password, name))
    setBusy(false)
  }
  return (
    <AnimatePresence>
      {mode && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={close}
          style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'rgba(240,239,234,.55)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <motion.form onSubmit={submit} onMouseDown={(e) => e.stopPropagation()} initial={{ y: 16, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 10, opacity: 0 }} transition={spring}
            className="glass" style={{ width: 'min(400px, 100%)', padding: 28, background: 'rgba(255,255,255,.95)', borderRadius: 26, display: 'flex', flexDirection: 'column', gap: 16 }} role="dialog" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="26" height="26" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="var(--accent)" /><circle cx="16" cy="16" r="6" fill="#fff" /></svg>
              <div style={{ flex: 1 }} />
              <button type="button" className="ibtn" onClick={close} aria-label="Close" style={{ width: 30, height: 30 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 24, letterSpacing: '-0.03em', fontWeight: 600 }}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.5 }}>Your account and saved reports stay on this computer.</p>
            </div>
            <div className="seg" style={{ alignSelf: 'stretch' }}>
              <button type="button" className={mode === 'login' ? 'on' : ''} style={{ flex: 1 }} onClick={() => useStore.setState({ authOpen: 'login' })}>Sign in</button>
              <button type="button" className={mode === 'register' ? 'on' : ''} style={{ flex: 1 }} onClick={() => useStore.setState({ authOpen: 'register' })}>Create account</button>
            </div>
            {mode === 'register' && <Field label="Your name" value={name} onChange={setN} autoComplete="name" />}
            <Field label="Username" value={username} onChange={setU} autoComplete="username" autoFocus />
            <Field label="Password" type="password" value={password} onChange={setP} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} hint={mode === 'register' ? 'At least 8 characters.' : undefined} />
            <AnimatePresence>
              {err && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ fontSize: 13, color: '#b3261e', background: 'var(--danger-soft)', padding: '8px 12px', borderRadius: 10 }}>{err}</motion.div>}
            </AnimatePresence>
            <button className="btn btn-primary" disabled={busy || !username || !password} style={{ height: 44, justifyContent: 'center', borderRadius: 13, opacity: busy || !username || !password ? 0.6 : 1 }}>
              {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function UserMenu() {
  const user = useStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [])
  if (!user) {
    return (
      <button className="btn btn-soft" style={{ pointerEvents: 'auto', borderRadius: 12 }} onClick={() => useStore.setState({ authOpen: 'login' })}>
        Sign in
      </button>
    )
  }
  const initials = user.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div ref={ref} style={{ position: 'relative', pointerEvents: 'auto' }}>
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} style={{ width: 36, height: 36, borderRadius: 99, background: 'linear-gradient(135deg, #2f5bff, #8b5cf6)', color: '#fff', fontSize: 12.5, fontWeight: 600, boxShadow: 'var(--shadow-sm)' }}>
        {initials}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}
            className="glass" style={{ position: 'absolute', right: 0, top: 44, width: 230, padding: 6, background: 'rgba(255,255,255,.96)', borderRadius: 16, zIndex: 40 }}>
            <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{user.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>@{user.username} · local account</div>
            </div>
            <button role="menuitem" className="row-hover" style={{ width: '100%', textAlign: 'left', height: 36, padding: '0 10px', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }} onClick={() => { setOpen(false); useStore.setState({ libraryOpen: true }) }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h6v16H4zM14 4h6v16h-6z" /></svg>
              My reports
            </button>
            <button role="menuitem" className="row-hover" style={{ width: '100%', textAlign: 'left', height: 36, padding: '0 10px', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10, color: '#b3261e' }} onClick={() => { setOpen(false); signOut() }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Library() {
  const open = useStore((s) => s.libraryOpen)
  const user = useStore((s) => s.user)
  const [items, setItems] = useState<SavedMeta[] | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  useEffect(() => {
    if (open && user) { setItems(null); listReports().then(setItems) }
  }, [open, user])
  const close = () => useStore.setState({ libraryOpen: false })
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={close}
          style={{ position: 'absolute', inset: 0, zIndex: 45, background: 'rgba(240,239,234,.6)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <motion.div onMouseDown={(e) => e.stopPropagation()} initial={{ y: 20, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 14, opacity: 0 }} transition={spring}
            className="glass" style={{ width: 'min(980px, 100%)', maxHeight: 'min(760px, 100%)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,.95)', borderRadius: 28, overflow: 'hidden' }} role="dialog" aria-label="My reports">
            <div style={{ display: 'flex', alignItems: 'center', padding: '22px 24px 16px' }}>
              <div style={{ flex: 1 }}>
                <div className="eyebrow">{user?.name}</div>
                <h2 style={{ margin: '4px 0 0', fontSize: 26, letterSpacing: '-0.035em', fontWeight: 600 }}>My reports</h2>
              </div>
              <button className="ibtn" onClick={close} aria-label="Close">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="scroll" style={{ padding: '0 24px 24px', flex: 1 }}>
              {items === null && <div className="shimmer" style={{ padding: 30 }}>Loading your reports…</div>}
              {items?.length === 0 && (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ width: 52, height: 52, borderRadius: 16, margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: '#fff', boxShadow: 'var(--shadow-sm)' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.8" strokeLinecap="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>
                  </div>
                  <div style={{ fontWeight: 600 }}>No saved reports yet</div>
                  <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Generate a report from any scan, then press Save.</div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {items?.map((r) => (
                  <motion.div key={r.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ borderRadius: 20, background: '#fff', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <button onClick={() => openSaved(r.id)} style={{ textAlign: 'left', display: 'block' }} aria-label={`Open ${r.title}`}>
                      <div style={{ aspectRatio: '16 / 9', background: 'radial-gradient(400px 220px at 50% 40%, #fff, #efeee9)', overflow: 'hidden' }}>
                        {r.thumb && <img src={r.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform .4s var(--ease)' }} onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.04)')} onMouseLeave={(e) => (e.currentTarget.style.transform = 'none')} />}
                      </div>
                      <div style={{ padding: '12px 14px 6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 14.5, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                          {r.nFindings > 0 ? (
                            <span className="chip" style={{ height: 22, fontSize: 11, background: 'var(--danger-soft)', color: '#b3261e' }}>{r.nFindings} finding</span>
                          ) : (
                            <span className="chip" style={{ height: 22, fontSize: 11, background: 'rgba(24,160,88,.1)', color: '#127a43' }}>No findings</span>
                          )}
                        </div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {new Date(r.saved * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {r.nOrgans} structures
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45, marginTop: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.impression}</div>
                      </div>
                    </button>
                    <div style={{ display: 'flex', gap: 6, padding: '8px 10px 12px 14px', marginTop: 'auto' }}>
                      <button className="btn btn-primary" style={{ height: 30, fontSize: 12.5, borderRadius: 10 }} onClick={() => openSaved(r.id)}>Open</button>
                      <div style={{ flex: 1 }} />
                      {confirm === r.id ? (
                        <>
                          <button className="btn btn-ghost" style={{ height: 30, fontSize: 12.5 }} onClick={() => setConfirm(null)}>Keep</button>
                          <button className="btn" style={{ height: 30, fontSize: 12.5, background: 'var(--danger)', color: '#fff', borderRadius: 10 }} onClick={async () => { await deleteReport(r.id); setConfirm(null); setItems((x) => x?.filter((y) => y.id !== r.id) ?? null) }}>Delete</button>
                        </>
                      ) : (
                        <button className="ibtn" style={{ width: 30, height: 30, borderRadius: 9 }} onClick={() => setConfirm(r.id)} aria-label={`Delete ${r.title}`} data-tip="Delete">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export { requireAuth }
