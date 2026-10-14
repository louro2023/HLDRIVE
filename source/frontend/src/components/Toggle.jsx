// Physical on/off switch — one component instead of every view hand-rolling
// its own checkbox or fake "On/Off" button.
export default function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`pmgr-toggle ${checked ? 'is-on' : ''}`}
    >
      <span className="pmgr-toggle-thumb" />
    </button>
  )
}
