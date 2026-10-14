import { useEffect, useRef, useState } from 'react'
import Panel from '../components/Panel.jsx'
import DropZone from '../components/DropZone.jsx'
import Button from '../components/Button.jsx'
import PathPickerModal from '../components/PathPickerModal.jsx'
import { ConfirmDialog } from '../components/Dialog.jsx'
import { CheckCircleIcon, ClockIcon, DeleteIcon, FileIcon, FolderIcon, InstallIcon, UploadIcon, ExternalIcon, XCircleIcon } from '../components/icons.jsx'
import TransferProgress, { formatSize, formatSpeed, formatEta } from '../components/TransferProgress.jsx'
import { api } from '../lib/api.js'
import { watchDirectUploadActive } from '../lib/pkgDirectUpload.js'
import { useToast } from '../lib/ToastContext.jsx'
import { useI18n } from '../lib/i18n.jsx'

const METHODS = [
  { id: 'device', labelKey: 'pkg.methodDeviceLabel', descKey: 'pkg.methodDeviceDesc', icon: <UploadIcon size={18} /> },
  { id: 'url', labelKey: 'pkg.methodUrlLabel', descKey: 'pkg.methodUrlDesc', icon: <InstallIcon size={18} /> },
  { id: 'console', labelKey: 'pkg.methodConsoleLabel', descKey: 'pkg.methodConsoleDesc', icon: <FolderIcon size={18} /> },
]

// Queue-row phase -> label. "finishing" is the PS5 still reading the package after
// "queued", not a stall — see pkg_live_cache.hpp's done callback.
const PHASE_LABEL_KEYS = { uploading: 'pkg.stepUploading', validating: 'pkg.stepValidating', finishing: 'pkg.stepFinishing' }

