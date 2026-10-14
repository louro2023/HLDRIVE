const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let copied=null, canceled=false;
 let appActions=[], appFailure=false;
 let jobs=[];
 const folder='https://drive.google.com/drive/folders/testroot';
 await page.route('**/api/**',async route=>{
  const req=route.request(), url=new URL(req.url()); let data={};
  if(url.pathname==='/api/status') data={name:'HLDRIVE',version:'0.1.0'};
  else if(url.pathname==='/api/app/action') {
   const body=req.postDataJSON();assert.equal(body.confirm,'HLDRIVE');appActions.push(body.action);
   if(appFailure){await route.fulfill({status:409,json:{error:'Há transferências ativas. Cancele a fila.'}});return;}
   data={ok:true,message:body.action==='install_shortcut'?'Atalho registrado.':body.action==='stop'?'HLDRIVE encerrando.':'Atalho e configurações removidos.'};
  }
  else if(url.pathname==='/api/drive/config') data={url:folder};
  else if(url.pathname==='/api/drive/list') data={name:'Biblioteca de teste',url:folder,entries:[{id:'one',name:'Teste.pkg',is_dir:false},{id:'two',name:'Subpasta',is_dir:true,url:folder+'/sub'}]};
  else if(url.pathname==='/api/drive/jobs') data={jobs};
  else if(url.pathname==='/api/drive/copy') {copied=req.postDataJSON();jobs=[{id:'1',name:'Teste.pkg',state:'running',destination:copied.destination,current:copied.destination+'/Teste.pkg',loaded:1024,total:4096,files:0}];data={ids:['1']};}
  else if(url.pathname==='/api/drive/cancel') {canceled=true;jobs[0].state='canceled';data={ok:true};}
  else if(url.pathname==='/api/drive/clear') {jobs=jobs.filter(j=>['queued','running'].includes(j.state));data={ok:true};}
  else if(url.pathname==='/api/ftp/list') data={path:url.searchParams.get('path')||'/data',entries:[]};
  else if(url.pathname==='/api/ftp/storage') data={volumes:[]};
  else if(url.pathname==='/api/ftp/status') data={reachable:true,mode:'native'};
  else if(url.pathname==='/api/files/jobs') data={jobs:[]};
  else throw new Error('Unexpected API: '+url.pathname);
  await route.fulfill({json:data});
 });
 await page.addInitScript(() => {
   window.testButtons = Array.from({length:16},()=>({pressed:false}));
   navigator.getGamepads = () => [{mapping:'standard',buttons:window.testButtons}];
 });
 await page.goto('http://127.0.0.1:4173/?console=1');
 await page.getByText('PS5 conectado',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.title),'Google Drive');
 await page.keyboard.press('ArrowDown');
 assert.equal(await page.evaluate(()=>document.activeElement.title),'Arquivos do PS5');
 await page.evaluate(()=>window.testButtons[0].pressed=true);
 await page.waitForFunction(()=>location.hash==='#/files');
 await page.evaluate(()=>window.testButtons[0].pressed=false);
 await page.getByRole('button',{name:'Google Drive',exact:true}).click();
 await page.getByRole('button',{name:'Abrir pasta',exact:true}).click();
 await page.getByRole('checkbox',{name:'Selecionar Teste.pkg',exact:true}).check();
 await page.getByRole('button',{name:'Copiar (1)',exact:true}).click();
 await page.getByRole('button',{name:'Colar no console',exact:true}).click();
 await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'Iniciar cópia',exact:true}).focus();
 await page.keyboard.press('ArrowLeft');
 assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]')),true);
 await page.evaluate(()=>window.testButtons[1].pressed=true);
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.evaluate(()=>window.testButtons[1].pressed=false);
 await page.getByRole('button',{name:'Colar no console',exact:true}).click();
 await page.getByRole('button',{name:'Iniciar cópia',exact:true}).click();
 await page.getByText('Copiando',{exact:true}).waitFor();
 assert.deepEqual(copied,{url:folder,ids:['one'],destination:'/data',conflict:'skip'});
 await page.screenshot({path:'build/ui-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.getByText('Cancelado',{exact:true}).waitFor();assert(canceled);
 await page.getByRole('button',{name:'Limpar finalizados',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Limpar finalizados'&&b.disabled));
 assert.equal(await page.getByRole('button',{name:'Limpar finalizados',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Arquivos do PS5',exact:true}).click();
 await page.waitForTimeout(700);
 await page.screenshot({path:'build/ui-files.png',fullPage:true});
 await page.getByRole('button',{name:'Google Drive',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'build/ui-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 await page.setViewportSize({width:1920,height:1080});
 await page.getByRole('button',{name:'Excluir HLDRIVE',exact:true}).click();
 await page.getByRole('dialog').waitFor();
 await page.screenshot({path:'build/ui-remove-confirm.png',fullPage:true});
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(appActions.length,0);
 await page.getByRole('button',{name:'Adicionar ícone na Mídia',exact:true}).click();
 await page.getByRole('button',{name:'Registrar atalho',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByText('Atalho registrado.',{exact:true}).waitFor();assert.deepEqual(appActions,['install_shortcut']);
 await page.getByRole('button',{name:'Encerrar HLDRIVE',exact:true}).click();
 appFailure=true;await page.getByRole('button',{name:'Encerrar agora',exact:true}).click();
 await page.getByText('Há transferências ativas. Cancele a fila.',{exact:true}).waitFor();
 appFailure=false;await page.getByRole('button',{name:'Encerrar agora',exact:true}).click();
 await page.getByText('HLDRIVE encerrando.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Google Drive',exact:true}).count(),0);
 await page.reload();await page.getByText('PS5 conectado',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Excluir HLDRIVE',exact:true}).click();
 await page.getByRole('button',{name:'Excluir e encerrar',exact:true}).click();
 await page.getByText('Atalho e configurações removidos.',{exact:true}).waitFor();
 assert.deepEqual(appActions,['install_shortcut','stop','stop','remove']);
 assert.deepEqual(errors,[]);
 fs.writeFileSync('build/ui-test.json',JSON.stringify({passed:true,checks:['select','copy','paste destination','job progress','cancel','local files navigation','mobile width','gamepad focus','shortcut registration','remove confirmation cancellation','busy shutdown retry','stop disconnected screen','confirmed remove','no JS exceptions'],backend:'mocked; does not validate PS5 runtime'},null,2));
 console.log('UI smoke test passed (mock API).');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
