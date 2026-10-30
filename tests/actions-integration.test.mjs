import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import WebSocket from 'ws';
import {createApp} from '../server/app.mjs';

async function peer(origin){
 const ws=new WebSocket(origin.replace('http:','ws:')+'/ws',{origin}),events=new EventEmitter(),history=[];
 ws.on('message',raw=>{const message=JSON.parse(String(raw));history.push(message);if(history.length>96)history.shift();events.emit('data',message);});
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 return {send:message=>ws.send(JSON.stringify(message)),wait(predicate){
  for(const message of history)if(predicate(message))return Promise.resolve(message);
  return new Promise((resolve,reject)=>{const handler=message=>{if(predicate(message)){clearTimeout(timer);events.off('data',handler);resolve(message);}};const timer=setTimeout(()=>{events.off('data',handler);reject(Error('real action socket deadline'));},3000);events.on('data',handler);});
 }};
}

// Actual C++/Wasm, real loopback sockets and the normal live 60Hz server clock.
// No synthetic positions, private room edits, fake engine or injected clock.
test('REAL Wasm pistol stale-resume does not synthesize a press and a new release rearms it',{timeout:10000},async t=>{
 const diagnostics=[],app=await createApp({onError:code=>diagnostics.push(code)});
 t.after(()=>app.close());const address=await app.listen('127.0.0.1',0),origin=`http://127.0.0.1:${address.port}`;
 const shooter=await peer(origin);shooter.send({type:'create',name:'QA_STALE_A'});const welcome=await shooter.wait(m=>m.type==='welcome');
 const observer=await peer(origin);observer.send({type:'join',name:'QA_STALE_B',code:welcome.room});await observer.wait(m=>m.type==='welcome');
 const send=(seq,fire)=>shooter.send({type:'input',seq,forward:0,strafe:0,yaw:0,pitch:0,fire,reload:false,sprint:false,jump:false,crouch:false,weapon:1,grenade:false});
 const player=state=>state.players.find(p=>p.id===welcome.id);
 send(0,false);await shooter.wait(m=>m.type==='state'&&player(m)?.weapon===1&&player(m).equip===0);
 send(1,true);const first=await shooter.wait(m=>m.type==='state'&&player(m)?.shot===1);assert.equal(player(first).pistolAmmo,11);
 await shooter.wait(m=>m.type==='state'&&m.time>=first.time+400);
 send(2,true);const resumed=await shooter.wait(m=>m.type==='state'&&player(m)?.ack===2);
 assert.equal(player(resumed).shot,1,'stale held true cannot synthesize a pistol press');assert.equal(player(resumed).pistolAmmo,11);
 send(1,false);send(3,true);const ignoredRelease=await shooter.wait(m=>m.type==='state'&&player(m)?.ack===3);
 assert.equal(player(ignoredRelease).shot,1,'old release cannot rearm the pistol edge');
 send(4,false);send(5,true);send(6,false);const second=await shooter.wait(m=>m.type==='state'&&player(m)?.shot===2&&player(m)?.ack===6);
 assert.equal(player(second).pistolAmmo,10,'fresh release and brief press still work after expiry');
 const observed=await observer.wait(m=>m.type==='state'&&m.time===second.time);assert.deepEqual(observed.players,second.players);assert.deepEqual(observed.grenades,second.grenades);
 assert.deepEqual(diagnostics,[]);
});
