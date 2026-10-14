import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Panel from '../components/Panel.jsx'
import DropZone from '../components/DropZone.jsx'
import Button from '../components/Button.jsx'
import Checkbox from '../components/Checkbox.jsx'
import ActionMenu from '../components/ActionMenu.jsx'
import SearchField from '../components/SearchField.jsx'
import EmptyState from '../components/EmptyState.jsx'
import CollapsibleSection from '../components/CollapsibleSection.jsx'
import { SkeletonRows } from '../components/Skeleton.jsx'
import { ConfirmDialog, InputDialog, Dialog } from '../components/Dialog.jsx'
import PathPickerModal from '../components/PathPickerModal.jsx'
import FileEditor from '../components/FileEditor.jsx'
import ImagePreview from '../components/ImagePreview.jsx'
import CreateArchiveDialog from '../components/CreateArchiveDialog.jsx'
import ExtractArchiveDialog from '../components/ExtractArchiveDialog.jsx'
import ArchiveInspectorModal from '../components/ArchiveInspectorModal.jsx'
import {
  UploadIcon, NewFileIcon, NewFolderIcon, RefreshIcon, GoUpIcon, EditIcon, DownloadIcon,
  ZipIcon, UnzipIcon, RenameIcon, DeleteIcon, CopyIcon, MoveIcon,
  FolderIcon, FileIcon, AlertTriangleIcon,
} from '../components/icons.jsx'
import { api } from '../lib/api.js'
import { useToast } from '../lib/ToastContext.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { formatFileSize, formatDate, volumeLabel} from '../lib/format.js'

function formatSpeed(bytesPerSec, locale) {
  if (!bytesPerSec || !isFinite(bytesPerSec)) return '—'
  return `${formatFileSize(bytesPerSec, locale)}/s`
}

