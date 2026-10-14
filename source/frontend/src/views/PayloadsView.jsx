import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Panel from '../components/Panel.jsx'
import Pill from '../components/Pill.jsx'
import Button from '../components/Button.jsx'
import DropZone from '../components/DropZone.jsx'
import PathPickerModal from '../components/PathPickerModal.jsx'
import SkeletonGrid from '../components/Skeleton.jsx'
import ActionMenu from '../components/ActionMenu.jsx'
import SearchField from '../components/SearchField.jsx'
import SegmentedControl from '../components/SegmentedControl.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { ConfirmDialog, InputDialog } from '../components/Dialog.jsx'
import DownloadPayloadDialog from '../components/DownloadPayloadDialog.jsx'
import { UploadIcon, DeleteIcon, LaunchIcon, RefreshIcon, KillIcon, PowerIcon, RenameIcon, StarIcon, FolderIcon, ClockIcon } from '../components/icons.jsx'
import TransferProgress, { formatSize as formatTransferSize, formatSpeed, formatEta } from '../components/TransferProgress.jsx'
import { api } from '../lib/api.js'
import { useToast } from '../lib/ToastContext.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { formatFileSize } from '../lib/format.js'

// Process names on the PS5 can come back truncated/without extension —
// match loosely both ways instead of requiring an exact filename match.
function SectionHeading({ label, count }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-text-dim">
      {label}
      <span className="font-mono text-[11px] font-semibold opacity-70" dir="ltr">{count}</span>
      <span className="h-px flex-1 bg-panel-border" />
    </div>
  )
}

function stem(name) {
  return name.replace(/\.(elf|bin|self)$/i, '').toLowerCase()
}

function findRunningPid(payloadName, processes) {
  const s = stem(payloadName)
  if (!s) return null
  // Exact match, or a truncated prefix from the capped comm field. Not a loose
  // substring, which would false-match on a short fragment.
  const hit = processes.find((p) => {
    const ps = stem(p.name)
    return ps.length >= 3 && (ps === s || s.startsWith(ps))
  })
  return hit ? hit.pid : null
}

// A running process whose name contains a payload extension is almost certainly homebrew —
// elfldr preserves the launched filename, unlike a truncated system daemon. A few Sony processes are excluded by name.
const PAYLOAD_EXT_RE = /\.(elf|bin|self)$/i

const SYSTEM_PROCESS_BLACKLIST = new Set([
  'mini-syscore.elf',
  'scesysavcontrol.elf',
  'scesyscore.elf',
  'orbis_audiod.elf',
  'agccompositor.elf',
  'fs_cleaner.elf',
  'webrtc_daemon.self',
])

function isPayloadLikeProcessName(name) {
  return PAYLOAD_EXT_RE.test(name) && !SYSTEM_PROCESS_BLACKLIST.has(name.toLowerCase())
}

const FILTERS = [
  { id: 'all', labelKey: 'payloads.filterAll' },
  { id: 'running', labelKey: 'payloads.filterRunning' },
  { id: 'favorites', labelKey: 'payloads.filterFavorites' },
]

// The unfiltered grid is grouped by where each payload came from, which is
// what the old Bundled/Uploaded filter chips were really being used for.
const SOURCE_ORDER = ['repository', 'uploaded', 'usb', 'bundled', 'other']
const KNOWN_SOURCES = new Set(['repository', 'uploaded', 'usb'])

function sourceOf(p) {
  if (p.bundled) return 'bundled'
  return KNOWN_SOURCES.has(p.source) ? p.source : 'other'
}

const SORTS = [
  { id: 'name', labelKey: 'payloads.sortName' },
  { id: 'size', labelKey: 'payloads.sortSize' },
  { id: 'recent', labelKey: 'payloads.sortRecent' },
]

