// Browser integration test with synthetic API responses. No external traffic.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const dist=path.resolve('source/frontend/dist');
const folder='https://drive.google.com/drive/folders/hldrive-synthetic-folder?usp=drive_link';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
(async()=>{
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(dist,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(e?'Not found':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;const checks=[],requests=[],external=[],errors=[];
 try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  let mode='success',online=true,release,entered,saved=[];
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.origin!==origin){external.push(req.url());await route.abort();return;}
   if(!u.pathname.startsWith('/api/'))return route.continue();
   requests.push({method:req.method(),path:u.pathname,url:u.searchParams.get('url')});
   if(u.pathname==='/api/status')return route.fulfill({status:online?200:503,json:online?{name:'HLDRIVE'}:{error:'offline'}});
   if(u.pathname==='/api/drive/jobs')return route.fulfill({json:{jobs:[]}});
   if(u.pathname==='/api/drive/config'){
    if(req.method()==='POST')saved.push(req.postDataJSON().url);
    return route.fulfill({json:req.method()==='GET'?{url:folder}:{ok:true}});
   }
   if(u.pathname==='/api/drive/list'){
    if(mode==='delayed'){entered();await new Promise(resolve=>release=resolve);}
    if(mode==='network')return route.fulfill({status:502,json:{error:'Falha na transferência do Drive (HTTP 0, transporte 2). Verifique a rede e tente novamente.'}});
    if(mode==='invalid')return route.fulfill({status:400,json:{error:'Cole um link https://drive.google.com/drive/folders/...'}});
    if(mode==='disconnect')return route.abort('connectionfailed');
    return route.fulfill({json:{name:'Biblioteca simulada',url:folder,entries:mode==='empty'?[]:[{id:'synthetic',name:'Arquivo de teste.pkg',is_dir:false},{id:'sub',name:'Subpasta simulada',is_dir:true,url:'https://drive.google.com/drive/folders/simulated-sub'}]}});
   }
   errors.push(`Unexpected API: ${req.method()} ${u.pathname}`);return route.fulfill({status:500,json:{error:'Unexpected API'}});
  });
  await page.goto(origin+'/?console=1');
  await page.getByText('PS5 conectado',{exact:true}).waitFor();
  const input=page.getByRole('textbox',{name:'Link da pasta pública do Google Drive'});
  await page.waitForFunction(url=>document.querySelector('input[type=url]').value===url,folder);
  assert.equal(requests.filter(r=>r.path==='/api/drive/list').length,0);checks.push('No listing or download on startup');
  mode='delayed';const waiting=new Promise(resolve=>entered=resolve);
  await page.getByRole('button',{name:'Abrir pasta',exact:true}).click();await waiting;
  assert(await page.getByRole('button',{name:'Abrindo…',exact:true}).isDisabled());release();
  await page.getByRole('checkbox',{name:'Selecionar Arquivo de teste.pkg',exact:true}).waitFor();
  await page.getByRole('button',{name:'Abrir pasta',exact:true}).waitFor();
  assert.equal(requests.find(r=>r.path==='/api/drive/list').url,folder);assert.deepEqual(saved,[folder]);
  checks.push('Open folder sends exact link, displays listing, saves config and disables duplicate clicks while busy');
  await page.screenshot({path:'build/drive-connect-success.png',fullPage:true});
  mode='network';await page.getByRole('button',{name:'Abrir pasta',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'HTTP 0, transporte 2'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Abrir pasta',exact:true}).isDisabled(),false);
  await page.screenshot({path:'build/drive-connect-error.png',fullPage:true});checks.push('Original HTTP 0/transport 2 error displayed, retry available');
  mode='success';await page.getByRole('button',{name:'Abrir pasta',exact:true}).click();
  await page.getByRole('alert').waitFor({state:'hidden'});checks.push('Successful retry clears error');
  mode='empty';await page.getByRole('button',{name:'Abrir pasta',exact:true}).click();
  await page.getByText('Nenhum arquivo comum ou subpasta encontrado.',{exact:true}).waitFor();checks.push('Empty folder displayed');
  mode='invalid';await input.fill('https://example.invalid/not-a-drive-folder');await page.getByRole('button',{name:'Abrir pasta',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Cole um link'}).waitFor();checks.push('Backend invalid-folder error displayed');
  mode='disconnect';await input.fill(folder);await page.getByRole('button',{name:'Abrir pasta',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Failed to fetch'}).waitFor();checks.push('Interrupted API request handled');
  online=false;await page.getByText('Sem conexão com o PS5',{exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'Abrir pasta',exact:true}).isDisabled());checks.push('Open folder disabled while PS5 is offline');
  assert.equal(requests.some(r=>r.path==='/api/drive/copy'),false);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  checks.push('Zero copy/download requests, zero external requests, zero JavaScript errors');
  fs.writeFileSync('build/drive-connect-test.json',JSON.stringify({passed:true,checks,requests,externalRequests:external,limitations:'Synthetic browser/API test; does not validate Google HTTPS, backend parser or PS5 execution.'},null,2));
  console.log(`Drive connect test passed: ${checks.length} checks; no external requests or downloads.`);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
