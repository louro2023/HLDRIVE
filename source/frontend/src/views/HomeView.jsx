import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import Pill from '../components/Pill.jsx'
import PlatformBadge from '../components/PlatformBadge.jsx'
import SkeletonGrid from '../components/Skeleton.jsx'
import Panel from '../components/Panel.jsx'
import SearchField from '../components/SearchField.jsx'
import SegmentedControl from '../components/SegmentedControl.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Button from '../components/Button.jsx'
import { ICONS } from '../components/NavRail.jsx'
import { ChevronRightIcon, PowerIcon, RefreshIcon } from '../components/icons.jsx'
import { api } from '../lib/api.js'
import { useToast } from '../lib/ToastContext.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { formatDate } from '../lib/format.js'
import { useDebouncedValue } from '../lib/useDebouncedValue.js'

// Word order/punctuation around a name differs by language, so the caller
// picks a plain vs. a "WithName" key instead of concatenating "greeting, name".
function greetingKey(userName) {
  const h = new Date().getHours()
  const period = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
  return userName ? `home.greeting.${period}WithName` : `home.greeting.${period}`
}

const QUICK_ACTIONS = [
  { id: 'ftp', labelKey: 'home.quickBrowseFiles', descKey: 'home.quickBrowseFilesDesc' },
  { id: 'pkg', labelKey: 'home.quickInstallPkg', descKey: 'home.quickInstallPkgDesc' },
  { id: 'payloads', labelKey: 'home.quickRunPayload', descKey: 'home.quickRunPayloadDesc' },
  { id: 'autoloader', target: 'settings', tab: 'autoloader', labelKey: 'home.autoloader', descKey: 'home.quickAutoloaderDesc', icon: <PowerIcon size={18} /> },
  { id: 'saves', labelKey: 'home.quickBackUpSaves', descKey: 'home.quickBackUpSavesDesc' },
]

// app.db stores playedTimeOnConsole in seconds. Returns {key, count} so the caller can run
// it through a proper Intl.PluralRules-backed plural string instead of hand-appending "h"/"m".
function formatPlaytime(seconds) {
  if (!seconds) return null
  const h = Math.floor(seconds / 3600)
  if (h >= 1) return { key: 'home.playedHours', count: h }
  return { key: 'home.playedMinutes', count: Math.max(1, Math.floor(seconds / 60)) }
}

