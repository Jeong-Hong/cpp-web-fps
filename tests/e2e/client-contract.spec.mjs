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

test('compiled grenade snapshots retain existing IDs when an earlier pool slot is reused',async({page})=>{
 await page.goto(url);
 const counts=await page.evaluate(async()=>{
  // Controlled snapshot-consumer ABI fixture, not a public-socket combat claim.
  const feedback=[];globalThis.CY={feedback:kind=>feedback.push(kind)};
  const {default:factory}=await import('/client.mjs');const m=await factory({noInitialRun:true});
  const snapshot=entries=>{m._client_begin_state();for(const [id,blast] of entries)m._client_grenade(id,0,5,1,-5,blast?300:0,blast?1:0);m._client_end_state();};
  const blasts=()=>feedback.filter(kind=>kind===3).length;
  snapshot([[10,true],[11,true]]);const initial=blasts();
  snapshot([[12,false],[10,true],[11,true]]);const inserted=blasts();
  snapshot([]);feedback.length=0;
  const old=Array.from({length:16},(_,i)=>[100+i,true]);snapshot(old);const full=blasts();
  snapshot([[999,false],...old.slice(0,15)]);const retained=blasts();
  const replacement=Array.from({length:16},(_,i)=>[200+i,true]);snapshot(replacement);const replaced=blasts();
  snapshot([...replacement].reverse());const reordered=blasts();
  snapshot([]);snapshot([[1000,true]]);const afterCleanup=blasts();
  return {initial,inserted,full,retained,replaced,reordered,afterCleanup};
 });
 expect(counts.initial).toBe(2);
 expect(counts.inserted,'new ID must not replay existing grenade explosions').toBe(2);
 expect(counts.full).toBe(16);expect(counts.retained).toBe(16);
 expect(counts.replaced,'all sixteen replacement IDs remain observable').toBe(32);
 expect(counts.reordered).toBe(32);expect(counts.afterCleanup).toBe(33);
});
