import { useEffect, useRef, useState } from 'react'
import PathPickerModal from '../components/PathPickerModal.jsx'
import { FolderIcon, FileIcon, CopyIcon, DownloadIcon } from '../components/icons.jsx'
async function request(path, body) {
  const response = await fetch(`/api/drive/${path}`, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Falha ao acessar o Drive.')
  return data
}
function size(bytes) {
  if (bytes < 0 || bytes === undefined) return 'Tamanho não informado'
  const units = ['B','KiB','MiB','GiB','TiB']; let unit=0
  while(bytes>=1024 && unit<units.length-1) {bytes/=1024;unit++}
  return `${bytes.toFixed(unit ? 1 : 0)} ${units[unit]}`
}
const states={queued:'Na fila',running:'Copiando',done:'Concluído',error:'Falhou',canceled:'Cancelado'}
const button='rounded-lg border border-panel-border bg-panel-2 px-4 py-2 text-sm font-semibold hover:border-accent disabled:opacity-40'
function eta(job) {
  if (!(job.speed > 0) || !(job.total > 0)) return ''
  const seconds=Math.max(0,Math.ceil((job.total-job.loaded)/job.speed))
  return seconds>=3600?`${Math.floor(seconds/3600)}h ${Math.ceil((seconds%3600)/60)}min restantes`:seconds>=60?`${Math.ceil(seconds/60)}min restantes`:`${seconds}s restantes`
}
export default function DriveView({connection,onOpenFiles}) {
  const [url,setUrl]=useState(''), [listing,setListing]=useState(null), [crumbs,setCrumbs]=useState([])
  const [selected,setSelected]=useState(new Set()), [clipboard,setClipboard]=useState(null)
  const [jobs,setJobs]=useState([]), [error,setError]=useState(''), [busy,setBusy]=useState(false)
  const [picker,setPicker]=useState(null), [search,setSearch]=useState(''), [notice,setNotice]=useState('')
  const [destination,setDestination]=useState('/data'), [pollError,setPollError]=useState('')
  const [conflict,setConflict]=useState('skip')
  const generation=useRef(0)
  useEffect(() => {let alive=true;request('config').then(data=>{if(alive)setUrl(data.url||'')}).catch(()=>{});return()=>{alive=false}},[])
  useEffect(() => {
    if(connection !== 'online') return
    let alive=true, timer
    const poll=async()=>{try {const data=await request('jobs');if(alive){setJobs(data.jobs||[]);setPollError('')}}catch(e){if(alive)setPollError('Não foi possível atualizar as transferências.')}finally{if(alive)timer=setTimeout(poll,1500)}}
    poll(); return()=>{alive=false;clearTimeout(timer)}
  },[connection])
  async function browse(next, history) {
    const seq=++generation.current;setBusy(true);setError('');setNotice('')
    try {
      const data=await request(`list?url=${encodeURIComponent(next.trim())}`)
      if(seq!==generation.current)return
      setListing(data);setSelected(new Set());setSearch('');setCrumbs([...history,{name:data.name||'Pasta',url:data.url}])
      if(history.length===0){await request('config',{url:data.url});setUrl(data.url)}
    } catch(e){if(seq===generation.current)setError(e.message)}finally{if(seq===generation.current)setBusy(false)}
  }
  function copySelection() {
    setClipboard({url:listing.url,ids:[...selected]})
    setNotice(`${selected.size} item(ns) copiado(s). Use “Colar no console” para escolher o destino.`)
  }
  async function paste(path) {
    setError('')
    try {await request('copy',{...picker,destination:path,conflict});setDestination(path);setPicker(null);setNotice('Transferência adicionada à fila.');const data=await request('jobs');setJobs(data.jobs||[])}
    catch(e){setError(e.message);throw e}
  }
  async function clearFinished() {
    try {
      await request('clear', {})
      const result = await request('jobs')
      setJobs(result.jobs || [])
    } catch (e) { setError(e.message) }
  }
  const filtered=(listing?.entries||[]).filter(e=>e.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const entries=[...filtered].sort((a,b)=>a.is_dir===b.is_dir?a.name.localeCompare(b.name):a.is_dir?-1:1)
  const active=jobs.some(j=>j.state==='running'||j.state==='queued')
  return <div className="mx-auto max-w-[1500px] space-y-5">
    <section className="pmgr-panel rounded-2xl border border-panel-border p-5">
      <h2 className="text-lg font-bold">Sua biblioteca no Google Drive</h2>
      <p className="mt-1 text-sm text-text-dim">Cole o link de uma pasta compartilhada com “Qualquer pessoa com o link”. Os arquivos são baixados diretamente para o PS5.</p>
      <form className="mt-4 flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();browse(url,[])}}>
        <input aria-label="Link da pasta pública do Google Drive" type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" className="min-w-0 flex-1 rounded-xl border border-panel-border bg-bg px-4 py-3 text-sm outline-none focus:border-accent"/>
        <button className={`${button} bg-accent text-white`} disabled={busy||active||connection!=='online'}>{busy?'Abrindo…':'Abrir pasta'}</button>
      </form>
      {active&&<p className="mt-3 text-xs text-text-dim">A conexão com o Drive está dedicada à fila atual. A navegação remota volta ao concluir.</p>}
    </section>
    {error&&<div role="alert" className="rounded-xl border border-err/30 bg-err/10 p-4 text-sm text-err">{error}</div>}
    {notice&&<div role="status" className="rounded-xl bg-accent/10 p-4 text-sm">{notice}</div>}
    {listing&&<section className="pmgr-panel overflow-hidden rounded-2xl border border-panel-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-panel-border p-4">
        <nav aria-label="Pastas do Google Drive" className="flex flex-1 flex-wrap gap-2 text-sm">{crumbs.map((c,i)=><span key={`${c.url}-${i}`}><button disabled={busy||active} className="text-accent hover:underline" onClick={()=>browse(c.url,crumbs.slice(0,i))}>{c.name}</button>{i<crumbs.length-1?' / ':''}</span>)}</nav>
        <button className={button} disabled={busy||active} onClick={()=>browse(listing.url,crumbs.slice(0,-1))}>Atualizar</button>
      </div>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <input aria-label="Buscar arquivos" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar nesta pasta…" className="min-w-0 flex-1 rounded-lg border border-panel-border bg-bg px-3 py-2 text-sm"/>
        <button className={button} disabled={!selected.size||busy||active} onClick={copySelection}><span className="flex items-center gap-2"><CopyIcon size={16}/>Copiar ({selected.size})</span></button>
        <button className={button} disabled={!clipboard||busy||active} onClick={()=>setPicker(clipboard)}>Colar no console</button>
        <button className={button} disabled={!selected.size||busy||active} onClick={()=>setPicker({url:listing.url,ids:[...selected]})}>Baixar selecionados</button>
      </div>
      <label className="flex flex-wrap items-center gap-3 px-4 pb-4 text-sm text-text-dim">Se o arquivo já existir:
        <select aria-label="Tratamento de arquivos existentes" value={conflict} disabled={active||busy||!!picker} onChange={e=>setConflict(e.target.value)} className="rounded-lg border border-panel-border bg-bg px-3 py-2 text-text">
          <option value="skip">Pular arquivos existentes</option><option value="keep_both">Manter ambos com outro nome</option><option value="cancel">Parar este item</option>
        </select>
      </label>
      <div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-panel-2 text-text-dim"><tr><th className="w-12 p-4"><input type="checkbox" aria-label="Selecionar todos os itens visíveis" checked={entries.length>0&&entries.every(e=>selected.has(e.id))} onChange={e=>setSelected(e.target.checked?new Set(entries.map(x=>x.id)):new Set())}/></th><th className="p-3">Nome</th><th className="p-3">Tipo</th><th className="p-3">Ação</th></tr></thead>
        <tbody>{entries.map(entry=><tr key={entry.id} className="border-t border-panel-border hover:bg-panel-2"><td className="p-4"><input type="checkbox" aria-label={`Selecionar ${entry.name}`} checked={selected.has(entry.id)} onChange={()=>setSelected(prev=>{const next=new Set(prev);next.has(entry.id)?next.delete(entry.id):next.add(entry.id);return next})}/></td><td className="p-3"><button disabled={!entry.is_dir||busy||active} onClick={()=>browse(entry.url,crumbs)} className={`flex items-center gap-3 text-left ${entry.is_dir?'text-accent':'text-text'}`}>{entry.is_dir?<FolderIcon size={20}/>:<FileIcon size={20}/>}<span className="break-all">{entry.name}</span></button></td><td className="p-3 text-text-dim">{entry.is_dir?'Pasta':'Arquivo'}</td><td className="p-3"><button className={button} disabled={busy||active} onClick={()=>setPicker({url:listing.url,ids:[entry.id]})}><span className="flex items-center gap-2"><DownloadIcon size={16}/>Baixar</span></button></td></tr>)}</tbody>
      </table></div>
      {!entries.length&&<p className="p-8 text-center text-text-dim">{search?'Nenhum resultado.':'Nenhum arquivo comum ou subpasta encontrado.'}</p>}
      <p className="border-t border-panel-border p-4 text-xs text-text-dim">{listing.entries.length} item(ns). Pastas são copiadas com sua estrutura. “Pular” aproveita pastas existentes e mantém seus arquivos sem comparar conteúdo. Documentos nativos do Google não são exportados.</p>
    </section>}
    <section className="pmgr-panel rounded-2xl border border-panel-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Transferências para o console</h2><div className="flex flex-wrap gap-2">
        <button className={button} disabled={!jobs.some(j=>!['running','queued'].includes(j.state))} onClick={clearFinished}>Limpar finalizados</button>
        <button className={button} onClick={onOpenFiles}>Abrir arquivos do PS5</button></div></div>
      {pollError&&<p role="alert" className="mt-3 text-warn">{pollError}</p>}
      {!jobs.length&&<p className="py-8 text-center text-sm text-text-dim">Selecione arquivos do Drive e escolha onde salvar no console.</p>}
      <div className="space-y-3 pt-4">{[...jobs].reverse().map(job=><article key={job.id} className="rounded-xl border border-panel-border bg-panel-2 p-4">
        <div className="flex justify-between gap-3"><strong className="break-all text-sm">{job.name}</strong><span className="shrink-0 text-xs text-text-dim">{states[job.state]||job.state}</span></div>
        <p className="mt-1 break-all text-xs text-text-dim">{job.current||job.destination}</p>
        {job.state==='running'&&<><progress aria-label={`Progresso de ${job.name}`} className="mt-3 h-2 w-full" max={job.total>0?job.total:undefined} value={job.total>0?job.loaded:undefined}/><p className="mt-1 text-xs text-text-dim">{size(job.loaded)}{job.total>0?` de ${size(job.total)}`:''}{job.speed>0?` · ${size(job.speed)}/s · ${eta(job)}`:''}</p></>}
        <p className="mt-2 text-xs text-text-dim">{job.files||0} arquivo(s) concluído(s) · {job.skipped||0} ignorado(s)</p>
        {job.error&&<p role="alert" className="mt-2 text-sm text-err">{job.error}</p>}
        {(job.state==='running'||job.state==='queued')&&<button className={`${button} mt-3`} onClick={()=>request('cancel',{id:job.id}).catch(e=>setError(e.message))}>Cancelar</button>}
      </article>)}</div>
      <p className="mt-4 text-xs text-text-dim">O download continua ao trocar de tela. Após reiniciar o payload, recrie a fila. Downloads interrompidos recomeçam do início; arquivos já concluídos permanecem no destino.</p>
    </section>
    {picker&&<PathPickerModal title="Colar no console" description={`Conflitos: ${conflict==='skip'?'pular arquivos existentes':conflict==='keep_both'?'manter ambos':'parar este item'}. Escolha o destino.`} initialPath={destination} actionLabel="Iniciar cópia" validateSelection={p=>p==='/data'||p.startsWith('/data/')||p.startsWith('/mnt/usb')||p.startsWith('/mnt/ext')?'':'Escolha /data ou armazenamento externo.'} onClose={()=>setPicker(null)} onSelect={paste}/>}
  </div>
}
