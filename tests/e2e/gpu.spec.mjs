import {test,expect} from '@playwright/test';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
let server,url;
test.beforeAll(async()=>{
 server=http.createServer(async(req,res)=>{
  if(req.url==='/gpu.mjs') {res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../../web/gpu.mjs',import.meta.url)));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><meta name="viewport" content="width=device-width"><body style="margin:0"><canvas id="game" style="width:640px;height:400px"></canvas></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(r=>server.close(r));});
for(const forceWebGL of [false,true]) test(`real GPU adapter draws an instanced cube (fallback=${forceWebGL})`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.bringToFront();
 const result=await page.evaluate(async(forceWebGL)=>{
  const {createRenderer}=await import('/gpu.mjs');
  const r=await createRenderer(document.querySelector('canvas'),{forceWebGL});
  const matrix=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  r.draw(matrix,new Float32Array([0,0,0,1,1,1,0.9,0.2,0.1,0,0]),new Float32Array([0,0,2]));
  window.testRenderer=r;
  return {api:r.api,reason:r.reason,width:document.querySelector('canvas').width};
 },forceWebGL);
 console.log('GPU smoke',JSON.stringify(result));
 expect(result.api).toMatch(forceWebGL?/WebGL2/:/WebGPU|WebGL2/);expect(result.width).toBeGreaterThan(0);
 await page.screenshot({path:`work/gpu-${forceWebGL?'webgl':'auto'}.png`});
 expect(errors).toEqual([]);
});
