// Four labelled automated participants. Uses only public WebSocket messages;
// never changes positions, health, scores, rules, timers or engine internals.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import WebSocket from 'ws';
const arg=process.argv.indexOf('--url');
const base=new URL(arg>=0?process.argv[arg+1]:'http://127.0.0.1:8088');
if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/')throw Error('Use an HTTP(S) server origin without credentials');
const wsUrl=new URL('/ws',base);wsUrl.protocol=base.protocol==='https:'?'wss:':'ws:';
class Participant extends EventEmitter {
 constructor(name){super();this.name=name;this.seq=0;this.latest=null;this.welcome=null;this.failure=null;this.ws=new WebSocket(wsUrl,{origin:base.origin});
  this.ws.on('message',raw=>{const data=JSON.parse(raw);if(data.type==='state')this.latest=data;if(data.type==='welcome')this.welcome=data;if(data.type==='error')this.failure=data;this.emit('data',data);});
  this.ws.on('error',()=>{this.failure={type:'transport-error'};this.emit('data',this.failure);});
 }
 async opened(){if(this.ws.readyState===WebSocket.OPEN)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('open deadline')),4000);this.ws.once('open',()=>{clearTimeout(timer);resolve();});this.ws.once('error',()=>{clearTimeout(timer);reject(Error('socket open failed'));});});}
 send(data){assert.equal(this.ws.readyState,WebSocket.OPEN);this.ws.send(JSON.stringify(data));}
 input(patch={}){this.send({type:'input',seq:++this.seq,forward:0,strafe:0,yaw:0,pitch:0,fire:false,reload:false,sprint:false,jump:false,crouch:false,weapon:0,grenade:false,...patch});}
 wait(predicate,timeout=7000){
  for(const data of [this.latest,this.welcome,this.failure])if(data&&predicate(data))return Promise.resolve(data);
  return new Promise((resolve,reject)=>{const listener=data=>{if(predicate(data)){cleanup();resolve(data);}};const cleanup=()=>{clearTimeout(timer);this.off('data',listener);};const timer=setTimeout(()=>{cleanup();reject(Error(`public state deadline: ${this.name}`));},timeout);this.on('data',listener);});
 }
 async hold(patch,milliseconds){
  this.input(patch);const timer=setInterval(()=>this.input(patch),33);
  try{await new Promise(resolve=>setTimeout(resolve,milliseconds));}finally{clearInterval(timer);if(this.ws.readyState===WebSocket.OPEN)this.input({yaw:patch.yaw||0,pitch:patch.pitch||0});}
 }
 async close(){if(this.ws.readyState===WebSocket.CLOSED)return;await new Promise(resolve=>{const timer=setTimeout(()=>{this.ws.terminate();resolve();},1500);this.ws.once('close',()=>{clearTimeout(timer);resolve();});this.ws.close(1000,'test complete');});}
}
const participants=[],report={kind:'observed_public_protocol',automatedParticipants:4,base:base.origin};
const stateHas=(id,predicate)=>s=>s.type==='state'&&s.players.some(p=>p.id===id&&predicate(p));
async function join(name,code){const p=new Participant(name);participants.push(p);await p.opened();p.send(code?{type:'join',name,code}:{type:'create',name});await p.wait(s=>s.type==='welcome');return p;}
try{
 const health=await (await fetch(new URL('/health',base))).json();assert.equal(health.ok,true);assert.equal(health.engine,'C++/Wasm');
 const a=await join('QA_ALPHA'),code=a.welcome.room;
 const b=await join('QA_BRAVO',code),c=await join('QA_CHARLIE',code),d=await join('QA_DELTA',code);
 await Promise.all([a,b,c,d].map(p=>p.wait(s=>s.type==='state'&&s.players.length===4)));
 report.joinedIds=[a,b,c,d].map(p=>p.welcome.id);assert.equal(new Set(report.joinedIds).size,4);
 const fifth=new Participant('QA_FIFTH');participants.push(fifth);await fifth.opened();fifth.send({type:'join',name:fifth.name,code});
 const full=await fifth.wait(s=>s.type==='error');assert.equal(full.code,'ROOM_FULL');report.fifthRejected=full.code;await fifth.close();
 const shooter=a.welcome.id,target=b.welcome.id;
 await a.wait(stateHas(target,p=>p.shield<=0));
 const p0=a.latest.players.find(p=>p.id===shooter),p1=a.latest.players.find(p=>p.id===target);
 const dx=p1.x-p0.x,dz=p1.z-p0.z,yaw=Math.atan2(dx,-dz),pitch=Math.atan2(p1.y+1.25-(p0.y+1.6),Math.hypot(dx,dz));
 const deathSeen=[a,b,c,d].map(p=>p.wait(stateHas(target,q=>q.hp===0&&q.deaths===1)));
 await Promise.all([a.hold({yaw,pitch,fire:true},800),...deathSeen]);
 const attacker=a.latest.players.find(p=>p.id===shooter);assert.equal(attacker.kills,1);assert.ok(attacker.hit>=4);assert.ok(attacker.ammo<24);
 report.combat={kills:attacker.kills,hits:attacker.hit,ammoAfterFire:attacker.ammo,allFourSawDeath:true};
 await b.wait(stateHas(target,p=>p.hp===100&&p.deaths===1&&p.respawn===0));report.respawn=true;
 a.input({yaw,pitch,reload:true});await a.wait(stateHas(shooter,p=>p.reload>0));a.input({yaw,pitch});await a.wait(stateHas(shooter,p=>p.ammo===24&&p.reload===0));report.reload=true;
 const moving=c.welcome.id,before=c.latest.players.find(p=>p.id===moving);
 await c.hold({forward:1,yaw:0},650);
 const afterState=await c.wait(stateHas(moving,p=>Math.abs(p.z-before.z)>1));
 const after=afterState.players.find(p=>p.id===moving),distance=Math.hypot(after.x-before.x,after.z-before.z);
 assert.ok(distance>1&&distance<4.5);report.movement={distanceMeters:distance};
 await d.close();await a.wait(s=>s.type==='state'&&s.players.length===3);report.disconnectRemoved=true;
 await Promise.all(participants.map(p=>p.close()));
 await new Promise(resolve=>setTimeout(resolve,100));
 const end=await (await fetch(new URL('/health',base))).json();assert.equal(end.rooms,health.rooms);assert.equal(end.clients,health.clients);report.emptyRoomCleaned=true;
 console.log(JSON.stringify(report,null,2));
}finally{await Promise.all(participants.map(p=>p.close()));}
