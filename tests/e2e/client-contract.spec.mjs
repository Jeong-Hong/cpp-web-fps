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
  return ['_client_start','_client_stop','_client_player','_client_motion','_client_loadout','_client_grenade','_client_lock','_client_release','_client_settings'].map(k=>[k,typeof m[k]]);
 });
 for(const [name,kind] of exports)expect(kind,name).toBe('function');
});
test('compiled C++ sends complete v2 action fields even in a neutral input snapshot',async({page})=>{
 await page.goto(url);
 const packet=await page.evaluate(async()=>{
  const packets=[];globalThis.CY={renderer:{draw(){}},sendInput:p=>packets.push(p),hud(){},lockChanged(){},lockError(){},feedback(){}};
  const {default:factory}=await import('/client.mjs');const m=await factory();
  m._client_start(0);m._client_player(0,-18,0,-18,0,0,100,24,0,0,0,0,0,0,0,0,0,0,1.6,-18);
  const start=performance.now();while(!packets.length&&performance.now()-start<2000)await new Promise(r=>setTimeout(r,16));
  m._client_stop();return packets[0];
 });
 expect(packet).toMatchObject({type:'input',jump:false,crouch:false,weapon:0,grenade:false});
});
