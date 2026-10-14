import { useEffect, useRef } from 'react'

// A real checkbox (native input, so aria-checked/keyboard/screen-reader semantics are free)
// with a proper indeterminate state — only settable via a DOM property, not a JSX attribute, hence the ref.
export default function Checkbox({ checked, indeterminate = false, onChange, label, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <label
      className={`pmgr-icon-btn inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="peer sr-only"
      />
      <span className="grid h-[18px] w-[18px] place-items-center rounded-md border border-panel-border bg-bg text-transparent transition-[color,background-color,border-color,box-shadow] duration-150 peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white peer-indeterminate:border-accent peer-indeterminate:bg-accent peer-indeterminate:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent/30">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          {indeterminate ? <path d="M5 12h14" /> : <path d="M5 13l4 4L19 7" />}
        </svg>
      </span>
    </label>
  )
}
