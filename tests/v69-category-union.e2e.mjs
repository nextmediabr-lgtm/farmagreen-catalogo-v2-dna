import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {app} from '../dist/server.js';

test('numeric category triples: mobile first, compact heading, filters, pagination and navigation', {timeout:120000},async()=>{
 const executablePath=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
 assert.ok(executablePath);
 const server=app({NODE_ENV:'test',V69_LOCAL_PREVIEW:'1',V69_CATALOG_FILE:path.resolve('data/catalog-v69.json')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const dto=await fetch(origin+'/api/catalog-v6-9').then(r=>r.json());
 const browser=await chromium.launch({headless:true,executablePath});
 try{
  for(const width of [360,390,430,1366]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    return (u.origin===origin&&!u.pathname.startsWith('/api/meta'))||(u.hostname==='storage.googleapis.com'&&route.request().resourceType()==='image')?route.continue():route.abort();
   });
   await page.goto(origin+'/?scope=todo&q=6338',{waitUntil:'load'});
   const individualFont=await page.locator('#catalogTitleV69').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
   const combos=['6551+6338+6614','7160+6779+9677','6851+6347+6614','6338+6551+6338'];
   for(const q of combos){
    const keys=q.split('+');const expected=dto.products.filter(p=>(p.magentoCategories||[]).some(c=>keys.includes(String(c.id))));
    await page.locator('#searchV69').fill(q);
    await page.waitForFunction(({q,n})=>new URL(location.href).searchParams.get('q')===q&&document.querySelector('#countV69').textContent===`${Math.min(64,n)} de ${n}`,{q,n:expected.length});
    const title=page.locator('#catalogTitleV69');
    assert.match(await title.getAttribute('class'),/v69-title-categories/);
    const size=await title.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
    assert.ok(size<individualFont,`${width}: combined ${size} vs individual ${individualFont}`);
    assert.ok(size>20);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width}:${q}`);
    const shown=await page.locator('#gridV69 .v65-hit').evaluateAll(a=>a.map(x=>new URL(x.href).pathname.split('/').pop()));
    assert.equal(new Set(shown).size,shown.length);
    assert.ok(shown.every(id=>expected.some(p=>p.publicId===id)));
    if(q==='6551+6338+6614'){await page.waitForFunction(()=>{const img=document.querySelector('#gridV69 img');return img&&img.complete&&img.naturalWidth>0;});await page.screenshot({path:`/tmp/v69-additive-categories-${width}.png`});}
   }
   const q=combos[0],keys=q.split('+'),expected=dto.products.filter(p=>(p.magentoCategories||[]).some(c=>keys.includes(String(c.id))));
   await page.locator('#searchV69').fill(q);
   await page.waitForFunction(q=>new URL(location.href).searchParams.get('q')===q,q);
   await page.locator('#sortV69').selectOption('precio-asc');
   await page.waitForFunction(()=>new URL(location.href).searchParams.get('orden')==='precio-asc');
   await page.locator('#loadMoreV69').click();
   await page.waitForFunction(n=>document.querySelectorAll('#gridV69 .v65-hit').length===Math.min(128,n),expected.length);
   await page.reload({waitUntil:'load'});
   await page.waitForFunction(n=>document.querySelectorAll('#gridV69 .v65-hit').length===Math.min(128,n),expected.length);
   assert.equal(await page.locator('#searchV69').inputValue(),q);
   const ids=await page.locator('#gridV69 .v65-hit').evaluateAll(a=>a.map(x=>new URL(x.href).pathname.split('/').pop()));
   const prices=ids.map(id=>Math.round(expected.find(p=>p.publicId===id).offerPrice));
   assert.deepEqual(prices,[...prices].sort((a,b)=>a-b));
   await page.locator('#gridV69 .v65-hit').first().click();
   await page.goBack({waitUntil:'load'});
   await page.waitForFunction(q=>document.querySelector('#searchV69')?.value===q,q);
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({width,triples:combos.length,combinedTitleSize:'smaller',navigation:'passed',products:expected.length}));
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
