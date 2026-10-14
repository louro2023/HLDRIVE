import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { formatSize, formatSpeed } from './TransferProgress.jsx'
import { useI18n } from '../lib/i18n.jsx'

function hasActiveTasks(tasks) {
  if (tasks?.pkg && ['downloading', 'installing'].includes(tasks.pkg.phase)) return true
  if (tasks?.payload && ['downloading', 'launching'].includes(tasks.payload.phase)) return true
  if (tasks?.save_job?.phase === 'running') return true
  return Boolean(tasks?.autoloader?.running || tasks?.files?.length)
}

// Every job type is listed, zip included. An unlisted type falls back to its own
// name rather than borrowing another verb and mislabelling the job.
const FILE_VERB_KEYS = {
  copy: 'activity.copying',
  move: 'activity.moving',
  zip: 'activity.zipping',
  unzip: 'activity.unzipping',
  delete: 'activity.deleting',
}

function activityLabel(type, task, t) {
  if (type === 'pkg') {
    const verb = t(task.phase === 'installing' ? 'activity.installingPackage' : 'activity.downloadingPackage')
    return task.title ? `${verb}: ${task.title}` : verb
  }
  if (type === 'payload') {
    return t(task.phase === 'launching' ? 'activity.installingPayload' : 'activity.downloadingPayload')
  }
  if (type === 'saveJob') {
    if (task.kind === 'restore') return t('activity.restoringSave', { name: task.label })
    if (task.kind === 'backup_all') return t('activity.backingUpSaves')
    return t('activity.importingSave', { name: task.label })
  }
  if (type === 'autoloader') {
    return task.remaining_seconds > 0
      ? t('activity.autoloaderStartsIn', { seconds: task.remaining_seconds })
      : t('activity.autoloading', { current: task.current || t('activity.payloadsFallback') })
  }
  if (task.ephemeral) return t('activity.preparingDownload')
  const verbKey = FILE_VERB_KEYS[task.type]
  return `${verbKey ? t(verbKey) : task.type} ${task.source.split('/').pop() || task.source}`
}

function ActivityRow({ type, task, onNavigate, t, locale }) {
  const knownTotal = task.total > 0
  const loaded = type === 'file' ? task.completed
    : type === 'autoloader' || type === 'saveJob' ? task.done
    : task.loaded
  const pct = knownTotal ? Math.min(100, (loaded / task.total) * 100) : 0
  const label = activityLabel(type, task, t)

  return (
    <button
      type="button"
      onClick={() => type === 'autoloader'
        ? onNavigate('settings', 'autoloader')
        : onNavigate(type === 'pkg' ? 'pkg' : type === 'payload' ? 'payloads' : type === 'saveJob' ? 'saves' : 'ftp')}
      className="block w-full rounded-xl p-3 text-left transition-colors hover:bg-panel-2"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-text">{label}</div>
          <div className="mt-0.5 text-xs text-text-dim">
            {type === 'autoloader'
              ? `${t('activity.autoloaderProgress', { done: task.done, total: task.total })}${task.failed ? t('activity.autoloaderFailed', { failed: task.failed }) : ''}`
              : type === 'file'
              ? task.state === 'queued' ? t('activity.queuedWaiting') : `${formatSize(loaded, locale)}${knownTotal ? ` / ${formatSize(task.total, locale)}` : ''}`
              : type === 'saveJob'
              ? (knownTotal ? t('activity.savesProgress', { done: task.done, total: task.total }) : t('activity.workingInBackground'))
              : type !== 'payload' && task.phase === 'downloading'
                ? `${formatSpeed(task.speed_bps, locale)} · ${formatSize(task.loaded, locale)}${knownTotal ? ` / ${formatSize(task.total, locale)}` : ''}`
                : t('activity.workingInBackground')}
          </div>
        </div>
        <span className="pmgr-live-dot shrink-0 text-info" />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-border">
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={knownTotal ? Math.round(pct) : undefined}
          className={`h-full rounded-full bg-info ${knownTotal && (type === 'file' || type === 'autoloader' || type === 'saveJob' || task.phase === 'downloading') ? 'transition-[width] duration-300' : 'pmgr-indeterminate'}`}
          style={knownTotal && (type === 'file' || type === 'autoloader' || type === 'saveJob' || task.phase === 'downloading') ? { width: `${pct}%` } : undefined}
        />
      </div>
    </button>
  )
}

export default function GlobalActivity({ connection, onNavigate }) {
  const { t, locale } = useI18n()
  const [tasks, setTasks] = useState(null)

  useEffect(() => {
    if (connection === 'offline') return undefined
    let cancelled = false
    let timer = null
    const schedule = (delay) => {
      if (!cancelled) timer = window.setTimeout(poll, delay)
    }
    const poll = () => {
      if (document.visibilityState === 'hidden') {
        schedule(5000)
        return
      }
      api.tasks()
        .then((value) => {
          if (cancelled) return
          setTasks(value)
          schedule(hasActiveTasks(value) ? 1000 : 5000)
        })
        .catch(() => schedule(5000))
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(timer)
      poll()
    }
    poll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [connection])

  const active = []
  if (tasks?.pkg && ['downloading', 'installing'].includes(tasks.pkg.phase)) {
    active.push(['pkg', tasks.pkg])
  }
  if (tasks?.payload && ['downloading', 'launching'].includes(tasks.payload.phase)) {
    active.push(['payload', tasks.payload])
  }
  if (tasks?.save_job?.phase === 'running') active.push(['saveJob', tasks.save_job])
  if (tasks?.autoloader?.running) active.push(['autoloader', tasks.autoloader])
  for (const job of tasks?.files || []) active.push(['file', job])
  if (active.length === 0) return null

  return (
    <aside className="pmgr-global-activity pmgr-modal-pop fixed z-30 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-info/25 bg-panel/95 p-1.5 shadow-2xl backdrop-blur-xl">
      <div className="px-3 pb-1 pt-2 text-xs font-extrabold uppercase tracking-[0.18em] text-info">
        {t('activity.title')}
      </div>
      {active.map(([type, task]) => (
        <ActivityRow key={type === 'file' ? `file-${task.id}` : type} type={type} task={task} onNavigate={onNavigate} t={t} locale={locale} />
      ))}
    </aside>
  )
}
