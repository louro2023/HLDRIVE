import { useState } from 'react'

// Shared collapse/chevron behavior for every Sidebar section, one pattern instead of four
// copies. Content stays mounted and animates via grid-template-rows (0fr -> 1fr), not a snap.
export default function CollapsibleSection({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-panel-border last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-text-dim hover:text-text"
      >
        <span>{title}</span>
        <span className={`pmgr-chevron ${open ? 'pmgr-chevron-open' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      <div className={`pmgr-collapse ${open ? 'is-open' : ''}`}>
        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>
  )
}
