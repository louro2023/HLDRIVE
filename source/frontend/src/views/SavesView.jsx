import { useEffect, useMemo, useRef, useState } from 'react'
import Panel from '../components/Panel.jsx'
import Pill from '../components/Pill.jsx'
import PlatformBadge from '../components/PlatformBadge.jsx'
import Button from '../components/Button.jsx'
import Toggle from '../components/Toggle.jsx'
import CollapsibleSection from '../components/CollapsibleSection.jsx'
import Checkbox from '../components/Checkbox.jsx'
import EmptyState from '../components/EmptyState.jsx'
import SegmentedControl from '../components/SegmentedControl.jsx'
import PathPickerModal from '../components/PathPickerModal.jsx'
import { ConfirmDialog } from '../components/Dialog.jsx'
import { DownloadIcon, UploadIcon, RefreshIcon, SaveIcon, DeleteIcon, ShieldIcon, FolderIcon } from '../components/icons.jsx'
import { api } from '../lib/api.js'
import { useToast } from '../lib/ToastContext.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { formatDate, formatFileSize } from '../lib/format.js'

function formatWhen(unixSeconds, locale) {
  return formatDate(unixSeconds * 1000, locale)
}

// The backend's own message is English, so prefer the translated string its code
// names and keep the raw text only for unknown codes.
const SAVE_ERROR_KEYS = {
  title_running: 'saves.errorTitleRunning',
  no_saves: 'saves.errorNoSaves',
  no_files: 'saves.errorNoFiles',
  missing_key: 'saves.errorMissingKey',
  unsafe_path: 'saves.errorUnsafePath',
  invalid_zip: 'saves.errorInvalidZip',
  snapshot_failed: 'saves.errorSnapshotFailed',
  unpack_failed: 'saves.errorUnpackFailed',
  replace_failed: 'saves.errorReplaceFailed',
  delete_failed: 'saves.errorDeleteFailed',
}

function saveErrorText(t, code, fallback) {
  return code && SAVE_ERROR_KEYS[code] ? t(SAVE_ERROR_KEYS[code]) : fallback
}

function SaveArtwork({ save }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-panel-border bg-bg text-accent/55">
      {!failed ? (
        <img
          src={api.saves.iconUrl(save.user_id_hex, save.title_id, save.filename)}
          alt={`${save.title_name || save.title_id} icon`}
          onError={() => setFailed(true)}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M8 9v6M5 12h6M14 10h.01M17 13h.01" strokeLinecap="round" />
        </svg>
      )}
    </div>
  )
}

function BackupRow({ b, busy, onDownload, onRestore, onDelete, t, locale }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-panel-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text">{formatWhen(b.created_unix, locale)}</div>
        <div className="text-xs text-text-dim">{formatFileSize(b.size_bytes, locale)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="icon" tone="ghost" title={t('saves.download')} onClick={onDownload} icon={<DownloadIcon size={15} />} />
        <Button size="sm" tone="primary" disabled={busy} onClick={onRestore}>{t('saves.restore')}</Button>
        <Button size="icon" tone="danger" title={t('saves.deleteBackupTitle2')} onClick={onDelete} icon={<DeleteIcon size={15} />} />
      </div>
    </div>
  )
}

