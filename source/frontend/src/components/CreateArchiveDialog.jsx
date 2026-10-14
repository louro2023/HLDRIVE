import { useRef, useState } from 'react'
import { Dialog } from './Dialog.jsx'
import Button from './Button.jsx'
import { CheckCircleIcon } from './icons.jsx'
import { api } from '../lib/api.js'
import { useI18n } from '../lib/i18n.jsx'
import { formatFileSize } from '../lib/format.js'

const COMPRESSION_KEY = 'pmgr_archive_compression'
const MODES = ['smart', 'store', 'fast', 'balanced']

function loadSavedMode() {
  const saved = window.localStorage.getItem(COMPRESSION_KEY)
  return MODES.includes(saved) ? saved : 'smart'
}

function isSafeArchiveName(name) {
  return name.trim().length > 0 && !name.includes('/') && name !== '.' && name !== '..'
}

// Same dialog for one file, one folder, or a mixed multi-selection — Create
// Archive shouldn't feel different depending on what happens to be selected.
export default function CreateArchiveDialog({ entries, sourceDir, totalBytes, availableBytes, onClose, onCreated }) {
  const { t, locale } = useI18n()
  const [name, setName] = useState(() => (entries.length === 1 ? `${entries[0].name}.zip` : 'Archive.zip'))
  const [compression, setCompression] = useState(loadSavedMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const trimmed = name.trim()
  const nameError = trimmed && !isSafeArchiveName(trimmed) ? t('files.invalidNameError', { name: trimmed }) : ''
  const knownSpace = Number.isFinite(availableBytes)
  const knownInputSize = Number.isFinite(totalBytes)
  const notEnoughSpace = knownSpace && knownInputSize && totalBytes > 0 && totalBytes > availableBytes

  const submit = async (close) => {
    if (!trimmed || nameError || notEnoughSpace || busy) return
    setBusy(true)
    setError('')
    try {
      const paths = entries.map((e) => `${sourceDir.endsWith('/') ? sourceDir : `${sourceDir}/`}${e.name}`)
      window.localStorage.setItem(COMPRESSION_KEY, compression)
      const result = await api.ftp.zipSelection(paths, sourceDir, trimmed, compression)
      onCreated(result.job_id)
      close()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const modes = [
    { id: 'smart', label: t('archive.modeSmart'), desc: t('archive.modeSmartDesc') },
    { id: 'store', label: t('archive.modeStore'), desc: t('archive.modeStoreDesc') },
    { id: 'fast', label: t('archive.modeFast'), desc: t('archive.modeFastDesc') },
    { id: 'balanced', label: t('archive.modeBalanced'), desc: t('archive.modeBalancedDesc') },
  ]

  return (
    <Dialog
      title={t('archive.createTitle')}
      onClose={onClose}
      initialFocusRef={inputRef}
      renderFooter={(close) => (
        <>
          <Button tone="neutral" onClick={close} disabled={busy}>{t('common.cancel')}</Button>
          <Button
            tone="primary"
            sheen
            disabled={busy || !trimmed || Boolean(nameError) || notEnoughSpace}
            onClick={() => submit(close)}
          >
            {busy ? t('common.working') : t('files.createZip')}
          </Button>
        </>
      )}
    >
      {() => (
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-text-dim">{t('files.archiveName')}</label>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            dir="ltr"
            className="min-h-10 w-full rounded-lg border border-panel-border bg-bg px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
          />
          {(nameError || error) && <div className="mt-1.5 text-xs text-err">{nameError || error}</div>}

          <div className="mt-4 mb-1.5 text-xs font-bold uppercase tracking-wide text-text-dim">{t('archive.compression')}</div>
          <div className="space-y-1.5" role="radiogroup" aria-label={t('archive.compression')}>
            {modes.map((mode) => {
              const selected = compression === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setCompression(mode.id)}
                  className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selected ? 'border-accent/50 bg-accent/[0.08]' : 'border-panel-border hover:border-accent/25'
                  }`}
                >
                  <span className={`mt-0.5 shrink-0 ${selected ? 'text-accent' : 'text-transparent'}`}>
                    <CheckCircleIcon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${selected ? 'text-accent' : 'text-text'}`}>{mode.label}</span>
                    <span className="block text-xs text-text-dim">{mode.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-panel-border pt-3 text-xs text-text-dim">
            <span>{t('common.itemsCount', { count: entries.length })}</span>
            <span dir="ltr" className="pmgr-mono">{knownInputSize ? formatFileSize(totalBytes, locale) : '—'}</span>
            {knownSpace && <span dir="ltr" className={`pmgr-mono ${notEnoughSpace ? 'text-err' : ''}`}>{t('archive.available', { size: formatFileSize(availableBytes, locale) })}</span>}
          </div>
          {notEnoughSpace && (
            <div className="mt-2 rounded-lg border border-err/25 bg-err/10 px-3 py-2 text-xs text-err">
              {t('archive.notEnoughSpace')}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
