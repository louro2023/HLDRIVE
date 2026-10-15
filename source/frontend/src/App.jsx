import { useEffect, useState } from 'react'
import FtpView from './views/FtpView.jsx'
import DriveView from './views/DriveView.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { FolderIcon, DownloadIcon } from './components/icons.jsx'
import { useConsoleNavigation } from './lib/useConsoleNavigation.js'
import PayloadManager from './components/PayloadManager.jsx'
export default function App() {
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
  if(stopped)return <div className="grid min-h-screen place-items-center bg-bg p-8 text-text"><div className="pmgr-panel flex max-w-3xl items-center gap-8 rounded-2xl border border-panel-border p-8"><img src="/branding/cover.jpg" alt="Capa HLDRIVE" className="hidden w-44 shrink-0 rounded-xl md:block"/><div><h1 className="text-2xl font-bold text-accent">HLDRIVE</h1><p role="status" className="mt-4">{stopped}</p><p className="mt-4 text-text-dim">A interface foi desconectada. Volte à tela inicial do PS5. Para abrir novamente, execute o payload pelo loader.</p></div></div></div>
  return <div className="pmgr-app flex h-screen overflow-hidden bg-bg text-text">
    <div className="pmgr-bg" /><div className="pmgr-aurora-blob" />
    <aside className="relative z-10 flex w-20 shrink-0 flex-col gap-4 border-r border-panel-border bg-panel p-3 md:w-56 md:p-5">
      <div className="my-2 flex justify-center"><img src="/branding/tile.png" alt="HLDRIVE" width="96" height="96" className="h-auto w-full max-w-24 rounded-xl"/></div>
      {[['drive','Google Drive',DownloadIcon],['files','Arquivos do PS5',FolderIcon]].map(([id,label,Icon]) => <button key={id} title={label} onClick={() => navigate(id)} aria-current={active === id ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl p-3 text-left text-sm font-semibold ${active === id ? 'bg-accent text-white' : 'text-text-dim hover:bg-panel-2'}`}><Icon size={20}/><span className="hidden md:inline">{label}</span></button>)}
      <div className="mt-auto"><PayloadManager onStopped={setStopped}/><div className="mt-3 hidden text-xs text-text-dim md:block">HLDRIVE 0.2.2<br/>Gerenciador de arquivos<br/><span className="mt-2 block">Base de arquivos: ProsperoMgr · GPLv3</span></div></div>
    </aside>
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-panel-border bg-panel/70 px-5 py-4">
        <h1 className="font-bold">{active === 'drive' ? 'Google Drive' : 'Arquivos do PS5'}</h1>
        <span role="status" className={`text-xs ${connection === 'online' ? 'text-accent' : 'text-warn'}`}>{connection === 'online' ? 'PS5 conectado' : connection === 'offline' ? 'Sem conexão com o PS5' : 'Conectando…'}</span>
      </header>
      <main className="pmgr-main min-w-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="hldrive-brand-hero mb-5 rounded-2xl border border-panel-border" role="img" aria-label="HLDRIVE — seus arquivos na nuvem e no console"><div className="hldrive-brand-caption"><p className="text-lg font-bold text-white md:text-2xl">Sua biblioteca, no seu console.</p><p className="mt-2 text-sm text-slate-300">Google Drive · Arquivos do PS5</p></div></div>
        <ErrorBoundary><div hidden={active !== 'drive'}><DriveView connection={connection} onOpenFiles={() => navigate('files')}/></div></ErrorBoundary>
        {active === 'files' && <ErrorBoundary><FtpView connection={connection}/></ErrorBoundary>}
      </main>
      {new URLSearchParams(location.search).has('console') && <footer className="border-t border-panel-border bg-panel px-5 py-2 text-sm text-text-dim">Direcional: navegar · ✕: selecionar · ○: fechar diálogo · Campos de texto: teclado do navegador</footer>}
    </div>
  </div>
}
