import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import create from '../../../../build/sim.mjs';

const m=await create();
const expected=['room_create','room_destroy','room_input','room_input_v2','room_join','room_leave','room_snapshot','room_tick'].map(x=>'_'+x).sort();
assert.deepEqual(Object.keys(m).filter(x=>x.startsWith('_room_')).sort(),expected);
assert.equal(m._room_input.length,10);
assert.equal(m._room_input_v2.length,14);
const snapshot=h=>JSON.parse(m.UTF8ToString(m._room_snapshot(h)));
assert.deepEqual(snapshot(0),{time:0,players:[],grenades:[]});
const h=m._room_create();
assert.ok(h);
try {
  assert.equal(m._room_join(h),0); assert.equal(m._room_join(h),1);
  assert.equal(m._room_input_v2(h,0,0,0,0,0,0,0,0,0,1,1,1,1),1);
  m._room_tick(h,0.01);
  let s=snapshot(h),p=s.players[0],g=s.grenades[0];
  assert.deepEqual(Object.keys(s).sort(),['grenades','players','time']);
  const playerKeys='id,x,y,z,yaw,pitch,hp,ammo,kills,deaths,reload,respawn,shield,shot,hit,damage,ack,trace,vy,grounded,crouch,weapon,rifleAmmo,pistolAmmo,grenadeCount,equip'.split(',').sort();
  assert.deepEqual(Object.keys(p).sort(),playerKeys);
  assert.deepEqual(Object.keys(g).sort(),'id,owner,x,y,z,vx,vy,vz,fuse,explosion,exploding'.split(',').sort());
  assert.equal(p.ack,0); assert.equal(p.weapon,1); assert.equal(p.crouch,true);
  assert.equal(p.grounded,false); assert.ok(p.y>0 && p.vy>7);
  assert.equal(p.grenadeCount,1); assert.equal(p.shield,0);
  assert.ok(Math.abs(p.equip-200)<0.001);
  assert.equal(g.fuse,2500); assert.equal(g.explosion,0); assert.equal(g.exploding,false);
  const grenadeId=g.id;
  for(let index=0;index<6;index++) for(const bad of [-1,2]) {
    const f=[0,0,0,0,0,0]; f[index]=bad;
    assert.equal(m._room_input_v2(h,0,0,0,0,0,f[0],f[1],f[2],1,f[3],f[4],0,f[5]),0);
  }
  for(const weapon of [-1,2]) assert.equal(m._room_input_v2(h,0,0,0,0,0,0,0,0,1,0,0,weapon,0),0);
  assert.equal(m._room_input_v2(h,0,NaN,0,0,0,0,0,0,1,0,0,0,0),0);
  assert.equal(m._room_input_v2(h,0,0,0,0,0,0,0,0,2147483648,0,0,0,0),0);
  assert.equal(snapshot(h).players[0].ack,0);
  for(let i=0;i<4;i++) m._room_tick(h,0.05);
  assert.equal(m._room_input_v2(h,0,0,0,0,0,1,0,0,1,0,1,1,0),1);
  m._room_tick(h,0.01);
  p=snapshot(h).players[0];
  assert.equal(p.ammo,11); assert.equal(p.rifleAmmo,24); assert.equal(p.pistolAmmo,11); assert.equal(p.shot,1);
  for(let i=0;i<8;i++) {
    assert.equal(m._room_input_v2(h,0,0,0,0,0,1,0,0,2+i,0,1,1,0),1);
    m._room_tick(h,0.05);
  }
  assert.equal(snapshot(h).players[0].shot,1);
  assert.equal(m._room_input(h,0,0,0,0,0,0,0,0,10),1);
  m._room_tick(h,0.01);
  p=snapshot(h).players[0];
  assert.equal(p.weapon,0); assert.equal(p.crouch,false); assert.equal(p.grenadeCount,1);
  for(let i=0;i<60 && !snapshot(h).grenades[0]?.exploding;i++) m._room_tick(h,0.05);
  s=snapshot(h); g=s.grenades[0];
  assert.equal(g.id,grenadeId); assert.equal(g.exploding,true); assert.equal(g.fuse,0);
  assert.ok(Math.abs(g.explosion-350)<0.001);
  for(const entity of [...s.players,...s.grenades]) for(const value of Object.values(entity)) {
    if(typeof value==='number') assert.ok(Number.isFinite(value));
    if(Array.isArray(value)) assert.ok(value.every(Number.isFinite));
  }
  m._room_leave(h,0);
  assert.equal(snapshot(h).grenades.length,0); assert.deepEqual(snapshot(h).players.map(p=>p.id),[1]);
  assert.equal(m._room_join(h),0);
  p=snapshot(h).players.find(p=>p.id===0);
  assert.equal(p.ack,0); assert.equal(p.grenadeCount,2); assert.equal(p.weapon,0);
} finally {m._room_destroy(h);}
assert.equal(m._room_join(0),-1);
assert.equal(m._room_input_v2(0,0,0,0,0,0,0,0,0,0,0,0,0,0),0);
assert.equal(m._room_input(0,0,0,0,0,0,0,0,0,0),0);
m._room_leave(0,0); m._room_tick(0,0.05); m._room_destroy(0);
const files=['include/arena.hpp','core/game.cpp','core/bridge.cpp','tests/core_tests.cpp','scripts/build.py','build/sim.mjs','build/sim.wasm'];
const hashes=Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../../../../'+path,import.meta.url))).digest('hex')]));
console.log(JSON.stringify({result:'PASS',exports:expected,inputArity:10,inputV2Arity:14,scope:'Actual generated server Wasm module; direct C ABI and parsed JSON, not sockets/browser',hashes},null,2));
