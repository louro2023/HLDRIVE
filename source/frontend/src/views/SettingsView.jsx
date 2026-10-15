import { useEffect, useRef, useState } from 'react'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import Pill from '../components/Pill.jsx'
import Toggle from '../components/Toggle.jsx'
import CollapsibleSection from '../components/CollapsibleSection.jsx'
import { ConfirmDialog } from '../components/Dialog.jsx'
import PathPickerModal from '../components/PathPickerModal.jsx'
import { SectionHero, SettingsSection, SettingsRow, MetricTile, CopyRow } from '../components/SettingsKit.jsx'
import {
  SlidersIcon, PaletteIcon, FlaskIcon, InfoIcon, ThermometerIcon, MoonIcon, SunIcon, YoutubeIcon,
  ExternalIcon, GithubIcon, ShieldIcon, ClockIcon, PowerIcon, UserIcon, LaunchIcon, AlertTriangleIcon,
  FolderIcon, PlusIcon, DeleteIcon, GripIcon,
} from '../components/icons.jsx'
import { EFFECTS_KEY, applyEffects, loadReducedEffects } from '../lib/effects.js'
import { api } from '../lib/api.js'
import { useToast } from '../lib/ToastContext.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { formatFileSize, volumeLabel} from '../lib/format.js'

// Third-party lookup tool for the offline-activation help panel — returns a decimal
// Account ID, which still needs converting to hex before it's usable here.
const PSN_ACCOUNT_CHECKER_URL = 'https://www.psntools.com/psn/checker'

// BigInt for the 64-bit wraparound multiply — only used to pre-fill a
// suggested account_id for a never-activated slot; the field stays fully editable.
function suggestAccountId(name) {
  const PRIME = BigInt(0x100000001b3)
  const MASK = BigInt('0xffffffffffffffff')
  let base = BigInt(0)
  for (let i = 0; i < name.length; i++) {
    base = (PRIME * (base ^ BigInt(name.charCodeAt(i)))) & MASK
  }
  return '0x' + base.toString(16)
}

function tempStatusWord(c, warm, hot, t) {
  if (c == null || c < 0) return '—'
  if (c >= hot) return t('settings.tempHot')
  if (c >= warm) return t('settings.tempWarm')
  return t('settings.tempNormal')
}

const FAN_UNIT_KEY = 'pmgr_fan_unit'
const toF = (c) => Math.round((c * 9) / 5 + 32)
const fmtTemp = (c, fahrenheit) => (c == null || c < 0 ? '—' : `${fahrenheit ? toF(c) : c}°${fahrenheit ? 'F' : 'C'}`)

// ok/warn/err as real colors (not just text classes) — the gauge ring and
// the bar fills need a stroke/background color, not a Tailwind text-* class.
function tempColor(c, warm, hot) {
  if (c == null || c < 0) return 'var(--color-text-dim)'
  if (c >= hot) return 'var(--color-err)'
  if (c >= warm) return 'var(--color-warn)'
  return 'var(--color-ok)'
}

function clampPct(value, min, max) {
  if (value == null || value < 0 || max <= min) return 0
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
}

// Circular gauge for the single "hottest sensor" headline reading — the four flat number
// boxes this replaced didn't communicate at a glance how close a reading sits to the warm/hot zone.
function TempGauge({ label, c, min, max, warm, hot, fahrenheit, size = 116 }) {
  const stroke = 9
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const pct = clampPct(c, min, max)
  const color = tempColor(c, warm, hot)
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-panel-border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="pmgr-mono text-xl font-extrabold" style={{ color }}>
          {fmtTemp(c, fahrenheit)}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-dim">{label}</span>
      </div>
    </div>
  )
}

