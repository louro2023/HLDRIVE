import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import flexGapFallback from './scripts/postcss-flex-gap-fallback.mjs'

export default {
  plugins: [
    tailwindcss(),
    // Must run after tailwindcss so it sees the generated .gap-* rules.
    flexGapFallback(),
    autoprefixer(),
  ],
}
