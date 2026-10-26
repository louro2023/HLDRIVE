// Browser test with synthetic APIs; never contacts Google or downloads files.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const dist=path.resolve('source/frontend/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
(async()=>{
 const server=http.createServer((req,res)=>{
  const file=path.resolve(dist,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(err?'Not found':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
  const errors=[],listings=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!==origin)throw new Error(`Unexpected external request: ${u}`);
   if(!u.pathname.startsWith('/api/'))return route.continue();
   if(u.pathname==='/api/status')return route.fulfill({json:{name:'HLDRIVE'}});
   if(u.pathname==='/api/drive/config')return route.fulfill({json:{url:''}});
   if(u.pathname==='/api/drive/jobs')return route.fulfill({json:{jobs:[]}});
   if(u.pathname==='/api/drive/list'){
    listings.push(u.searchParams.get('url'));
    return route.fulfill({json:{name:'Biblioteca de jogos',url:listings.at(-1),entries:[]}});
   }
   throw new Error(`Unexpected API: ${u}`);
  });
  await page.goto(origin);
  await page.getByText('PS5 conectado',{exact:true}).waitFor();
  const input=page.getByRole('textbox',{name:'Link da pasta pública do Google Drive'});
  const name=page.getByRole('textbox',{name:'Nome do link (opcional)'});
  const save=page.getByRole('button',{name:'Salvar link',exact:true});
  const first='https://drive.google.com/drive/folders/demo-jogos';
  await input.fill(first);await name.fill('Biblioteca de jogos');await save.click();
  assert(await page.getByRole('button',{name:'Link já salvo',exact:true}).isDisabled());
  await input.fill(first+'?usp=sharing');
  assert(await page.getByRole('button',{name:'Link já salvo',exact:true}).isDisabled());
  await input.fill('https://drive.google.com/drive/folders/demo-homebrews');await name.fill('Homebrews e aplicativos');await save.click();
  await page.reload();await page.getByRole('button',{name:'Abrir link salvo: Biblioteca de jogos',exact:true}).click();
  await page.getByText('Nenhum arquivo comum ou subpasta encontrado.',{exact:true}).waitFor();
  assert.deepEqual(listings,[first]);
  await page.getByRole('button',{name:'Excluir link salvo: Biblioteca de jogos',exact:true}).click();
  await page.reload();assert.equal(await page.getByRole('button',{name:'Abrir link salvo: Biblioteca de jogos',exact:true}).count(),0);
  await input.fill('https://example.com/folder');await save.click();
  await page.getByRole('alert').filter({hasText:'Informe um link HTTPS'}).waitFor();
  await input.fill(first);await name.fill('Biblioteca de jogos');await save.click();
  await input.fill('https://drive.google.com/drive/folders/demo-backups');await name.fill('Backups pessoais');
  await page.screenshot({path:'build/saved-links-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:'build/saved-links-mobile.png',fullPage:true});
  await page.evaluate(()=>{localStorage.setItem('hldrive_saved_links','invalid json')});await page.reload();
  await page.getByText('Nenhum link salvo.',{exact:false}).waitFor();
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('storage unavailable')}});
  await input.fill(first);await save.click();
  await page.getByRole('alert').filter({hasText:'Não foi possível salvar os links'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Saved links passed: save, duplicate prevention, reload, open, delete persistence, validation, corrupt/unavailable storage, mobile layout; no downloads.');
 } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
