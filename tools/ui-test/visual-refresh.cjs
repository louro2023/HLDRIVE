// Visual fixtures only. Block external traffic and all download/app mutations.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
(async()=>{
 const dist=path.resolve('source/frontend/dist');
 const output=path.resolve('build/visual-refresh');fs.mkdirSync(output,{recursive:true});
 const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(err?'Not found':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const folder='https://drive.google.com/drive/folders/synthetic-visual-fixture';
 let browser;
 try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1080}});page.setDefaultTimeout(10000);
  const errors=[],mutations=[];page.on('pageerror',error=>errors.push(error.message));
  let jobs=[];
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(req.method()!=='GET'&&url.pathname!=='/api/drive/config'){mutations.push(url.pathname);return route.abort();}
   const entries=[{id:'folder',name:'Documentos',is_dir:true,url:folder},{id:'backup',name:'Backup completo.zip',is_dir:false},{id:'file',name:'Arquivo de demonstração.pkg',is_dir:false}];
   const fixtures={
    '/api/status':{name:'HLDRIVE'},'/api/drive/config':{url:folder},
    '/api/drive/list':{name:'Minha biblioteca',url:folder,entries},'/api/drive/jobs':{jobs},
    '/api/ftp/list':{path:'/data',entries:[{name:'Downloads',is_dir:true,size:0,modified:'2026-10-16 12:00:00',mode:493},{name:'Arquivo de demonstração.zip',is_dir:false,size:16777216,modified:'2026-10-16 12:00:00',mode:420}]},
    '/api/ftp/storage':{volumes:[{path:'/data',label:'SSD interno',kind:'internal',total:1000000000000,free:650000000000}]},
    '/api/ftp/status':{reachable:true,mode:'native'},'/api/files/jobs':{jobs:[]},
   };
   assert(url.pathname in fixtures,'Unexpected API '+url.pathname);
   return route.fulfill({json:fixtures[url.pathname]});
  });
  await page.goto(origin+'/?console=1');
  await page.getByText('PS5 conectado',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Abrir pasta',exact:true}).click();
  await page.getByRole('checkbox',{name:'Selecionar Backup completo.zip',exact:true}).waitFor();
  for(const [width,height] of [[1920,1080],[1440,1080],[1024,900],[390,844],[360,800]]){
   await page.setViewportSize({width,height});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Page overflow at ${width}`);
   assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth>el.clientWidth),false,`Main overflow at ${width}`);
   await page.screenshot({path:path.join(output,`library-${width}.png`)});
  }
  jobs=[{id:'pending',name:'Verificando arquivo.zip',destination:'/data',state:'running',loaded:0,total:-1,files:0},
        {id:'running',name:'Backup completo.zip',destination:'/data',state:'running',loaded:3*1024**3,total:8*1024**3,speed:62500000,average_speed:58000000,connections:16,max_connections:16,transport_reason:0,files:0}];
  await page.locator('progress').first().waitFor();
  // Native DOM values still come directly from the existing transfer state.
  assert.equal(await page.locator('progress[value]').evaluate(el=>el.value/el.max),.375);
  assert.equal(await page.locator('progress:not([value])').count(),1);
  assert.equal(await page.locator('progress[value]').evaluate(el=>getComputedStyle(el).height),'9px');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});
   await page.locator('.hldrive-transfers-panel').scrollIntoViewIfNeeded();
   assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth>el.clientWidth),false);
   await page.screenshot({path:path.join(output,`transfers-${width}.png`)});
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
  await page.setViewportSize({width:1440,height:1080});
  await page.getByRole('button',{name:'Arquivos do PS5',exact:true}).click();
  await page.getByText('Arquivo de demonstração.zip',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'files-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.screenshot({path:path.join(output,'files-mobile.png')});
  await page.setViewportSize({width:1440,height:1080});
  await page.getByRole('button',{name:'Excluir HLDRIVE',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({path:path.join(output,'dialog-dark.png')});
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.evaluate(()=>document.documentElement.dataset.pmgrTheme='light');
  await page.getByRole('button',{name:'Google Drive',exact:true}).click();
  await page.locator('.hldrive-transfers-panel').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'transfers-light.png')});
  await page.getByRole('button',{name:'Google Drive',exact:true}).focus();
  assert.equal(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'solid');
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,viewports:[1920,1440,1024,390,360],progressRatio:.375,indeterminate:true,files:true,dialog:true,lightTheme:true,reducedMotion:true,noMutations:true},null,2));
  console.log('Visual refresh: responsive library, native progress values, indeterminate loading, files, dialogs, light theme and focus passed. No downloads or app mutations.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
