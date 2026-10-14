// A consistent "nothing here" state that answers what to do next, not just names the absence.
// `size="sm"` for a nested area (card, tab panel); default fits a whole page/panel body.
export default function EmptyState({ icon, title, description, action, size = 'md', className = '' }) {
  return (
    <div className={`pmgr-empty-state ${size === 'sm' ? 'py-6' : 'py-10'} px-4 text-center ${className}`}>
      {icon && <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent">{icon}</div>}
      <div className="font-semibold text-text">{title}</div>
      {description && <div className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-text-dim">{description}</div>}
      {action && <div className="mt-3.5 flex justify-center">{action}</div>}
    </div>
  )
}
