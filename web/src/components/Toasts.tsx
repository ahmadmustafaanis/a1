import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'

export default function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div style={{ position: 'absolute', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 70, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none' }} aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: -12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ type: 'spring', damping: 26, stiffness: 340 }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 10px 12px', borderRadius: 14, background: 'rgba(17,18,20,.92)', color: '#fff', boxShadow: '0 12px 32px -10px rgba(0,0,0,.35)', backdropFilter: 'blur(12px)' }}>
            <span style={{ width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center', background: t.kind === 'warn' ? '#f59e0b' : t.kind === 'info' ? 'var(--accent)' : 'var(--ok)' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"><path d="M5 12l5 5 9-10" /></svg>
            </span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{t.text}</div>
              {t.sub && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.65)', marginTop: 1 }}>{t.sub}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
