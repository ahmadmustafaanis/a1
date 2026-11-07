import { useEffect, useState } from 'react'

/** Read text aloud with the browser's built-in voice (patients asked for audio explanations). */
let current: string | null = null
const listeners = new Set<(id: string | null) => void>()

function pickVoice(): SpeechSynthesisVoice | undefined {
  const vs = window.speechSynthesis?.getVoices() ?? []
  return vs.find((v) => /Samantha|Ava|Google US English|Jenny|Aria/i.test(v.name) && v.lang.startsWith('en')) ?? vs.find((v) => v.lang.startsWith('en'))
}

export function speak(id: string, text: string) {
  const ss = window.speechSynthesis
  if (!ss) return
  ss.cancel()
  if (current === id) {
    current = null
    listeners.forEach((l) => l(null))
    return
  }
  const u = new SpeechSynthesisUtterance(text.replace(/\*\*/g, ''))
  const v = pickVoice()
  if (v) u.voice = v
  u.rate = 0.98
  u.onend = u.onerror = () => {
    if (current === id) {
      current = null
      listeners.forEach((l) => l(null))
    }
  }
  current = id
  listeners.forEach((l) => l(id))
  ss.speak(u)
}

export function useSpeaking(id: string) {
  const [on, setOn] = useState(current === id)
  useEffect(() => {
    const l = (c: string | null) => setOn(c === id)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [id])
  return on
}

export function ListenButton({ id, text, label = 'Listen' }: { id: string; text: string; label?: string }) {
  const on = useSpeaking(id)
  if (typeof window === 'undefined' || !window.speechSynthesis || !text) return null
  return (
    <button className="btn btn-soft no-print" style={{ height: 28, fontSize: 12, padding: '0 10px', gap: 6 }} onClick={() => speak(id, text)} aria-pressed={on}>
      {on ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
      )}
      {on ? 'Stop' : label}
    </button>
  )
}
