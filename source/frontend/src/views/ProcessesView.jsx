import { useEffect, useState } from 'react'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import SearchField from '../components/SearchField.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonRows } from '../components/Skeleton.jsx'
import { ConfirmDialog } from '../components/Dialog.jsx'
import { KillIcon, RefreshIcon, ShieldIcon } from '../components/icons.jsx'
import { api } from '../lib/api.js'
import { useToast } from '../lib/ToastContext.jsx'
import { useI18n } from '../lib/i18n.jsx'

// pid 0 is a real row on FreeBSD/PS5 (the kernel/swapper process) that can't actually be
// signaled — kill() on it targets the whole process group, so it's blocked here and server-side.
function isProtected(pid) {
  return pid <= 1
}

export default function ProcessesView() {
  const { t, locale } = useI18n()
  const [processes, setProcesses] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  // null when idle — using 0 collided with pid 0 ("kernel"), which made that
  // row's button permanently read "Killing…" even before ever being clicked.
  const [busy, setBusy] = useState(null)
  const [killTarget, setKillTarget] = useState(null) // { pid, name }
  const showToast = useToast()

  const load = () => {
    api.processes
      .list()
      .then((r) => setProcesses(r.processes))
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true))
  }

  useEffect(load, [])

  const doKill = (pid, name) => {
    setBusy(pid)
    setError('')
    return api.processes
      .kill(pid)
      .then(() => {
        load()
        showToast(t('processes.stoppedToast', { name, pid }))
      })
      .catch((e) => {
        setError(e.message)
        throw e
      })
      .finally(() => setBusy(null))
  }

  const visible = processes.filter((p) => p.name.toLocaleLowerCase(locale).includes(filter.toLocaleLowerCase(locale)))

  return (
    <Panel
      title={t('processes.title')}
      actions={<Button tone="neutral" icon={<RefreshIcon size={15} />} onClick={load}>{t('processes.refresh')}</Button>}
    >
      <p className="mb-3 text-sm text-text-dim">{t('processes.intro')}</p>

      <SearchField value={filter} onChange={setFilter} placeholder={t('processes.searchPlaceholder')} className="mb-3 max-w-sm" />

      {error && <div className="mb-3 rounded-md bg-err/10 px-3 py-2 text-sm text-err">{error}</div>}

      {!loaded ? (
        <SkeletonRows count={8} />
      ) : visible.length === 0 ? (
        processes.length === 0 ? (
          <EmptyState size="sm" title={t('processes.emptyTitle')} />
        ) : (
          <EmptyState size="sm" title={t('processes.noMatchTitle')} />
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-text-dim">
                <th className="pb-2 font-medium">{t('processes.pid')}</th>
                <th className="pb-2 font-medium">{t('processes.ppid')}</th>
                <th className="pb-2 font-medium">{t('processes.name')}</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p, i) => (
                <tr key={p.pid} className="pmgr-row-in border-t border-panel-border transition-colors hover:bg-panel-2" style={{ '--ti': i }}>
                  <td className="pmgr-mono py-1.5 text-text-dim">{p.pid}</td>
                  <td className="pmgr-mono py-1.5 text-text-dim">{p.ppid}</td>
                  <td className="py-1.5 text-text">{p.name}</td>
                  <td className="py-1.5 text-right">
                    {isProtected(p.pid) ? (
                      <span title={t('processes.protected')} className="inline-flex h-9 w-9 items-center justify-center text-text-dim/60">
                        <ShieldIcon size={15} />
                      </span>
                    ) : (
                      <Button
                        size="icon"
                        tone="danger"
                        title={t('processes.stop', { pid: p.pid })}
                        onClick={() => setKillTarget({ pid: p.pid, name: p.name })}
                        disabled={busy === p.pid}
                        icon={<KillIcon size={15} />}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {killTarget && (
        <ConfirmDialog
          title={t('processes.stopTitle')}
          description={t('processes.stopDesc', { name: killTarget.name, pid: killTarget.pid })}
          detail={t('processes.stopDetail')}
          tone="danger"
          confirmLabel={t('processes.stopConfirm')}
          onClose={() => setKillTarget(null)}
          onConfirm={() => doKill(killTarget.pid, killTarget.name)}
        />
      )}
    </Panel>
  )
}
