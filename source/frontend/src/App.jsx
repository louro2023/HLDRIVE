import { useI18n } from './lib/i18n.jsx'
import { useEffect, useState } from 'react'
import FtpView from './views/FtpView.jsx'
import DriveView from './views/DriveView.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { FolderIcon, DownloadIcon } from './components/icons.jsx'
import { useConsoleNavigation } from './lib/useConsoleNavigation.js'
import LanguagePicker from './components/LanguagePicker.jsx'
import PayloadManager from './components/PayloadManager.jsx'
export default function App() {
  const { t } = useI18n()
  useConsoleNavigation()
  const [active, setActive] = useState(window.location.hash === '#/files' ? 'files' : 'drive')
  const [connection, setConnection] = useState('connecting')
  const [stopped, setStopped] = useState('')
  useEffect(() => {
    if(stopped)return
    let alive = true
    const poll = async () => {
      try { const r = await fetch('/api/status'); if (!r.ok) throw new Error(); if (alive) setConnection('online') }
      catch { if (alive) setConnection('offline') }
    }
    poll(); const timer = setInterval(poll, 5000)
    const route = () => setActive(window.location.hash === '#/files' ? 'files' : 'drive')
    window.addEventListener('hashchange', route)
    return () => { alive = false; clearInterval(timer); window.removeEventListener('hashchange', route) }
  }, [stopped])
  function navigate(id) { setActive(id); window.location.hash = `/${id}` }
  if(stopped)return <div className="hldrive-ui hldrive-stopped grid min-h-screen place-items-center bg-bg p-8 text-text"><div className="pmgr-panel flex max-w-3xl items-center gap-8 rounded-2xl border border-panel-border p-8"><img src="/branding/cover.jpg" alt={t('hldrive.cover')} className="hidden w-44 shrink-0 rounded-xl md:block"/><div><h1 className="text-2xl font-bold text-accent">HLDRIVE</h1><p role="status" className="mt-4">{stopped}</p><p className="mt-4 text-text-dim">{t('hldrive.disconnected')}</p></div></div></div>
  return <div className="hldrive-ui pmgr-app flex h-screen overflow-hidden bg-bg text-text">
    <div className="hldrive-ambient" aria-hidden="true" />
    <aside className="hldrive-sidebar relative z-10 flex w-20 shrink-0 flex-col gap-4 border-r border-panel-border bg-panel p-3 md:w-56 md:p-5">
      <div className="hldrive-brand my-2 flex justify-center"><img src="/branding/tile.png" alt="HLDRIVE" width="96" height="96" className="h-auto w-full max-w-24 rounded-xl"/></div>
      {[['drive','Google Drive',DownloadIcon],['files',t('hldrive.files'),FolderIcon]].map(([id,label,Icon]) => <button key={id} title={label} onClick={() => navigate(id)} aria-current={active === id ? 'page' : undefined} className={`hldrive-nav-item flex items-center gap-3 rounded-xl p-3 text-left text-sm font-semibold ${active === id ? 'bg-accent text-white' : 'text-text-dim hover:bg-panel-2'}`}><Icon size={20}/><span className="hidden md:inline">{label}</span></button>)}
      <div className="mt-auto space-y-2">
        <PayloadManager onStopped={setStopped}/>
        <section className="hidden rounded-xl border border-panel-border bg-panel-2/40 p-2 md:block" aria-label={t('hldrive.support')}>
          <h2 className="text-[11px] font-semibold text-text">{t('hldrive.support')}</h2>
          <p className="mt-1 text-[10px] leading-snug text-text-dim">{t('hldrive.supportHint')}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a href="https://www.youtube.com/@henriquelouro7848" target="_blank" rel="noreferrer" className="flex min-w-0 flex-col items-center gap-1 text-center text-[9px] leading-tight text-text-dim hover:text-text">
              <img src="/branding/support-youtube.jpg" alt={t('hldrive.youtubeQR')} width="72" height="72" className="h-[72px] w-[72px] rounded bg-white p-1 object-contain" />
              <span>{t('hldrive.youtube')}</span>
            </a>
            <div className="flex min-w-0 flex-col items-center gap-1 text-center text-[9px] leading-tight text-text-dim">
              <img src="/branding/support-financial.png" alt={t('hldrive.financialQR')} width="72" height="72" className="h-[72px] w-[72px] rounded bg-white p-1 object-contain" />
              <span>{t('hldrive.financial')}</span>
            </div>
          </div>
        </section>
        <div className="hidden text-xs text-text-dim md:block">HLDRIVE 1.1.1-rc.1<br/>{t('hldrive.manager')}</div>
      </div>
    </aside>
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="hldrive-header flex items-center justify-between border-b border-panel-border bg-panel/70 px-5 py-4">
        <h1 className="font-bold">{active === 'drive' ? 'Google Drive' : t('hldrive.files')}</h1>
        <div className="flex items-center gap-3"><LanguagePicker/><span role="status" className={`hldrive-connection text-xs ${connection === 'online' ? 'text-accent' : 'text-warn'}`}>{connection === 'online' ? t('hldrive.online') : connection === 'offline' ? t('hldrive.offline') : t('hldrive.connecting')}</span></div>
      </header>
      <main className="hldrive-main pmgr-main min-w-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="hldrive-brand-hero mb-5 rounded-2xl border border-panel-border" role="img" aria-label={t('hldrive.heroAlt')}><div className="hldrive-brand-caption"><p className="text-lg font-bold text-white md:text-2xl">{t('hldrive.hero')}</p><p className="mt-2 text-sm text-slate-300">{t('hldrive.subtitle')}</p></div></div>
        <ErrorBoundary><div hidden={active !== 'drive'}><DriveView connection={connection} onOpenFiles={() => navigate('files')}/></div></ErrorBoundary>
        {active === 'files' && <ErrorBoundary><FtpView connection={connection}/></ErrorBoundary>}
      </main>
      {new URLSearchParams(location.search).has('console') && <footer className="hldrive-footer border-t border-panel-border bg-panel px-5 py-2 text-sm text-text-dim">{t('hldrive.controls')}</footer>}
    </div>
  </div>
}