function formatLastPlayed(raw, locale) {
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return raw
  return formatDate(d, locale, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const SORTS = [
  { id: 'name-asc', labelKey: 'home.sortNameAsc' },
  { id: 'name-desc', labelKey: 'home.sortNameDesc' },
  { id: 'id-asc', labelKey: 'home.sortIdAsc' },
  { id: 'recent', labelKey: 'home.sortRecent' },
]

const PLATFORM_FILTERS = [
  { id: 'all', labelKey: 'home.allGames' },
  { id: 'ps5', labelKey: 'home.ps5Games' },
  { id: 'ps4', labelKey: 'home.ps4Games' },
]

// Memoized so the 5s/10s background polls below don't re-render every tile.
const TitleTile = memo(function TitleTile({ title, index, launching, running, onPlay, t, locale }) {
  const [iconFailed, setIconFailed] = useState(false)
  const showIcon = title.has_icon && !iconFailed
  const lastPlayed = formatLastPlayed(title.last_played, locale)
  const played = formatPlaytime(title.played_seconds)

  return (
    <div
      className={`pmgr-game-card pmgr-tile pmgr-tile-in group relative grid min-h-[148px] grid-cols-[118px_minmax(0,1fr)] overflow-hidden rounded-xl border bg-panel sm:grid-cols-[138px_minmax(0,1fr)] ${
        running ? 'border-ok' : 'border-panel-border'
      }`}
      style={{ '--ti': index }}
      aria-label={`${title.name}, ${title.platform || 'PlayStation'}, ${title.title_id}`}
    >
      <div className="pmgr-game-art relative min-h-[148px] overflow-hidden bg-panel-2">
        {showIcon ? (
          <img
            src={api.titles.iconUrl(title.title_id)}
            alt={`${title.name} cover`}
            onError={() => setIconFailed(true)}
            loading="lazy"
            decoding="async"
            className="absolute top-0 right-0 bottom-0 left-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-accent/40">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M8 9v6M5 12h6M14 10h.01M17 13h.01" strokeLinecap="round" />
            </svg>
          </div>
        )}
        {running && (
          <span className="absolute left-2 top-2">
            <Pill tone="ok" live>
              {t('common.running')}
            </Pill>
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-col p-3.5">
        <div className="line-clamp-2 min-h-[2.5em] text-base font-bold leading-tight text-text" title={title.name}>
          {title.name}
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-text-dim">
          <PlatformBadge platform={title.platform} />
          <span className="pmgr-mono truncate rounded bg-bg/70 px-1.5 py-0.5 text-xs font-semibold tracking-wide" dir="ltr">{title.title_id}</span>
        </div>
        {/* Compact, priority-ordered metadata — playtime, then last played,
            then installed version. Unavailable ones are simply omitted
            instead of padded out with filler text; the name/platform/Title
            ID above and the Play button below are already enough on their
            own for a title with nothing else known about it yet. */}
        {(played || lastPlayed || title.version) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-snug text-text-dim">
            {played && <span className="text-text">{t(played.key, { count: played.count })}</span>}
            {played && (lastPlayed || title.version) && <span className="opacity-50">·</span>}
            {lastPlayed && <span className="truncate" title={lastPlayed}>{t('home.lastOpened')} <span className="text-text">{lastPlayed}</span></span>}
            {lastPlayed && title.version && <span className="opacity-50">·</span>}
            {title.version && (
              <span className="truncate" title={`${t('home.version')} ${title.version}`}>
                {t('home.version')} <span className="pmgr-mono text-text" dir="ltr">{title.version}</span>
              </span>
            )}
          </div>
        )}
        <button
          onClick={() => onPlay(title.title_id)}
          disabled={launching === title.title_id}
          className="pmgr-game-play pmgr-btn-sheen mt-auto inline-flex min-h-9 w-fit self-end items-center justify-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {launching === title.title_id ? (
            t('home.launching')
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7Z" />
              </svg>
              {t('home.play')}
            </>
          )}
        </button>
      </div>
    </div>
  )
})

export default function HomeView({ status, connection, onNavigate }) {
  const { t, locale } = useI18n()
  const [titles, setTitles] = useState(null)
  const [titleError, setTitleError] = useState('')
  const [runningTitleId, setRunningTitleId] = useState('')
  const [overview, setOverview] = useState({ thermal: null, autoloader: null })
  const [userName, setUserName] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('name-asc')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [launching, setLaunching] = useState('')
  const showToast = useToast()

  const loadTitles = () => {
    setTitleError('')
    api.titles.list().then((r) => setTitles(r.titles)).catch((error) => setTitleError(error.message))
  }

  useEffect(() => {
    let cancelled = false
    const poll = () => api.titles.running().then((r) => !cancelled && setRunningTitleId(r.title_id)).catch(() => {})
    poll()
    const id = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  useEffect(loadTitles, [])

  // Just the foreground user's name for the greeting. A one-time load on mount is
  // enough — it doesn't change minute to minute.
  useEffect(() => {
    api.system.info().then((info) => setUserName(info.user_name || '')).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadOverview = () => {
      Promise.allSettled([api.thermal.status(), api.autoloader.status()]).then(
        ([thermal, autoloader]) => {
          if (cancelled) return
          setOverview({
            thermal: thermal.status === 'fulfilled' ? thermal.value : null,
            autoloader: autoloader.status === 'fulfilled' ? autoloader.value : null,
          })
        },
      )
    }
    loadOverview()
    const id = setInterval(loadOverview, 10000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const play = useCallback((titleId) => {
    setLaunching(titleId)
    api.titles
      .launch(titleId)
      .then(() => showToast(t('home.launchedToast')))
      .catch((e) => showToast(e.message, 'err'))
      .finally(() => setLaunching(''))
  }, [showToast, t])

  // Keeps typing from re-filtering and re-reconciling the whole grid per key.
  const debouncedSearch = useDebouncedValue(search, 150)

  const view = useMemo(() => {
    if (!titles) return []
    let items = titles
    if (platformFilter !== 'all') {
      items = items.filter((title) => String(title.platform || '').toLowerCase().includes(platformFilter))
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLocaleLowerCase(locale)
      items = items.filter((title) => title.name.toLocaleLowerCase(locale).includes(q) || title.title_id.toLowerCase().includes(q))
    }
    items = [...items]
    if (sort === 'name-asc') items.sort((a, b) => a.name.localeCompare(b.name, locale))
    if (sort === 'name-desc') items.sort((a, b) => b.name.localeCompare(a.name, locale))
    if (sort === 'id-asc') items.sort((a, b) => a.title_id.localeCompare(b.title_id))
    if (sort === 'recent') items.sort((a, b) => (b.last_played || '').localeCompare(a.last_played || ''))
    if (runningTitleId) items.sort((a, b) => Number(b.title_id === runningTitleId) - Number(a.title_id === runningTitleId))
    return items
  }, [titles, debouncedSearch, sort, platformFilter, runningTitleId, locale])

  const platformCounts = useMemo(() => {
    const counts = { all: titles?.length || 0, ps5: 0, ps4: 0 }
    for (const title of titles || []) {
      const platform = String(title.platform || '').toLowerCase()
      if (platform.includes('ps5')) counts.ps5++
      if (platform.includes('ps4')) counts.ps4++
    }
    return counts
  }, [titles])

  const runningTitle = titles?.find((title) => title.title_id === runningTitleId)
  const titleTiles = useMemo(
    () => view.map((title, i) => (
      <TitleTile
        key={title.title_id}
        title={title}
        index={i}
        launching={launching}
        running={title.title_id === runningTitleId}
        onPlay={play}
        t={t}
        locale={locale}
      />
    )),
    [view, launching, runningTitleId, play, t, locale],
  )

  return (
    <div className="pmgr-home space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-2xl border border-panel-border bg-panel p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-text-dim">
            <span className={`h-1.5 w-1.5 rounded-full ${connection === 'online' ? 'bg-ok' : 'bg-warn'}`} />
            {connection === 'online' ? t('home.connected') : t('home.waiting')}
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-text">{t(greetingKey(userName), { name: userName })}</h2>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <button onClick={() => onNavigate?.('settings', 'thermal')} className="rounded-md text-left transition-colors hover:text-accent">
            <div className="text-xs text-text-dim">{t('home.thermals')}</div>
            <div className="font-semibold text-text">{overview.thermal?.ok ? `${overview.thermal.hottest_c}°C` : '—'}</div>
          </button>
          <button onClick={() => onNavigate?.('settings', 'autoloader')} className="rounded-md text-left transition-colors hover:text-accent">
            <div className="text-xs text-text-dim">{t('home.autoloader')}</div>
            <div className={`font-semibold ${overview.autoloader?.running ? 'text-ok' : 'text-text'}`}>
              {overview.autoloader === null
                ? '—'
                : overview.autoloader.running
                  ? t('home.autoloaderRunning')
                  : overview.autoloader.enabled
                    ? t('home.autoloaderEnabled')
                    : t('home.autoloaderOff')}
            </div>
          </button>
          <div>
            <div className="text-xs text-text-dim">{t('home.uptime')}</div>
            <div className="font-semibold text-text">{formatUptime(status?.uptime_seconds)}</div>
          </div>
        </div>
      </section>

      {runningTitle && (
        <section className="flex items-center gap-4 overflow-hidden rounded-2xl border border-ok/25 bg-panel p-3.5 sm:p-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-panel-2 sm:h-20 sm:w-20">
            {runningTitle.has_icon ? (
              <img src={api.titles.iconUrl(runningTitle.title_id)} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-text-dim">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="5" width="18" height="14" rx="2" /></svg>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <Pill tone="ok" live>{t('home.currentlyPlaying')}</Pill>
            <div className="mt-1.5 truncate text-lg font-bold text-text">{runningTitle.name}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-text-dim">
              <PlatformBadge platform={runningTitle.platform} />
              <span className="pmgr-mono truncate" dir="ltr">{runningTitle.title_id}</span>
            </div>
          </div>
          <button
            onClick={() => onNavigate?.('processes')}
            className="shrink-0 rounded-lg border border-panel-border px-3 py-2 text-xs font-semibold text-text-dim transition-colors hover:border-accent/40 hover:text-text"
          >
            {t('home.manageProcess')}
          </button>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.id}
            onClick={() => onNavigate?.(a.target || a.id, a.tab)}
            className="pmgr-tile group flex items-center gap-3 rounded-xl border border-panel-border bg-panel p-3.5 text-left"
          >
            <span className="pmgr-home-action-icon grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent transition-transform duration-200 group-hover:scale-105 group-focus-visible:scale-105">{a.icon || ICONS[a.id]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-text">{t(a.labelKey)}</span>
              <span className="block truncate text-xs text-text-dim">{t(a.descKey)}</span>
            </span>
            <ChevronRightIcon size={15} className="pmgr-home-action-chevron shrink-0 text-text-dim/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent" />
          </button>
        ))}
      </section>

      <Panel
        title={t('home.gameLibrary')}
        className="pmgr-home-library"
        actions={<span className="rounded-full bg-panel-border px-2.5 py-1 text-xs font-semibold text-text-dim">{titles === null ? t(titleError ? 'common.error' : 'home.loadingLibrary') : t('home.installedCount', { count: titles.length })}</span>}
      >
      <div className="pmgr-library-toolbar mb-4 rounded-xl border border-panel-border bg-bg/45 p-3">
        <div className="flex flex-wrap items-center gap-2">
        <SearchField value={search} onChange={setSearch} placeholder={t('home.searchGames')} className="min-w-48 flex-1" />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border border-panel-border bg-bg px-2.5 py-2 text-xs text-text outline-none focus:border-accent"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {t('home.sortPrefix', { label: t(s.labelKey) })}
            </option>
          ))}
        </select>
        <button
          onClick={loadTitles}
          className="pmgr-icon-btn inline-flex items-center gap-1.5 rounded-lg border border-panel-border px-3 py-2 text-xs font-semibold text-text-dim transition hover:border-accent/40 hover:text-text"
        >
          <RefreshIcon size={13} /> {t('home.refresh')}
        </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={PLATFORM_FILTERS.map((f) => ({ ...f, label: t(f.labelKey), count: platformCounts[f.id] }))}
            value={platformFilter}
            onChange={setPlatformFilter}
          />
          {runningTitleId && <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ok"><span className="pmgr-live-dot" /> {t('home.runningFirst')}</span>}
        </div>
      </div>

      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-text-dim">
        {titles === null ? t('home.loadingEllipsis') : t('home.titlesInView', { count: view.length })}
      </div>

      {titleError && titles !== null && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-err/20 bg-err/10 px-3 py-2.5 text-sm text-err">
          <span>{titleError}</span>
          <Button size="sm" tone="danger" onClick={loadTitles}>{t('common.tryAgain')}</Button>
        </div>
      )}

      {titleError && titles === null ? (
        <EmptyState
          title={t('common.error')}
          description={titleError}
          action={<Button tone="neutral" onClick={loadTitles}>{t('common.tryAgain')}</Button>}
        />
      ) : titles === null ? (
        <SkeletonGrid count={8} gridClassName="grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {titleTiles}
        </div>
      )}

      {titles !== null && view.length === 0 && (
        <EmptyState
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 10v4M6 12h4M15 11h.01M18 13h.01" strokeLinecap="round" /></svg>
          }
          title={titles.length === 0 ? t('home.noTitlesTitle') : t('home.noMatchTitle')}
          description={titles.length === 0 ? t('home.noTitlesDesc') : t('home.noMatchDesc')}
        />
      )}
      </Panel>
    </div>
  )
}
