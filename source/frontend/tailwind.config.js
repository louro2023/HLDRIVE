// Colors stay CSS custom properties in index.css for theme switching; each has a "-rgb"
// companion so opacity utilities (bg-accent/10) compile to old-WebKit-safe rgba(), not rgb(a%).
function withOpacity(varName) {
  return ({ opacityValue }) =>
    opacityValue === undefined ? `var(${varName})` : `rgba(var(${varName}-rgb), ${opacityValue})`
}

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: withOpacity('--color-bg'),
        panel: withOpacity('--color-panel'),
        'panel-2': withOpacity('--color-panel-2'),
        'panel-border': withOpacity('--color-panel-border'),
        text: withOpacity('--color-text'),
        'text-dim': withOpacity('--color-text-dim'),
        accent: withOpacity('--color-accent'),
        'accent-hover': withOpacity('--color-accent-hover'),
        info: withOpacity('--color-info'),
        ok: withOpacity('--color-ok'),
        warn: withOpacity('--color-warn'),
        err: withOpacity('--color-err'),
      },
      fontSize: {
        xs: ['0.8125rem', '1.2rem'],
        sm: ['0.9375rem', '1.4rem'],
      },
    },
  },
  plugins: [],
}
