import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {app} from '../dist/server.js';
import {resetCatalogV69CacheForTests} from '../dist/data-v69.js';
let server, browser, origin;
before(async()=>{
  resetCatalogV69CacheForTests();
  server=app({NODE_ENV:'test',V69_LOCAL_PREVIEW:'1',V69_SYNC_ENABLED:'0',V69_CATALOG_FILE:path.resolve('data/catalog-v69.json')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  const executablePath=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));assert.ok(executablePath);
  browser=await chromium.launch({headless:true,executablePath});
});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}resetCatalogV69CacheForTests();});
async function context(options={}){
  const c=await browser.newContext({viewport:{width:options.width||390,height:900}});let calls=0;
  await c.addInitScript(({saveData})=>{if(saveData)Object.defineProperty(navigator,'connection',{value:{saveData:true,effectiveType:'4g'},configurable:true});window.__prefetchEvents=[];window.fgTrackMetaV69=name=>window.__prefetchEvents.push(name);},{saveData:options.saveData||false});
  await c.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='storage.googleapis.com')return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>'});if(u.origin!==origin||u.pathname.startsWith('/api/meta')||u.pathname.startsWith('/api/analytics')||u.pathname.includes('measurement-loader'))return route.fulfill({status:200,contentType:u.pathname.endsWith('.js')?'application/javascript':'text/plain',body:''});if(u.pathname==='/api/catalog-v6-9'){calls++;if(options.api)await options.api(route,calls);else await route.continue();}else await route.continue();});
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  return {c,p,errors,calls:()=>calls};
}

test('precarga real conserva las 64 fichas e imágenes, sin búsquedas sintéticas, en PC/móvil',{timeout:60_000},async()=>{
  for(const width of [1366,390]){
    const f=await context({width});try{
      await f.p.goto(origin+'/?scope=todo',{waitUntil:'load'});const html=await f.p.locator('#gridV69').innerHTML();
      assert.equal(await f.p.locator('#gridV69 .v66-card').count(),64);
      await f.p.waitForFunction(()=>document.body.dataset.v69CatalogLoaded==='true');
      assert.equal(f.calls(),1);assert.equal(await f.p.locator('#gridV69').innerHTML(),html);
      assert.deepEqual(await f.p.evaluate(()=>window.__prefetchEvents),[]);
      assert.equal(await f.p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(f.errors,[]);
      await f.p.locator('#searchV69').fill('neutrogena+dermaglos');await f.p.waitForFunction(()=>new URL(location.href).searchParams.get('q')==='neutrogena+dermaglos');
      assert.equal(f.calls(),1);assert.equal(await f.p.locator('#gridV69 .v66-card').count(),64);
    }finally{await f.c.close();}
  }
});

test('ahorro de datos no precarga; foco e input comparten la única descarga',{timeout:30_000},async()=>{
  const f=await context({saveData:true});try{
    await f.p.goto(origin+'/?scope=todo',{waitUntil:'load'});await f.p.waitForTimeout(600);assert.equal(f.calls(),0);
    await f.p.locator('#searchV69').fill('eucerin');await f.p.waitForFunction(()=>new URL(location.href).searchParams.get('q')==='eucerin');assert.equal(f.calls(),1);assert.deepEqual(f.errors,[]);
  }finally{await f.c.close();}
});

test('input durante precarga en vuelo no duplica la petición ni pierde el último texto',{timeout:30_000},async()=>{
  let release;const gate=new Promise(r=>{release=r;});
  const f=await context({api:async route=>{await gate;await route.continue();}});try{
    await f.p.goto(origin+'/?scope=todo',{waitUntil:'load'});await f.p.waitForFunction(()=>document.body.dataset.v69CatalogLoaded==='loading');
    await f.p.locator('#searchV69').fill('eucerin');await f.p.locator('#searchV69').fill('neutrogena');release();
    await f.p.waitForFunction(()=>new URL(location.href).searchParams.get('q')==='neutrogena');assert.equal(f.calls(),1);assert.equal(await f.p.locator('#searchV69').inputValue(),'neutrogena');assert.deepEqual(f.errors,[]);
  }finally{release();await f.c.close();}
});

test('prefetch fallido deja fichas visibles y permite reintento por interacción',{timeout:30_000},async()=>{
  const f=await context({api:async(route,calls)=>calls===1?route.fulfill({status:503,body:'prueba de fallo'}):route.continue()});try{
    await f.p.goto(origin+'/?scope=todo',{waitUntil:'load'});const html=await f.p.locator('#gridV69').innerHTML();
    await f.p.waitForFunction(()=>document.body.dataset.v69CatalogLoaded==='error');assert.equal(await f.p.locator('#gridV69').innerHTML(),html);
    await f.p.locator('#searchV69').fill('eucerin');await f.p.waitForFunction(()=>new URL(location.href).searchParams.get('q')==='eucerin');assert.equal(f.calls(),2);assert.deepEqual(f.errors,[]);
  }finally{await f.c.close();}
});

test('ficha de producto no descarga todo el catálogo',{timeout:30_000},async()=>{
  const dto=await fetch(origin+'/api/catalog-v6-9').then(r=>r.json());
  const f=await context();try{
    await f.p.goto(origin+'/p/'+dto.products[0].publicId,{waitUntil:'load'});await f.p.waitForTimeout(600);assert.equal(f.calls(),0);assert.deepEqual(f.errors,[]);
  }finally{await f.c.close();}
});
