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
  expect(measured).toEqual({width,overflow:false});await page.screenshot({path:`work/rendered-lobby-${width}.png`});
 }
 expect(errors).toEqual([]);
});