// Native auto-backup: waits for a title to close, settles, then zips it to local storage.
// Config and the resulting backups live together here since one drives the other.
function AutoBackupPanel({ refreshKey, onJobStarted }) {
  const { t, locale } = useI18n()
  const [config, setConfig] = useState(null)
  const [backups, setBackups] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [busyPath, setBusyPath] = useState('')
  const [dialog, setDialog] = useState(null) // { kind: 'restore'|'delete', backup }
  const [destPickerOpen, setDestPickerOpen] = useState(false)
  const [volumes, setVolumes] = useState([])
  const [backupAll, setBackupAll] = useState(null) // { running, done, total, failed, current_title_id }
  const [skipSnapshot, setSkipSnapshot] = useState(false)
  const backupAllPollRef = useRef(null)
  const showToast = useToast()

  const load = () => {
    setLoadError('')
    api.saves.getBackupConfig().then(setConfig).catch((error) => setLoadError(error.message))
    api.saves.listBackups().then((r) => setBackups(r.backups || [])).catch((error) => setLoadError(error.message))
  }
  useEffect(load, [refreshKey])
  useEffect(() => {
    api.ftp.storage().then((r) => setVolumes(r.volumes || [])).catch(() => {})
    return () => clearInterval(backupAllPollRef.current)
  }, [])

  const toggle = (checked) => {
    const next = { ...config, enabled: checked }
    setConfig(next)
    api.saves
      .setBackupConfig(next.enabled, next.settle_seconds, next.backup_root)
      .then(() => showToast(t(next.enabled ? 'saves.autoBackupEnabledToast' : 'saves.autoBackupDisabledToast')))
      .catch((e) => showToast(e.message, 'err'))
  }

  const changeSettle = (seconds) => {
    const next = { ...config, settle_seconds: seconds }
    setConfig(next)
    api.saves.setBackupConfig(next.enabled, seconds, next.backup_root).catch((e) => showToast(e.message, 'err'))
  }

  const changeBackupRoot = (path) => {
    const next = { ...config, backup_root: path }
    setConfig(next)
    api.saves
      .setBackupConfig(next.enabled, next.settle_seconds, path)
      .then(() => showToast(path ? t('saves.backupDestChangedToast') : t('saves.backupDestResetToast')))
      .catch((e) => showToast(e.message, 'err'))
  }

  const startBackupAll = () => {
    api.saves
      .backupAll()
      .then(() => {
        backupAllPollRef.current = setInterval(() => {
          api.saves.backupAllStatus().then((s) => {
            setBackupAll(s)
            if (!s.running) {
              clearInterval(backupAllPollRef.current)
              showToast(
                s.failed > 0
                  ? t('saves.backupAllPartialToast', { done: s.done - s.failed, total: s.total })
                  : t('saves.backupAllDoneToast', { total: s.total }),
                s.failed > 0 ? 'err' : undefined,
              )
              load()
            }
          }).catch(() => {})
        }, 500)
      })
      .catch((e) => showToast(e.message, 'err'))
  }

  // Only starts the job; the outcome arrives through the parent's watcher. A
  // rejection here is the request itself being refused, which the dialog shows.
  const restore = (b) => {
    setBusyPath(b.path)
    return api.saves
      .restoreBackup(b.path, !skipSnapshot)
      .then(() => onJobStarted())
      .catch((e) => { throw new Error(saveErrorText(t, e.code, e.message)) })
      .finally(() => setBusyPath(''))
  }

  const remove = (b) =>
    api.saves.deleteBackup(b.path).then(() => {
      showToast(t('saves.backupDeletedToast'))
      load()
    })

  // Grouped by title, newest backup leading. A flat list gets unreadable past a
  // couple of games, so older ones sit behind History.
  const groups = useMemo(() => {
    if (!backups) return null
    const byTitle = new Map()
    for (const b of backups) {
      if (!byTitle.has(b.title_id)) byTitle.set(b.title_id, { title_id: b.title_id, title_name: b.title_name, platform: b.platform, items: [] })
      byTitle.get(b.title_id).items.push(b)
    }
    for (const g of byTitle.values()) g.items.sort((a, b) => b.created_unix - a.created_unix)
    return [...byTitle.values()].sort((a, b) => b.items[0].created_unix - a.items[0].created_unix)
  }, [backups])

  return (
    <Panel title={t('saves.autoBackupTitle')} className="mb-4">
      <p className="mb-3 text-sm text-text-dim">
        {t('saves.autoBackupDesc', { path: config?.backup_root || '/data/HLDRIVE/save_backups' })}
      </p>

      {loadError && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-err/20 bg-err/10 px-3 py-2.5 text-sm text-err">
          <span>{loadError}</span>
          <Button size="sm" tone="danger" onClick={load}>{t('common.tryAgain')}</Button>
        </div>
      )}

      {!config ? (
        !loadError && <div className="text-sm text-text-dim">{t('saves.loading')}</div>
      ) : (
        <div className="mb-4 space-y-2.5">
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-panel-border bg-bg/45 p-3">
            <div className="flex items-center gap-3">
              <Toggle checked={config.enabled} onChange={toggle} label={t('saves.autoBackupTitle')} />
              <span className="text-sm font-semibold text-text">{t(config.enabled ? 'saves.enabled' : 'saves.disabled')}</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-text">
              {t('saves.settleWindow')}
              <select
                value={config.settle_seconds}
                onChange={(e) => changeSettle(Number(e.target.value))}
                className="rounded-md border border-panel-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                {[5, 10, 15, 30, 60].map((s) => (
                  <option key={s} value={s}>{t('saves.settleSeconds', { seconds: s })}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-panel-border bg-bg/45 p-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-text-dim">{t('saves.backupDestLabel')}</div>
              <div className="mt-0.5 truncate pmgr-mono text-sm text-text" dir="ltr">
                {config.backup_root || t('saves.backupDestInternal')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {config.backup_root && (
                <Button size="sm" tone="ghost" onClick={() => changeBackupRoot('')}>{t('saves.backupDestReset')}</Button>
              )}
              <Button size="sm" tone="neutral" icon={<FolderIcon size={14} />} onClick={() => setDestPickerOpen(true)}>
                {t('saves.backupDestChange')}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-panel-border bg-bg/45 p-3">
            <div className="min-w-0 text-sm text-text-dim">
              {backupAll?.running
                ? t('saves.backupAllProgress', { done: backupAll.done, total: backupAll.total })
                : t('saves.backupAllDesc')}
            </div>
            <Button size="sm" tone="primary" icon={<SaveIcon size={14} />} disabled={backupAll?.running} onClick={startBackupAll}>
              {backupAll?.running ? t('saves.backupAllRunning') : t('saves.backupAllAction')}
            </Button>
          </div>
        </div>
      )}

      {destPickerOpen && (
        <PathPickerModal
          title={t('saves.backupDestPickerTitle')}
          description={t('saves.backupDestPickerDesc')}
          initialPath="/mnt"
          volumes={volumes}
          mode="folder"
          actionLabel={t('common.add')}
          onClose={() => setDestPickerOpen(false)}
          onSelect={(selected) => {
            setDestPickerOpen(false)
            changeBackupRoot(selected)
          }}
        />
      )}

      {groups === null ? (
        !loadError && <div className="text-sm text-text-dim">{t('saves.loadingBackups')}</div>
      ) : groups.length === 0 ? (
        <EmptyState size="sm" icon={<ShieldIcon size={20} />} title={t('saves.noBackupsTitle')} description={t('saves.noBackupsDesc')} />
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const latest = g.items[0]
            const older = g.items.slice(1)
            return (
              <div key={g.title_id} className="rounded-xl border border-panel-border">
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text">{g.title_name || g.title_id}</span>
                      {g.platform && <PlatformBadge platform={g.platform} />}
                      {older.length > 0 && <Pill tone="neutral">{t('saves.backupsCount', { count: g.items.length })}</Pill>}
                    </div>
                    <div className="text-xs text-text-dim">{t('saves.latestBackup', { date: formatWhen(latest.created_unix, locale), size: formatFileSize(latest.size_bytes, locale) })}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="icon" tone="ghost" title={t('saves.download')} onClick={() => window.open(api.saves.backupDownloadUrl(latest.path), '_blank')} icon={<DownloadIcon size={15} />} />
                    <Button size="sm" tone="primary" disabled={busyPath === latest.path} onClick={() => setDialog({ kind: 'restore', backup: latest })}>{t('saves.restore')}</Button>
                    <Button size="icon" tone="danger" title={t('saves.deleteBackupTitle2')} onClick={() => setDialog({ kind: 'delete', backup: latest })} icon={<DeleteIcon size={15} />} />
                  </div>
                </div>
                {older.length > 0 && (
                  <CollapsibleSection title={t('saves.historyOlder', { count: older.length })} defaultOpen={false}>
                    <div className="space-y-2">
                      {older.map((b) => (
                        <BackupRow
                          key={b.path}
                          b={b}
                          busy={busyPath === b.path}
                          onDownload={() => window.open(api.saves.backupDownloadUrl(b.path), '_blank')}
                          onRestore={() => setDialog({ kind: 'restore', backup: b })}
                          onDelete={() => setDialog({ kind: 'delete', backup: b })}
                          t={t}
                          locale={locale}
                        />
                      ))}
                    </div>
                  </CollapsibleSection>
                )}
              </div>
            )
          })}
        </div>
      )}

      {dialog?.kind === 'restore' && (
        <ConfirmDialog
          title={t('saves.restoreTitle')}
          description={t('saves.restoreDesc', { name: dialog.backup.title_name || dialog.backup.title_id, date: formatWhen(dialog.backup.created_unix, locale) })}
          tone="warn"
          confirmLabel={t('saves.restore')}
          onClose={() => { setDialog(null); setSkipSnapshot(false) }}
          onConfirm={() => restore(dialog.backup)}
        >
          <div className="flex items-start gap-1 rounded-lg border border-panel-border px-2 py-1">
            <Checkbox checked={skipSnapshot} onChange={setSkipSnapshot} label={t('saves.skipSnapshot')} />
            <div className="min-w-0 flex-1 pt-3">
              <div className="text-sm text-text">{t('saves.skipSnapshot')}</div>
              <div className="mt-0.5 text-xs text-text-dim">{t('saves.skipSnapshotHint')}</div>
            </div>
          </div>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('saves.deleteBackupTitle')}
          description={t('saves.deleteBackupDesc', { name: dialog.backup.title_name || dialog.backup.title_id, date: formatWhen(dialog.backup.created_unix, locale) })}
          tone="danger"
          confirmLabel={t('common.delete')}
          onClose={() => setDialog(null)}
          onConfirm={() => remove(dialog.backup)}
        />
      )}
    </Panel>
  )
}