// Slim horizontal readout for a single sensor — position within min..max,
// color-coded, plus a text status word so the state never depends on color alone.
function TempBar({ label, c, min, max, warm, hot, fahrenheit, t }) {
  const pct = clampPct(c, min, max)
  const color = tempColor(c, warm, hot)
  return (
    <div className="rounded-xl border border-panel-border bg-bg/45 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-dim">{label}</span>
        <span className="pmgr-mono text-sm font-bold" style={{ color }}>{fmtTemp(c, fahrenheit)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-border">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width 0.6s ease, background 0.3s ease' }} />
      </div>
      <div className="mt-1 text-right text-[11px] font-semibold" style={{ color }}>{tempStatusWord(c, warm, hot, t)}</div>
    </div>
  )
}

function ThermalPanel() {
  const { t } = useI18n()
  const [thermal, setThermal] = useState(null)
  const [target, setTarget] = useState(70)
  const [adjusting, setAdjusting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fahrenheit, setFahrenheit] = useState(() => window.localStorage.getItem(FAN_UNIT_KEY) === 'F')
  const showToast = useToast()

  const load = () => api.thermal.status().then(setThermal).catch(() => setThermal({ ok: false }))

  useEffect(() => {
    load()
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (thermal?.threshold_c && !adjusting) setTarget(thermal.threshold_c)
  }, [thermal?.threshold_c, adjusting])

  const toggleUnit = () => {
    const next = !fahrenheit
    setFahrenheit(next)
    window.localStorage.setItem(FAN_UNIT_KEY, next ? 'F' : 'C')
  }

  const pin = () => {
    setBusy(true)
    api.thermal
      .setFan(target)
      .then(() => {
        showToast(t('settings.fanPinnedToast', { temp: fmtTemp(target, fahrenheit) }))
        setAdjusting(false)
        load()
      })
      .catch((e) => showToast(e.message, 'err'))
      .finally(() => setBusy(false))
  }

  const reset = () => {
    setBusy(true)
    api.thermal
      .resetFan()
      .then(() => {
        showToast(t('settings.fanAutoToast'))
        setAdjusting(false)
        load()
      })
      .catch((e) => showToast(e.message, 'err'))
      .finally(() => setBusy(false))
  }

  return (
    <div>
      <SectionHero
        icon={<ThermometerIcon size={18} />}
        title={t('settings.tabThermal')}
        description={t('settings.thermalDesc')}
        status={
          thermal?.ok && (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs text-text-dim">
                <span className="pmgr-live-dot text-info" />
                {t('settings.live')}
              </span>
              <Button size="sm" tone={fahrenheit ? 'primary' : 'neutral'} onClick={toggleUnit}>
                °{fahrenheit ? 'F' : 'C'}
              </Button>
            </div>
          )
        }
      />

      {!thermal ? (
        <div className="mb-4 flex flex-col gap-4 rounded-2xl border border-panel-border bg-panel p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="pmgr-skeleton h-28 w-28 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="pmgr-skeleton h-4 w-28 rounded" />
            <div className="pmgr-skeleton h-3 w-full max-w-xs rounded" />
          </div>
        </div>
      ) : !thermal.ok ? (
        <div className="pmgr-empty-state py-10 text-center text-sm text-text-dim">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-panel-border bg-panel-2 text-text-dim">
            <ThermometerIcon size={22} />
          </div>
          <div className="font-semibold text-text">{t('settings.thermalUnavailableTitle')}</div>
          <div className="mt-1">{t('settings.thermalUnavailableDesc')}</div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-4 rounded-2xl border border-panel-border bg-panel p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="flex justify-center sm:border-r sm:border-panel-border sm:pr-5">
              <TempGauge c={thermal.hottest_c} min={thermal.min_c} max={thermal.max_c} warm={thermal.warm_c} hot={thermal.hot_c} fahrenheit={fahrenheit} label={t('settings.hottest')} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase tracking-wide text-text-dim">{t('settings.thermalStatus')}</div>
              <div className="mt-0.5 text-2xl font-extrabold" style={{ color: tempColor(thermal.hottest_c, thermal.warm_c, thermal.hot_c) }}>
                {tempStatusWord(thermal.hottest_c, thermal.warm_c, thermal.hot_c, t)}
              </div>
              <p className="mt-1 text-sm text-text-dim">{t('settings.thermalMonitoring')}</p>
              {thermal.fan_duty_percent >= 0 && (
                <p className="mt-1 text-sm text-text-dim">
                  {t('settings.fanDuty')} · <span className="pmgr-mono font-semibold text-text">{thermal.fan_duty_percent}%</span>
                </p>
              )}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <TempBar label="CPU" c={thermal.cpu_c} min={thermal.min_c} max={thermal.max_c} warm={thermal.warm_c} hot={thermal.hot_c} fahrenheit={fahrenheit} t={t} />
                <TempBar label="SoC" c={thermal.soc_c} min={thermal.min_c} max={thermal.max_c} warm={thermal.warm_c} hot={thermal.hot_c} fahrenheit={fahrenheit} t={t} />
                <TempBar label="M.2" c={thermal.m2_c} min={thermal.min_c} max={thermal.max_c} warm={thermal.warm_c} hot={thermal.hot_c} fahrenheit={fahrenheit} t={t} />
              </div>
            </div>
          </div>

          <SettingsSection
            title={t('settings.coolingBehaviorTitle')}
            description={t('settings.coolingBehaviorDesc')}
          >
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-panel-border bg-bg/45 p-1">
              <button
                onClick={reset}
                disabled={busy || !thermal.threshold_c}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-default ${
                  !thermal.threshold_c ? 'bg-accent text-white' : 'text-text-dim hover:text-text'
                }`}
              >
                {t('settings.automaticCooling')}
              </button>
              <div className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold ${thermal.threshold_c ? 'bg-accent text-white' : 'text-text-dim'}`}>
                {t('settings.customThreshold')}{thermal.threshold_c ? ` · ${fmtTemp(thermal.threshold_c, fahrenheit)}` : ''}
              </div>
            </div>

            <div className="mb-3 grid grid-cols-3 gap-2">
              {[
                { id: 'cooler', labelKey: 'settings.presetCoolerLabel', value: 65, descKey: 'settings.presetCoolerDesc' },
                { id: 'balanced', labelKey: 'settings.presetBalancedLabel', value: 70, descKey: 'settings.presetBalancedDesc' },
                { id: 'quieter', labelKey: 'settings.presetQuieterLabel', value: 75, descKey: 'settings.presetQuieterDesc' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setAdjusting(true); setTarget(p.value) }}
                  className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                    target === p.value ? 'border-accent/60 bg-accent/10' : 'border-panel-border hover:border-accent/30'
                  }`}
                >
                  <div className="font-bold text-text">{t(p.labelKey)}</div>
                  <div className="text-text-dim">{t(p.descKey)}</div>
                </button>
              ))}
            </div>

            <div className="mb-1.5 flex items-center justify-between text-sm text-text">
              <span>{t('settings.customFanThreshold')}</span>
              <span className="pmgr-mono font-semibold" style={{ color: tempColor(target, thermal.warm_c, thermal.hot_c) }}>
                {fmtTemp(target, fahrenheit)}
              </span>
            </div>
            <input
              type="range"
              min={thermal.min_c}
              max={thermal.max_c}
              value={target}
              onChange={(e) => {
                setAdjusting(true)
                setTarget(parseInt(e.target.value, 10))
              }}
              className="mb-1.5 w-full"
              style={{ accentColor: tempColor(target, thermal.warm_c, thermal.hot_c) }}
            />
            <div className="mb-2 text-xs text-text-dim">
              {target <= (thermal.min_c + thermal.max_c) / 2 ? t('settings.prioritizeCooling') : t('settings.prioritizeQuiet')}
            </div>
            {target >= thermal.hot_c && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2 text-xs text-warn">
                <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
                <span>{t('settings.higherThresholdWarn')}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button tone="primary" onClick={pin} disabled={busy}>
                {t(thermal.threshold_c ? 'settings.repinButton' : 'settings.pinButton', { temp: fmtTemp(target, fahrenheit) })}
              </Button>
              {adjusting && target !== thermal.threshold_c && <span className="text-xs text-text-dim">{t('settings.unsavedChange')}</span>}
            </div>
          </SettingsSection>
        </>
      )}
    </div>
  )
}

const THEME_KEY = 'pmgr_theme'

const THEMES = [
  { id: 'dark', labelKey: 'settings.themeDark', descKey: 'settings.themeDarkDesc', swatch: '#0b0e16', Icon: MoonIcon },
  { id: 'light', labelKey: 'settings.themeLight', descKey: 'settings.themeLightDesc', swatch: '#f4f7fb', Icon: SunIcon },
]

function ThemePanel() {
  const { t } = useI18n()
  // A previously-saved 'contrast' (removed) falls back to dark instead of
  // rendering an unstyled theme attribute with no matching CSS.
  const [theme, setTheme] = useState(() => {
    const saved = window.localStorage.getItem(THEME_KEY)
    return THEMES.some((th) => th.id === saved) ? saved : 'dark'
  })

  useEffect(() => {
    // Brief window so the theme cross-fades instead of snapping. Removed right
    // after, so it costs nothing outside a switch.
    const root = document.documentElement
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduceMotion) {
      root.classList.add('pmgr-theme-transition')
      setTimeout(() => root.classList.remove('pmgr-theme-transition'), 260)
    }
    if (theme === 'dark') delete root.dataset.pmgrTheme
    else root.dataset.pmgrTheme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  return (
    <Panel title={t('settings.appearanceTitle')}>
      <p className="mb-3 text-sm text-text-dim">{t('settings.appearanceDesc')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {THEMES.map((th) => (
          <button
            key={th.id}
            onClick={() => setTheme(th.id)}
            className={`pmgr-theme-choice relative overflow-hidden rounded-xl border p-3 text-left ${
              theme === th.id ? 'is-selected border-accent/60 bg-accent/10' : 'border-panel-border bg-bg/45 hover:border-accent/35'
            }`}
          >
            <span className="mb-3 block h-16 rounded-lg border border-panel-border" style={{ background: `linear-gradient(145deg, ${th.swatch}, ${th.id === 'dark' ? '#18243a' : '#dbeafe'})` }}>
              <span className="m-2 block h-2 w-1/2 rounded-full bg-accent/70" />
              <span className="mx-2 mt-2 block h-5 rounded border border-panel-border bg-panel/80" />
            </span>
            <span className="flex items-center gap-2 text-sm font-bold text-text"><th.Icon size={16} />{t(th.labelKey)}</span>
            <span className="mt-0.5 block text-xs text-text-dim">{t(th.descKey)}</span>
            {theme === th.id && <span className="absolute right-3 top-3 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">{t('settings.active')}</span>}
          </button>
        ))}
      </div>
    </Panel>
  )
}

const EFFECTS_OPTIONS = [
  { id: 'full', labelKey: 'settings.effectsFull', descKey: 'settings.effectsFullDesc' },
  { id: 'reduced', labelKey: 'settings.effectsReduced', descKey: 'settings.effectsReducedDesc' },
]

function VisualEffectsPanel() {
  const { t } = useI18n()
  const [mode, setMode] = useState(() => (loadReducedEffects() ? 'reduced' : 'full'))

  useEffect(() => {
    applyEffects(mode === 'reduced')
    window.localStorage.setItem(EFFECTS_KEY, mode)
  }, [mode])

  return (
    <Panel title={t('settings.visualEffectsTitle')}>
      <p className="mb-3 text-sm text-text-dim">{t('settings.visualEffectsDesc')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {EFFECTS_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setMode(opt.id)}
            className={`pmgr-theme-choice relative overflow-hidden rounded-xl border p-3 text-left ${
              mode === opt.id ? 'is-selected border-accent/60 bg-accent/10' : 'border-panel-border bg-bg/45 hover:border-accent/35'
            }`}
          >
            <span className="text-sm font-bold text-text">{t(opt.labelKey)}</span>
            <span className="mt-0.5 block text-xs text-text-dim">{t(opt.descKey)}</span>
            {mode === opt.id && <span className="absolute right-3 top-3 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">{t('settings.active')}</span>}
          </button>
        ))}
      </div>
    </Panel>
  )
}

function storageBarClass(pct) {
  if (pct >= 93) return 'bg-err'
  if (pct >= 80) return 'bg-warn'
  return 'bg-accent'
}

function GeneralTab() {
  const { t, locale } = useI18n()
  const [status, setStatus] = useState(null)
  const [paths, setPaths] = useState(null)
  const [system, setSystem] = useState(null)
  const [confirmingShutdown, setConfirmingShutdown] = useState(false)
  const [payloadsDirPickerOpen, setPayloadsDirPickerOpen] = useState(false)
  const [savingPayloadsDir, setSavingPayloadsDir] = useState(false)
  const showToast = useToast()

  useEffect(() => {
    api.status().then(setStatus).catch(() => {})
    api.paths().then(setPaths).catch(() => {})
    api.system.info().then(setSystem).catch(() => {})
  }, [])

  // payloads_dir above still reports the running process's current value — the new
  // one only takes effect after HLDRIVE.elf restarts, so it's not reflected here yet.
  const changePayloadsDir = (path) => {
    setSavingPayloadsDir(true)
    return api.setPayloadsDir(path)
      .then(() => showToast(t('settings.payloadsDirSaved')))
      .finally(() => setSavingPayloadsDir(false))
  }

  const bytes = (value) => (!value ? '—' : formatFileSize(value, locale))

  const loading = !status && !system

  return (
    <div>
      <SectionHero
        icon={<SlidersIcon size={18} />}
        title={t('settings.consoleOverviewTitle')}
        description={t('settings.consoleOverviewDesc')}
        status={
          status && (
            <Pill tone={status.privileged ? 'ok' : 'neutral'}>
              <ShieldIcon size={12} /> {t(status.privileged ? 'settings.elevatedPrivileges' : 'settings.limitedPrivileges')}
            </Pill>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricTile label={t('settings.metricConsole')} value={system?.platform} loading={loading} />
        <MetricTile label={t('settings.metricFirmware')} value={system?.firmware} loading={loading} />
        <MetricTile label={t('settings.metricCurrentUser')} value={system?.user_name || t('common.unknown')} loading={loading} />
        <MetricTile label={t('settings.metricIpAddress')} value={system?.ip_address} loading={loading} />
      </div>

      {system?.storage?.length > 0 && (
        <SettingsSection title={t('settings.storageTitle')} description={t('settings.storageDesc')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {system.storage.map((volume) => {
              const pct = volume.total > 0 ? ((volume.total - volume.free) / volume.total) * 100 : 0
              return (
                <div key={volume.path} className="rounded-xl border border-panel-border px-3 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                    <span className="font-semibold text-text">{volumeLabel(volume, t)}</span>
                    <span className="pmgr-mono text-xs text-text-dim">{t('settings.storageFreeOfTotal', { free: bytes(volume.free), total: bytes(volume.total) })}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-border">
                    <div className={`h-full rounded-full transition-[width] duration-500 ${storageBarClass(pct)}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 pmgr-mono text-xs text-text-dim" dir="ltr">{t('settings.storagePathUsed', { path: volume.path, pct: pct.toFixed(0) })}</div>
                </div>
              )
            })}
          </div>
        </SettingsSection>
      )}

      <SettingsSection title={t('settings.payloadsDirTitle')} description={t('settings.payloadsDirDesc')}>
        <SettingsRow
          title={t('settings.payloadsDirLabel')}
          description={<span className="pmgr-mono" dir="ltr">{paths?.payloads_dir || '—'}</span>}
          control={
            <Button tone="neutral" size="sm" icon={<FolderIcon size={14} />} disabled={savingPayloadsDir}
                    onClick={() => setPayloadsDirPickerOpen(true)}>
              {t('settings.payloadsDirChange')}
            </Button>
          }
        />
      </SettingsSection>

      {payloadsDirPickerOpen && (
        <PathPickerModal
          title={t('settings.payloadsDirChange')}
          description={t('settings.payloadsDirDesc')}
          initialPath={paths?.payloads_dir || '/data'}
          volumes={system?.storage || []}
          mode="folder"
          actionLabel={t('common.save')}
          validateSelection={(value) => (value.startsWith('/') && !value.includes('..') ? '' : t('settings.smpInvalidPath'))}
          onClose={() => setPayloadsDirPickerOpen(false)}
          onSelect={(selected) => changePayloadsDir(selected).then(() => setPayloadsDirPickerOpen(false))}
        />
      )}

      <CollapsibleSection title={t('settings.technicalDetails')} defaultOpen={false}>
        <div className="text-sm">
          <CopyRow label={t('settings.copyModel')} value={system?.model} />
          <CopyRow label={t('settings.copyFirmwareSdk')} value={system?.firmware || system?.sdk_version} />
          <CopyRow label={t('settings.copyUserId')} value={system?.user_id} />
          <CopyRow label={t('settings.copyRootDir')} value={paths?.root_dir} />
          <CopyRow label={t('settings.copyPayloadsDir')} value={paths?.payloads_dir} />
          <CopyRow label={t('settings.copyBundledDir')} value={paths?.bundled_dir} />
          <CopyRow label={t('settings.copyAutoloaderIni')} value={paths?.autoloader_ini} />
        </div>
      </CollapsibleSection>

      <SettingsSection title={t('settings.dangerZone')} description={t('settings.dangerZoneDesc')} className="border-err/25">
        <SettingsRow
          title={t('settings.shutdown')}
          description={t('settings.shutdownDesc')}
          control={<Button tone="danger" icon={<PowerIcon size={15} />} onClick={() => setConfirmingShutdown(true)}>{t('settings.shutdownConfirm')}</Button>}
        />
      </SettingsSection>

      {confirmingShutdown && (
        <ConfirmDialog
          title={t('settings.shutdownTitle')}
          description={t('settings.shutdownConfirmDesc')}
          tone="danger"
          confirmLabel={t('settings.shutdownConfirm')}
          onClose={() => setConfirmingShutdown(false)}
          onConfirm={() =>
            api.shutdown().then(() => showToast(t('settings.shuttingDownToast'), 'warn'))
          }
        />
      )}
    </div>
  )
}

