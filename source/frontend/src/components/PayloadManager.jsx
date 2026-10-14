import { useState } from 'react'
import { ConfirmDialog } from './Dialog.jsx'

const actions = {
  stop: {label:'Encerrar HLDRIVE', description:'Encerra o payload e desconecta esta interface. Mantém o atalho, as configurações e todos os downloads. Para usar novamente, execute o ELF pelo loader.', confirm:'Encerrar agora'},
  remove: {label:'Excluir HLDRIVE', description:'Remove o atalho HLDRIVE da aba Mídia e suas configurações, depois encerra o payload. Jogos, downloads e outros arquivos serão preservados. O ELF enviado pela rede roda na memória; cópias guardadas manualmente no loader não serão apagadas.', confirm:'Excluir e encerrar'},
  install_shortcut: {label:'Adicionar ícone na Mídia', description:'Registra o atalho HLDRIVE no PS5. Ele abre esta interface enquanto o payload estiver em execução; após reiniciar o console, execute o ELF pelo loader novamente.', confirm:'Registrar atalho'},
}
export default function PayloadManager({onStopped}) {
  const [action,setAction]=useState(null)
  const [message,setMessage]=useState('')
  const selected=actions[action]
  async function execute() {
    const response=await fetch('/api/app/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,confirm:'HLDRIVE'})})
    const data=await response.json()
    if(!response.ok)throw new Error(data.error||'Não foi possível executar a ação.')
    if(action==='install_shortcut')setMessage(data.message)
    else onStopped(data.message)
  }
  return <div className="space-y-2 border-t border-panel-border pt-3">
    {Object.entries(actions).map(([id,item])=><button key={id} title={item.label} aria-label={item.label} onClick={()=>setAction(id)} className={`w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-panel-2 ${id==='remove'?'text-err':'text-text-dim'}`}><span className="hidden md:inline">{item.label}</span><span className="md:hidden">{id==='stop'?'⏻':id==='remove'?'Excluir':'Ícone'}</span></button>)}
    {message&&<p role="status" className="text-xs text-accent">{message}</p>}
    {selected&&<ConfirmDialog title={selected.label} description={selected.description} confirmLabel={selected.confirm} cancelLabel="Cancelar" tone={action==='remove'?'danger':'warn'} onClose={()=>setAction(null)} onConfirm={execute}/>}
  </div>
}
