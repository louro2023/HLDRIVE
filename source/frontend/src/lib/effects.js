// Visual Effects: Full/Reduced, set in Settings -> Appearance — distinct from the OS-level
// prefers-reduced-motion query. Persisted like pmgr_theme, applied before first paint by main.jsx.
export const EFFECTS_KEY = 'pmgr_effects'

// The PS5's own browser identifies itself this way (no separate PS4/PS5
// marker — "PlayStation" alone is enough, nothing else sends it).
export function isPS5() {
  return /PlayStation/i.test(navigator.userAgent)
}

export function applyEffects(reduced) {
  document.documentElement.classList.toggle('pmgr-low-power', reduced)
}

export function loadReducedEffects() {
  const saved = window.localStorage.getItem(EFFECTS_KEY)
  if (saved === 'reduced') return true
  if (saved === 'full') return false
  // No explicit choice yet — PS5's WebKit is too GPU-constrained for full
  // motion by default; everywhere else still defaults to Full.
  return isPS5()
}
