// Small rounded-square badge for PS5/PS4/APP — the "dark/light chip, bold letters" shape
// redrawn in CSS, not Sony's trademarked logo artwork. PS4 is white-on-black, PS5 black-on-white, matched here.
const STYLES = {
  PS4: 'border-white/10 bg-black text-white',
  PS5: 'border-black/10 bg-white text-black',
}

export default function PlatformBadge({ platform }) {
  if (!platform) return null
  return (
    <span
      className={`pmgr-mono inline-flex h-6 min-w-9 items-center justify-center rounded-[4px] border px-1.5 text-xs font-black tracking-tight shadow-sm ${
        STYLES[platform] || 'border-white/10 bg-panel-border text-text'
      }`}
      title={platform}
    >
      {platform}
    </span>
  )
}