function BundledAutostartToggle() {
  const { t } = useI18n()
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const showToast = useToast()

  useEffect(() => {
    api.autoloader.getBundledAutostart().then((r) => setEnabled(r.enabled)).catch(() => {})
  }, [])

  const toggle = () => {
    const next = !enabled
    setBusy(true)
    api.autoloader
      .setBundledAutostart(next)
      .then(() => {
        setEnabled(next)
        showToast(t(next ? 'settings.autostartOnToast' : 'settings.autostartOffToast'))
      })
      .catch((e) => showToast(e.message, 'err'))
      .finally(() => setBusy(false))
  }

  return (
    <SettingsRow
      title={t('settings.autostartBundledTitle')}
      description={t('settings.autostartBundledDesc')}
      control={<Toggle checked={enabled} onChange={toggle} disabled={busy} label={t('settings.autostartBundledTitle')} />}
    />
  )
}

function AutoloaderEditor() {
  const { t } = useI18n()
  const [enabled, setEnabled] = useState(false)
  const [delay, setDelay] = useState(5)
  const [delayDraft, setDelayDraft] = useState('5')
  const [settleMs, setSettleMs] = useState(500)
  const [retries, setRetries] = useState(0)
  const [continueOnError, setContinueOnError] = useState(true)
  const [sequence, setSequence] = useState([])
  const [payloadNames, setPayloadNames] = useState([])
  const [disabledPayloadNames, setDisabledPayloadNames] = useState([])
  const [status, setStatus] = useState(null)
  const [paths, setPaths] = useState(null)
  const [saveState, setSaveState] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [running, setRunning] = useState(false)
  const [confirmRunAgain, setConfirmRunAgain] = useState(false)
  const [error, setError] = useState('')
  const [draggingIndex, setDraggingIndex] = useState(-1)
  const [dragOverIndex, setDragOverIndex] = useState(-1)
  const dragIndexRef = useRef(-1)
  const showToast = useToast()

  // Autosave bookkeeping that must survive renders without causing one: whether the
  // first GET landed, the current and last-confirmed config, and any save in flight.
  const hydratedRef = useRef(false)
  const latestConfigRef = useRef(null)
  const savedKeyRef = useRef(null)
  const inFlightRef = useRef(null)
  const savedFadeRef = useRef(null)

  const currentConfig = { enabled, delay, settle_ms: settleMs, retries, continue_on_error: continueOnError, sequence }
  latestConfigRef.current = currentConfig
  const configKey = JSON.stringify(currentConfig)

  const load = () => {
    api.autoloader.getConfig().then((c) => {
      hydratedRef.current = false // the state updates below are hydration, not a user edit
      setEnabled(c.enabled)
      setDelay(c.delay)
      setDelayDraft(String(c.delay))
      setSettleMs(c.settle_ms ?? 500)
      setRetries(c.retries ?? 0)
      setContinueOnError(c.continue_on_error ?? true)
      setSequence(c.sequence)
      const key = JSON.stringify({
        enabled: c.enabled, delay: c.delay, settle_ms: c.settle_ms ?? 500,
        retries: c.retries ?? 0, continue_on_error: c.continue_on_error ?? true, sequence: c.sequence,
      })
      savedKeyRef.current = key
      // Flip back only once the state above has committed, or the next render
      // autosaves the config we just loaded.
      window.setTimeout(() => { hydratedRef.current = true }, 0)
    })
    api.payloads.list().then((r) => {
      setPayloadNames(r.payloads.map((p) => p.name))
      setDisabledPayloadNames(r.payloads.filter((p) => !p.enabled).map((p) => p.name))
    })
    api.autoloader.status().then(setStatus).catch(() => {})
  }

  useEffect(() => {
    load()
    api.paths().then(setPaths).catch(() => {})
    const id = setInterval(() => api.autoloader.status().then(setStatus).catch(() => {}), 1200)
    return () => clearInterval(id)
  }, [])

  // Never more than one save in flight: overlapping requests can land out of order
  // and silently revert. A change during a save is picked up by its `finally`.
  const trySave = () => {
    if (inFlightRef.current) return inFlightRef.current
    const configToSave = latestConfigRef.current
    const keyBeingSaved = JSON.stringify(configToSave)
    if (keyBeingSaved === savedKeyRef.current) return Promise.resolve()

    setSaveState('saving')
    const promise = api.autoloader.setConfig(configToSave)
      .then(() => {
        savedKeyRef.current = keyBeingSaved
        setSaveState('saved')
        setError('')
        window.clearTimeout(savedFadeRef.current)
        savedFadeRef.current = window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000)
      })
      .catch((e) => {
        setSaveState('error')
        setError(e.message)
        throw e
      })
      .finally(() => {
        inFlightRef.current = null
        if (JSON.stringify(latestConfigRef.current) !== savedKeyRef.current) trySave()
      })
    inFlightRef.current = promise
    return promise
  }

  // Debounced autosave — waits for a quiet moment after the last edit
  // instead of saving on every keystroke/click.
  useEffect(() => {
    if (!hydratedRef.current) return
    const timer = window.setTimeout(() => { trySave().catch(() => {}) }, 550)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey])

  const commitDelay = (raw) => {
    const parsed = parseInt(raw, 10)
    // Clearing a field mid-edit must not autosave 0, so only a valid number
    // updates the saved value.
    if (Number.isFinite(parsed) && parsed >= 0) setDelay(Math.min(parsed, 300))
  }

  const [customDelay, setCustomDelay] = useState('1000')

  const removeStep = (i) => setSequence((current) => current.filter((_, idx) => idx !== i))
  const moveStep = (i, dir) => {
    const j = i + dir
    setSequence((current) => {
      if (j < 0 || j >= current.length) return current
      const next = [...current]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  const addLoad = (name) => setSequence((current) => [...current, { type: 'load', value: name }])
  const addDelay = (ms) => setSequence((current) => [...current, { type: 'delay', value: String(ms) }])

  const endDrag = () => {
    dragIndexRef.current = -1
    setDraggingIndex(-1)
    setDragOverIndex(-1)
  }

  const dropStep = (toIndex) => {
    const fromIndex = dragIndexRef.current
    if (fromIndex >= 0 && fromIndex !== toIndex) {
      setSequence((current) => {
        if (fromIndex >= current.length || toIndex >= current.length) return current
        const next = [...current]
        const [step] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, step)
        return next
      })
    }
    endDrag()
  }

  // Drop a queued payload from Available so it can't be added twice by a stray
  // double-click.
  const usedLoadNames = new Set(sequence.filter((s) => s.type === 'load').map((s) => s.value))
  const available = payloadNames.filter((n) => !usedLoadNames.has(n) && !disabledPayloadNames.includes(n))
  const missing = [...usedLoadNames].filter((name) => !payloadNames.includes(name))
  const disabledQueued = [...usedLoadNames].filter((name) => disabledPayloadNames.includes(name))
  const kstuffCount = sequence.filter((s) => s.type === 'load' && /kstuff/i.test(s.value)).length
  const hasEtaHen = sequence.some((s) => s.type === 'load' && /etahen/i.test(s.value))
  const issues = [
    ...(missing.length ? [t('settings.issueMissingPayloads', { count: missing.length, list: missing.join(', ') })] : []),
    ...(disabledQueued.length ? [t('settings.issueEnableBeforeAutoloading', { list: disabledQueued.join(', ') })] : []),
    ...(kstuffCount > 1 ? [t('settings.issueMultipleKstuff')] : []),
    ...(kstuffCount > 0 && hasEtaHen ? [t('settings.issueEtaHenKstuff')] : []),
    ...(sequence.every((s) => s.type !== 'load') ? [t('settings.issueNoPayload')] : []),
  ]

  // A manual run bypasses the startup guard and launches everything. Flushes any
  // pending autosave first and refuses to run if that save fails.
  const runSequence = async () => {
    setError('')
    if (JSON.stringify(latestConfigRef.current) !== savedKeyRef.current) {
      try {
        await trySave()
      } catch (e) {
        setError(e.message)
        return
      }
      // Covers a change that raced in right as the flush above resolved.
      if (JSON.stringify(latestConfigRef.current) !== savedKeyRef.current) {
        try {
          await trySave()
        } catch (e) {
          setError(e.message)
          return
        }
      }
    }
    setRunning(true)
    try {
      await api.autoloader.run()
      showToast(t('settings.sequenceStartedToast'))
      setStatus(await api.autoloader.status())
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <SectionHero
        icon={<PowerIcon size={18} />}
        title={t('settings.tabAutoloader')}
        description={t('settings.autoloaderDesc')}
        status={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {saveState !== 'idle' && (
              <span className="flex items-center gap-1.5 text-xs text-text-dim">
                {saveState === 'saving' && <><span className="pmgr-live-dot text-info" /> {t('settings.savingEllipsis')}</>}
                {saveState === 'saved' && <span className="text-ok">✓ {t('settings.savedStatus')}</span>}
                {saveState === 'error' && (
                  <span className="flex items-center gap-1.5 text-err">
                    {t('settings.couldntSave')}
                    <button type="button" onClick={() => trySave().catch(() => {})} className="font-semibold underline underline-offset-2">
                      {t('common.retry')}
                    </button>
                  </span>
                )}
              </span>
            )}
            {status?.already_loaded && !status?.running && <Pill tone="ok">{t('settings.alreadyLoadedPill')}</Pill>}
            <Pill tone={status?.running ? 'info' : enabled ? 'ok' : 'neutral'} live={status?.running}>
              {status?.running ? t('common.running') : t(enabled ? 'settings.autoloaderPillEnabled' : 'settings.autoloaderPillDisabled')}
            </Pill>
          </div>
        }
      />

      {status?.running && (
        <SettingsSection className="border-info/30">
          <div className="flex items-center justify-between gap-3" aria-live="polite">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-text">
                <span className="pmgr-live-dot text-info shrink-0" />
                <span className="truncate">{status.current || t(status.remaining_seconds > 0 ? 'settings.statusWaitingDelay' : 'settings.statusPreparing')}</span>
              </div>
              <div className="mt-0.5 text-xs text-text-dim">
                {t('settings.stepOfTotal', { done: status.done, total: status.total })}
                {status.remaining_seconds > 0 ? t('settings.startingInSeconds', { seconds: status.remaining_seconds }) : ''}
              </div>
            </div>
            <Button
              size="sm"
              tone="danger"
              onClick={() => api.autoloader.abort().then(() => api.autoloader.status().then(setStatus))}
            >
              {t('common.cancel')}
            </Button>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-border">
            <div className="h-full rounded-full bg-info transition-[width] duration-500" style={{ width: `${status.total ? (status.done / status.total) * 100 : 4}%` }} />
          </div>
        </SettingsSection>
      )}

      {error && <div className="mb-4 rounded-xl border border-err/25 bg-err/10 px-3 py-2 text-sm text-err">{error}</div>}

      <SettingsSection title={t('settings.startupBehaviorTitle')} description={t('settings.startupBehaviorDesc')}>
        <SettingsRow
          title={t('settings.autoloaderRowTitle')}
          description={t('settings.autoloaderRowDesc')}
          control={<Toggle checked={enabled} onChange={setEnabled} label={t('settings.autoloaderEnabledLabel')} />}
        />
        <SettingsRow
          title={t('settings.startupDelayTitle')}
          description={t('settings.startupDelayDesc')}
          control={
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={delayDraft}
                onChange={(e) => { setDelayDraft(e.target.value); commitDelay(e.target.value) }}
                onBlur={() => setDelayDraft(String(delay))}
                className="w-16 rounded-md border border-panel-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
              />
              <span className="text-sm text-text-dim">{t('settings.seconds')}</span>
            </div>
          }
        />
        <SettingsRow
          title={t('settings.retriesTitle')}
          description={t('settings.retriesDesc')}
          control={
            <select value={retries} onChange={(e) => setRetries(Number(e.target.value))} className="rounded-md border border-panel-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent">
              <option value={0}>{t('settings.none')}</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
            </select>
          }
        />
        <SettingsRow
          title={t('settings.timeBetweenTitle')}
          description={t('settings.timeBetweenDesc')}
          control={
            <select value={settleMs} onChange={(e) => setSettleMs(Number(e.target.value))} className="rounded-md border border-panel-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent">
              <option value={0}>{t('settings.none')}</option><option value={500}>0.5s</option><option value={1000}>1s</option><option value={2000}>2s</option>
            </select>
          }
        />
        <SettingsRow
          title={t('settings.continueOnFailureTitle')}
          description={t('settings.continueOnFailureDesc')}
          control={<Toggle checked={continueOnError} onChange={setContinueOnError} label={t('settings.continueOnFailureLabel')} />}
        />
        <BundledAutostartToggle />
      </SettingsSection>

      {issues.length > 0 && (
        <SettingsSection title={t('settings.sequenceNeedsAttention')} className="border-warn/30">
          <div className="space-y-2">
            {issues.map((issue) => (
              <div key={issue} className="flex items-start gap-2 text-sm text-warn">
                <AlertTriangleIcon size={14} className="mt-0.5 shrink-0" />
                <span>{issue}</span>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}
      {!status?.running && status?.last_error && (
        <SettingsSection title={t('settings.lastRunFailed')} className="border-err/30">
          <div className="flex items-start gap-2 text-sm text-err">
            <AlertTriangleIcon size={14} className="mt-0.5 shrink-0" />
            <span>{status.last_error}</span>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title={t('settings.sequenceTitle')} description={t('settings.sequenceDesc')}>
        {sequence.length === 0 ? (
          <div className="pmgr-empty-state py-8 text-center text-sm text-text-dim">
            <div className="font-semibold text-text">{t('settings.noStepsTitle')}</div>
            <div className="mt-1">{t('settings.noStepsDesc')}</div>
          </div>
        ) : (
          <div>
            {sequence.map((step, i) => {
              const isLoad = step.type === 'load'
              const invalid = isLoad && !payloadNames.includes(step.value)
              const disabledStep = isLoad && !invalid && disabledPayloadNames.includes(step.value)
              return (
                <div key={i}>
                  {/* A thin connector between steps — an ordered workflow,
                      not just an unordered list of rows. */}
                  {i > 0 && <div className="ml-[19px] h-2 w-px bg-panel-border" />}
                  <div
                    onDragOver={(event) => {
                      if (dragIndexRef.current < 0) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setDragOverIndex(i)
                    }}
                    onDrop={(event) => { event.preventDefault(); dropStep(i) }}
                    className={`pmgr-row-in flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
                      invalid ? 'border-err/30 bg-err/5' : disabledStep ? 'border-warn/30 bg-warn/5' : 'border-panel-border'
                    } ${draggingIndex === i ? 'opacity-40' : ''} ${dragOverIndex === i && draggingIndex !== i ? 'border-t-2 border-t-accent bg-accent/[0.06]' : ''}`}
                    style={{ '--ti': i }}
                  >
                    <span
                      draggable="true"
                      role="img"
                      aria-label={t('settings.dragToReorder')}
                      title={t('settings.dragToReorder')}
                      onDragStart={(event) => {
                        dragIndexRef.current = i
                        setDraggingIndex(i)
                        setDragOverIndex(-1)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', String(i))
                      }}
                      onDragEnd={endDrag}
                      className="-ml-1 grid h-7 w-5 shrink-0 cursor-grab place-items-center text-text-dim opacity-60 hover:opacity-100 active:cursor-grabbing"
                    >
                      <GripIcon size={15} />
                    </span>
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-panel-border text-[10px] font-bold text-text-dim">
                      {i + 1}
                    </span>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                      invalid ? 'bg-err/10 text-err' : disabledStep ? 'bg-warn/10 text-warn' : isLoad ? 'bg-info/10 text-info' : 'bg-panel-border text-text-dim'
                    }`}>
                      {isLoad ? <LaunchIcon size={13} /> : <ClockIcon size={13} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text" dir={isLoad ? 'ltr' : undefined}>{isLoad ? step.value : t('settings.waitMs', { ms: step.value })}</span>
                      {invalid && <span className="text-xs text-err">{t('settings.payloadNotFound')}</span>}
                      {disabledStep && <span className="text-xs text-warn">{t('settings.disabledEnableFirst')}</span>}
                    </span>
                    <Button size="icon" tone="ghost" title={t('settings.moveUp')} onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</Button>
                    <Button size="icon" tone="ghost" title={t('settings.moveDown')} onClick={() => moveStep(i, 1)} disabled={i === sequence.length - 1}>↓</Button>
                    <Button size="icon" tone="danger" title={t('common.remove')} onClick={() => removeStep(i)}>✕</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SettingsSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SettingsSection title={t('settings.addToSequenceTitle')} description={t('settings.addToSequenceDesc')}>
          <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {available.map((n) => (
              <button
                key={n}
                onClick={() => addLoad(n)}
                className="flex w-full items-center justify-between rounded-md border border-panel-border px-2.5 py-2 text-left text-sm text-text transition-colors hover:border-accent/50 hover:bg-panel-border"
              >
                <span className="truncate">{n}</span>
                <span className="shrink-0 text-xs text-text-dim">{t('settings.addAction')}</span>
              </button>
            ))}
            {available.length === 0 && (
              <div className="rounded-md border border-dashed border-panel-border py-4 text-center text-xs text-text-dim">
                {t(payloadNames.length === 0 ? 'settings.noPayloadsInstalled' : 'settings.allPayloadsQueued')}
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title={t('settings.addWaitTitle')}
          description={t('settings.addWaitDesc')}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {[1000, 3000, 5000].map((ms) => (
              <Button key={ms} size="sm" tone="neutral" onClick={() => addDelay(ms)}>{t('settings.addSeconds', { seconds: ms / 1000 })}</Button>
            ))}
            <input
              type="number"
              min="0"
              value={customDelay}
              onChange={(e) => setCustomDelay(e.target.value)}
              className="w-20 rounded-md border border-panel-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
            />
            <Button size="sm" tone="neutral" onClick={() => customDelay && addDelay(parseInt(customDelay, 10) || 0)}>
              {t('settings.addAction')}
            </Button>
          </div>
        </SettingsSection>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Button
          tone="primary"
          sheen
          onClick={() => (status?.already_loaded ? setConfirmRunAgain(true) : runSequence())}
          disabled={running || status?.running || issues.length > 0}
        >
          {status?.running ? t('settings.sequenceRunning') : t(status?.already_loaded ? 'settings.runSequenceAgain' : 'settings.runSequenceNow')}
        </Button>
      </div>
      {issues.length > 0 && !status?.running && (
        <div className="mt-1 text-right text-xs text-text-dim">{t('settings.resolveIssuesFirst')}</div>
      )}

      {confirmRunAgain && (
        <ConfirmDialog
          title={t('settings.runAgainTitle')}
          description={t('settings.runAgainDesc')}
          confirmLabel={t('settings.runAgainConfirm')}
          onClose={() => setConfirmRunAgain(false)}
          onConfirm={runSequence}
        />
      )}

      <CollapsibleSection title={t('settings.technicalDetails')} defaultOpen={false}>
        <div className="text-sm">
          <CopyRow label={t('settings.copyAutoloaderConfigFile')} value={paths?.autoloader_ini} />
        </div>
      </CollapsibleSection>
    </div>
  )
}

function AccountsPanel() {
  const { t } = useI18n()
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [mode, setMode] = useState('activate') // 'activate' | 'signin'
  const [accountId, setAccountId] = useState('')
  const [idSource, setIdSource] = useState('existing') // 'existing' | 'suggested' | 'edited'
  const [busy, setBusy] = useState(false)
  const [rebootSlots, setRebootSlots] = useState(() => new Set())
  const [restoreTarget, setRestoreTarget] = useState(null)
  const showToast = useToast()

  const load = () => {
    api.accounts
      .list()
      .then((r) => setSlots(r.slots || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const select = (s, nextMode) => {
    setSelectedSlot(s)
    setMode(nextMode)
    const existing = s.id_hex !== '0x0'
    setAccountId(existing ? s.id_hex : suggestAccountId(s.name))
    setIdSource(existing ? 'existing' : 'suggested')
  }

  const apply = () => {
    if (!selectedSlot) return
    setBusy(true)
    api.accounts
      .apply(selectedSlot.slot, accountId.trim())
      .then(() => {
        showToast(t('settings.activatedToast', { name: selectedSlot.name, slot: selectedSlot.slot }))
        setSelectedSlot(null)
        load()
      })
      .catch((e) => showToast(t('settings.activateFailedToast', { message: e.message }), 'err'))
      .finally(() => setBusy(false))
  }

  const signIn = () => {
    if (!selectedSlot) return
    setBusy(true)
    api.accounts
      .signIn(accountId.trim())
      .then(() => {
        showToast(t('settings.signedInToast', { name: selectedSlot.name }))
        setRebootSlots((prev) => new Set(prev).add(selectedSlot.slot))
        setSelectedSlot(null)
        load()
      })
      .catch((e) => showToast(t('settings.signInFailedToast', { message: e.message }), 'err'))
      .finally(() => setBusy(false))
  }

  const restore = (s) =>
    api.accounts
      .restore(s.slot)
      .then(() => {
        showToast(t('settings.slotRestoredToast', { slot: s.slot }))
        if (selectedSlot?.slot === s.slot) setSelectedSlot(null)
        load()
      })

  return (
    <div>
      <SectionHero
        icon={<UserIcon size={18} />}
        title={t('settings.offlineActivationTitle')}
        description={t('settings.offlineActivationDesc')}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-panel-border bg-bg/45 p-3">
          <div className="text-sm font-bold text-text">{t('settings.activateCardTitle')}</div>
          <p className="mt-1 text-xs text-text-dim">{t('settings.activateCardDesc')}</p>
        </div>
        <div className="rounded-xl border border-panel-border bg-bg/45 p-3">
          <div className="text-sm font-bold text-text">{t('settings.signInCardTitle')}</div>
          <p className="mt-1 text-xs text-text-dim">{t('settings.signInCardDesc')}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="pmgr-skeleton h-20 rounded-xl" />
          <div className="pmgr-skeleton h-20 rounded-xl" />
        </div>
      ) : slots.length === 0 ? (
        <div className="pmgr-empty-state py-10 text-center text-sm text-text-dim">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-panel-border bg-panel-2 text-text-dim">
            <UserIcon size={22} />
          </div>
          <div className="font-semibold text-text">{t('settings.noAccountsTitle')}</div>
          <div className="mt-1">{t('settings.noAccountsDesc')}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {slots.map((s) => {
            const isSelected = selectedSlot?.slot === s.slot
            return (
              <div key={s.slot} className="rounded-xl border border-panel-border bg-panel p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-panel-border text-text-dim">
                      <UserIcon size={18} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-text">{s.name}</div>
                      <div className="text-xs text-text-dim">{t('settings.slotLabel', { slot: s.slot })}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {s.is_foreground && <Pill tone="info">{t('settings.currentUserPill')}</Pill>}
                    {s.activated && <Pill tone="ok">{t('settings.activatedPill')}</Pill>}
                    {s.has_backup && <Pill tone="neutral">{t('settings.backupAvailablePill')}</Pill>}
                    {rebootSlots.has(s.slot) && <Pill tone="warn">{t('settings.rebootToApplyPill')}</Pill>}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    tone={isSelected && mode === 'activate' ? 'primary' : 'neutral'}
                    onClick={() => (isSelected && mode === 'activate' ? setSelectedSlot(null) : select(s, 'activate'))}
                  >
                    {isSelected && mode === 'activate' ? t('common.cancel') : t('settings.activateEllipsis')}
                  </Button>
                  {s.is_foreground && (
                    <Button
                      size="sm"
                      tone={isSelected && mode === 'signin' ? 'primary' : 'neutral'}
                      onClick={() => (isSelected && mode === 'signin' ? setSelectedSlot(null) : select(s, 'signin'))}
                    >
                      {isSelected && mode === 'signin' ? t('common.cancel') : t('settings.signInEllipsis')}
                    </Button>
                  )}
                  {s.has_backup && (
                    <Button size="sm" tone="neutral" onClick={() => setRestoreTarget(s)}>{t('settings.restoreBackup')}</Button>
                  )}
                </div>

                {isSelected && (
                  <div className="pmgr-row-in mt-3 space-y-2.5 border-t border-panel-border pt-3">
                    <div>
                      <label className="block text-sm font-semibold text-text">{t('settings.accountIdLabel')}</label>
                      <p className="mt-0.5 text-xs text-text-dim">{t('settings.accountIdDesc')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={accountId}
                        onChange={(e) => { setAccountId(e.target.value); setIdSource('edited') }}
                        dir="ltr"
                        className="w-full min-w-0 flex-1 rounded-md border border-panel-border bg-bg px-3 py-1.5 text-sm pmgr-mono text-text outline-none focus:border-accent"
                      />
                      <span className="shrink-0 text-xs text-text-dim">
                        {idSource === 'existing' ? t('settings.idSourceExisting') : idSource === 'suggested' ? t('settings.idSourceSuggested') : t('settings.idSourceEdited')}
                      </span>
                    </div>
                    <details className="rounded-lg border border-panel-border bg-bg/45 px-3 py-2">
                      <summary className="cursor-pointer text-xs font-semibold text-text-dim hover:text-text">
                        {t('settings.accountIdHelpTitle')}
                      </summary>
                      <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-text-dim">
                        <p>{t('settings.accountIdHelpIntro')}</p>
                        <ul className="ml-4 list-disc space-y-1">
                          <li>{t('settings.accountIdHelpThisConsole')}</li>
                          <li>{t('settings.accountIdHelpOtherConsole')}</li>
                          <li>{t('settings.accountIdHelpSaveData')}</li>
                          <li>
                            {t('settings.accountIdHelpLookup')}{' '}
                            <a
                              href={PSN_ACCOUNT_CHECKER_URL}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                            >
                              {t('settings.accountIdHelpLookupLink')}
                            </a>
                          </li>
                        </ul>
                        <p>{t('settings.accountIdHelpFormat')}</p>
                      </div>
                    </details>
                    <p className="text-xs text-text-dim">{t('settings.backupNoticeBeforeChange')}</p>
                    {mode === 'signin' ? (
                      <Button tone="primary" onClick={signIn} disabled={busy || !accountId.trim()}>
                        {busy ? t('settings.signingIn') : t('settings.signInAs', { name: s.name })}
                      </Button>
                    ) : (
                      <Button tone="primary" onClick={apply} disabled={busy || !accountId.trim()}>
                        {busy ? t('settings.applyingEllipsis') : t('settings.activateSlot', { slot: s.slot })}
                      </Button>
                    )}
                  </div>
                )}

                <div className="-mx-3.5 -mb-3.5 mt-3">
                  <CollapsibleSection title={t('settings.technicalDetails')} defaultOpen={false}>
                    <div className="text-xs">
                      <CopyRow label={t('settings.copyAccountId')} value={s.id_hex} />
                      <CopyRow label={t('settings.copyNpType')} value={s.type || '—'} />
                      <CopyRow label={t('settings.copyFlags')} value={String(s.flags)} />
                      <CopyRow label={t('settings.copySlot')} value={String(s.slot)} />
                    </div>
                  </CollapsibleSection>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {restoreTarget && (
        <ConfirmDialog
          title={t('settings.restoreAccountTitle')}
          description={t('settings.restoreAccountDesc', { name: restoreTarget.name, slot: restoreTarget.slot })}
          tone="warn"
          confirmLabel={t('saves.restore')}
          onClose={() => setRestoreTarget(null)}
          onConfirm={() => restore(restoreTarget)}
        />
      )}
    </div>
  )
}

// Edits ShadowMountPlus's own scanpath= lines in its config.ini — Prospero
// doesn't run ShadowMountPlus itself, this just manages where it looks.
function ShadowMountPanel() {
  const { t } = useI18n()
  const showToast = useToast()
  const [scanPaths, setScanPaths] = useState([])
  const [usingDefaults, setUsingDefaults] = useState(true)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [volumes, setVolumes] = useState([])

  const load = () => {
    api.experimental
      .getShadowMountScanPaths()
      .then((r) => {
        setScanPaths(r.scanPaths || [])
        setUsingDefaults(Boolean(r.usingDefaults))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])
  useEffect(() => { api.ftp.storage().then((r) => setVolumes(r.volumes || [])).catch(() => {}) }, [])

  const save = (next) => {
    setBusy(true)
    return api.experimental
      .setShadowMountScanPaths(next)
      .then((r) => {
        setScanPaths(next)
        setUsingDefaults(Boolean(r.usingDefaults))
      })
      .finally(() => setBusy(false))
  }

  const addPath = (value) => save([...scanPaths, value.trim()]).then(() => showToast(t('settings.smpPathAdded')))
  const removePath = (path) => save(scanPaths.filter((p) => p !== path))
  const resetToDefaults = () => save([]).then(() => showToast(t('settings.smpResetToast')))

  const validatePath = (value) => {
    const v = value.trim()
    if (!v.startsWith('/') || v.includes('..')) return t('settings.smpInvalidPath')
    if (scanPaths.includes(v)) return t('settings.smpDuplicatePath')
    return ''
  }

  return (
    <div className="mt-6 border-t border-panel-border pt-6">
      <SectionHero icon={<FolderIcon size={18} />} title={t('settings.smpTitle')} description={t('settings.smpDesc')} />
      {loading ? (
        <div className="text-sm text-text-dim">{t('common.loading')}</div>
      ) : (
        <div className="rounded-xl border border-panel-border bg-bg/45 p-3.5">
          {usingDefaults ? (
            <div className="text-xs text-text-dim">
              <div className="mb-1.5 text-sm font-semibold text-text">{t('settings.smpUsingDefaults')}</div>
              <p>{t('settings.smpDefaultsDesc')}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {scanPaths.map((path) => (
                <div key={path} className="flex items-center justify-between gap-2 rounded-lg border border-panel-border bg-bg px-3 py-2 text-sm">
                  <span className="min-w-0 truncate pmgr-mono" dir="ltr">{path}</span>
                  <Button size="icon" tone="ghost" title={t('common.remove')} disabled={busy} onClick={() => removePath(path)} icon={<DeleteIcon size={14} />} />
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button tone="neutral" size="sm" icon={<PlusIcon size={14} />} disabled={busy} onClick={() => setAddOpen(true)}>
              {t('settings.smpAddPath')}
            </Button>
            {!usingDefaults && (
              <Button tone="ghost" size="sm" disabled={busy} onClick={resetToDefaults}>
                {t('settings.smpResetDefaults')}
              </Button>
            )}
          </div>
        </div>
      )}

      {addOpen && (
        <PathPickerModal
          title={t('settings.smpAddPathTitle')}
          description={t('settings.smpDesc')}
          initialPath="/mnt"
          volumes={volumes}
          mode="folder"
          actionLabel={t('common.add')}
          validateSelection={validatePath}
          onClose={() => setAddOpen(false)}
          onSelect={(selected) => addPath(selected).then(() => setAddOpen(false))}
        />
      )}
    </div>
  )
}

function ExperimentalPanel() {
  const { t } = useI18n()
  return (
    <div>
      <SectionHero
        icon={<FlaskIcon size={18} />}
        title={t('settings.tabExperimental')}
        description={t('settings.experimentalDesc')}
      />
      <AccountsPanel />
      <ShadowMountPanel />
    </div>
  )
}

function AboutPanel() {
  const { t } = useI18n()
  return (
    <Panel title={t('settings.tabAbout')}>
      <div className="text-sm leading-relaxed text-text-dim">
        <p className="text-text">HLDRIVE 1.0.1</p>
        <p className="mt-1">Não seja mão de vaca e ajude a melhorar o projeto.</p>
        <p className="mt-3">
          <a href="https://www.youtube.com/@henriquelouro7848" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Inscreva-se no canal do YouTube
          </a>
        </p>
        <p className="mt-3 text-xs">Avisos de licença e créditos obrigatórios estão na documentação do projeto.</p>
      </div>
    </Panel>
  )
}
const TABS = [
  { id: 'general', labelKey: 'settings.tabGeneral', icon: SlidersIcon },
  { id: 'autoloader', labelKey: 'settings.tabAutoloader', icon: PowerIcon },
  { id: 'appearance', labelKey: 'settings.tabAppearance', icon: PaletteIcon },
  { id: 'thermal', labelKey: 'settings.tabThermal', icon: ThermometerIcon },
  { id: 'experimental', labelKey: 'settings.tabExperimental', icon: FlaskIcon },
  { id: 'about', labelKey: 'settings.tabAbout', icon: InfoIcon },
]

export default function SettingsView({ settingsTab, onNavigate }) {
  const { t } = useI18n()
  const [tab, setTab] = useState(settingsTab || 'general')

  useEffect(() => setTab(settingsTab || 'general'), [settingsTab])

  const selectTab = (id) => {
    setTab(id)
    onNavigate?.('settings', id)
  }

  const moveTabFocus = (event, index) => {
    let next = null
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = TABS.length - 1
    if (next === null) return
    event.preventDefault()
    selectTab(TABS[next].id)
    window.requestAnimationFrame(() => document.getElementById(`pmgr-settings-tab-${TABS[next].id}`)?.focus())
  }

  return (
    <div>
      <div role="tablist" aria-label={t('nav.settings')} className="pmgr-settings-tabs mb-4 flex gap-1.5 overflow-x-auto rounded-2xl border border-panel-border bg-panel p-1.5">
        {TABS.map((tabItem, index) => {
          const Icon = tabItem.icon
          return (
            <button
              key={tabItem.id}
              id={`pmgr-settings-tab-${tabItem.id}`}
              role="tab"
              aria-selected={tab === tabItem.id}
              aria-controls="pmgr-settings-panel"
              tabIndex={tab === tabItem.id ? 0 : -1}
              onClick={() => selectTab(tabItem.id)}
              onKeyDown={(event) => moveTabFocus(event, index)}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-[color,background-color,box-shadow] duration-200 ${
                tab === tabItem.id
                  ? 'bg-accent text-white shadow-[0_6px_18px_-8px_var(--color-accent)]'
                  : 'text-text-dim hover:bg-panel-border hover:text-text'
              }`}
            >
              <Icon size={15} />
              {t(tabItem.labelKey)}
            </button>
          )
        })}
      </div>

      <div key={tab} id="pmgr-settings-panel" role="tabpanel" aria-labelledby={`pmgr-settings-tab-${tab}`} className="pmgr-view-enter">
        {tab === 'general' && <GeneralTab />}
        {tab === 'autoloader' && <AutoloaderEditor />}
        {tab === 'appearance' && (
          <>
            <ThemePanel />
            <VisualEffectsPanel />
          </>
        )}
        {tab === 'thermal' && <ThermalPanel />}
        {tab === 'experimental' && <ExperimentalPanel />}
        {tab === 'about' && <AboutPanel />}
      </div>
    </div>
  )
}
