import { formatFileSize } from '../lib/format.js'

// Shared by PKG installs, payload downloads, and repository installs — same bar, same
// size/speed/ETA formatting. `locale` is optional; pass it (useI18n()) for locale-correct grouping.
export function formatSize(bytes, locale) {
  if (bytes < 0 || !isFinite(bytes)) return '?'
  return formatFileSize(bytes, locale)
}

export function formatSpeed(bps, locale) {
  if (!bps || !isFinite(bps)) return '—'
  return `${formatSize(bps, locale)}/s`
}

export function formatEta(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—'
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(h)}H ${pad(m)}M ${pad(s)}S`
}

// A real percentage while bytes are counted, or an indeterminate sweep when
// there's genuinely nothing to measure (e.g. AppInstUtil's own install step).
export default function TransferProgress({ label, pct, indeterminate, sub }) {
  return (
    <div className="mb-3 rounded-lg border border-panel-border bg-panel p-3 text-xs">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-text-dim">
        <span className="min-w-0 truncate font-medium text-text">{label}</span>
        {sub && <span className="pmgr-mono text-xs">{sub}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-border">
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : Math.round(pct)}
          className={`h-full rounded-full bg-info transition-[width] duration-200 ${
            indeterminate ? 'pmgr-indeterminate' : ''
          }`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
