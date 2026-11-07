import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { startReport } from '../api'
import OrganViewer from './OrganViewer'
import { ListenButton } from '../speak'
import { requireAuth, saveReport } from '../auth'
import { useStore, type Organ } from '../store'
import Compare from './Compare'
import { Feed } from './Timeline'
import { AttributionBars, Circuit } from './Xray'

const STAGES = [
  { key: 'shots', label: 'Photographing the 3D scan' },
  { key: 'weights', label: 'Custom diagnosis weights' },
  { key: 'explain', label: 'Tracing the model’s reasoning' },
  { key: 'write', label: 'Opus writing the report' },
]
const STATUS = {
  typical: { label: 'Typical', bg: 'rgba(24,160,88,.1)', fg: '#127a43' },
  attention: { label: 'Worth a look', bg: 'rgba(234,150,20,.14)', fg: '#9a5b00' },
  incomplete: { label: 'Partly in view', bg: 'rgba(17,18,20,.06)', fg: 'var(--ink-2)' },
} as const
const URGENCY = { routine: 'Routine', soon: 'Soon', discuss: 'Discuss' } as const

function Progress() {
  const events = useStore((s) => s.reportEvents)
  const shots = useStore((s) => s.reportShots)
  const status = (k: string) => {
    if (k === 'shots') return shots ? 'done' : 'running'
    const last = [...events].reverse().find((e) => e.type === 'report_stage' && e.stage === k)
    return last?.status ?? 'pending'
  }
  const text = (k: string) => [...events].reverse().find((e) => e.type === 'report_stage' && e.stage === k)?.text
  const feed = events.filter((e) => ['say', 'thinking', 'tool_call', 'tool_result', 'wsp_edit', 'wsp_revert', 'wsp_done', 'error'].includes(e.type))
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <div className="eyebrow">Generating report</div>
        <h2 style={{ fontSize: 32, letterSpacing: '-0.035em', fontWeight: 600, margin: '6px 0 0' }}>Putting your report together.</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {STAGES.map((s) => {
          const st = status(s.key)
          return (
            <div key={s.key} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 14, background: '#fff', border: '1px solid var(--line)' }}>
              {st === 'done' || st === 'skipped' ? (
                <span style={{ width: 20, height: 20, borderRadius: 99, background: 'rgba(24,160,88,.12)', color: 'var(--ok)', display: 'grid', placeItems: 'center' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M5 12l5 5 9-10" /></svg>
                </span>
              ) : st === 'running' ? (
                <span style={{ width: 20, height: 20, borderRadius: 99, border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin .8s linear infinite' }} />
              ) : (
                <span style={{ width: 20, height: 20, borderRadius: 99, border: '2px solid var(--line)' }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{s.label}</div>
                {text(s.key) && <div className="muted" style={{ fontSize: 12.5 }}>{text(s.key)}</div>}
              </div>
            </div>
          )
        })}
      </div>
      {feed.length > 0 && (
        <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,.7)', border: '1px solid var(--line)', maxHeight: 360, overflow: 'auto' }} className="scroll">
          <Feed events={feed} live />
        </div>
      )}
    </div>
  )
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section style={{ breakInside: 'avoid-page', padding: '28px 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <span className="mono muted" style={{ fontSize: 12 }}>{String(n).padStart(2, '0')}</span>
        <h3 style={{ margin: 0, fontSize: 21, letterSpacing: '-0.025em', fontWeight: 600 }}>{title}</h3>
      </div>
      {children}
    </section>
  )
}

function Figure({ shot, big }: { shot: { title: string; caption: string; url: string }; big?: boolean }) {
  return (
    <figure style={{ margin: 0, breakInside: 'avoid' }}>
      <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--line)', background: 'radial-gradient(800px 500px at 50% 40%, #fff, #f1f0ec)' }}>
        <img src={shot.url} alt={shot.title} style={{ width: '100%', display: 'block', aspectRatio: big ? '16 / 9' : '4 / 3', objectFit: 'cover' }} />
      </div>
      <figcaption style={{ fontSize: 12, marginTop: 6, color: 'var(--ink-2)' }}>
        <b style={{ fontWeight: 600, color: 'var(--ink)' }}>{shot.title}.</b> {shot.caption}
      </figcaption>
    </figure>
  )
}

function Doc() {
  const rep = useStore((s) => s.report)
  const shots = useStore((s) => s.reportShots) ?? []
  const ex = useStore((s) => s.explain)
  const organs = useStore((s) => s.organs)
  // open the first organ that deserves a look, so the 3D is discoverable
  const [open, setOpen] = useState<string | null>(() => (useStore.getState().report?.opus?.organs ?? []).find((r: any) => r.status === 'attention')?.name ?? null)
  if (!rep) return null
  const o = rep.opus ?? {}
  const shot = (k: string) => shots.find((s) => s.key === k)
  const findingShots = shots.filter((s) => s.key.startsWith('finding-'))
  const date = new Date((rep.created ?? Date.now() / 1000) * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const c = ex?.cases?.[0]
  const all = Object.values(organs)
  // map a report row to the 3D structures it refers to (grouped rows cover a whole system; the liver brings its findings)
  const structuresFor = (name: string): Organ[] => {
    const n = name.toLowerCase()
    if (/skelet|bone/.test(n)) return all.filter((x) => x.system === 'skeletal')
    if (/muscle/.test(n)) return all.filter((x) => x.system === 'muscular')
    const exact = all.filter((x) => x.name === name)
    const hit = exact.length ? exact : all.filter((x) => x.label.toLowerCase() === n || x.name.includes(n.replace(/ /g, '_')))
    const withFindings = hit.some((x) => x.name === 'liver') ? [...hit, ...all.filter((x) => x.finding)] : hit
    return withFindings
  }
  const showInScene = (items: Organ[]) => {
    useStore.setState({ reportOpen: false, selected: items.map((x) => x.id), isolate: false, hiddenSystems: items.some((x) => x.system === 'muscular') ? [] : ['muscular'] })
  }
  const labelOf = (name: string) => rep.organs?.[name]?.label ?? Object.values(organs).find((x) => x.name === name)?.label ?? name.replace(/_/g, ' ')

  return (
    <article className="report-doc" style={{ maxWidth: 920, margin: '0 auto', padding: '36px 40px 60px', background: '#fff', borderRadius: 28, boxShadow: '0 30px 80px -30px rgba(17,18,20,.25)' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 16, paddingBottom: 22 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, letterSpacing: '-0.03em' }}>
            <svg width="20" height="20" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="var(--accent)" /><circle cx="16" cy="16" r="6" fill="#fff" /></svg>
            lumen <span className="muted" style={{ fontWeight: 400 }}>· CT report</span>
          </div>
          <h1 style={{ margin: '18px 0 6px', fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.045em', fontWeight: 600 }}>Your scan, explained.</h1>
          <div className="muted" style={{ fontSize: 13.5 }}>
            {rep.title} · {rep.nOrgans} structures · {rep.findings?.length ? `${rep.findings.length} finding${rep.findings.length > 1 ? 's' : ''}` : 'no findings flagged'} · {date}
          </div>
        </div>
        <div style={{ padding: '8px 12px', borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 11.5, maxWidth: 220, lineHeight: 1.4 }}>
          Educational report generated by AI. Not a diagnosis. Review it with your doctor.
        </div>
      </header>

      {shot('overview') && <Figure shot={shot('overview')!} big />}

      <Section n={1} title="Impression">
        <div style={{ marginTop: -6, marginBottom: 10 }}><ListenButton id="report-impression" text={[o.impression, ...(o.key_points ?? [])].join(' ')} label="Listen to summary" /></div>
        <p style={{ fontSize: 17, lineHeight: 1.6, margin: 0, letterSpacing: '-0.01em' }}>{o.impression}</p>
        {o.key_points?.length > 0 && (
          <ul style={{ margin: '14px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            {o.key_points.map((k: string, i: number) => <li key={i}>{k}</li>)}
          </ul>
        )}
      </Section>

      <Section n={2} title={rep.findings?.length ? 'Findings' : 'Findings: none flagged'}>
        {rep.findings?.length ? (
          rep.findings.map((f: any) => {
            const fo = (o.findings ?? []).find((x: any) => x.name === f.name) ?? (o.findings ?? [])[0]
            const fs = findingShots.find((s) => s.key === `finding-${f.id}`)
            return (
              <div key={f.id} style={{ display: 'grid', gridTemplateColumns: fs ? 'minmax(0,1fr) minmax(0,1.1fr)' : '1fr', gap: 22, alignItems: 'start' }}>
                {fs && <Figure shot={fs} />}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{f.title}</div>
                  <div className="mono muted" style={{ fontSize: 12 }}>≈{f.diameter_mm} mm · {f.organ}</div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)' }}>{fo?.interpretation ?? f.detail}</p>
                  {fo?.possibilities?.length > 0 && (
                    <div>
                      <div className="eyebrow" style={{ marginBottom: 6 }}>Possible explanations</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{fo.possibilities.map((p: string) => <span key={p} className="chip">{p}</span>)}</div>
                    </div>
                  )}
                  {fo?.certainty && <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Certainty: {fo.certainty}</div>}
                </div>
              </div>
            )
          })
        ) : (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)' }}>
            Opus screened the liver and did not report any focal finding.{c?.kind === 'closest_call' && c.info ? ` The most lesion-like spot (≈${c.info.diameter_mm} mm, one of ${c.info.candidates_checked} checked) is analysed in section 4.` : ''}
          </p>
        )}
      </Section>

      <Section n={3} title="Organ by organ">
        <div style={{ display: 'grid', gridTemplateColumns: shot('organs') ? 'minmax(0,1fr) minmax(0,1fr)' : '1fr', gap: 22, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {shot('organs') && <Figure shot={shot('organs')!} />}
            {shot('side') && <Figure shot={shot('side')!} />}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {(o.organs ?? []).map((r: any) => {
              const stt = STATUS[(r.status as keyof typeof STATUS) ?? 'typical'] ?? STATUS.typical
              const vol = rep.organs?.[r.name]?.volume_ml
              const items = structuresFor(r.name)
              const isOpen = open === r.name && items.length > 0
              return (
                <div key={r.name} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', breakInside: 'avoid' }}>
                  <div
                    role="button"
                    onClick={() => items.length && setOpen(isOpen ? null : r.name)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: items.length ? 'pointer' : 'default' }}
                  >
                    {items.length > 0 && (
                      <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', background: isOpen ? 'var(--accent)' : 'rgba(17,18,20,.05)', color: isOpen ? '#fff' : 'var(--ink-2)', flex: 'none', transition: 'all .2s' }} title="Show in 3D">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M12 22V12M21 7l-9 5-9-5" /></svg>
                      </span>
                    )}
                    <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{labelOf(r.name)}</span>
                    {vol !== undefined && <span className="mono muted" style={{ fontSize: 11.5 }}>{vol >= 1000 ? `${(vol / 1000).toFixed(2)} L` : vol >= 10 ? `${Math.round(vol)} mL` : `${vol.toFixed(1)} mL`}</span>}
                    <span className="chip" style={{ height: 22, fontSize: 11, background: stt.bg, color: stt.fg }}>{stt.label}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)', marginTop: 3, paddingLeft: items.length ? 34 : 0 }}>{r.note}</div>
                  {isOpen && (
                    <div style={{ marginTop: 10, paddingLeft: 34 }}>
                      <OrganViewer organs={items} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <span className="muted" style={{ fontSize: 11.5, flex: 1 }}>
                          {items.length > 1 ? `${items.length} structures in their true positions` : 'Your model, from this scan'}
                          {items.some((x) => x.finding) ? ' · the red spot is the finding' : ''}
                        </span>
                        <button className="btn btn-soft no-print" style={{ height: 28, fontSize: 12 }} onClick={() => showInScene(items)}>Open in full 3D scene →</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      <Section n={4} title="How the AI reasoned">
        <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)' }}>{o.ai_reasoning}</p>
        {ex && c && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 22, alignItems: 'start' }}>
            <div style={{ breakInside: 'avoid' }}>
              <Circuit ex={ex} d={c.edited ?? c.base} showEdits={!!c.edited} />
              <div className="muted" style={{ fontSize: 11.5 }}>
                Signal through the {c.edited ? 'Opus-edited' : 'original'} model for the {c.kind === 'closest_call' ? 'closest call' : 'finding'}. Coral pushes toward “lesion”, blue pushes away, and dashed lines are connections Opus rewrote.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>What drove the decision</div>
                <AttributionBars ex={ex} max={6} />
              </div>
              {ex.opus?.report_sentence && (
                <div style={{ padding: 12, borderRadius: 14, background: 'rgba(17,18,20,.04)', fontSize: 13, lineHeight: 1.5 }}>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Report sentence</div>
                  {ex.opus.report_sentence}
                </div>
              )}
            </div>
          </div>
        )}
        {rep.wsp && (
          <div style={{ marginTop: 18, breakInside: 'avoid' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Custom weights: original vs Opus-edited model</div>
            <Compare />
          </div>
        )}
      </Section>

      <Section n={5} title="Suggestions">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
          {(o.suggestions ?? []).map((s: any, i: number) => (
            <div key={i} style={{ padding: 14, borderRadius: 16, border: '1px solid var(--line)', background: 'rgba(255,255,255,.9)', breakInside: 'avoid' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{s.title}</span>
                <span className="chip" style={{ height: 22, fontSize: 11, background: s.urgency === 'soon' ? 'rgba(234,150,20,.14)' : 'var(--accent-soft)', color: s.urgency === 'soon' ? '#9a5b00' : 'var(--accent)' }}>
                  {URGENCY[s.urgency as keyof typeof URGENCY] ?? s.urgency}
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>{s.detail}</div>
            </div>
          ))}
        </div>
        {o.questions_for_doctor?.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Questions to ask your doctor</div>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.5 }}>
              {o.questions_for_doctor.map((q: string, i: number) => <li key={i}>{q}</li>)}
            </ol>
          </div>
        )}
      </Section>

      <Section n={6} title="Limitations">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>
          {(o.limitations ?? []).map((l: string, i: number) => <li key={i}>{l}</li>)}
          {rep.demoNote && <li>{rep.demoNote}</li>}
        </ul>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 16, lineHeight: 1.5 }}>
          Generated by Lumen with Claude Opus 5.5. Segmentation: TotalSegmentator, refined and checked by Opus. Lesion screening: lesion_net, with custom weights edited by Opus through weight-space programming. This is not a medical device.
        </p>
      </Section>
    </article>
  )
}

export default function ReportPanel() {
  const open = useStore((s) => s.reportOpen)
  const rep = useStore((s) => s.report)
  const busy = useStore((s) => s.reportBusy)
  const events = useStore((s) => s.reportEvents)
  const err = events.find((e) => e.type === 'error')
  const savedId = useStore((s) => s.savedId)
  const saving = useStore((s) => s.saving)
  const ready = !!rep && !busy
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="report-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(240,239,234,.86)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', display: 'flex', flexDirection: 'column' }}>
          <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
          <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px' }}>
            <div style={{ fontWeight: 600, letterSpacing: '-0.02em', flex: 1 }}>Report</div>
            {ready && (
              <>
                <button className="btn btn-soft" onClick={() => { useStore.setState({ savedId: undefined }); startReport() }} data-tip="Write a fresh report (keeps the custom weights)" data-tip-pos="bottom">Regenerate</button>
                <button className="btn btn-soft" disabled={saving || !!savedId} onClick={() => requireAuth(() => saveReport())} style={{ color: savedId ? 'var(--ok)' : undefined }}>
                  {savedId ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M5 12l5 5 9-10" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
                  )}
                  {saving ? 'Saving…' : savedId ? 'Saved' : 'Save'}
                </button>
                <button className="btn btn-primary" onClick={() => window.print()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z" /></svg>
                  Print / Save PDF
                </button>
              </>
            )}
            <button className="btn btn-ghost" style={{ height: 34, width: 34, padding: 0, justifyContent: 'center' }} onClick={() => useStore.setState({ reportOpen: false })} aria-label="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="scroll report-scroll" style={{ flex: 1, padding: '0 16px 32px' }}>
            {err && !rep && <div style={{ maxWidth: 720, margin: '40px auto', padding: 18, borderRadius: 16, background: 'var(--danger-soft)', color: '#b3261e' }}>{err.text}</div>}
            {ready ? <Doc /> : !err && <Progress />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
