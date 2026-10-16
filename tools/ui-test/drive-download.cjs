// Synthetic Drive notices; no Google requests or console downloads.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
(async()=>{
 const dist=path.resolve('source/frontend/dist');
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(dist,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(err?'Not found':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let job={id:'test',name:'Arquivo grande.pkg',state:'running',destination:'/data',loaded:0,total:-1,files:0,notice:'Confirmação de download do Google Drive processada automaticamente.'};
  Object.assign(job,{speed:62500000,average_speed:50000000,connections:16,max_connections:16,transport_reason:0});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());assert.equal(url.origin,origin);
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname==='/api/status')return route.fulfill({json:{name:'HLDRIVE'}});
   if(url.pathname==='/api/drive/config')return route.fulfill({json:{url:''}});
   if(url.pathname==='/api/drive/jobs')return route.fulfill({json:{jobs:[job]}});
   throw new Error('Unexpected API '+url.pathname);
  });
  await page.goto(origin+'/?console=1');
  await page.getByRole('status').filter({hasText:'Confirmação de download'}).waitFor();
  await page.getByText(/500\.0 Mbps \(59\.6 MiB\/s\)/).waitFor();
  await page.getByText(/16 conexões ativas/).waitFor();
  await page.getByText(/Média: 400\.0 Mbps/).waitFor();
  job={...job,state:'done',loaded:4096,total:4096,files:1};
  await page.getByText('Concluído',{exact:true}).waitFor();
  await page.getByRole('status').filter({hasText:'Confirmação de download'}).waitFor();
  job={...job,state:'error',notice:'',transport_reason:3,connections:0,max_connections:1,error:'Aviso do Google Drive: Download quota exceeded.'};
  await page.getByRole('alert').filter({hasText:'Download quota exceeded.'}).waitFor();
  await page.getByText(/Conexão única:.*identificador forte/).waitFor();
  assert.equal(await page.getByRole('status').filter({hasText:'Confirmação de download'}).count(),0);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('Drive download UI: confirmation, completion, original error, mobile layout passed (mock API).');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