// Memoized — the 5s process poll below otherwise re-renders every tile.
const PayloadTile = memo(function PayloadTile({ p, index, busy, runningPid, onLaunch, onDelete, onToggleEnabled, onToggleFavorite, onRename, onKill, t, locale }) {
  const launching = busy === p.name
  // External means a running process with no file behind it, so only Kill applies.
  // It renders like any other tile.
  const external = p.external
  const disabled = !external && !p.enabled

  return (
    <div
      className={`pmgr-tile pmgr-tile-in relative flex flex-col gap-3 rounded-lg border bg-panel p-3 ${
        runningPid ? 'border-ok/35' : 'border-panel-border'
      }`}
      style={{ '--ti': index }}
    >
      <div className="flex items-center gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border ${disabled ? 'border-panel-border bg-panel-2 text-text-dim' : 'border-accent/30 bg-accent/10 text-accent'}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text" title={p.name}>
            {p.name}
          </div>
          <div className="truncate text-xs text-text-dim">
            {external ? <span dir="ltr">{`pid ${runningPid}`}</span> : `${formatFileSize(p.size_bytes, locale)}${p.installed_version ? ` · ${p.installed_version}` : ''}`}
          </div>
        </div>
        {/* A quiet, always-visible toggle — favoriting is frequent enough
            that burying it in More would make it annoying, but it must not
            compete visually with Launch. Brand color when set, never the
            warning tone (favorite isn't a caution state). */}
        {!external && (
          <button
            type="button"
            onClick={() => onToggleFavorite(p)}
            title={t(p.favorite ? 'payloads.unpinFavorite' : 'payloads.pinFavorite')}
            aria-label={t(p.favorite ? 'payloads.unpinFavorite' : 'payloads.pinFavorite')}
            aria-pressed={p.favorite}
            className={`pmgr-icon-btn grid h-8 w-8 shrink-0 place-items-center rounded-lg ${p.favorite ? 'text-accent' : 'text-text-dim hover:text-text'}`}
          >
            <StarIcon size={16} filled={p.favorite} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {external ? (
          <Pill tone="warn">{t('payloads.notInRegistry')}</Pill>
        ) : (
          <Pill tone="neutral">{t(`payloads.origin.${sourceOf(p)}`)}</Pill>
        )}
        {runningPid ? (
          <Pill tone="ok" live>{t('payloads.running')}</Pill>
        ) : disabled ? (
          <Pill tone="neutral">{t('payloads.disabledPill')}</Pill>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        {external ? (
          <Button size="sm" tone="danger" className="ml-auto" title={`SIGKILL pid ${runningPid}`} onClick={() => onKill(runningPid, p.name)} icon={<KillIcon size={14} />}>
            {t('payloads.stop')}
          </Button>
        ) : (
          <>
            <ActionMenu
              label={t('payloads.moreActionsFor', { name: p.name })}
              align="left"
              items={[
                !p.bundled && { label: t('payloads.rename'), icon: <RenameIcon size={15} />, onClick: () => onRename(p.name) },
                { label: t(p.enabled ? 'payloads.disable' : 'payloads.enable'), icon: <PowerIcon size={15} />, onClick: () => onToggleEnabled(p) },
                '-',
                !p.bundled && { label: t('payloads.delete'), icon: <DeleteIcon size={15} />, tone: 'danger', onClick: () => onDelete(p.name) },
              ]}
            />
            <div className="flex items-center gap-2">
              {runningPid && (
                <Button size="sm" tone="danger" title={`SIGKILL pid ${runningPid}`} onClick={() => onKill(runningPid, p.name)} icon={<KillIcon size={14} />}>
                  {t('payloads.stop')}
                </Button>
              )}
              {!runningPid && disabled && (
                <Button size="sm" tone="ok" onClick={() => onToggleEnabled(p)} icon={<PowerIcon size={14} />}>
                  {t('payloads.enable')}
                </Button>
              )}
              {!runningPid && !disabled && (
                <Button size="sm" tone="primary" sheen onClick={() => onLaunch(p.name)} disabled={launching} icon={<LaunchIcon size={14} />}>
                  {launching ? t('payloads.launching') : t('payloads.launch')}
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {launching && (
        <div className="pmgr-payload-busy pointer-events-none absolute bottom-0 left-0 right-0 top-0 flex items-center justify-center gap-2 rounded-lg bg-bg/70 text-sm font-semibold text-accent backdrop-blur-[1px]">
          <span className="pmgr-live-dot" /> {t('payloads.launching')}
        </div>
      )}
    </div>
  )
})

export default function PayloadsView({ onNavigate }) {
  const { t, locale } = useI18n()
  const [payloads, setPayloads] = useState([])
  const [catalog, setCatalog] = useState([])
  const [updateEntry, setUpdateEntry] = useState(null) // catalog entry currently open in the download dialog
  const [processes, setProcesses] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [uploadJob, setUploadJob] = useState(null)
  const [volumes, setVolumes] = useState([])
  const [consolePickerOpen, setConsolePickerOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('name')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState(null) // { kind: 'delete'|'rename'|'kill'|'replace', ... }
  const fileInputRef = useRef(null)
  const showToast = useToast()

  const load = useCallback(() => {
    api.payloads
      .list()
      .then((r) => setPayloads(r.payloads))
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    load()
    api.ftp.storage().then((r) => setVolumes(r.volumes || [])).catch(() => {})
    // Cached only — never forces a refresh here, that's the Payload Repositories tab's
    // job (GitHub's unauthenticated rate limit is shared and easy to burn through).
    api.catalog.list(false).then((r) => setCatalog(r.entries || [])).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // A payload whose recorded source repo has a cached "latest" version that doesn't
  // match what's installed. Empty until the user has checked at least once in Repositories.
  const updates = useMemo(() => {
    if (!catalog.length) return []
    const byUrl = new Map(catalog.map((entry) => [entry.url, entry]))
    const out = []
    for (const p of payloads) {
      if (!p.source_url) continue
      const entry = byUrl.get(p.source_url)
      if (!entry || entry.version_state !== 'ok' || !entry.version) continue
      if (entry.version === p.installed_version) continue
      out.push({ payload: p, entry })
    }
    return out
  }, [payloads, catalog])
  // Cross-referenced against Processes so an already-running bundled payload can
  // be killed here rather than from the Processes tab.
  useEffect(() => {
    const poll = () => api.processes.list().then((r) => setProcesses(r.processes)).catch(() => {})
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  const killPayload = (pid, name) => {
    api.processes
      .kill(pid)
      .then(() => {
        showToast(t('payloads.stoppedToast', { name, pid }))
        api.processes.list().then((r) => setProcesses(r.processes)).catch(() => {})
      })
      .catch((e) => showToast(e.message, 'err'))
  }

  const launch = useCallback((name) => {
    setBusy(name)
    setError('')
    api.payloads
      .launch(name)
      .then(() => { showToast(t('payloads.launchedToast', { name })); load() })
      .catch((e) => {
        setError(e.message)
        showToast(t('payloads.launchFailedToast', { name }), 'err')
      })
      .finally(() => setBusy(''))
  }, [t, showToast, load])

  const remove = (name) =>
    api.payloads.delete(name).then(() => {
      load()
      showToast(t('payloads.deletedToast', { name }))
    })

  const toggleEnabled = useCallback((p) => {
    api.payloads
      .setEnabled(p.name, !p.enabled)
      .then(() => {
        load()
        showToast(t(p.enabled ? 'payloads.disabledToast' : 'payloads.enabledToast', { name: p.name }))
      })
      .catch((e) => showToast(e.message, 'err'))
  }, [t, showToast, load])

  const toggleFavorite = useCallback((p) => {
    api.payloads.setFavorite(p.name, !p.favorite)
      .then(() => { load(); showToast(t(p.favorite ? 'payloads.unpinnedToast' : 'payloads.pinnedToast', { name: p.name })) })
      .catch((e) => showToast(e.message, 'err'))
  }, [t, showToast, load])

  // Stable references so PayloadTile's memo isn't broken by fresh
  // arrow functions on every render.
  const handleDelete = useCallback((name) => setDialog({ kind: 'delete', name }), [])
  const handleRename = useCallback((name) => setDialog({ kind: 'rename', name }), [])
  const handleKill = useCallback((pid, name) => setDialog({ kind: 'kill', pid, name }), [])

  const rename = (name, next) =>
    api.payloads.rename(name, next).then((result) => {
      load()
      showToast(`${t('payloads.renamedToast', { name, next })}${result.warning ? ` · ${result.warning}` : ''}`)
    })

  const importFiles = async (files) => {
    setError('')
    let completed = 0
    for (const file of files) {
      if (payloads.some((payload) => payload.name === file.name)) {
        const replace = await new Promise((resolve) => {
          setDialog({ kind: 'replace', name: file.name, resolve })
        })
        if (!replace) continue
      }
      let startedAt = performance.now()
      setUploadJob({ name: file.name, loaded: 0, total: file.size, speed: 0, retrying: false })
      try {
        await api.payloads.upload(
          file,
          (loaded, total) => {
            const elapsed = (performance.now() - startedAt) / 1000
            setUploadJob({ name: file.name, loaded, total, speed: elapsed > 0.15 ? loaded / elapsed : 0, retrying: false })
          },
          () => {
            startedAt = performance.now()
            setUploadJob({ name: file.name, loaded: 0, total: file.size, speed: 0, retrying: true })
          },
        )
        completed++
      } catch (e) {
        setError(`${t('payloads.uploadFailedToast', { name: file.name })}: ${e.message}`)
        showToast(t('payloads.uploadFailedToast', { name: file.name }), 'err')
        break
      }
    }
    setUploadJob(null)
    if (completed > 0) {
      load()
      showToast(completed === 1 ? t('payloads.uploadedToast', { name: files[0].name }) : t('payloads.uploadedCountToast', { count: completed }))
    }
  }

  const doImport = (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length) importFiles(files)
  }

  const importFromConsole = (selectedPath) => {
    return api.payloads.importPath(selectedPath).then((result) => {
      setConsolePickerOpen(false)
      load()
      showToast(t('payloads.importedToast', { name: result.name }))
    })
  }

  // Running processes that match no known payload — started outside Prospero or
  // since deleted. Rendered as regular tiles, not a separate list.
  const externalRunning = useMemo(() => {
    return processes
      .filter((proc) => {
        if (!isPayloadLikeProcessName(proc.name)) return false
        return !payloads.some((p) => findRunningPid(p.name, [proc]))
      })
      .map((proc) => ({
        name: proc.name,
        size_bytes: 0,
        bundled: false,
        enabled: true,
        external: true,
        pid: proc.pid,
      }))
  }, [processes, payloads])

  const allItems = useMemo(() => [...payloads, ...externalRunning], [payloads, externalRunning])

  const counts = useMemo(
    () => ({
      all: allItems.length,
      running: allItems.filter((p) => p.external || findRunningPid(p.name, processes)).length,
      favorites: allItems.filter((p) => p.favorite).length,
    }),
    [allItems, processes],
  )

  const sortItems = (items) => {
    const compare = sort === 'size'
      ? (a, b) => b.size_bytes - a.size_bytes
      : sort === 'recent'
        ? (a, b) => (b.mtime_unix || 0) - (a.mtime_unix || 0)
        : (a, b) => a.name.localeCompare(b.name, locale)
    return [...items].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || compare(a, b))
  }

  // Registry payloads only. Unknown processes get their own section below rather
  // than competing for weight with payloads Prospero actually manages.
  const view = useMemo(() => {
    let items = payloads
    if (filter === 'running') items = items.filter((p) => findRunningPid(p.name, processes))
    if (filter === 'favorites') items = items.filter((p) => p.favorite)
    const q = search.trim().toLocaleLowerCase(locale)
    if (q) items = items.filter((p) => p.name.toLocaleLowerCase(locale).includes(q))
    return sortItems(items)
  }, [payloads, filter, sort, search, processes, locale])

  // Hidden under Bundled/Uploaded/Favorites, none of which apply to a process
  // with no registry entry.
  const viewExternal = useMemo(() => {
    if (filter !== 'all' && filter !== 'running') return []
    const q = search.trim().toLocaleLowerCase(locale)
    const items = q ? externalRunning.filter((p) => p.name.toLocaleLowerCase(locale).includes(q)) : externalRunning
    return sortItems(items)
  }, [externalRunning, filter, search, locale])

  // Grouping only earns its keep in the unfiltered view — Running and
  // Favorites are each already a single coherent answer.
  const sections = useMemo(() => {
    if (filter !== 'all') return [{ id: 'flat', label: '', items: view }]
    return SOURCE_ORDER.map((id) => ({
      id,
      label: t(`payloads.origin.${id}`),
      items: view.filter((p) => sourceOf(p) === id),
    })).filter((section) => section.items.length > 0)
  }, [view, filter, t])

  const filterOptions = FILTERS.map((f) => ({ ...f, count: counts[f.id] }))

  return (
    <div>
      <Panel
        title={t('payloads.title')}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button tone="neutral" icon={<ClockIcon size={15} />} onClick={() => onNavigate?.('settings', 'autoloader')}>
              {t('payloads.autoloader')}
            </Button>
            <Button tone="neutral" icon={<FolderIcon size={15} />} disabled={Boolean(uploadJob)} onClick={() => setConsolePickerOpen(true)}>
              {t('payloads.fromPs5')}
            </Button>
            <Button tone="primary" icon={<UploadIcon size={15} />} disabled={Boolean(uploadJob)} onClick={() => fileInputRef.current?.click()}>
              {uploadJob ? t('payloads.uploading') : t('payloads.upload')}
            </Button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={doImport} />
          </div>
        }
      >
        <DropZone global onFiles={importFiles} label={t('payloads.dropLabel')}>
          {updates.length > 0 && (
            <div className="mb-4 rounded-2xl border border-accent/30 bg-accent/[0.06] p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent"><RefreshIcon size={15} /></span>
                <div>
                  <div className="text-sm font-bold text-text">{t('payloads.updatesAvailableTitle', { count: updates.length })}</div>
                  <div className="text-xs text-text-dim">{t('payloads.updatesAvailableDesc')}</div>
                </div>
              </div>
              <div className="space-y-1.5">
                {updates.map(({ payload, entry }) => (
                  <div key={payload.name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-panel-border bg-bg/55 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-text">{entry.name}</div>
                      <div className="pmgr-mono text-xs text-text-dim" dir="ltr">
                        {payload.installed_version || t('payloads.updatesUnknownVersion')} → {entry.version}
                      </div>
                    </div>
                    <Button size="sm" tone="primary" onClick={() => setUpdateEntry(entry)}>{t('payloads.updateAction')}</Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mb-3 text-sm text-text-dim">
            {t('payloads.dropHint', { path: '/data/HLDRIVE/payloads' })}
          </p>

          {uploadJob && (
            <TransferProgress
              label={`${uploadJob.retrying ? t('files.retrying') : t('payloads.uploading')} ${uploadJob.name}`}
              pct={uploadJob.total > 0 ? Math.min(100, (uploadJob.loaded / uploadJob.total) * 100) : 0}
              sub={`${formatSpeed(uploadJob.speed, locale)} · ${formatTransferSize(uploadJob.loaded, locale)} / ${formatTransferSize(uploadJob.total, locale)} · ${t('files.eta')} ${formatEta(uploadJob.speed > 0 ? (uploadJob.total - uploadJob.loaded) / uploadJob.speed : Infinity)}`}
            />
          )}

          {error && <div className="mb-3 rounded-md bg-err/10 px-3 py-2 text-sm text-err">{error}</div>}

          {/* Toolbar: search, filter tabs, sort, refresh. */}
          <div className="mb-4 flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchField value={search} onChange={setSearch} placeholder={t('payloads.searchPlaceholder')} className="sm:max-w-64" />
              <SegmentedControl options={filterOptions.map((f) => ({ ...f, label: t(f.labelKey) }))} value={filter} onChange={setFilter} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label={t('payloads.sortLabel')}
                className="h-8 rounded-lg border border-panel-border bg-bg/45 px-2 text-xs font-semibold text-text-dim outline-none transition-colors hover:text-text focus-visible:border-accent"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t('payloads.sortPrefix', { label: t(s.labelKey) })}
                  </option>
                ))}
              </select>
              <Button size="sm" tone="ghost" icon={<RefreshIcon size={14} />} onClick={load}>
                {t('payloads.refresh')}
              </Button>
              <span className="ml-auto text-xs text-text-dim">
                {t('payloads.inViewOfTotal', { inView: view.length + viewExternal.length, total: allItems.length })}
              </span>
            </div>
          </div>

          {!loaded ? (
            <SkeletonGrid count={6} gridClassName="grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" />
          ) : view.length === 0 && viewExternal.length === 0 ? (
            payloads.length === 0 ? (
              <EmptyState
                icon={<LaunchIcon size={22} />}
                title={t('payloads.emptyTitle')}
                description={t('payloads.emptyDesc')}
              />
            ) : (
              <EmptyState size="sm" title={t('payloads.noMatchTitle')} description={t('payloads.noMatchDesc')} />
            )
          ) : (
            <>
            {sections.map((section, si) => (
              <div key={section.id} className={si > 0 ? 'mt-5' : ''}>
                {section.label && <SectionHeading label={section.label} count={section.items.length} />}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {section.items.map((p, i) => (
                    <PayloadTile
                      key={p.name}
                      p={p}
                      index={i}
                      busy={busy}
                      runningPid={findRunningPid(p.name, processes)}
                      onLaunch={launch}
                      onDelete={handleDelete}
                      onToggleEnabled={toggleEnabled}
                      onToggleFavorite={toggleFavorite}
                      onRename={handleRename}
                      onKill={handleKill}
                      t={t}
                      locale={locale}
                    />
                  ))}
                </div>
              </div>
            ))}

            {viewExternal.length > 0 && (
              <div className={view.length > 0 ? 'mt-5' : ''}>
                <SectionHeading label={t('payloads.runningOutside')} count={viewExternal.length} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {viewExternal.map((p, i) => (
                    <PayloadTile
                      key={`ext-${p.pid}`}
                      p={p}
                      index={i}
                      busy={busy}
                      runningPid={p.pid}
                      onLaunch={launch}
                      onDelete={handleDelete}
                      onToggleEnabled={toggleEnabled}
                      onToggleFavorite={toggleFavorite}
                      onRename={handleRename}
                      onKill={handleKill}
                      t={t}
                      locale={locale}
                    />
                  ))}
                </div>
              </div>
            )}
            </>
          )}
        </DropZone>
      </Panel>
      {consolePickerOpen && (
        <PathPickerModal
          title={t('payloads.importTitle')}
          description={t('payloads.importDesc')}
          initialPath="/data"
          volumes={volumes}
          mode="file"
          extensions={['.elf', '.bin', '.self']}
          actionLabel={t('payloads.importAction')}
          onClose={() => setConsolePickerOpen(false)}
          onSelect={importFromConsole}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('payloads.deleteTitle', { name: dialog.name })}
          description={t('payloads.deleteDesc', { name: dialog.name })}
          tone="danger"
          confirmLabel={t('payloads.delete')}
          onClose={() => setDialog(null)}
          onConfirm={() => remove(dialog.name)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <InputDialog
          title={t('payloads.renameTitle', { name: dialog.name })}
          label={t('payloads.renameLabel')}
          defaultValue={dialog.name}
          confirmLabel={t('payloads.rename')}
          onClose={() => setDialog(null)}
          onConfirm={(next) => (next === dialog.name ? Promise.resolve() : rename(dialog.name, next))}
        />
      )}
      {dialog?.kind === 'kill' && (
        <ConfirmDialog
          title={t('payloads.stopProcessTitle')}
          description={t('payloads.stopProcessDesc', { name: dialog.name, pid: dialog.pid })}
          detail={t('payloads.stopProcessDetail')}
          tone="danger"
          confirmLabel={t('payloads.stopProcessConfirm')}
          onClose={() => setDialog(null)}
          onConfirm={() => killPayload(dialog.pid, dialog.name)}
        />
      )}
      {dialog?.kind === 'replace' && (
        <ConfirmDialog
          title={t('payloads.replaceTitle', { name: dialog.name })}
          description={t('payloads.replaceDesc')}
          confirmLabel={t('payloads.replaceConfirm')}
          onClose={() => {
            dialog.resolve(false)
            setDialog(null)
          }}
          onConfirm={() => {
            dialog.resolve(true)
          }}
        />
      )}

      {updateEntry && (
        <DownloadPayloadDialog
          entry={updateEntry}
          onClose={() => setUpdateEntry(null)}
          onDownloaded={() => {
            showToast(t('repositories.downloadStarted', { name: updateEntry.name }))
            load()
          }}
        />
      )}
    </div>
  )
}