// A simple step progression for the two jobs that actually have distinct
// phases — never a fake percentage where the backend doesn't have one.
function JobHero({ steps, activeIndex, label, pct, sub, indeterminate }) {
  return (
    <div className="mb-4 rounded-2xl border border-accent/25 bg-accent/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        {steps.map((step, i) => (
          <div key={step} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  i < activeIndex ? 'bg-ok text-white' : i === activeIndex ? 'bg-accent text-white' : 'bg-panel-border text-text-dim'
                }`}
              >
                {i < activeIndex ? '✓' : i + 1}
              </span>
              <span className={i === activeIndex ? 'text-text' : 'text-text-dim'}>{step}</span>
            </div>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-panel-border" />}
          </div>
        ))}
      </div>
      <TransferProgress label={label} pct={pct} indeterminate={indeterminate} sub={sub} />
    </div>
  )
}

export default function PkgView() {
  const { t, locale } = useI18n()
  const [method, setMethod] = useState('device')
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')
  const [volumes, setVolumes] = useState([])
  const [pathPickerOpen, setPathPickerOpen] = useState(false)
  const [pathPickerMulti, setPathPickerMulti] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploadJob, setUploadJob] = useState(null) // browser -> backend leg, upload flow only
  const [job, setJob] = useState(null) // backend job status (download/install)
  const [result, setResult] = useState(null)
  const [confirmDeleteDownload, setConfirmDeleteDownload] = useState(false)
  const [directUploadActive, setDirectUploadActive] = useState(false)
  const [queue, setQueue] = useState([]) // multi-file installs — [{id, name, kind, file|path, status, error}]
  const pollRef = useRef(null)
  const fileInputRef = useRef(null)
  const uploadSampleRef = useRef(null)
  const showToast = useToast()

  useEffect(() => {
    api.ftp.storage().then((r) => setVolumes(r.volumes || [])).catch(() => {})
    return () => clearInterval(pollRef.current)
  }, [])

  // The PS5 keeps reading the package over this connection well past "queued" — stays
  // true until the backend itself closes it, regardless of what the job status shows.
  useEffect(() => watchDirectUploadActive(setDirectUploadActive), [])

  // Resolves once the backend job reaches a terminal state — the shared tail end of
  // every install, single or queued.
  const waitForJobTerminal = () =>
    new Promise((resolve) => {
      pollRef.current = setInterval(() => {
        api.pkg
          .status()
          .then((s) => {
            setJob(s)
            if (s.phase === 'queued' || s.phase === 'error') {
              clearInterval(pollRef.current)
              resolve(s)
            }
          })
          .catch(() => {})
      }, 500)
    })

  // A device upload's socket stays open well past "queued" — only safe to start the
  // next queued item once the backend actually closes it (see pkgDirectUpload.js).
  const waitForDirectUploadInactive = () =>
    new Promise((resolve) => {
      const unwatch = watchDirectUploadActive((active) => {
        if (active) return
        unwatch()
        resolve()
      })
    })

  const reportJobResult = (s) => {
    if (s.phase === 'queued') {
      setResult({ ok: true, content_id: s.content_id, title: s.title, hasStagedFile: s.has_staged_file })
      showToast(t('pkg.installQueuedToast', { contentId: s.title || s.content_id || t('pkg.packageAcceptedByPs5') }))
    } else {
      setResult({ ok: false, error: s.error })
      showToast(s.error, 'err')
    }
  }

  const deleteDownloadedFile = () =>
    api.pkg.deleteDownload().then(() => {
      setResult((r) => (r ? { ...r, hasStagedFile: false } : r))
      showToast(t('pkg.deleteDownloadDone'))
    })

  const install = (opts) => {
    setBusy(true)
    setResult(null)
    setConfirmDeleteDownload(false)
    setJob(null)
    setQueue([])
    api.pkg
      .install(opts)
      .then(() => waitForJobTerminal())
      .then((s) => {
        setBusy(false)
        reportJobResult(s)
      })
      .catch((e) => {
        setBusy(false)
        setResult({ ok: false, error: e.message })
        showToast(e.message, 'err')
      })
  }

  const updateQueueItem = (id, patch) => setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  // Installs each queued item in order — the backend only ever runs one install job at
  // a time anyway, so this just waits for each to fully finish before starting the next.
  const runQueue = async (items) => {
    for (const item of items) {
      updateQueueItem(item.id, { status: 'active', phase: item.kind === 'device' ? 'uploading' : 'validating' })
      setResult(null)
      setJob(null)
      try {
        if (item.kind === 'device') {
          const now = performance.now()
          uploadSampleRef.current = { time: now, loaded: 0, speed: 0 }
          setUploadJob({ name: item.name, loaded: 0, total: item.file.size, speed: 0 })
          await api.pkg.upload(item.file, (loaded, total) => {
            const sample = uploadSampleRef.current
            const sampleNow = performance.now()
            const elapsed = (sampleNow - sample.time) / 1000
            let speed = sample.speed
            if (elapsed >= 0.15 && loaded >= sample.loaded) {
              const instant = (loaded - sample.loaded) / elapsed
              speed = sample.speed > 0 ? sample.speed * 0.72 + instant * 0.28 : instant
              uploadSampleRef.current = { time: sampleNow, loaded, speed }
            }
            setUploadJob({ name: item.name, loaded, total: total || item.file.size, speed })
          })
          setUploadJob(null)
          updateQueueItem(item.id, { phase: 'validating' })
        } else {
          await api.pkg.install({ path: item.path })
        }
        const status = await waitForJobTerminal()
        // Wait for the socket to close (success or error) before starting the next
        // item — a live session still winding down would reject a new one as busy.
        if (item.kind === 'device') {
          updateQueueItem(item.id, { phase: 'finishing' })
          await waitForDirectUploadInactive()
        }
        if (status.phase === 'error') throw new Error(status.error)
        updateQueueItem(item.id, { status: 'done' })
        reportJobResult(status)
      } catch (e) {
        updateQueueItem(item.id, { status: 'error', error: e.message })
        showToast(e.message, 'err')
      }
    }
    setBusy(false)
    setUploadJob(null)
    setJob(null)
  }

  const uploadAndInstall = (files) => {
    if (busy) {
      showToast(t('pkg.waitForCurrentJob'), 'err')
      return
    }
    const pkgFiles = files.filter((f) => f.name.toLowerCase().endsWith('.pkg'))
    if (pkgFiles.length === 0) {
      showToast(t('pkg.onlyPkgFiles'), 'err')
      return
    }
    if (pkgFiles.length < files.length) showToast(t('pkg.someFilesSkipped', { count: files.length - pkgFiles.length }), 'err')
    setMethod('device')
    setBusy(true)
    setResult(null)
    setConfirmDeleteDownload(false)
    setJob(null)
    const items = pkgFiles.map((file, i) => ({ id: `d${Date.now()}-${i}`, name: file.name, kind: 'device', file, status: 'pending' }))
    setQueue(items)
    runQueue(items)
  }

  const installConsolePaths = (paths) => {
    setPathPickerOpen(false)
    if (busy) {
      showToast(t('pkg.waitForCurrentJob'), 'err')
      return
    }
    setBusy(true)
    setResult(null)
    setConfirmDeleteDownload(false)
    setJob(null)
    const items = paths.map((p, i) => ({ id: `c${Date.now()}-${i}`, name: p.split('/').pop(), kind: 'console', path: p, status: 'pending' }))
    setQueue(items)
    runQueue(items)
  }

  const onChoosePkg = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length) uploadAndInstall(files)
  }

  const jobPct = job && job.total > 0 ? Math.min(100, (job.loaded / job.total) * 100) : 0
  const jobEta = job && job.speed_bps > 0 ? (job.total - job.loaded) / job.speed_bps : Infinity

  // The device method has its own upload progress; URL and console share the
  // backend's job status once queued.
  const steps = { uploading: t('pkg.stepUploading'), downloading: t('pkg.stepDownloading'), validating: t('pkg.stepValidating'), queued: t('pkg.stepQueued') }

  let hero = null
  if (uploadJob) {
    const pct = uploadJob.total > 0 ? Math.min(100, (uploadJob.loaded / uploadJob.total) * 100) : 0
    const eta = uploadJob.speed > 0 ? (uploadJob.total - uploadJob.loaded) / uploadJob.speed : Infinity
    hero = (
      <JobHero
        steps={[steps.uploading, steps.validating, steps.queued]}
        activeIndex={0}
        label={t('pkg.uploadingName', { name: uploadJob.name })}
        pct={pct}
        sub={`${formatSpeed(uploadJob.speed, locale)} · ${formatSize(uploadJob.loaded, locale)} / ${formatSize(uploadJob.total, locale)} · ${t('files.eta')} ${formatEta(eta)}`}
      />
    )
  } else if (job?.phase === 'downloading') {
    hero = (
      <JobHero
        steps={[steps.downloading, steps.validating, steps.queued]}
        activeIndex={0}
        label={t('pkg.downloadingPkg')}
        pct={jobPct}
        sub={`${formatSpeed(job.speed_bps, locale)} · ${formatSize(job.loaded, locale)} / ${job.total > 0 ? formatSize(job.total, locale) : '?'} · ${t('files.eta')} ${formatEta(jobEta)}`}
      />
    )
  } else if (job?.phase === 'installing') {
    hero = (
      <JobHero
        steps={[method === 'url' ? steps.downloading : steps.uploading, steps.validating, steps.queued]}
        activeIndex={1}
        label={t('pkg.validatingAndQueuing')}
        indeterminate
        sub={t('pkg.validatingSub')}
      />
    )
  }

  return (
    <Panel title={t('pkg.title')}>
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-text-dim">{t('pkg.intro')}</p>

      {directUploadActive && (
        <div className="mb-4 rounded-2xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          {t('pkg.deviceStayConnected')}
        </div>
      )}

      {hero}

      {queue.length > 1 && (
        <div className="mb-4 rounded-2xl border border-panel-border bg-bg/40 p-3">
          <div className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-text-dim">
            {t('pkg.queueProgress', { done: queue.filter((it) => it.status === 'done' || it.status === 'error').length, total: queue.length })}
          </div>
          <div className="flex flex-col gap-1">
            {queue.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                <span className="grid h-5 w-5 shrink-0 place-items-center">
                  {item.status === 'done' && <CheckCircleIcon size={16} className="text-ok" />}
                  {item.status === 'error' && <XCircleIcon size={16} className="text-err" />}
                  {item.status === 'active' && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />}
                  {item.status === 'pending' && <ClockIcon size={16} className="text-text-dim" />}
                </span>
                <span className="min-w-0 flex-1 truncate" dir="ltr">{item.name}</span>
                {item.status === 'active' && item.phase && (
                  <span className="shrink-0 text-xs text-text-dim">{t(PHASE_LABEL_KEYS[item.phase])}</span>
                )}
                {item.status === 'error' && <span className="shrink-0 truncate text-xs text-err">{item.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {result && !hero && queue.length <= 1 && (
        result.ok ? (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-ok/30 bg-ok/10 p-4">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ok/15 text-ok"><CheckCircleIcon size={18} /></span>
            <div className="min-w-0">
              <div className="font-bold text-text">{t('pkg.acceptedTitle')}</div>
              <div className="mt-0.5 text-sm text-text-dim">{t('pkg.acceptedDesc')}</div>
              {result.title && <div className="mt-1 text-sm text-text">{result.title}</div>}
              {result.content_id && <div className="mt-1 pmgr-mono text-xs text-text-dim" dir="ltr">{t('pkg.contentId', { id: result.content_id })}</div>}
              {result.hasStagedFile && (
                <Button size="sm" tone="ghost" className="mt-2" icon={<DeleteIcon size={13} />} onClick={() => setConfirmDeleteDownload(true)}>
                  {t('pkg.deleteDownloadAction')}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-2xl border border-err/30 bg-err/10 p-4 text-sm text-err">{result.error}</div>
        )
      )}

      {confirmDeleteDownload && (
        <ConfirmDialog
          title={t('pkg.deleteDownloadTitle')}
          description={t('pkg.deleteDownloadDesc')}
          detail={t('pkg.deleteDownloadWarning')}
          confirmLabel={t('common.delete')}
          tone="warn"
          onConfirm={deleteDownloadedFile}
          onClose={() => setConfirmDeleteDownload(false)}
        />
      )}

      <DropZone global onFiles={uploadAndInstall} label={t('pkg.dropZoneLabel')} className="block">
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id)}
              aria-pressed={method === m.id}
              className={`rounded-xl border p-3 text-left transition-colors ${
                method === m.id ? 'border-accent/55 bg-accent/10' : 'border-panel-border bg-bg/45 hover:border-accent/30'
              }`}
            >
              <span className={`mb-2 grid h-9 w-9 place-items-center rounded-lg ${method === m.id ? 'bg-accent text-white' : 'bg-panel-2 text-text-dim'}`}>{m.icon}</span>
              <div className="text-sm font-bold text-text">{t(m.labelKey)}</div>
              <div className="mt-0.5 text-xs text-text-dim">{t(m.descKey)}</div>
            </button>
          ))}
        </div>

        {method === 'device' && (
          <div className="rounded-xl border border-dashed border-panel-border bg-bg/40 px-4 py-7 text-center">
            <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent"><UploadIcon size={20} /></div>
            <div className="mb-3 text-sm font-semibold text-text">{t('pkg.dropHint')}</div>
            <Button tone="primary" sheen icon={<UploadIcon size={15} />} onClick={() => fileInputRef.current?.click()} disabled={busy}>
              {uploadJob ? t('pkg.uploading') : t('pkg.chooseFile')}
            </Button>
            <input ref={fileInputRef} type="file" accept=".pkg" multiple hidden onChange={onChoosePkg} />
          </div>
        )}

        {method === 'url' && (
          <div className="rounded-xl border border-panel-border bg-bg/40 p-4">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-text-dim">{t('pkg.urlLabel')}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('pkg.urlPlaceholder')}
                dir="ltr"
                className="min-h-10 min-w-0 flex-1 rounded-md border border-panel-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
              />
              <Button tone="primary" sheen icon={<InstallIcon size={15} />} onClick={() => install({ url: url.trim() })} disabled={busy || !url.trim()}>
                {busy ? t('pkg.installing') : t('pkg.install')}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-text-dim">{t('pkg.urlHint')}</p>
          </div>
        )}

        {method === 'console' && (
          <div className="rounded-xl border border-panel-border bg-bg/40 p-4">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-text-dim">{t('pkg.consoleLabel')}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => { setPathPickerMulti(false); setPathPickerOpen(true) }}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-panel-border bg-bg px-3 py-2 text-left text-sm transition-colors hover:border-accent/40"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">{path ? <FileIcon size={16} /> : <FolderIcon size={16} />}</span>
                <span className={`min-w-0 flex-1 truncate font-mono text-xs ${path ? 'text-text' : 'text-text-dim'}`} dir="ltr">{path || t('pkg.browsePlaceholder')}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent">{t('pkg.browse')} <ExternalIcon size={12} /></span>
              </button>
              <Button tone="neutral" icon={<InstallIcon size={15} />} onClick={() => install({ path: path.trim() })} disabled={busy || !path.trim()}>
                {busy ? t('pkg.installing') : t('pkg.install')}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => { setPathPickerMulti(true); setPathPickerOpen(true) }}
              disabled={busy}
              className="mt-2 text-xs font-semibold text-accent hover:underline disabled:opacity-50 disabled:hover:no-underline"
            >
              {t('pkg.selectMultiple')}
            </button>
            <p className="mt-1.5 text-xs text-text-dim">{t('pkg.consoleHint')}</p>
          </div>
        )}
      </DropZone>

      {pathPickerOpen && (
        <PathPickerModal
          title={pathPickerMulti ? t('pkg.pathPickerMultiTitle') : t('pkg.pathPickerTitle')}
          description={t('pkg.pathPickerDesc')}
          initialPath={path ? path.replace(/\/[^/]+$/, '') || '/' : '/data'}
          volumes={volumes}
          mode="file"
          multiple={pathPickerMulti}
          extensions={['.pkg']}
          actionLabel={pathPickerMulti ? t('pkg.pathPickerMultiAction') : t('pkg.pathPickerAction')}
          onClose={() => setPathPickerOpen(false)}
          onSelect={(selected) => {
            if (pathPickerMulti) installConsolePaths(selected)
            else { setPath(selected); setPathPickerOpen(false) }
          }}
        />
      )}
    </Panel>
  )
}
