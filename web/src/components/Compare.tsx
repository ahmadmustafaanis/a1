import { motion } from 'framer-motion'
import { useStore } from '../store'

type Row = { label: string; hint?: string; before: string; after: string; better: boolean | null }

/** Plain-language "Original vs Opus-edited" comparison, measured on held-out cases. */
export default function Compare({ compact = false }: { compact?: boolean }) {
  const report = useStore((s) => s.wspReport)
  const patient = useStore((s) => s.wspPatient)
  const explain = useStore((s) => s.explain)
  const events = useStore((s) => s.wspEvents)
  if (!report) return null
  const b = report.test_before
  const a = report.test_after
  const secs = Math.round(events.length ? events[events.length - 1].t : 0)

  const rows: Row[] = []
  for (const p of patient) {
    rows.push({
      label: 'Your liver spot',
      hint: 'lesion probability for the spot Opus flagged in your scan',
      before: `${p.before >= 0.5 ? 'Detected' : 'Missed'} · ${Math.round(p.before * 100)}%`,
      after: `${p.after >= 0.5 ? 'Detected' : 'Missed'} · ${Math.round(p.after * 100)}%`,
      better: p.after >= 0.5 && p.before < 0.5 ? true : p.after > p.before ? true : null,
    })
  }
  const cc = explain?.cases?.find((c: any) => c.kind === 'closest_call')
  if (cc?.edited) {
    rows.push({
      label: 'Closest call in your scan',
      hint: 'the most lesion-like spot that was not reported',
      before: `${Math.round(cc.base.score * 100)}%`,
      after: `${Math.round(cc.edited.score * 100)}%`,
      better: cc.edited.score < 0.5 ? null : false,
    })
  }
  rows.push({
    label: 'Small lesions caught',
    hint: 'lesions under 12 mm, the original model’s blind spot',
    before: `${Math.round(b.recall_small * 10)} in 10`,
    after: `${Math.round(a.recall_small * 10)} in 10`,
    better: a.recall_small > b.recall_small,
  })
  if (!compact) {
    rows.push({
      label: 'False alarms',
      hint: 'per 1,000 harmless spots (vessels, noise)',
      before: `${Math.round(b.false_positive_rate * 1000)} / 1,000`,
      after: `${Math.round(a.false_positive_rate * 1000)} / 1,000`,
      better: a.false_positive_rate <= b.false_positive_rate ? null : false,
    })
    rows.push({
      label: 'Large lesions caught',
      before: `${Math.round(b.recall_large * 100)}%`,
      after: `${Math.round(a.recall_large * 100)}%`,
      better: a.recall_large >= b.recall_large ? null : false,
    })
  }

  const tone = (x: boolean | null) => (x === true ? 'var(--ok)' : x === false ? '#b7791f' : 'var(--ink)')

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ borderRadius: 18, border: '1px solid var(--line)', background: 'rgba(255,255,255,.85)', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 86px 92px' : '1fr 104px 124px', alignItems: 'center', padding: '10px 14px', background: 'rgba(17,18,20,.03)', borderBottom: '1px solid var(--line)', gap: 8 }}>
        <div className="eyebrow">{compact ? 'Model comparison' : 'What changed'}</div>
        <span className="chip" style={{ justifyContent: 'center', height: 24, fontSize: 11 }}>Original</span>
        <span className="chip" style={{ justifyContent: 'center', height: 24, fontSize: 11, background: 'var(--accent)', color: '#fff' }}>Opus-edited</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 86px 92px' : '1fr 104px 124px', alignItems: 'center', padding: '9px 14px', gap: 8, borderBottom: '1px solid var(--line)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{r.label}</div>
            {r.hint && !compact && <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.35 }}>{r.hint}</div>}
          </div>
          <div className="mono" style={{ fontSize: compact ? 11.5 : 12.5, textAlign: 'center', color: 'var(--ink-3)' }}>{r.before}</div>
          <div className="mono" style={{ fontSize: compact ? 11.5 : 12.5, textAlign: 'center', fontWeight: 600, color: tone(r.better), whiteSpace: 'nowrap' }}>
            {r.after}
            {r.better === true && ' ↑'}
            {r.better === false && ' !'}
          </div>
        </div>
      ))}
      <div style={{ padding: '10px 14px', fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)' }}>
        Opus edited <b style={{ fontWeight: 600 }}>{report.weights_changed} of {report.n_params}</b> weights ({report.pct_changed}%){secs ? ` in ${secs} s` : ''}. No retraining and no new data. Scores are from{' '}
        {b.n.toLocaleString()} test cases Opus never saw.
        {rows.some((r) => r.better === false) && <span style={{ color: '#b7791f' }}> “!” marks a trade-off worth knowing about.</span>}
      </div>
    </motion.div>
  )
}
