import {test,expect} from '@playwright/test';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
let server,url;
test.beforeAll(async()=>{
 server=http.createServer(async(req,res)=>{
  const name=req.url==='/'?'index.html':req.url==='/style.css'?'style.css':null;
  if(!name){res.writeHead(404);res.end();return;}
  try {res.setHeader('Content-Type',name.endsWith('css')?'text/css':'text/html');res.end(await readFile(new URL('../../web/'+name,import.meta.url)));}
  catch(e){if(e.code!=='ENOENT')throw e;res.writeHead(404);res.end('<!doctype html><title>not implemented</title>');}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(r=>server.close(r));});
for(const width of [1440,768,375])test(`Korean lobby controls fit at ${width}px`,async({page})=>{
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.setViewportSize({width,height:900});await page.goto(url);
 await expect(page.getByRole('heading',{name:'CROSSYARD',exact:true})).toBeVisible({timeout:1500});
 if(width===375)await expect(page.locator('.description')).toContainText('쏘세요. 친구');
 if(width===1440)expect(await page.locator('.map-label').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(17, 25, 25)');
 await expect(page.getByLabel('닉네임',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'새 방 만들기',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const layout=await page.evaluate(()=>{const a=document.querySelector('.intro').getBoundingClientRect(),b=document.querySelector('.join-panel').getBoundingClientRect();return {introBottom:a.bottom,introRight:a.right,joinTop:b.top,joinLeft:b.left};});
 if(width<=768)expect(layout.joinTop).toBeGreaterThanOrEqual(layout.introBottom);
 else expect(layout.joinLeft).toBeGreaterThan(layout.introRight);
 expect(await page.locator('#code-help').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14);
});
test('new inventory hints fit the narrow HUD without replacing gameplay proof',async({page})=>{
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.setViewportSize({width:375,height:900});await page.goto(url);
 // Static layout fixture only: the compiled-game action tests separately exercise real input.
 await page.evaluate(()=>{document.querySelector('#lobby').hidden=true;document.querySelector('#hud').hidden=false;});
 await expect(page.locator('#inventory')).toBeVisible({timeout:1000});
 await expect(page.locator('#inventory')).toContainText('소총');
 await expect(page.locator('#inventory')).toContainText('권총');
 await expect(page.locator('#inventory')).toContainText('수류탄');
 expect(await page.locator('#inventory').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})).toBe(true);
 expect(await page.locator('#grenade-label').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14);
});

test('Esc key and Korean footer label stay together at 375px',async({page})=>{
 await page.route('**/app.mjs',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.setViewportSize({width:375,height:900});await page.goto(url);
 const sameLine=await page.evaluate(()=>{const key=[...document.querySelectorAll('.lobby-footer kbd')].find(e=>e.textContent==='Esc');const label=key.nextSibling,start=label.textContent.indexOf('메뉴'),range=document.createRange();range.setStart(label,start);range.setEnd(label,start+2);return Math.abs(key.getBoundingClientRect().top-range.getBoundingClientRect().top)<8;});
 expect(sameLine,'Esc key and Korean footer label share one line').toBe(true);
});