function formatEta(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—'
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(h)}H ${pad(m)}M ${pad(s)}S`
}

function formatModified(raw, locale) {
  if (!raw || raw.length < 14) return raw || '—'
  const date = new Date(
    Date.UTC(+raw.slice(0, 4), +raw.slice(4, 6) - 1, +raw.slice(6, 8), +raw.slice(8, 10), +raw.slice(10, 12), +raw.slice(12, 14)),
  )
  if (isNaN(date.getTime())) return raw
  return formatDate(date, locale)
}

function formatMode(mode) {
  return Number(mode || 0).toString(8).padStart(4, '0')
}

function uploadRelativePath(file) {
  const raw = (file.webkitRelativePath || file.name).replaceAll('\\', '/')
  const parts = raw.split('/').filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return ''
  return parts.join('/')
}

function fileType(entry) {
  if (entry.is_dir) return ''
  const dot = entry.name.lastIndexOf('.')
  return dot >= 0 ? entry.name.slice(dot + 1).toLocaleLowerCase() : ''
}

function joinPath(dir, name) {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

function parentPath(path) {
  return path.replace(/\/[^/]+\/?$/, '') || '/'
}

function directoryIsInside(path, directory) {
  return directory === path || directory.startsWith(path.endsWith('/') ? path : `${path}/`)
}

function jobAffectsDirectory(job, directory) {
  const sources = job.source.split('\n')
  return sources.some((source) => parentPath(source) === directory || directoryIsInside(source, directory)) ||
    parentPath(job.destination) === directory || directoryIsInside(job.destination, directory)
}

function pathCrumbs(path) {
  const parts = path.split('/').filter(Boolean)
  return [
    { label: 'PS5', path: '/' },
    ...parts.map((part, index) => ({ label: part, path: `/${parts.slice(0, index + 1).join('/')}` })),
  ]
}

// >=93% used matches the same thresholds Settings -> General uses for its
// own storage bars, so "near full"/"critical" mean the same thing everywhere.
function volumeBarClass(pct) {
  if (pct >= 93) return 'bg-err'
  if (pct >= 80) return 'bg-warn'
  return 'bg-accent'
}

const EDITABLE_EXT = new Set([
  'txt', 'ini', 'cfg', 'conf', 'json', 'log', 'md', 'xml', 'yml', 'yaml',
  'sh', 'py', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'htm',
  'c', 'h', 'cpp', 'hpp', 'lua', 'toml', 'csv', 'env', 'properties',
])

function isEditable(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return EDITABLE_EXT.has(ext)
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'])

function isImage(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return IMAGE_EXT.has(ext)
}

// .zip can also be created; .rar is extract-only (the backend can't write RAR archives).
function isExtractableArchive(name) {
  const lower = name.toLowerCase()
  return lower.endsWith('.zip') || lower.endsWith('.rar')
}

// The editor keeps the whole file in one <textarea> in browser memory — fine for configs
// and logs, not multi-MB text. Matches the backend's own cap on /api/ftp/text.
const MAX_EDIT_BYTES = 4 * 1024 * 1024
const PATH_SESSION_KEY = 'pmgr-files-path'
const SEARCH_SESSION_KEY = 'pmgr-files-search'

function savedPath() {
  const path = window.sessionStorage.getItem(PATH_SESSION_KEY)
  return path?.startsWith('/') ? path : '/'
}

function isSafeName(name) {
  return name.trim().length > 0 && !name.includes('/') && name !== '.' && name !== '..'
}

// One row in the transfer tray — speed/ETA computed from a loaded/time sample,
// smoothed a little so it doesn't jitter every progress event.
function useTransfers() {
  const [transfers, setTransfers] = useState([])

  const start = useCallback((name, direction, total) => {
    const id = `${direction}-${name}-${Date.now()}`
    setTransfers((t) => [...t, { id, name, direction, loaded: 0, total, startedAt: performance.now(), speed: 0, done: false, error: '', retries: 0 }])
    return id
  }, [])

  const progress = useCallback((id, loaded, total) => {
    setTransfers((list) =>
      list.map((tr) => {
        if (tr.id !== id) return tr
        const elapsed = (performance.now() - tr.startedAt) / 1000
        const speed = elapsed > 0.2 ? loaded / elapsed : tr.speed
        return { ...tr, loaded, total: total || tr.total, speed }
      }),
    )
  }, [])

  const finish = useCallback((id, error) => {
    setTransfers((list) => list.map((tr) => (tr.id === id ? { ...tr, done: true, error: error || '' } : tr)))
    setTimeout(() => setTransfers((list) => list.filter((tr) => tr.id !== id)), error ? 4000 : 1500)
  }, [])

  const retry = useCallback((id) => {
    setTransfers((list) => list.map((tr) => (tr.id === id ? { ...tr, loaded: 0, startedAt: performance.now(), speed: 0, retries: tr.retries + 1 } : tr)))
  }, [])

  return { transfers, start, progress, finish, retry }
}

function TransferTray({ transfers, locale, t }) {
  if (transfers.length === 0) return null
  return (
    <div className="mb-3 space-y-1.5 rounded-lg border border-panel-border bg-panel p-2.5">
      {transfers.map((tr) => {
        const pct = tr.total ? Math.min(100, (tr.loaded / tr.total) * 100) : 0
        const etaSeconds = tr.speed > 0 ? (tr.total - tr.loaded) / tr.speed : Infinity
        return (
          <div key={tr.id} className="text-xs">
            <div className="mb-1 flex items-center justify-between text-text-dim">
              <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-text">
                <span className="shrink-0 text-accent">{tr.direction === 'upload' ? <UploadIcon size={13} /> : <DownloadIcon size={13} />}</span>
                <span className="truncate">{tr.name}</span>
                {tr.error && <span className="ml-2 text-err">{tr.error}</span>}
                {tr.done && !tr.error && <span className="ml-2 text-ok">✓</span>}
                {!tr.done && tr.retries > 0 && <span className="ml-2 text-warn">↻</span>}
              </span>
              {!tr.done && (
                <span className="shrink-0">
                  {formatSpeed(tr.speed, locale)} · {t('files.eta')} {formatEta(etaSeconds)}
                </span>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-panel-border">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${tr.done ? 100 : pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Maps FileJobInfo::error_code to a friendlier phrase; falls back to the
// raw error text otherwise.
const ERROR_CODE_KEYS = {
  unsafe_path: 'archive.errorUnsafePath',
  no_space: 'archive.errorNoSpace',
  invalid_zip: 'archive.errorInvalidZip',
  crc_failed: 'archive.errorCrcFailed',
  read_failed: 'archive.errorReadFailed',
  write_failed: 'archive.errorWriteFailed',
  create_failed: 'archive.errorCreateFailed',
  source_changed: 'files.errorSourceChanged',
  source_tree_changed: 'files.errorSourceChanged',
  cleanup_failed: 'files.errorCleanupFailed',
  destination_exists: 'files.errorDestinationExists',
  type_conflict: 'files.errorTypeConflict',
}

const JOB_TYPE_KEYS = {
  copy: 'common.copy',
  move: 'common.move',
  zip: 'files.createZip',
  unzip: 'files.unzip',
  delete: 'files.delete',
}

const JOB_STATE_KEYS = {
  queued: 'files.jobStateQueued',
  scanning: 'files.jobStateScanning',
  running: 'common.running',
  done: 'common.done',
  attention: 'files.jobStateAttention',
  canceled: 'files.jobStateCanceled',
  error: 'common.error',
}

function FileJobsTray({ jobs, locale, onCancel, onClear, t }) {
  if (!jobs.length) return null
  const active = jobs.filter((job) => ['queued', 'scanning', 'running'].includes(job.state))
  return (
    <div className="mb-3 rounded-xl border border-panel-border bg-bg/55 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-text">{t('files.backgroundJobs')}</div>
          <div className="text-xs text-text-dim">{t('files.backgroundJobsDesc')}</div>
        </div>
        {active.length === 0 && <Button size="sm" tone="ghost" onClick={onClear}>{t('files.clearFinished')}</Button>}
      </div>
      <div className="space-y-2">
        {jobs.slice().reverse().map((job) => {
          const pct = job.total > 0 ? Math.min(100, (job.completed / job.total) * 100) : 0
          const canCancel = ['queued', 'scanning', 'running'].includes(job.state)
          // Multi-source zip jobs join sources with '\n' — show a count instead of a mangled path.
          const sourceCount = job.source.includes('\n') ? job.source.split('\n').length : 1
          const sourceLabel = sourceCount > 1 ? t('common.itemsCount', { count: sourceCount }) : job.source.split('/').pop()
          const typeLabel = t(JOB_TYPE_KEYS[job.type] || 'common.unknown')
          const errorText = job.error_code && ERROR_CODE_KEYS[job.error_code] ? t(ERROR_CODE_KEYS[job.error_code]) : job.error
          const etaSeconds = job.speed > 0 ? (job.total - job.completed) / job.speed : Infinity
          return (
            <div key={job.id} className="pmgr-row-in rounded-lg border border-panel-border px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="rounded bg-panel-border px-1.5 py-0.5 font-bold uppercase text-text-dim">{typeLabel}</span>
                <span className="min-w-0 flex-1 truncate text-text" title={job.source}>{sourceLabel}</span>
                <span className={job.state === 'done' ? 'text-ok' : job.state === 'error' ? 'text-err' : ['attention', 'canceled'].includes(job.state) ? 'text-warn' : 'text-accent'}>
                  {t(JOB_STATE_KEYS[job.state] || 'common.unknown')}
                </span>
                {canCancel && <Button size="sm" tone="danger" onClick={() => onCancel(job.id)}>{t('files.cancelJob')}</Button>}
              </div>
              {job.state !== 'queued' && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-border">
                  <div className={`h-full rounded-full ${job.state === 'error' ? 'bg-err' : job.state === 'attention' ? 'bg-warn' : 'bg-accent'} transition-[width]`} style={{ width: `${['done', 'attention'].includes(job.state) ? 100 : pct}%` }} />
                </div>
              )}
              {errorText && <div className="mt-1 text-err">{errorText}</div>}
              {job.total > 0 && !errorText && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 pmgr-mono text-xs text-text-dim">
                  <span dir="ltr">{formatFileSize(job.completed, locale)} / {formatFileSize(job.total, locale)}</span>
                  {job.total_items > 0 && <span dir="ltr">· {Math.min(job.current_index, job.total_items)} / {job.total_items}</span>}
                  {job.state === 'running' && <span dir="ltr">· {formatSpeed(job.speed, locale)} · {t('files.eta')} {formatEta(etaSeconds)}</span>}
                </div>
              )}
              {job.current && !errorText && (
                <div className="mt-1 truncate text-xs text-text-dim" dir="ltr" title={job.current}>{job.current.split('/').pop()}</div>
              )}
              {!job.ephemeral && job.type !== 'delete' ? (
                <div className="mt-1 truncate text-xs text-text-dim" dir="ltr" title={job.destination}>→ {job.destination}</div>
              ) : job.ephemeral ? (
                <div className="mt-1 text-xs text-text-dim">{job.state === 'done' ? t('archive.downloadStarting') : t('archive.preparingDownload')}</div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TransferConflictDialog({ conflict, onClose, onResolve, t }) {
  const [policy, setPolicy] = useState('keep_both')
  const policies = [
    { id: 'keep_both', label: t('archive.conflict.keep_both') },
    { id: 'skip', label: t('archive.conflict.skip') },
    { id: 'replace', label: t('files.replaceMerge') },
  ]

  return (
    <Dialog
      title={t('files.transferConflictTitle')}
      description={t('files.transferConflictDesc', { count: conflict.conflicts.length })}
      onClose={onClose}
      tone="warn"
      icon={<AlertTriangleIcon size={19} />}
      renderFooter={(close) => (
        <>
          <Button tone="neutral" onClick={close}>{t('common.cancel')}</Button>
          <Button tone={policy === 'replace' ? 'warn' : 'primary'} onClick={() => { close(); onResolve(policy) }}>
            {t('common.confirm')}
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <div className="pmgr-mono max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg border border-panel-border bg-bg/45 px-3 py-2 text-xs text-text-dim">
          {conflict.conflicts.map((entry) => entry.name).join('\n')}
        </div>
        <div role="radiogroup" className="grid gap-2">
          {policies.map((option) => {
            const selected = policy === option.id
            return (
              <label
                key={option.id}
                className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-[border-color,background-color,color] ${
                  selected ? 'border-accent/55 bg-accent/[0.08] text-text' : 'border-panel-border bg-bg/25 text-text-dim hover:border-accent/30 hover:text-text'
                }`}
              >
                <input
                  type="radio"
                  name="transfer-conflict-policy"
                  value={option.id}
                  checked={selected}
                  onChange={() => setPolicy(option.id)}
                  className="peer sr-only"
                />
                <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg ${selected ? 'border-accent' : 'border-text-dim/60'}`}>
                  {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
                </span>
                <span>{option.label}</span>
              </label>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}

function FolderPickerModal({ entries, sourceDir, type, initialPath, volumes, onClose, onConfirm, t }) {
  const single = entries.length === 1
  const validate = (folder) => {
    if (folder === sourceDir) return t('files.collisionError', { name: '' })
    for (const entry of entries) {
      const source = joinPath(sourceDir, entry.name)
      if (entry.is_dir && (folder === source || folder.startsWith(`${source}/`))) {
        return t('files.invalidNameError', { name: entry.name })
      }
    }
    return ''
  }
  const label = type === 'copy' ? t('files.copyTo') : t('files.moveTo')
  return (
    <PathPickerModal
      title={single ? `${label} "${entries[0].name}"` : `${label} (${entries.length})`}
      description={t('pkg.pathPickerDesc')}
      initialPath={initialPath}
      volumes={volumes}
      mode="folder"
      actionLabel={label}
      validateSelection={validate}
      onClose={onClose}
      onSelect={(folder) => onConfirm(folder)}
    />
  )
}

// Numbered bulk rename with a live preview — files keep their extension,
// folders don't get one invented for them.
function computeRenamePlan(entries, baseName) {
  return entries.map((entry, i) => {
    if (entry.is_dir) return { entry, newName: `${baseName} (${i + 1})` }
    const dot = entry.name.lastIndexOf('.')
    const ext = dot > 0 ? entry.name.slice(dot) : ''
    return { entry, newName: `${baseName} (${i + 1})${ext}` }
  })
}

function BulkRenameDialog({ entries, siblingEntries, onClose, onConfirm }) {
  const { t } = useI18n()
  const [baseName, setBaseName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const trimmed = baseName.trim()
  const plan = computeRenamePlan(entries, trimmed)
  const selectedNames = new Set(entries.map((e) => e.name))

  const validationError = (() => {
    if (!trimmed) return ''
    if (!isSafeName(trimmed)) return t('files.invalidNameError', { name: trimmed })
    const targets = plan.map((p) => p.newName)
    if (new Set(targets).size !== targets.length) return t('files.duplicateNameError')
    for (const p of plan) {
      if (siblingEntries.some((e) => !selectedNames.has(e.name) && e.name === p.newName)) {
        return t('files.collisionError', { name: p.newName })
      }
    }
    return ''
  })()

  const submit = async (close) => {
    if (!trimmed || validationError || busy) return
    setBusy(true)
    setError('')
    try {
      await onConfirm(plan)
      close()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('files.bulkRenameTitle', { count: entries.length })}
      onClose={onClose}
      initialFocusRef={inputRef}
      renderFooter={(close) => (
        <>
          <Button tone="neutral" onClick={close} disabled={busy}>{t('common.cancel')}</Button>
          <Button tone="primary" sheen disabled={busy || !trimmed || Boolean(validationError)} onClick={() => submit(close)}>
            {busy ? t('common.working') : t('common.confirm')}
          </Button>
        </>
      )}
    >
      {(close) => (
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-text-dim">{t('files.baseNameLabel')}</label>
          <input
            ref={inputRef}
            value={baseName}
            onChange={(e) => setBaseName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit(close)}
            placeholder={t('files.archiveName')}
            className="min-h-10 w-full rounded-lg border border-panel-border bg-bg px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
          />
          {(validationError || error) && <div className="mt-1.5 text-xs text-err">{validationError || error}</div>}
          {trimmed && !validationError && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-text-dim">{t('files.renamePreview')}</div>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-panel-border bg-bg/45 p-2">
                {plan.map((p) => (
                  <div key={p.entry.name} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-text-dim">{p.entry.name}</span>
                    <span className="shrink-0 text-text-dim">→</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-text">{p.newName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

function BulkDeleteDialog({ entries, onClose, onConfirm }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const folders = entries.filter((e) => e.is_dir).length
  const files = entries.length - folders
  const description = folders > 0 && files > 0
    ? t('files.bulkDeleteDesc', { folders, files })
    : folders > 0
      ? t('files.bulkDeleteFoldersOnlyDesc', { count: folders })
      : t('files.bulkDeleteFilesOnlyDesc', { count: files })

  const submit = async (close) => {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      close()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('files.bulkDeleteTitle', { count: entries.length })}
      description={description}
      tone="danger"
      icon={<AlertTriangleIcon size={19} />}
      onClose={onClose}
      renderFooter={(close) => (
        <>
          <Button tone="neutral" onClick={close} disabled={busy}>{t('common.cancel')}</Button>
          <Button tone="danger" disabled={busy} onClick={() => submit(close)}>
            {busy ? t('common.working') : t('common.delete')}
          </Button>
        </>
      )}
    >
      {error && <div className="mb-2 rounded-lg border border-err/25 bg-err/10 px-3 py-2 text-xs text-err">{error}</div>}
      <CollapsibleSection title={t('files.previewSelection')} defaultOpen={false}>
        <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
          {entries.map((e) => (
            <div key={e.name} className="flex items-center gap-1.5 truncate text-text-dim">
              {e.is_dir ? <FolderIcon size={12} /> : <FileIcon size={12} />} {e.name}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </Dialog>
  )
}

// Memoized — the 1s file-jobs poll below otherwise re-renders every row,
// regardless of directory size.
const FileRow = memo(function FileRow({
  entry, index, fullPath, isSelected, isFocused, t, locale,
  onRowClick, onOpenDir, onToggleSelect, onInspectArchive, onDownload,
  onDownloadFolder, onEdit, onPreview, onUnzip, onZip, onRename, onCopyTo, onMoveTo, onPermissions, onDelete,
}) {
  const editable = !entry.is_dir && isEditable(entry.name)
  const previewable = !entry.is_dir && isImage(entry.name)
  const isArchive = !entry.is_dir && isExtractableArchive(entry.name)

  return (
    <tr
      onClick={(event) => onRowClick(event, entry, index)}
      onDoubleClick={(event) => {
        if (!entry.is_dir || event.target.closest('button, a, input, select, textarea')) return
        onOpenDir(entry.name)
      }}
      title={entry.is_dir ? t('files.editPath') : undefined}
      className={`pmgr-row-in border-t transition-colors duration-150 ${
        isSelected ? 'border-accent/25 bg-accent/[0.07]' : 'border-panel-border hover:bg-panel-2'
      } ${isFocused ? 'outline outline-2 -outline-offset-2 outline-accent/70' : ''}`}
      style={{ '--ti': index }}
    >
      <td className="py-2.5">
        <Checkbox checked={isSelected} onChange={() => onToggleSelect(fullPath, index)} label={t('files.selectRow', { name: entry.name })} />
      </td>
      <td className="py-2.5">
        {entry.is_dir ? (
          <button onClick={() => onOpenDir(entry.name)} className="inline-flex items-center gap-2 font-medium text-accent hover:underline">
            <FolderIcon size={17} /> {entry.name}
          </button>
        ) : isArchive ? (
          <button onClick={() => onInspectArchive(fullPath, entry.name)} title={t('archive.openArchive')} className="inline-flex items-center gap-2 font-medium text-accent hover:underline">
            <ZipIcon size={16} /> {entry.name}
          </button>
        ) : previewable ? (
          <button onClick={() => onPreview(fullPath)} title={t('files.preview')} className="inline-flex items-center gap-2 font-medium text-accent hover:underline">
            <FileIcon size={16} /> {entry.name}
          </button>
        ) : (
          <span className="inline-flex items-center gap-2 text-text"><FileIcon size={16} /> {entry.name}</span>
        )}
        <div className="mt-0.5 pl-[26px] text-xs text-text-dim sm:hidden">
          {entry.is_dir ? '—' : formatFileSize(entry.size, locale)}
          {' · '}{formatModified(entry.modified, locale)}{' · '}{formatMode(entry.mode)}
        </div>
      </td>
      <td className="hidden py-1.5 text-text-dim sm:table-cell">
        {entry.is_dir ? '—' : formatFileSize(entry.size, locale)}
      </td>
      <td className="hidden py-1.5 text-text-dim md:table-cell" title={formatModified(entry.modified, locale)}>
        {formatModified(entry.modified, locale)}
      </td>
      <td className="hidden py-1.5 pmgr-mono text-xs text-text-dim lg:table-cell">{formatMode(entry.mode)}</td>
      <td className="py-1.5 text-right">
        <div className="flex justify-end gap-1.5">
          {!entry.is_dir && (
            <Button size="icon" tone="ghost" title={t('files.download')} onClick={() => onDownload(entry)} icon={<DownloadIcon size={15} />} />
          )}
          <ActionMenu
            label={t('common.moreActions')}
            items={[
              editable && {
                label: entry.size > MAX_EDIT_BYTES ? t('files.editTooLarge') : t('files.edit'),
                icon: <EditIcon size={15} />,
                disabled: entry.size > MAX_EDIT_BYTES,
                onClick: () => onEdit(fullPath),
              },
              previewable && {
                label: t('files.preview'),
                icon: <FileIcon size={15} />,
                onClick: () => onPreview(fullPath),
              },
              entry.is_dir && {
                label: t('files.downloadAsZip'),
                icon: <DownloadIcon size={15} />,
                onClick: () => onDownloadFolder(entry),
              },
              isArchive && {
                label: t('archive.openArchive'),
                icon: <ZipIcon size={15} />,
                onClick: () => onInspectArchive(fullPath, entry.name),
              },
              isArchive && {
                label: t('files.unzip'),
                icon: <UnzipIcon size={15} />,
                onClick: () => onUnzip(entry),
              },
              {
                label: t('files.createZip'),
                icon: <ZipIcon size={15} />,
                onClick: () => onZip(entry),
              },
              '-',
              { label: t('files.rename'), icon: <RenameIcon size={15} />, onClick: () => onRename(entry) },
              { label: t('files.copyTo'), icon: <CopyIcon size={15} />, onClick: () => onCopyTo(entry) },
              { label: t('files.moveTo'), icon: <MoveIcon size={15} />, onClick: () => onMoveTo(entry) },
              { label: t('common.permissions'), icon: <EditIcon size={15} />, onClick: () => onPermissions(entry) },
              '-',
              { label: t('files.delete'), icon: <DeleteIcon size={15} />, tone: 'danger', onClick: () => onDelete(entry) },
            ]}
          />
        </div>
      </td>
    </tr>
  )
})

export default function FtpView() {
  const { t, locale } = useI18n()
  const [path, setPath] = useState(savedPath)
  const [pathInput, setPathInput] = useState(path)
  const [editingPathBar, setEditingPathBar] = useState(false)
  const [entries, setEntries] = useState([])
  const [search, setSearch] = useState(() => window.sessionStorage.getItem(SEARCH_SESSION_KEY) || '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingPath, setEditingPath] = useState(null)
  const [previewPath, setPreviewPath] = useState(null)
  const [volumes, setVolumes] = useState([])
  const [fileJobs, setFileJobs] = useState([])
  const [destinationPicker, setDestinationPicker] = useState(null) // { entries, type }
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('pmgr-files-sort') || 'name')
  const [sortDirection, setSortDirection] = useState(() => localStorage.getItem('pmgr-files-sort-direction') || 'asc')
  const [permissionsEntry, setPermissionsEntry] = useState(null)
  const [dialog, setDialog] = useState(null) // { kind: 'mkdir'|'newFile'|'rename'|'delete', entry? }
  const [bulkDialog, setBulkDialog] = useState(null) // { kind: 'delete'|'rename' }
  const [createArchiveEntries, setCreateArchiveEntries] = useState(null)
  const [extractArchiveEntries, setExtractArchiveEntries] = useState(null)
  const [uploadConflict, setUploadConflict] = useState(null)
  const [transferConflict, setTransferConflict] = useState(null)
  const [inspectorArchive, setInspectorArchive] = useState(null) // { path, name }
  const [selected, setSelected] = useState(() => new Set()) // full paths
  const [focusedIndex, setFocusedIndex] = useState(null) // keyboard cursor row, in visibleEntries
  const lastIndexRef = useRef(null)
  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)
  const downloadedEphemeralRef = useRef(new Set())
  const loadGenerationRef = useRef(0)
  const showToast = useToast()
  const { transfers, start, progress, finish, retry } = useTransfers()

  const load = useCallback((p) => {
    const generation = ++loadGenerationRef.current
    const navigating = p !== path
    setLoading(true)
    setError('')
    api.ftp
      .list(p)
      .then((r) => {
        if (generation !== loadGenerationRef.current) return
        setEntries(r.entries || [])
        setPath(p)
        window.sessionStorage.setItem(PATH_SESSION_KEY, p)
        setPathInput(p)
        setEditingPathBar(false)
        if (navigating) {
          setSearch('')
          setSelected(new Set())
          setFocusedIndex(null)
          lastIndexRef.current = null
        }
      })
      .catch((e) => {
        if (generation === loadGenerationRef.current) setError(e.message)
      })
      .finally(() => {
        if (generation === loadGenerationRef.current) setLoading(false)
      })
  }, [path])

  useEffect(() => {
    load(path)
    api.ftp.storage().then((r) => setVolumes(r.volumes || [])).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.sessionStorage.setItem(SEARCH_SESSION_KEY, search)
  }, [search])

  // Reload the listing when a background job finishes instead of leaving it stale.
  // Must not disturb the selection — only changing folder does that.
  const jobStatesRef = useRef({})
  const jobSamplesRef = useRef({})
  const jobReloadPendingRef = useRef(false)
  useEffect(() => {
    let stopped = false
    const poll = () =>
      api.ftp
        .jobs()
        .then((r) => {
          if (stopped) return
          const now = performance.now()
          const jobs = (r.jobs || []).map((job) => {
            const previous = jobSamplesRef.current[job.id]
            let speed = previous?.speed || 0
            if (previous && job.completed >= previous.completed && now > previous.at && job.state === 'running') {
              const sample = ((job.completed - previous.completed) * 1000) / (now - previous.at)
              if (sample > 0) speed = speed > 0 ? speed * 0.65 + sample * 0.35 : sample
            }
            jobSamplesRef.current[job.id] = { completed: job.completed, at: now, speed }
            return { ...job, speed }
          })
          const liveIds = new Set(jobs.map((job) => job.id))
          for (const id of Object.keys(jobSamplesRef.current)) {
            if (!liveIds.has(Number(id))) delete jobSamplesRef.current[id]
          }
          const prev = jobStatesRef.current
          // No truthy check on prev[job.id] — a fast job can go straight from
          // unseen to "done" between two polls and must still trigger a reload.
          const justFinished = jobs.filter((job) => prev[job.id] !== job.state && job.state === 'done')
          const hasActiveJobs = jobs.some((job) => ['queued', 'scanning', 'running'].includes(job.state))
          jobStatesRef.current = Object.fromEntries(jobs.map((job) => [job.id, job.state]))
          setFileJobs(jobs)
          if (justFinished.some((job) => !job.ephemeral && jobAffectsDirectory(job, path))) jobReloadPendingRef.current = true
          if (!hasActiveJobs && jobReloadPendingRef.current) {
            jobReloadPendingRef.current = false
            load(path)
          }

          // Hand the finished temp archive straight to the browser's download
          // manager, once per job and with no blob buffering.
          for (const job of jobs) {
            if (job.ephemeral && job.state === 'done' && !downloadedEphemeralRef.current.has(job.id)) {
              downloadedEphemeralRef.current.add(job.id)
              const a = document.createElement('a')
              a.href = api.ftp.downloadUrl(job.destination)
              a.download = job.destination.split('/').pop()
              a.click()
            }
          }
        })
        .catch(() => {})
    poll()
    const id = setInterval(poll, 1000)
    return () => { stopped = true; clearInterval(id) }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  const openDir = useCallback((name) => load(joinPath(path, name)), [load, path])
  const goUp = () => {
    if (path === '/') return
    load(path.replace(/\/[^/]+\/?$/, '') || '/')
  }

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLocaleLowerCase(locale)
    const filtered = q ? entries.filter((e) => e.name.toLocaleLowerCase(locale).includes(q)) : entries
    const direction = sortDirection === 'desc' ? -1 : 1
    return [...filtered].sort((first, second) => {
      let compared = 0
      if (sortBy === 'size') compared = first.size - second.size
      else if (sortBy === 'modified') compared = first.modified.localeCompare(second.modified)
      else if (sortBy === 'mode') compared = first.mode - second.mode
      else if (sortBy === 'type') compared = (first.is_dir ? '' : fileType(first)).localeCompare(second.is_dir ? '' : fileType(second), locale)
      else compared = first.name.localeCompare(second.name, locale)
      if (compared === 0) compared = first.name.localeCompare(second.name, locale)
      return compared * direction
    })
  }, [entries, search, locale, sortBy, sortDirection])

  // Longest-prefix match — the volume the current folder actually lives on,
  // for the Create Archive dialog's "available space" preflight line.
  const currentVolume = useMemo(
    () => volumes.filter((v) => path === v.path || path.startsWith(`${v.path}/`)).sort((a, b) => b.path.length - a.path.length)[0],
    [volumes, path],
  )

  // ---- Selection ------------------------------------------------------

  const fullPathOf = useCallback((entry) => joinPath(path, entry.name), [path])

  const toggleSelect = useCallback((fullPath) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(fullPath)) next.delete(fullPath)
      else next.add(fullPath)
      return next
    })
  }, [])

  const selectRange = useCallback((fromIndex, toIndex) => {
    const [rangeStart, rangeEnd] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
    setSelected((prev) => {
      const next = new Set(prev)
      for (let i = rangeStart; i <= rangeEnd; i++) next.add(fullPathOf(visibleEntries[i]))
      return next
    })
  }, [visibleEntries, fullPathOf])

  const selectAllVisible = () => setSelected(new Set(visibleEntries.map(fullPathOf)))
  const clearSelection = () => setSelected(new Set())

  // Combines the checkbox toggle with the shift-click anchor update, kept
  // stable so FileRow's memo isn't broken by a fresh arrow every render.
  const onToggleSelectRow = useCallback((fullPath, index) => {
    toggleSelect(fullPath)
    lastIndexRef.current = index
  }, [toggleSelect])

  const onRowClick = useCallback((event, entry, index) => {
    if (event.target.closest('button, a, input, select, textarea')) return
    setFocusedIndex(index)
    if (event.shiftKey && lastIndexRef.current !== null) {
      selectRange(lastIndexRef.current, index)
      return
    }
    if (event.ctrlKey || event.metaKey || selected.size > 0) {
      toggleSelect(fullPathOf(entry))
      lastIndexRef.current = index
    }
  }, [selected, selectRange, toggleSelect, fullPathOf])

  const modalOpen = Boolean(editingPath || previewPath || dialog || destinationPicker || bulkDialog || permissionsEntry)

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.has(fullPathOf(e))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, selected, path],
  )
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((e) => selected.has(fullPathOf(e)))
  const someVisibleSelected = visibleEntries.some((e) => selected.has(fullPathOf(e)))

  // ---- Single-item actions ----------------------------------------------

  const doMkdir = (name) =>
    api.ftp.mkdir(joinPath(path, name)).then(() => load(path))

  const doNewFile = (name) =>
    api.ftp.writeText(joinPath(path, name), '').then(() => load(path))

  const doDelete = (entry) =>
    api.ftp.delete(joinPath(path, entry.name), entry.is_dir ? 'dir' : 'file').then(() => showToast(t('files.jobQueued')))

  const doRename = (entry, next) =>
    api.ftp.rename(joinPath(path, entry.name), joinPath(path, next)).then(() => load(path))

  const doZip = useCallback((entry) => setCreateArchiveEntries([entry]), [])
  const doUnzip = useCallback((entry) => setExtractArchiveEntries([entry]), [])
  const onArchiveCreated = () => { showToast(t('files.jobQueued')); clearSelection() }
  const onArchiveExtracted = () => { showToast(t('files.jobQueued')); clearSelection() }

  const downloadFile = useCallback((entry) => {
    const dest = joinPath(path, entry.name)
    const a = document.createElement('a')
    a.href = api.ftp.downloadUrl(dest)
    a.download = entry.name
    a.click()
  }, [path])

  // Builds into Prospero's temp directory, never the visible file tree. The backend
  // unlinks it as the download opens, so nothing is left behind.
  const downloadAsZip = useCallback((paths, name) => {
    api.ftp
      .downloadZip(paths, name)
      .then(() => showToast(t('files.jobQueued')))
      .catch((e) => showToast(e.message, 'err'))
  }, [t, showToast])

  const downloadFolder = useCallback((entry) => downloadAsZip([joinPath(path, entry.name)], `${entry.name}.zip`), [downloadAsZip, path])

  // Stable openers so FileRow's memo isn't broken by fresh arrows per render.
  const openEditor = useCallback((fullPath) => setEditingPath(fullPath), [])
  const openPreview = useCallback((fullPath) => setPreviewPath(fullPath), [])
  const openArchiveInspector = useCallback((fullPath, name) => setInspectorArchive({ path: fullPath, name }), [])
  const openRenameDialog = useCallback((entry) => setDialog({ kind: 'rename', entry }), [])
  const openDeleteDialog = useCallback((entry) => setDialog({ kind: 'delete', entry }), [])

  const activateEntry = useCallback((entry, entryFullPath) => {
    if (entry.is_dir) return openDir(entry.name)
    if (isExtractableArchive(entry.name)) return openArchiveInspector(entryFullPath, entry.name)
    if (isImage(entry.name)) return openPreview(entryFullPath)
  }, [openDir, openArchiveInspector, openPreview])

  // Row-level keyboard nav: arrow keys move a focus cursor independent of selection,
  // Enter/F2/Delete act on whichever row that cursor is on (or the selection, for Delete).
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (modalOpen || inField) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAllVisible()
        return
      }
      if (e.key === 'Escape' && selected.size > 0) {
        clearSelection()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (visibleEntries.length === 0) return
        e.preventDefault()
        setFocusedIndex((current) => {
          const base = current === null ? -1 : current
          const next = base + (e.key === 'ArrowDown' ? 1 : -1)
          return Math.min(Math.max(next, 0), visibleEntries.length - 1)
        })
        return
      }
      if (focusedIndex === null || focusedIndex >= visibleEntries.length) return
      const entry = visibleEntries[focusedIndex]
      const entryFullPath = fullPathOf(entry)
      if (e.key === 'Enter') {
        e.preventDefault()
        activateEntry(entry, entryFullPath)
      } else if (e.key === 'F2') {
        e.preventDefault()
        openRenameDialog(entry)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (selected.size > 0) setBulkDialog({ kind: 'delete' })
        else openDeleteDialog(entry)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, selected, visibleEntries, focusedIndex, activateEntry])

  const openCopyPicker = useCallback((entry) => setDestinationPicker({ entries: [entry], type: 'copy' }), [])
  const openMovePicker = useCallback((entry) => setDestinationPicker({ entries: [entry], type: 'move' }), [])
  const openPermissions = useCallback((entry) => setPermissionsEntry(entry), [])

  const performUploads = async (items, targetDir, overwrite) => {
    setError('')
    const total = items.reduce((sum, item) => sum + item.file.size, 0)
    await api.ftp.preflight(targetDir, total, true)
    const directories = new Set()
    for (const item of items) {
      const parts = item.relativePath.split('/')
      for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
    }
    for (const relative of [...directories].sort((a, b) => a.split('/').length - b.split('/').length)) {
      await api.ftp.mkdir(joinPath(targetDir, relative))
    }
    for (const item of items) {
      const { file, relativePath } = item
      const dest = joinPath(targetDir, relativePath)
      const id = start(relativePath, 'upload', file.size)
      try {
        await api.ftp.uploadWithProgress(
          dest,
          file,
          (loaded, total) => progress(id, loaded, total),
          () => retry(id),
          overwrite,
        )
        finish(id)
      } catch (e) {
        finish(id, e.message)
        showToast(`${relativePath}: ${e.message}`, 'err')
      }
    }
    load(path)
  }

  // Mirrors TransferConflictDialog's copy/move policies for uploads: replace overwrites
  // in place, skip drops the conflicting items, keep_both renames them server-side first.
  const resolveUploadConflict = async (policy) => {
    const { items, targetDir, conflicts } = uploadConflict
    setUploadConflict(null)
    if (policy === 'replace') {
      await performUploads(items, targetDir, true)
      return
    }
    if (policy === 'skip') {
      const names = new Set(conflicts.map((item) => item.relativePath))
      const remaining = items.filter((item) => !names.has(item.relativePath))
      if (remaining.length) await performUploads(remaining, targetDir, false)
      return
    }
    // keep_both
    const conflictPaths = conflicts.map((item) => joinPath(targetDir, item.relativePath))
    const result = await api.ftp.uniqueNames(conflictPaths)
    const renamedByOldPath = new Map(conflictPaths.map((oldPath, i) => [oldPath, result.paths[i]]))
    const resolved = items.map((item) => {
      const oldPath = joinPath(targetDir, item.relativePath)
      const uniquePath = renamedByOldPath.get(oldPath)
      return uniquePath ? { ...item, relativePath: uniquePath.slice(targetDir.length).replace(/^\//, '') } : item
    })
    await performUploads(resolved, targetDir, false)
  }

  const uploadFiles = async (files, targetDir = path) => {
    try {
      const items = files.map((file) => ({ file, relativePath: uploadRelativePath(file), name: uploadRelativePath(file) }))
      if (items.some((item) => !item.relativePath)) throw new Error(t('common.invalidUploadPath'))
      const destinations = items.map((item) => joinPath(targetDir, item.relativePath))
      const existing = new Set()
      for (let offset = 0; offset < destinations.length; offset += 512) {
        const result = await api.ftp.conflicts(destinations.slice(offset, offset + 512))
        for (const existingPath of result.paths || []) existing.add(existingPath)
      }
      const conflicts = items.filter((item) => existing.has(joinPath(targetDir, item.relativePath)))
      if (conflicts.length > 0) {
        setUploadConflict({ items, targetDir, conflicts })
        return
      }
      await performUploads(items, targetDir, false)
    } catch (e) {
      showToast(e.message, 'err')
    }
  }

  const doUpload = (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length) uploadFiles(files)
  }

  // ---- Bulk actions -------------------------------------------------------
  // Sequential requests keep queue errors tied to the item that caused them.

  const runBulk = async (label, fn, targetEntries = selectedEntries, reload = true) => {
    let okCount = 0
    let firstError = ''
    for (const entry of targetEntries) {
      try {
        await fn(entry)
        okCount++
      } catch (e) {
        if (!firstError) firstError = `${entry.name}: ${e.message}`
      }
    }
    if (reload) load(path)
    clearSelection()
    if (firstError) showToast(firstError, 'err')
    else showToast(`${label} · ${okCount}`)
  }

  const bulkDelete = () =>
    runBulk(t('files.jobQueued'), (entry) => api.ftp.delete(joinPath(path, entry.name), entry.is_dir ? 'dir' : 'file'), selectedEntries, false)

  const bulkRename = (plan) => {
    const apply = async () => {
      for (const { entry, newName } of plan) {
        await api.ftp.rename(joinPath(path, entry.name), joinPath(path, newName))
      }
    }
    return apply().then(() => {
      load(path)
      clearSelection()
    })
  }

  const queueCopyMove = (picker, folder, policy, entries = picker.entries) =>
    runBulk(picker.type === 'copy' ? t('common.copy') : t('common.move'), (entry) =>
      api.ftp[picker.type](joinPath(path, entry.name), joinPath(folder, entry.name), policy),
    entries, false)

  const bulkCopyMove = async (folder) => {
    const picker = destinationPicker
    if (!picker) return
    const listing = await api.ftp.list(folder)
    const existing = new Set((listing.entries || []).map((entry) => entry.name))
    const conflicts = picker.entries.filter((entry) => existing.has(entry.name))
    setDestinationPicker(null)
    if (conflicts.length > 0) {
      setTransferConflict({ picker, folder, conflicts })
      return
    }
    await queueCopyMove(picker, folder, 'cancel')
  }

  const zipCount = selectedEntries.filter((e) => !e.is_dir && isExtractableArchive(e.name)).length

  const bulkDownloadZip = () => downloadAsZip(selectedEntries.map((e) => joinPath(path, e.name)), `Archive-${Date.now()}.zip`)

  const bulkUnzip = () => {
    const archives = selectedEntries.filter((e) => !e.is_dir && isExtractableArchive(e.name))
    setExtractArchiveEntries(archives)
  }

  // ---- Action lists -------------------------------------------------------

  const bulkActions = [
    { id: 'rename', label: selected.size === 1 ? t('files.rename') : t('files.bulkRename'), icon: <RenameIcon size={15} />, onClick: () => setBulkDialog({ kind: 'rename' }) },
    { id: 'copy', label: t('files.bulkCopy'), icon: <CopyIcon size={15} />, onClick: () => setDestinationPicker({ entries: selectedEntries, type: 'copy' }) },
    { id: 'move', label: t('files.bulkMove'), icon: <MoveIcon size={15} />, onClick: () => setDestinationPicker({ entries: selectedEntries, type: 'move' }) },
    { id: 'zip', label: t('files.bulkZip'), icon: <ZipIcon size={15} />, onClick: () => setCreateArchiveEntries(selectedEntries) },
    zipCount > 0 && {
      id: 'unzip',
      label: zipCount < selectedEntries.length ? `${t('files.bulkUnzip')} (${zipCount})` : t('files.bulkUnzip'),
      icon: <UnzipIcon size={15} />,
      onClick: bulkUnzip,
    },
    { id: 'download', label: t('files.bulkDownloadZip'), icon: <DownloadIcon size={15} />, onClick: bulkDownloadZip },
    { id: 'delete', label: t('files.bulkDelete'), icon: <DeleteIcon size={15} />, tone: 'danger', onClick: () => setBulkDialog({ kind: 'delete' }) },
  ].filter(Boolean)

  const primaryBulkIds = new Set(['move', 'delete'])

  return (
    <Panel
      title={t('files.title')}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button tone="neutral" icon={<NewFileIcon size={15} />} onClick={() => setDialog({ kind: 'newFile' })}>{t('files.newFile')}</Button>
          <Button tone="neutral" icon={<NewFolderIcon size={15} />} onClick={() => setDialog({ kind: 'mkdir' })}>{t('files.newFolder')}</Button>
          <Button tone="primary" icon={<UploadIcon size={15} />} onClick={() => fileInputRef.current?.click()}>
            {t('files.upload')}
          </Button>
          <Button tone="neutral" icon={<FolderIcon size={15} />} onClick={() => folderInputRef.current?.click()}>
            {t('common.uploadFolder')}
          </Button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={doUpload} />
          <input ref={folderInputRef} type="file" webkitdirectory="" multiple hidden onChange={doUpload} />
        </div>
      }
    >
      <DropZone global onFiles={uploadFiles} label={t('files.dropToUpload', { path })}>
        {volumes.length > 0 && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {volumes.map((volume) => {
              const used = volume.total > 0 ? Math.max(0, Math.min(100, ((volume.total - volume.free) / volume.total) * 100)) : 0
              return (
                <button
                  type="button"
                  key={volume.path}
                  onClick={() => load(volume.path)}
                  className="rounded-xl border border-panel-border bg-bg/55 p-3 text-left transition-colors hover:border-accent/40 focus-visible:border-accent/40"
                >
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-text">{volumeLabel(volume, t)}</span>
                    <span className="pmgr-mono text-text-dim">{t('files.storageFree', { size: formatFileSize(volume.free, locale) })}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-border">
                    <div className={`h-full rounded-full transition-[width] duration-300 ${volumeBarClass(used)}`} style={{ width: `${used}%` }} />
                  </div>
                  <div className="mt-1.5 truncate text-xs text-text-dim" dir="ltr">{volume.path} · {formatFileSize(volume.total, locale)}</div>
                </button>
              )
            })}
          </div>
        )}

        <div className="mb-3 flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-panel-border bg-bg/60 px-2 py-1.5">
          {editingPathBar ? (
            <>
              <input
                autoFocus
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load(pathInput)}
                onBlur={() => setPathInput(path)}
                dir="ltr"
                aria-label={t('files.editPath')}
                className="min-w-0 flex-1 bg-transparent px-1 py-1 text-xs text-text outline-none"
              />
              <Button size="sm" tone="neutral" onClick={() => load(pathInput)}>{t('files.go')}</Button>
              <Button size="sm" tone="ghost" onClick={() => { setEditingPathBar(false); setPathInput(path) }}>{t('common.cancel')}</Button>
            </>
          ) : (
            <>
              {pathCrumbs(path).map((crumb, index, crumbs) => (
                <div key={crumb.path} className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => load(crumb.path)}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${index === crumbs.length - 1 ? 'bg-accent/15 text-accent' : 'text-text-dim hover:bg-panel-border hover:text-text'}`}
                  >
                    {crumb.label}
                  </button>
                  {index < crumbs.length - 1 && <span className="text-text-dim/50">/</span>}
                </div>
              ))}
              <button
                onClick={() => setEditingPathBar(true)}
                className="ml-1 shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-text-dim hover:bg-panel-border hover:text-text"
              >
                {t('files.editPath')}
              </button>
              <span className="ml-auto shrink-0 px-2 text-xs font-semibold uppercase tracking-wide text-text-dim">
                {t('files.itemsInFolder', { count: visibleEntries.length })}
              </span>
            </>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="icon" tone="neutral" title={t('files.up')} disabled={path === '/'} onClick={goUp} icon={<GoUpIcon size={16} />} />
          <SearchField value={search} onChange={setSearch} placeholder={t('files.searchPlaceholder')} className="min-w-40 flex-1" />
          <label className="sr-only" htmlFor="files-sort">{t('common.sortLabel')}</label>
          <select
            id="files-sort"
            value={sortBy}
            onChange={(event) => { setSortBy(event.target.value); localStorage.setItem('pmgr-files-sort', event.target.value) }}
            className="min-h-9 rounded-lg border border-panel-border bg-bg px-2.5 text-xs font-semibold text-text outline-none focus:border-accent"
          >
            <option value="name">{t('common.name')}</option>
            <option value="type">{t('common.type')}</option>
            <option value="size">{t('common.size')}</option>
            <option value="modified">{t('common.modified')}</option>
            <option value="mode">{t('common.permissions')}</option>
          </select>
          <Button
            size="icon"
            tone="neutral"
            title={sortDirection === 'asc' ? t('common.sortAscending') : t('common.sortDescending')}
            onClick={() => {
              const next = sortDirection === 'asc' ? 'desc' : 'asc'
              setSortDirection(next)
              localStorage.setItem('pmgr-files-sort-direction', next)
            }}
          >
            <span aria-hidden="true">{sortDirection === 'asc' ? '↑' : '↓'}</span>
          </Button>
          <Button size="icon" tone="neutral" title={t('files.refresh')} onClick={() => load(path)} icon={<RefreshIcon size={16} />} />
        </div>

        {/* Contextual bulk toolbar — only appears in selection mode, animates
            in/out rather than shifting the layout abruptly. */}
        {selected.size > 0 && (
          <div className="pmgr-row-in mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5">
            <span className="text-sm font-bold text-text">{t('common.selectedCount', { count: selected.size })}</span>

            {/* Desktop: full action row. */}
            <div className="ml-auto hidden flex-wrap items-center gap-1.5 sm:flex">
              {bulkActions.map((action) => (
                <Button key={action.id} size="sm" tone={action.tone === 'danger' ? 'danger' : 'neutral'} icon={action.icon} onClick={action.onClick}>
                  {action.label}
                </Button>
              ))}
            </div>

            {/* Mobile: primary two + More. */}
            <div className="ml-auto flex items-center gap-1.5 sm:hidden">
              {bulkActions.filter((a) => primaryBulkIds.has(a.id)).map((action) => (
                <Button key={action.id} size="sm" tone={action.tone === 'danger' ? 'danger' : 'neutral'} icon={action.icon} onClick={action.onClick}>
                  {action.label}
                </Button>
              ))}
              <ActionMenu label={t('common.moreActions')} items={bulkActions.filter((a) => !primaryBulkIds.has(a.id))} />
            </div>

            <div className="flex w-full items-center gap-3 border-t border-accent/15 pt-2 text-xs sm:w-auto sm:border-0 sm:pt-0">
              <button onClick={selectAllVisible} className="font-semibold text-accent hover:underline">{t('common.selectAll')}</button>
              <button onClick={clearSelection} className="font-semibold text-text-dim hover:text-text hover:underline">{t('common.clearSelection')}</button>
            </div>
          </div>
        )}

        <TransferTray transfers={transfers} locale={locale} t={t} />
        <FileJobsTray
          jobs={fileJobs}
          locale={locale}
          onCancel={(id) => api.ftp.cancelJob(id).catch((e) => showToast(e.message, 'err'))}
          onClear={() => api.ftp.clearJobs().then(() => setFileJobs([])).catch((e) => showToast(e.message, 'err'))}
          t={t}
        />

        {error && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-err/20 bg-err/10 px-3 py-2.5 text-sm text-err">
            <span>{error}</span>
            <Button size="sm" tone="danger" onClick={() => load(path)}>{t('common.tryAgain')}</Button>
          </div>
        )}

        {loading ? (
          <SkeletonRows count={6} />
        ) : visibleEntries.length === 0 ? (
          entries.length === 0 ? (
            <EmptyState
              icon={<FolderIcon size={24} />}
              title={t('files.emptyFolderTitle')}
              description={t('files.emptyFolderDesc')}
              action={<Button tone="primary" icon={<UploadIcon size={15} />} onClick={() => fileInputRef.current?.click()}>{t('files.upload')}</Button>}
            />
          ) : (
            <EmptyState size="sm" title={t('files.noSearchMatchTitle')} description={t('files.noSearchMatchDesc', { query: search })} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-text-dim">
                  <th className="w-11 pb-2">
                    <Checkbox
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected && !allVisibleSelected}
                      onChange={(checked) => (checked ? selectAllVisible() : clearSelection())}
                      label={t('files.selectAllVisible')}
                    />
                  </th>
                  <th className="pb-2 font-medium">{t('common.name')}</th>
                  <th className="hidden pb-2 font-medium sm:table-cell">{t('common.size')}</th>
                  <th className="hidden pb-2 font-medium md:table-cell">{t('common.modified')}</th>
                  <th className="hidden pb-2 font-medium lg:table-cell">{t('common.permissions')}</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry, i) => {
                  const fullPath = fullPathOf(entry)
                  return (
                    <FileRow
                      key={entry.name}
                      entry={entry}
                      index={i}
                      fullPath={fullPath}
                      isSelected={selected.has(fullPath)}
                      isFocused={i === focusedIndex}
                      t={t}
                      locale={locale}
                      onRowClick={onRowClick}
                      onOpenDir={openDir}
                      onToggleSelect={onToggleSelectRow}
                      onInspectArchive={openArchiveInspector}
                      onDownload={downloadFile}
                      onDownloadFolder={downloadFolder}
                      onEdit={openEditor}
                      onPreview={openPreview}
                      onUnzip={doUnzip}
                      onZip={doZip}
                      onRename={openRenameDialog}
                      onCopyTo={openCopyPicker}
                      onMoveTo={openMovePicker}
                      onPermissions={openPermissions}
                      onDelete={openDeleteDialog}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </DropZone>

      {editingPath && (
        <FileEditor path={editingPath} onClose={() => setEditingPath(null)} onSaved={() => load(path)} />
      )}

      {previewPath && (
        <ImagePreview path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
      {destinationPicker && (
        <FolderPickerModal
          {...destinationPicker}
          sourceDir={path}
          initialPath={path}
          volumes={volumes}
          onClose={() => setDestinationPicker(null)}
          onConfirm={bulkCopyMove}
          t={t}
        />
      )}

      {uploadConflict && (
        <TransferConflictDialog
          conflict={uploadConflict}
          onClose={() => setUploadConflict(null)}
          onResolve={resolveUploadConflict}
          t={t}
        />
      )}

      {transferConflict && (
        <TransferConflictDialog
          conflict={transferConflict}
          onClose={() => setTransferConflict(null)}
          onResolve={(policy) => {
            if (policy === 'skip') {
                const names = new Set(transferConflict.conflicts.map((entry) => entry.name))
                const remaining = transferConflict.picker.entries.filter((entry) => !names.has(entry.name))
                if (remaining.length) queueCopyMove(transferConflict.picker, transferConflict.folder, 'skip', remaining)
                return
            }
            queueCopyMove(transferConflict.picker, transferConflict.folder, policy)
          }}
          t={t}
        />
      )}

      {dialog?.kind === 'mkdir' && (
        <InputDialog
          title={t('files.newFolderTitle')}
          label={t('files.newFolderLabel')}
          confirmLabel={t('common.create')}
          onClose={() => setDialog(null)}
          onConfirm={doMkdir}
        />
      )}
      {dialog?.kind === 'newFile' && (
        <InputDialog
          title={t('files.newFileTitle')}
          label={t('files.newFileLabel')}
          placeholder="notes.txt"
          confirmLabel={t('common.create')}
          onClose={() => setDialog(null)}
          onConfirm={doNewFile}
        />
      )}
      {dialog?.kind === 'rename' && (
        <InputDialog
          title={t('files.renameTitle', { name: dialog.entry.name })}
          label={t('files.renameLabel')}
          defaultValue={dialog.entry.name}
          confirmLabel={t('common.rename')}
          onClose={() => setDialog(null)}
          onConfirm={(next) => (next === dialog.entry.name ? Promise.resolve() : doRename(dialog.entry, next))}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('files.deleteTitle', { name: dialog.entry.name })}
          description={dialog.entry.is_dir ? t('files.deleteFolderDesc', { name: dialog.entry.name }) : t('files.deleteFileDesc', { name: dialog.entry.name })}
          tone="danger"
          confirmLabel={t('common.delete')}
          onClose={() => setDialog(null)}
          onConfirm={() => doDelete(dialog.entry)}
        />
      )}

      {permissionsEntry && (
        <InputDialog
          title={t('common.permissionsTitle', { name: permissionsEntry.name })}
          description={t('common.permissionsHint')}
          label={t('common.permissionsLabel')}
          defaultValue={formatMode(permissionsEntry.mode)}
          placeholder="0777"
          validate={(value) => /^[0-7]{3,4}$/.test(value) ? '' : t('common.permissionsInvalid')}
          confirmLabel={t('common.save')}
          onClose={() => setPermissionsEntry(null)}
          onConfirm={(mode) => api.ftp.chmod(joinPath(path, permissionsEntry.name), mode).then(() => load(path))}
        />
      )}

      {bulkDialog?.kind === 'delete' && (
        <BulkDeleteDialog entries={selectedEntries} onClose={() => setBulkDialog(null)} onConfirm={bulkDelete} />
      )}
      {bulkDialog?.kind === 'rename' && (
        selected.size === 1 ? (
          <InputDialog
            title={t('files.renameTitle', { name: selectedEntries[0].name })}
            label={t('files.renameLabel')}
            defaultValue={selectedEntries[0].name}
            confirmLabel={t('common.rename')}
            onClose={() => setBulkDialog(null)}
            onConfirm={(next) => (next === selectedEntries[0].name ? Promise.resolve() : doRename(selectedEntries[0], next).then(clearSelection))}
          />
        ) : (
          <BulkRenameDialog
            entries={selectedEntries}
            siblingEntries={entries}
            onClose={() => setBulkDialog(null)}
            onConfirm={bulkRename}
          />
        )
      )}
      {createArchiveEntries && (
        <CreateArchiveDialog
          entries={createArchiveEntries}
          sourceDir={path}
          totalBytes={createArchiveEntries.some((entry) => entry.is_dir)
            ? null
            : createArchiveEntries.reduce((sum, entry) => sum + entry.size, 0)}
          availableBytes={currentVolume?.free}
          onClose={() => setCreateArchiveEntries(null)}
          onCreated={() => { setCreateArchiveEntries(null); onArchiveCreated() }}
        />
      )}
      {extractArchiveEntries && (
        <ExtractArchiveDialog
          entries={extractArchiveEntries}
          sourceDir={path}
          volumes={volumes}
          onClose={() => setExtractArchiveEntries(null)}
          onExtracted={() => { setExtractArchiveEntries(null); onArchiveExtracted() }}
        />
      )}
      {inspectorArchive && (
        <ArchiveInspectorModal
          path={inspectorArchive.path}
          name={inspectorArchive.name}
          onClose={() => setInspectorArchive(null)}
          onExtractAll={() => {
            const name = inspectorArchive.name
            setInspectorArchive(null)
            setExtractArchiveEntries([{ name, is_dir: false }])
          }}
        />
      )}
    </Panel>
  )
}
