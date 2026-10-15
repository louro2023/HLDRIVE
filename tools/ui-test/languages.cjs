// Synthetic APIs only: language changes must never start a download or app action.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const dist = path.resolve('source/frontend/dist');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const folder = 'https://drive.google.com/drive/folders/synthetic-language-test';
(async () => {
  const server = http.createServer((req,res) => {
    const name = new URL(req.url,'http://localhost').pathname;
    const file = path.resolve(dist,'.'+(name==='/'?'/index.html':decodeURIComponent(name)));
    if (!file.startsWith(dist+path.sep)) {res.writeHead(403);res.end();return;}
    fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(error?'Not found':data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const errors=[], external=[], mutations=[];
  try {
    browser = await chromium.launch({channel:'chrome',headless:true});
    const page = await browser.newPage({viewport:{width:1920,height:1080}});
    page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.padButtons = Array.from({length:16},()=>({pressed:false}));
      navigator.getGamepads=()=>[{mapping:'standard',buttons:window.padButtons}];
    });
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if (url.origin!==origin) {external.push(req.url());return route.abort();}
      if(!url.pathname.startsWith('/api/'))return route.continue();
      if(req.method()==='POST' && url.pathname!=='/api/drive/config')mutations.push(url.pathname);
      let data={};
      switch(url.pathname){
        case '/api/status': data={name:'HLDRIVE',version:'1.0.2'};break;
        case '/api/drive/config':data={url:folder};break;
        case '/api/drive/list':data={name:'Demo',url:folder,entries:[{id:'test',name:'Demo.pkg',is_dir:false}]};break;
        case '/api/drive/jobs':data={jobs:[]};break;
        case '/api/ftp/list':data={path:'/data',entries:[]};break;
        case '/api/ftp/storage':data={volumes:[]};break;
        case '/api/ftp/status':data={reachable:true,mode:'native'};break;
        case '/api/files/jobs':data={jobs:[]};break;
        default:throw new Error('Unexpected API: '+url.pathname);
      }
      return route.fulfill({json:data});
    });
    await page.goto(origin+'/?console=1');
    await page.getByRole('button',{name:'Abrir pasta',exact:true}).waitFor();
    await page.waitForFunction(()=>document.documentElement.lang==='pt-BR');
    await page.getByRole('button',{name:'Abrir pasta',exact:true}).click();
    await page.getByRole('checkbox',{name:'Selecionar Demo.pkg',exact:true}).check();
    await page.getByRole('button',{name:'Copiar (1)',exact:true}).click();
    const picker = page.locator('button[aria-haspopup="menu"]');
    async function choose(name,locale){
      await picker.click();
      assert.equal(await page.getByRole('menuitemradio').count(),3);
      await page.getByRole('menuitemradio',{name,exact:true}).click();
      await page.getByRole('menu').waitFor({state:'hidden'});
      await page.waitForFunction(id=>document.documentElement.lang===id,locale);
      assert.equal(await page.evaluate(()=>localStorage.getItem('hldrive_locale')),locale);
    }
    await choose('English (US)','en-US');
    await page.getByText('Your library, on your console.',{exact:true}).waitFor();
    assert(await page.getByRole('checkbox',{name:'Select Demo.pkg',exact:true}).isChecked());
    await page.getByText('Items copied: 1. Use “Paste to console” to choose the destination.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Paste to console',exact:true}).click();
    await page.getByRole('button',{name:'Start copy',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.screenshot({path:'build/language-en-US.png',fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Delete HLDRIVE',exact:true}).click();
    await page.getByText(/including downloads and settings stored there/).waitFor();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await choose('Español (Argentina)','es-AR');
    await page.getByRole('button',{name:'Pegar en la consola',exact:true}).click();
    await page.getByRole('button',{name:'Iniciar copia',exact:true}).waitFor();
    await page.getByText('Esta carpeta está vacía',{exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Archivos de PS5',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Arquivos do PS5',exact:true}).count(),0);
    await page.getByRole('button',{name:'Google Drive',exact:true}).click();
    await page.reload();
    await page.getByRole('button',{name:'Abrir carpeta',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.lang),'es-AR');
    await page.getByRole('button',{name:'Abrir carpeta',exact:true}).click();
    await page.getByRole('checkbox',{name:'Seleccionar Demo.pkg',exact:true}).waitFor();
    await page.screenshot({path:'build/language-es-AR.png',fullPage:true,animations:'disabled'});
    await picker.click();
    await page.getByRole('menuitemradio').first().focus();
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Español (Argentina)');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Português (Brasil)');
    await page.evaluate(()=>window.padButtons[13].pressed=true);
    await page.waitForFunction(()=>document.activeElement.textContent==='English (US)');
    await page.evaluate(()=>window.padButtons[13].pressed=false);
    await page.evaluate(()=>window.padButtons[1].pressed=true);
    await page.getByRole('menu').waitFor({state:'hidden'});
    await page.evaluate(()=>window.padButtons[1].pressed=false);
    await choose('Português (Brasil)','pt-BR');
    await page.setViewportSize({width:390,height:844});
    await picker.click();
    await page.getByRole('menu').waitFor();
    assert(await page.getByRole('menu').locator('img').evaluateAll(images=>images.length===3&&images.every(i=>i.complete&&i.naturalWidth>0)));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'build/language-picker-mobile.png',fullPage:true,animations:'disabled'});
    await page.getByRole('menuitemradio',{name:'English (US)',exact:true}).click();
    await page.getByRole('menu').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Open folder',exact:true}).waitFor();
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(mutations,[]);
    fs.writeFileSync('build/language-test.json',JSON.stringify({passed:true,locales:['pt-BR','en-US','es-AR'],checks:['selector flags','live translations','selection preserved','destination dialog','destructive warning','file manager','reload persistence','keyboard menu','gamepad menu','mobile layout','no external requests or downloads'],hardware:'not tested'},null,2));
    console.log('Language test passed: 3 locales, persistence, dialogs, keyboard/gamepad and mobile; no external requests.');
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
