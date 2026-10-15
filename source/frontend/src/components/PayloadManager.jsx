import { useI18n } from '../lib/i18n.jsx'
import { useState } from 'react'
import { ConfirmDialog } from './Dialog.jsx'

export default function PayloadManager({onStopped}) {
  const { t } = useI18n()
  const actions = {
  stop: {label:t('hldrive.stopLabel'), description:t('hldrive.stopDescription'), confirm:t('hldrive.stopConfirm')},
  remove: {label:t('hldrive.removeLabel'), description:t('hldrive.removeDescription'), confirm:t('hldrive.removeConfirm')},
  install_shortcut: {label:t('hldrive.shortcutLabel'), description:t('hldrive.shortcutDescription'), confirm:t('hldrive.shortcutConfirm')},
}

  const [action,setAction]=useState(null)
  const [message,setMessage]=useState('')
  const selected=actions[action]
  async function execute() {
    const response=await fetch('/api/app/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,confirm:'HLDRIVE'})})
    const data=await response.json()
    if(!response.ok)throw new Error(data.error||t('hldrive.actionError'))
    if(action==='install_shortcut')setMessage('hldrive.shortcutSuccess')
    else onStopped(t(action === 'stop' ? 'hldrive.stopSuccess' : 'hldrive.removeSuccess'))
  }
  return <div className="space-y-2 border-t border-panel-border pt-3">
    {Object.entries(actions).map(([id,item])=><button key={id} title={item.label} aria-label={item.label} onClick={()=>setAction(id)} className={`w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-panel-2 ${id==='remove'?'text-err':'text-text-dim'}`}><span className="hidden md:inline">{item.label}</span><span className="md:hidden">{id==='stop'?'⏻':id==='remove'?t('hldrive.deleteShort'):t('hldrive.iconShort')}</span></button>)}
    {message&&<p role="status" className="text-xs text-accent">{t(message)}</p>}
    {selected&&<ConfirmDialog title={selected.label} description={selected.description} confirmLabel={selected.confirm} cancelLabel={t('hldrive.cancel')} tone={action==='remove'?'danger':'warn'} onClose={()=>setAction(null)} onConfirm={execute}/>}
  </div>
}