export default function SavesView() {
  const { t, locale } = useI18n()
  const [saves, setSaves] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [user, setUser] = useState('all')
  const [backupsRefresh, setBackupsRefresh] = useState(0)
  const [importFile, setImportFile] = useState(null)
  const [watchingJob, setWatchingJob] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const importInputRef = useRef(null)
  const showToast = useToast()

  const load = () => {
    setError('')
    api.saves.list().then((r) => setSaves(r.saves)).catch((requestError) => setError(requestError.message))
  }
  useEffect(load, [])

  const groups = useMemo(() => {
    if (!saves) return []
    const byKey = new Map()
    for (const s of saves) {
      const key = `${s.user_id_hex}:${s.title_id}`
      if (!byKey.has(key)) byKey.set(key, { ...s, files: [] })
      byKey.get(key).files.push(s)
    }
    return [...byKey.values()]
  }, [saves])

  // One tab per user: with several accounts, whose save it is was the hardest
  // thing to read off a flat list.
  const users = useMemo(() => {
    const byHex = new Map()
    for (const g of groups) {
      if (!byHex.has(g.user_id_hex)) byHex.set(g.user_id_hex, { hex: g.user_id_hex, name: g.user_name || g.user_id_hex, count: 0 })
      byHex.get(g.user_id_hex).count++
    }
    return [...byHex.values()]
  }, [groups])

  const visibleGroups = user === 'all' ? groups : groups.filter((g) => g.user_id_hex === user)
  const userOptions = [{ id: 'all', label: t('saves.allUsers') }, ...users.map((u) => ({ id: u.hex, label: `${u.name} (${u.count})` }))]

  const backup = (group) => {
    const key = `${group.user_id_hex}:${group.title_id}`
    setBusy(key)
    api.saves
      .downloadZip(group.user_id_hex, group.title_id)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'backup failed')
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${group.title_id}-save.zip`
        a.click()
        URL.revokeObjectURL(url)
        showToast(t('saves.downloadedBackupToast', { name: group.title_name || group.title_id }))
      })
      .catch((e) => showToast(e.message, 'err'))
      .finally(() => setBusy(''))
  }

  const backupNow = (group) => {
    const key = `now:${group.title_id}`
    setBusy(key)
    api.saves
      .backupNow(group.title_id)
      .then(() => {
        showToast(t('saves.backedUpToast', { name: group.title_name || group.title_id }))
        setBackupsRefresh((n) => n + 1)
      })
      .catch((e) => showToast(e.message, 'err'))
      .finally(() => setBusy(''))
  }

  // Only starts the job — the outcome arrives through the poll below. A rejection
  // here is the upload itself failing, which the dialog shows inline.
  const runImport = () => api.saves.importZip(importFile, importFile.name).then(() => setWatchingJob(true))

  // Import, restore and back-up-all all run in the background, so a refusal
  // ("close the game first") comes back here rather than on the request.
  useEffect(() => {
    if (!watchingJob) return undefined
    let cancelled = false
    const timer = window.setInterval(() => {
      api.tasks().then((tasks) => {
        if (cancelled) return
        const job = tasks?.save_job
        if (!job || job.phase === 'running') return
        setWatchingJob(false)
        if (job.phase === 'error') {
          showToast(saveErrorText(t, job.error_code, job.error || t('saves.importFailed')), 'err')
          return
        }
        showToast(t(job.kind === 'restore' ? 'saves.restoredDoneToast' : 'saves.importedToast'))
        load()
        setBackupsRefresh((n) => n + 1)
      }).catch(() => {})
    }, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [watchingJob])

  const removeSaves = (g) => {
    setBusy(`del:${g.title_id}`)
    return api.saves
      .deleteSaves(g.user_id_hex, g.title_id)
      .then(() => {
        showToast(t('saves.savesDeletedToast', { name: g.title_name || g.title_id }))
        load()
        setBackupsRefresh((n) => n + 1)
      })
      .catch((e) => { throw new Error(saveErrorText(t, e.code, e.message)) })
      .finally(() => setBusy(''))
  }

  return (
    <div>
      <AutoBackupPanel refreshKey={backupsRefresh} onJobStarted={() => setWatchingJob(true)} />

      <Panel
        title={t('saves.saveDataTitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              tone="neutral"
              icon={<UploadIcon size={15} />}
              disabled={watchingJob}
              onClick={() => importInputRef.current?.click()}
            >
              {watchingJob ? t('saves.importing') : t('saves.import')}
            </Button>
            <Button tone="neutral" icon={<RefreshIcon size={15} />} onClick={load}>{t('saves.refresh')}</Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-text-dim">{t('saves.saveDataDesc')}</p>

        {users.length > 1 && <SegmentedControl className="mb-3" options={userOptions} value={user} onChange={setUser} />}

        {error && saves !== null && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-err/20 bg-err/10 px-3 py-2.5 text-sm text-err">
            <span>{error}</span>
            <Button size="sm" tone="danger" onClick={load}>{t('common.tryAgain')}</Button>
          </div>
        )}

        {error && saves === null ? (
          <EmptyState
            size="sm"
            title={t('common.error')}
            description={error}
            action={<Button tone="neutral" onClick={load}>{t('common.tryAgain')}</Button>}
          />
        ) : saves === null ? (
          <div className="py-6 text-center text-text-dim">{t('saves.loading')}</div>
        ) : visibleGroups.length === 0 ? (
          <EmptyState size="sm" title={t('saves.noSavesTitle')} description={t('saves.noSavesDesc')} />
        ) : (
          <div className="space-y-2">
            {visibleGroups.map((g) => {
              const key = `${g.user_id_hex}:${g.title_id}`
              const totalBytes = g.files.reduce((sum, f) => sum + f.size_bytes, 0)
              return (
                <div key={key} className="flex flex-wrap items-center gap-3 rounded-md border border-panel-border px-3 py-2.5">
                  <SaveArtwork save={g} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-text">{g.title_name || g.title_id}</span>
                      {g.platform && <PlatformBadge platform={g.platform} />}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-text-dim">
                      <span className="truncate" dir="ltr">{g.title_id}</span>
                      <span>·</span>
                      <span>{t('saves.filesCount', { count: g.files.length })}</span>
                      <span>·</span>
                      <span>{formatFileSize(totalBytes, locale)}</span>
                    </div>
                  </div>
                  <div className="hidden shrink-0 items-center gap-2 text-xs text-text-dim md:flex">
                    <img
                      src={api.avatar.userIconUrl(g.user_id_hex)}
                      alt=""
                      onError={(e) => { e.target.style.display = 'none' }}
                      className="h-6 w-6 rounded-full border border-panel-border object-cover"
                    />
                    <span>{g.user_name || g.user_id_hex}</span>
                  </div>
                  <Button
                    size="sm"
                    tone="neutral"
                    title={t('saves.backUpNowTitle')}
                    disabled={busy === `now:${g.title_id}`}
                    onClick={() => backupNow(g)}
                    icon={<SaveIcon size={15} />}
                  >
                    <span className="hidden sm:inline">{t('saves.backUpNow')}</span>
                  </Button>
                  <Button
                    size="sm"
                    tone="primary"
                    title={t('saves.downloadZipTitle')}
                    disabled={busy === key}
                    onClick={() => backup(g)}
                    icon={<DownloadIcon size={15} />}
                  >
                    <span className="hidden sm:inline">{t('saves.downloadZip')}</span>
                  </Button>
                  <Button
                    size="icon"
                    tone="danger"
                    title={t('saves.deleteSaveAction')}
                    disabled={busy === `del:${g.title_id}`}
                    onClick={() => setDeleteTarget(g)}
                    icon={<DeleteIcon size={15} />}
                  />
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <input
        ref={importInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Clear it so picking the same file twice in a row still fires onChange.
          e.target.value = ''
          if (file) setImportFile(file)
        }}
      />

      {importFile && (
        <ConfirmDialog
          title={t('saves.importTitle')}
          description={t('saves.importDesc', { name: importFile.name })}
          tone="warn"
          confirmLabel={t('saves.import')}
          onClose={() => setImportFile(null)}
          onConfirm={runImport}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t('saves.deleteSaveTitle')}
          description={t('saves.deleteSaveDesc', { name: deleteTarget.title_name || deleteTarget.title_id })}
          tone="danger"
          confirmLabel={t('common.delete')}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => removeSaves(deleteTarget)}
        />
      )}
    </div>
  )
}
