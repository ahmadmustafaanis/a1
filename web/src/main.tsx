import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-mono/400.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Dev-only automation hook (used to record demo footage); stripped from production builds.
if (import.meta.env.DEV) {
  Promise.all([import('./store'), import('./api'), import('./components/Xray')]).then(([s, a, x]) => {
    ;(window as any).__lumen = { useStore: s.useStore, startScan: a.startScan, startWsp: a.startWsp, openReport: a.openReport, openXray: x.openXray }
  })
}
