import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { resolveKey, resolvePlurals, interpolate } from './i18nFormat.js'

// Lightweight internal i18n — a JSON dictionary per locale plus Intl for plural/date/number
// formatting. Only en-US is a static import (guaranteed fallback); every other locale loads on demand.
import enUS from '../locales/en-US.json'

// Regional-indicator flag emoji need glyphs the PS5's system font doesn't have, so they
// render as tofu/letter boxes instead — SVGs sidestep that entirely.
import flagEnUS from '../assets/flags/en-US.svg'
import flagPtBR from '../assets/flags/pt-BR.svg'
import flagEsAR from '../assets/flags/es-AR.svg'
import hldriveEn from '../locales/hldrive/en-US.json'
import hldrivePt from '../locales/hldrive/pt-BR.json'
import hldriveEs from '../locales/hldrive/es-AR.json'
const hldrive = { 'en-US': hldriveEn, 'pt-BR': hldrivePt, 'es-AR': hldriveEs }

export const LOCALES = [
  { id: 'pt-BR', flag: flagPtBR, name: 'Português (Brasil)' },
  { id: 'en-US', flag: flagEnUS, name: 'English (US)' },
  { id: 'es-AR', flag: flagEsAR, name: 'Español (Argentina)' },
]
const KNOWN_LOCALES = new Set(LOCALES.map((l) => l.id))

// One dynamic import() per locale, written out explicitly (not a templated path) so Vite
// can see every possible target at build time and give each its own small chunk.
const LOCALE_LOADERS = {
  'pt-BR': () => import('../locales/pt-BR.json'),
  'es-AR': () => import('../locales/es-AR.json'),
}

// Module-level, not component state — a dictionary fetched once stays fetched for the tab's
// life, so switching back to an earlier language is instant, no repeat network/parse cost.
const loadedDictionaries = { 'en-US': { ...enUS, hldrive: hldriveEn } }
const pendingLoads = {}

function loadDictionary(id) {
  if (loadedDictionaries[id]) return Promise.resolve(loadedDictionaries[id])
  if (pendingLoads[id]) return pendingLoads[id]
  const loader = LOCALE_LOADERS[id]
  if (!loader) return Promise.resolve(loadedDictionaries['en-US'])
  const promise = loader()
    .then((mod) => {
      loadedDictionaries[id] = { ...mod.default, hldrive: hldrive[id] }
      delete pendingLoads[id]
      return loadedDictionaries[id]
    })
    .catch((e) => {
      delete pendingLoads[id]
      if (import.meta.env?.DEV) console.warn(`[i18n] failed to load locale "${id}":`, e)
      return loadedDictionaries['en-US']
    })
  pendingLoads[id] = promise
  return promise
}

const RTL_LOCALES = new Set(['ar-SA', 'fa-IR'])
export const DEFAULT_LOCALE = 'pt-BR'
export const LOCALE_KEY = 'hldrive_locale'

export function directionFor(locale) {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'
}

export function loadSavedLocale() {
  const saved = window.localStorage.getItem(LOCALE_KEY)
  return KNOWN_LOCALES.has(saved) ? saved : DEFAULT_LOCALE
}

// Applied as early as possible (main.jsx, before first paint) and again on every language
// change, so there's never a flash of the wrong language or the wrong text direction.
export function applyLocaleToDocument(locale) {
  const root = document.documentElement
  root.lang = locale
  root.dir = directionFor(locale)
}

// Awaited in main.jsx before the app renders, for the saved locale — the alternative (mount
// en-US, swap once the chunk arrives) is exactly the flash this prevents. English visitors pay nothing extra.
export async function preloadSavedLocale() {
  await loadDictionary(loadSavedLocale())
}

export const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const selection = useRef(0)
  const [locale, setLocaleState] = useState(loadSavedLocale)
  // The active dictionary has to live in state too: a module-level cache hit
  // wouldn't re-render when its promise resolves.
  const [dict, setDict] = useState(() => loadedDictionaries[locale] || enUS)

  useEffect(() => {
    applyLocaleToDocument(locale)
    window.localStorage.setItem(LOCALE_KEY, locale)
  }, [locale])

  const setLocale = useCallback((next) => {
    if (!KNOWN_LOCALES.has(next)) return
    const request = ++selection.current
    if (loadedDictionaries[next]) {
      // Already fetched this session (or it's en-US) — switch immediately,
      // no loading state, no flash.
      setDict(loadedDictionaries[next])
      setLocaleState(next)
      return
    }
    // Fetch before committing the switch, so t() never resolves keys against a
    // dictionary that hasn't loaded.
    loadDictionary(next).then((loaded) => {
      if (request !== selection.current) return
      setDict(loaded)
      setLocaleState(next)
    })
  }, [])

  const t = useCallback((key, vars) => {
    let template = resolveKey(dict, key)
    if (template === undefined) {
      template = resolveKey(loadedDictionaries['en-US'], key)
      if (template === undefined) {
        if (import.meta.env?.DEV) console.warn(`[i18n] missing translation key: ${key}`)
        return key
      }
    }
    template = resolvePlurals(template, vars, locale)
    return interpolate(template, vars)
  }, [dict, locale])

  const value = useMemo(() => ({ locale, setLocale, t, direction: directionFor(locale) }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n() must be used inside I18nProvider')
  return ctx
}
