import {test,expect} from '@playwright/test';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
let server,url;
const paths=new Map([['/','index.html'],['/style.css','style.css'],['/app.mjs','app.mjs'],['/gpu.mjs','gpu.mjs'],['/dist/client.mjs','dist/client.mjs'],['/dist/client.wasm','dist/client.wasm']]);
test.beforeAll(async()=>{
 server=http.createServer(async(req,res)=>{
  const path=paths.get(req.url);if(!path){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
  res.end(await readFile(new URL('../../web/'+path,import.meta.url)));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(r=>server.close(r));});
test('real C++ Wasm renders the lobby and fits three widths',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__lcp=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.__lcp.push({time:e.startTime,tag:e.element?.tagName});}).observe({type:'largest-contentful-paint',buffered:true});});
 await page.goto(url);await page.bringToFront();await expect(page.locator('#create')).toBeEnabled({timeout:15000});
 await expect(page.locator('#engine')).toHaveText(/WebGPU|WebGL2/);expect(await page.evaluate(()=>document.visibilityState)).toBe('visible');
 await page.evaluate(()=>new Promise(requestAnimationFrame));
 console.log('Observed local lobby',JSON.stringify(await page.evaluate(()=>({api:document.querySelector('#engine').textContent,lcp:window.__lcp,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches}))));
 for(const width of [1440,768,375]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(requestAnimationFrame));
  const measured=await page.evaluate(()=>({width:innerWidth,overflow:document.querySelector('#lobby').scrollWidth>innerWidth}));
  expect(measured).toEqual({width,overflow:false});await page.locator('#lobby').evaluate(e=>{e.scrollTop=0;});await page.screenshot({path:`work/rendered-lobby-${width}.png`});
  if(width<=768){await page.locator('#lobby').evaluate(e=>{e.scrollTop=e.scrollHeight;});await expect(page.locator('#lobby-status')).toBeInViewport();await expect(page.locator('.mobile-note')).toBeInViewport();await page.screenshot({path:`work/rendered-lobby-${width}-bottom.png`});console.log('Observed bottom state',JSON.stringify(await page.evaluate(()=>({state:'ready',origin:location.origin,width:innerWidth,height:innerHeight,visibility:document.visibilityState,scrollTop:document.querySelector('#lobby').scrollTop,text:document.querySelector('#lobby-status').textContent}))));}
 }
 expect(errors).toEqual([]);
});

test('real Wasm loading disables competing actions and then recovers',async({page})=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/dist/client.wasm',async route=>{await gate;await route.continue();});
 try{
  await page.goto(url);await page.bringToFront();await expect(page.locator('#lobby-status')).toContainText('C++ 게임 모듈');
  await expect(page.locator('#create')).toBeDisabled();await expect(page.locator('#join')).toBeDisabled();
  await expect(page.locator('#create'),'loading primary button names its current state').toContainText('준비 중');
  for(const width of [1440,768,375]){
   await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>innerWidth)).toBe(width);await page.locator('#lobby').evaluate(e=>{e.scrollTop=0;});await page.screenshot({path:`work/loading-${width}.png`});
   if(width<=768){await page.locator('#lobby').evaluate(e=>{e.scrollTop=e.scrollHeight;});await expect(page.locator('#lobby-status')).toBeInViewport();await expect(page.locator('#create')).toBeDisabled();await page.screenshot({path:`work/loading-${width}-bottom.png`});console.log('Observed bottom state',JSON.stringify(await page.evaluate(()=>({state:'controlled-loading',origin:location.origin,width:innerWidth,height:innerHeight,visibility:document.visibilityState,scrollTop:document.querySelector('#lobby').scrollTop,text:document.querySelector('#lobby-status').textContent}))));}
  }
 }finally{release();}
 await expect(page.locator('#create')).toBeEnabled({timeout:10000});await expect(page.locator('#join')).toBeEnabled();
});
