const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const {driveMessage}=await import('../../source/frontend/src/lib/driveMessages.js');
 const dictionaries=Object.fromEntries(['pt-BR','en-US','es-AR'].map(locale=>[locale,JSON.parse(fs.readFileSync(`source/frontend/src/locales/hldrive/${locale}.json`,'utf8'))]));
 const scenarios=[
  ['Aviso do Google Drive: Download quota exceeded.','googleQuota'],
  ['Aviso do Google Drive: Too many users have viewed or downloaded this file recently. Please try accessing the file again later.','googleQuota'],
  ['Aviso do Google Drive: You need access','googlePermission'],
  ['Aviso do Google Drive: The file you have requested does not exist.','googleNotFound'],
  ['Aviso do Google Drive: Sign in to your Google Account','googleLogin'],
  ['Aviso do Google Drive: This file is infected with a virus.','googleVirus'],
  ['Google recusou o acesso: permissão, cota ou limite de downloads (HTTP 403).','googleAccessLimited'],
  ['Confirmação de download do Google Drive processada automaticamente (aviso de arquivo grande/sem verificação de vírus).','googleConfirmationDone'],
  ['O Google repetiu a confirmação e não liberou o arquivo.','googleConfirmationLoop'],
  ['Aviso do Google Drive: A new warning from Google','googleUnknownWarning'],
 ];
 for(const dictionary of Object.values(dictionaries)){
  const t=key=>dictionary[key.replace('hldrive.','')];
  for(const [raw,key] of scenarios){assert(dictionary[key]);assert.equal(driveMessage(raw,t),dictionary[key]);}
  assert.equal(driveMessage('HTTP 0; transporte 2; TLS 0x1234',t),'HTTP 0; transporte 2; TLS 0x1234');
  assert.equal(driveMessage('',t),'');
 }
 // Run the rendered UI with synthetic quota failures and switch language live.
 const {chromium}=require('playwright');
 const http=require('node:http'),path=require('node:path');
 const dist=path.resolve('source/frontend/dist');
 const server=http.createServer((req,res)=>{
  const file=path.resolve(dist,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
  fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(e?'Not found':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const u=new URL(route.request().url());assert.equal(u.origin,origin);
   if(!u.pathname.startsWith('/api/'))return route.continue();
   if(u.pathname==='/api/status')return route.fulfill({json:{name:'HLDRIVE'}});
   if(u.pathname==='/api/drive/config')return route.fulfill({json:{url:'https://drive.google.com/drive/folders/demo'}});
   if(u.pathname==='/api/drive/jobs')return route.fulfill({json:{jobs:[{id:'1',name:'Demo.pkg',state:'error',error:scenarios[0][0],notice:scenarios[7][0]}]}});
   if(u.pathname==='/api/drive/list')return route.fulfill({status:502,json:{error:scenarios[1][0]}});
   throw new Error(`Unexpected API ${u}`);
  });
  await page.goto(origin);
  await page.getByText(dictionaries['pt-BR'].googleQuota,{exact:true}).waitFor();
  await page.getByRole('button',{name:'Abrir pasta',exact:true}).click();
  await page.getByRole('alert').filter({hasText:dictionaries['pt-BR'].googleQuota}).nth(1).waitFor();
  assert.equal(await page.getByRole('alert').filter({hasText:dictionaries['pt-BR'].googleQuota}).count(),2);
  for(const [locale,label] of [['en-US','English (US)'],['es-AR','Español (Argentina)'],['pt-BR','Português (Brasil)']]){
   await page.locator('button[aria-haspopup="menu"]').click();
   await page.getByRole('menuitemradio',{name:label,exact:true}).click();
   await page.getByRole('menuitemradio',{name:label,exact:true}).waitFor({state:'hidden'});
   await page.getByRole('alert').filter({hasText:dictionaries[locale].googleQuota}).first().waitFor();
   assert.equal(await page.getByRole('alert').filter({hasText:dictionaries[locale].googleQuota}).count(),2);
   await page.getByText(dictionaries[locale].googleConfirmationDone,{exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);
  console.log('Drive messages passed: 10 scenarios in 3 languages; live language changes for API errors, failed jobs and notices; diagnostics preserved.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
