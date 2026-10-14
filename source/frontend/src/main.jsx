import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ToastProvider } from './lib/ToastContext.jsx'
import { applyEffects, isPS5, loadReducedEffects } from './lib/effects.js'
import { I18nProvider, applyLocaleToDocument, loadSavedLocale, preloadSavedLocale } from './lib/i18n.jsx'

// Apply the saved theme before first paint — otherwise it only kicks in
// once Settings mounts, flashing default Dark Blue first.
const savedTheme = window.localStorage.getItem('pmgr_theme')
if (savedTheme === 'light') {
  document.documentElement.dataset.pmgrTheme = savedTheme
} else if (savedTheme && savedTheme !== 'dark') {
  window.localStorage.setItem('pmgr_theme', 'dark')
}

// Same idea for Visual Effects (Full/Reduced) — apply before first paint so
// a Reduced preference never flashes full motion first.
document.documentElement.classList.toggle('pmgr-ps5', isPS5())
applyEffects(loadReducedEffects())

// And for language/direction — set lang/dir before React ever renders, so
// there's no English -> saved-language flash and no LTR -> RTL layout jump.
applyLocaleToDocument(loadSavedLocale())

// Non-English locales are code-split — fetch the saved one before mounting.
// IIFE, not top-level await: the PS5's WebKit build can't parse that.
;(async () => {
  await preloadSavedLocale()

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <I18nProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </I18nProvider>
    </StrictMode>,
  )
})()
