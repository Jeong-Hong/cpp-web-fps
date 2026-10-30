import {test,expect} from '@playwright/test';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
let server,url;
test.beforeAll(async()=>{
 server=http.createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><canvas id="game"></canvas>');return;}
  const file=req.url==='/client.mjs'?'client.mjs':req.url==='/client.wasm'?'client.wasm':null;
  if(!file){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('wasm')?'application/wasm':'text/javascript');
  res.end(await readFile(new URL('../../web/dist/'+file,import.meta.url)));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(r=>server.close(r));});
test('compiled C++ exports actual game, snapshot and input entry points',async({page})=>{
 await page.goto(url);
 const exports=await page.evaluate(async()=>{
  const {default:factory}=await import('/client.mjs');const m=await factory({noInitialRun:true});
  return ['_client_start','_client_stop','_client_player','_client_lock','_client_release','_client_settings'].map(k=>[k,typeof m[k]]);
 });
 for(const [name,kind] of exports)expect(kind,name).toBe('function');
});
