import {createRenderer} from './gpu.mjs';
import {DEFAULT_MAP,mapId,maps} from './maps.mjs';
import {DEFAULT_MODE,GUNFIGHT_MODE,isTeamMode} from './modes.mjs';
import {createMinimap} from './minimap.mjs';
const $=id=>document.getElementById(id);
const text=(id,value)=>{const node=$(id);const next=String(value);if(node.textContent!==next)node.textContent=next;};
let module,renderer,socket=null,session=null,busy=false,ready=false,joinTimer=null,pingTimer=null,audio=null;
let firstEntry=true,lastScore='',lastKills=0,killUntil=0;
const motion=matchMedia('(prefers-reduced-motion: reduce)');
const minimap=createMinimap($('minimap'));
const teamNames=['블루','오렌지'];
const modeName=mode=>mode===GUNFIGHT_MODE?'2대2 건파이트':'2대2 팀 데스매치';
const compass=$('compass-ticks'),compassStart=-90,pixelsPerDegree=4;
const cardinals={0:'N 북',90:'E 동',180:'S 남',270:'W 서'};
for(let angle=compassStart;angle<=450;angle+=5){
 const tick=document.createElement('span'),degrees=(angle+360)%360;
 tick.className='compass-tick';
 tick.style.left=`${(angle-compassStart)*pixelsPerDegree}px`;
 if(degrees%15===0){
  tick.classList.add('major');
  if(degrees%90===0)tick.classList.add('cardinal');
  tick.textContent=cardinals[degrees]??degrees;
 }
 compass.append(tick);
}
$('reduce').checked=motion.matches;
const errors={ROOM_NOT_FOUND:'방을 찾지 못했어요. 친구에게 코드를 다시 확인해 주세요.',ROOM_FULL:'이미 4명이 참가한 방이에요. 다른 방을 만들어 주세요.',SERVER_FULL:'서버가 가득 찼어요. 잠시 후 다시 시도해 주세요.',INVALID_NAME:'닉네임은 제어 문자를 제외한 1~16자로 입력해 주세요.',INVALID_CODE:'방 코드는 0~9, A~F로 된 6자리입니다.',INVALID_MESSAGE:'통신 형식이 맞지 않아요. 새로고침 후 다시 입장해 주세요.',RATE_LIMIT:'너무 많은 요청이 발생했어요. 잠시 후 다시 입장해 주세요.'};
errors.INVALID_MAP='맵 선택을 확인해 주세요.';
errors.MAP_UNAVAILABLE='이 맵을 불러올 수 없어요. 새로고침하거나 다른 맵을 선택해 주세요.';
errors.INVALID_MODE='게임 모드 선택을 확인해 주세요.';
function status(message,error=false){text('lobby-status',message);$('lobby-status').classList.toggle('error',error);}
function buttons(){for(const id of ['create','join','map','mode'])$(id).disabled=!ready||busy;text('create-label',!ready?'준비 중…':busy?'연결 중…':'새 방 만들기');}
function setBusy(value){busy=value;buttons();}
function settings(){module?._client_settings(Number($('sensitivity').value),$('reduce').checked?1:0);text('sensitivity-value',Number($('sensitivity').value).toFixed(2).replace(/0$/,''));}
function showPause(initial=false){
 if(!session)return;
 const waiting=session.phase==='waiting',finished=session.phase==='finished',teamMatch=isTeamMode(session.mode);
 const pause=$('pause'),resume=$('resume'),invite=$('invite-code'),rematch=$('rematch');
 const focus=pause.hidden||resume.disabled!==!session.playing||rematch.hidden===finished;
 pause.hidden=false;
 resume.disabled=!session.playing;
 resume.hidden=finished;
 rematch.hidden=!finished;
 rematch.disabled=session.members!==4;
 invite.hidden=!teamMatch;
 text('invite-code',`방 코드 복사 · ${session.room}`);
 text('pause-mode',teamMatch?`${modeName(session.mode)}${session.team>=0?` / ${teamNames[session.team]} 팀`:''}`:'CROSSYARD / FIELD CONTROL');
 text('pause-title',finished?`${teamNames[session.winner]} 팀 승리`:waiting?'2대2 참가자 대기':initial?'입장 완료':'잠시 조작을 멈췄어요');
 text('pause-description',finished?`최종 점수 · 블루 ${session.scores[0]} 대 오렌지 ${session.scores[1]}`:waiting?`${session.members} / 4명 · 방 코드를 공유하고 친구를 초대하세요.`:initial?'아래 버튼을 누르면 마우스가 게임에 고정됩니다.':'다른 참가자의 전투는 계속되고 있습니다.');
 text('resume',waiting?'4명이 모이면 시작':initial?'클릭하고 플레이 ↗':'플레이로 돌아가기 ↗');
 text('pause-footnote',finished?'4명이 모여 있으면 같은 방에서 재경기할 수 있습니다.':waiting?'전투는 4명이 모일 때까지 대기합니다.':'메뉴를 열어도 전투는 계속됩니다.');
 if(focus&&document.hasFocus())(finished&&!rematch.disabled?rematch:!session.playing?invite:resume).focus();
}
function backToLobby(message,error=false){
 clearTimeout(joinTimer);clearInterval(pingTimer);module?._client_stop();session=null;firstEntry=true;lastScore='';lastKills=0;killUntil=0;
 $('pause').hidden=true;$('teammate-label').hidden=true;$('hud').hidden=true;$('lobby').hidden=false;setBusy(false);status(message,error);$('create').focus();
}
function failGraphics(){
 ready=false;buttons();module?._client_release();socket?.close(1000,'renderer unavailable');renderer?.dispose();
 $('fatal').hidden=false;text('fatal-message','그래픽 장치를 사용할 수 없어요. 다른 GPU 작업을 줄이거나 최신 Chrome·Edge에서 다시 열어 주세요.');
}
function rawSend(message){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));}
function updatePlayers(state){
 const names=state.names||{},ordered=[...state.players].sort((a,b)=>(a.team??0)-(b.team??0)||b.kills-a.kills||a.id-b.id);
 const signature=JSON.stringify(ordered.map(p=>[p.id,names[p.id],p.kills,p.deaths,p.team]));
 if(signature===lastScore)return;lastScore=signature;
 $('players').replaceChildren(...ordered.map(p=>{
  const li=document.createElement('li');
  if(p.id===session.id)li.className='me';
  const name=document.createElement('span');
  name.className='player-name';
  if(teamNames[p.team]){
   const team=document.createElement('span');
   team.className=`team-tag ${p.team===0?'team-blue':'team-orange'}`;
   team.textContent=teamNames[p.team];name.append(team,' ');
  }
  name.append((names[p.id]||`플레이어 ${p.id+1}`)+(p.id===session.id?' · 나':''));
  const score=document.createElement('span');score.className='score-values';score.textContent=`${p.kills} / ${p.deaths}`;
  li.append(name,score);return li;
 }));
 text('count',`${state.players.length} / 4`);
}
function updateMatch(state){
 const me=state.players.find(player=>player.id===session.id);
 session.alive=!!me&&me.hp>0;
 if(!isTeamMode(session.mode))return;
 session.members=state.players.length;
 session.team=me?.team??-1;
 session.allies=state.players.filter(player=>player.id!==session.id&&player.team===session.team&&player.hp>0);
 session.scores=state.teamScores??[0,0];
 session.winner=state.winner;
 session.remaining=Math.ceil((state.remaining??0)/1000);
 session.round=state.round;
 session.roundResult=state.roundResult;
 const phase=state.phase??(state.playing?'live':'waiting');
 if(phase!==session.phase)module._client_set_combat(Number(phase==='live'));
 session.phase=phase;
 const gunfight=session.mode===GUNFIGHT_MODE;
 text('team-you',session.team>=0?`내 팀 ${teamNames[session.team]}`:'2대2');
 text('match-format',gunfight?`라운드 ${session.round} · ${phase==='live'?`${session.remaining}초`:`${state.target}승 선승`}`:`${state.target}킬 선승`);
 text('team-blue-score',session.scores[0]);
 text('team-orange-score',session.scores[1]);
 const playing=state.playing===true;
 if(playing!==session.playing){
  session.playing=playing;
  module._client_set_playing(Number(playing));
  if(!playing)module._client_release();
 }
 if(!$('pause').hidden||!playing)showPause(firstEntry);
}
const idleMantle=[-1,...Array(14).fill(0)];
function applyState(state){
 if(!session||state.room!==session.room||!Array.isArray(state.players))return;
 if(Number.isInteger(state.deployment)&&session.deployment!==state.deployment){
  if(session.deployment!==undefined){module._client_reseed();lastKills=0;killUntil=0;}
  session.deployment=state.deployment;
 }
 session.names=state.names??{};
 module._client_begin_state();
 for(const p of state.players){
  module._client_player(p.id,p.x,p.y,p.z,p.yaw,p.pitch,p.hp,p.ammo,p.kills,p.deaths,p.reload,p.respawn,p.shield,p.shot,p.hit,p.damage,p.ack,...p.trace,p.weapon,p.shotWeapon??p.weapon,p.reloads??0);
  module._client_mantle(p.id,...(p.mantle??idleMantle));
  module._client_motion(p.id,p.vy,p.grounded?1:0,p.crouch?1:0,p.prone?1:0);
  module._client_loadout(p.id,p.weapon,p.grenadeCount,p.equip,p.recoil??0,p.recoilHeld?1:0);
  if(isTeamMode(session.mode))module._client_team(p.id,p.team??-1);
 }
 for(const g of state.grenades)module._client_grenade(g.id,g.owner,g.x,g.y,g.z,g.explosion,g.exploding?1:0);
 module._client_end_state();updatePlayers(state);updateMatch(state);
}
function connect(type){
 if(!ready||busy||session)return;
 const name=$('nickname').value.trim();
 if(!name||Array.from(name).length>16||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(name)){status(errors.INVALID_NAME,true);$('nickname').focus();return;}
 const code=$('code').value;
 const map=$('map').value;
 const mode=$('mode').value;
 if(type==='join'&&!/^[A-F0-9]{6}$/.test(code)){status(errors.INVALID_CODE,true);$('code').focus();return;}
 setBusy(true);status(type==='create'?'서버에 새 방을 만들고 있습니다.':'친구의 방에 연결하고 있습니다.');
 const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);socket=ws;
 joinTimer=setTimeout(()=>{if(socket!==ws||session)return;ws.close();status('서버가 응답하지 않아요. 서버 실행 상태를 확인해 주세요.',true);setBusy(false);},6000);
 ws.addEventListener('open',()=>{if(socket!==ws)return;ws.send(JSON.stringify(type==='create'?{type,name,map,mode}:{type,name,code}));});
 ws.addEventListener('message',event=>{
  if(socket!==ws)return;
  let message;try{message=JSON.parse(event.data);}catch{ws.close(1002,'invalid server data');return;}
  if(message.type==='welcome'){
   const roomMap=message.map??DEFAULT_MAP;
   const id=mapId(roomMap);
   if(id<0||!module._client_start(message.id,id)){
    socket=null;ws.close();backToLobby(errors.MAP_UNAVAILABLE,true);return;
   }
   const roomMode=message.mode??DEFAULT_MODE;
   const playing=!isTeamMode(roomMode);
   clearTimeout(joinTimer);setBusy(false);
   session={room:message.room,id:message.id,mode:roomMode,playing,phase:playing?'live':'waiting',members:Object.keys(message.names??{}).length,team:-1,allies:[],alive:true,names:{},scores:[0,0]};
   module._client_set_playing(Number(playing));module._client_set_combat(Number(playing));settings();
   $('team-match').hidden=playing;
   text('count',`${session.members} / 4`);text('lock-status','Esc를 누르면 마우스를 해제하고 이 메뉴로 돌아옵니다.');
   text('active-map',maps[roomMap]);
   $('lobby').hidden=true;$('hud').hidden=false;text('copy-code',session.room);$('code').value=session.room;text('ping','RTT —');showPause(true);
   clearInterval(pingTimer);pingTimer=setInterval(()=>rawSend({type:'ping',stamp:Date.now()}),2000);
   if(message.players)applyState({...message,type:'state'});
  }else if(message.type==='state')applyState(message);
  else if(message.type==='pong'&&Number.isSafeInteger(message.stamp))text('ping',`RTT ${Math.max(0,Date.now()-message.stamp)}ms`);
  else if(message.type==='error'){
   clearTimeout(joinTimer);setBusy(false);status(errors[message.code]||'입장하지 못했어요. 잠시 후 다시 시도해 주세요.',true);
   if(!session){socket=null;ws.close();}
  }else if(message.type==='left')backToLobby('방에서 나왔습니다. 새 방을 만들거나 다른 코드로 참가하세요.');
 });
 ws.addEventListener('error',()=>{if(socket===ws&&!session){clearTimeout(joinTimer);setBusy(false);status('서버에 연결하지 못했어요. 서버 실행 상태와 주소를 확인해 주세요.',true);}});
 ws.addEventListener('close',()=>{
  if(socket!==ws)return;socket=null;
  if(session)backToLobby('서버와 연결이 끊겼어요. 서버 실행 상태를 확인하고 다시 입장해 주세요.',true);
  else {clearTimeout(joinTimer);if(busy){setBusy(false);status('연결이 종료됐어요. 서버를 확인하고 다시 입장해 주세요.',true);}}
 });
}
const weaponEffects=new Map([
 // Each layer specifies delay, decay rate, high noise, low noise, ring Hz and ring gain.
 [0,{duration:.24,volume:.39,layers:[[0,170,.85,0,0,0],[0,27,.32,.72,81,.70],[.034,24,.07,.18,55,.22]]}],
 [4,{duration:.135,volume:.33,layers:[[0,222,1.10,0,0,0],[0,50,.44,.45,143,.42],[.020,68,.15,.03,1220,.11]]}],
 [5,{duration:.10,volume:.16,layers:[[0,118,.48,.22,960,.42],[.022,91,.34,.14,570,.21]]}],
 [6,{duration:.105,volume:.20,layers:[[0,101,.44,.51,310,.57],[.013,147,.41,.15,1490,.48]]}],
]);
const weaponBuffers=new Map();
function weaponBuffer(kind,effect){
 if(weaponBuffers.has(kind))return weaponBuffers.get(kind);
 const rate=audio.sampleRate;
 const buffer=audio.createBuffer(1,Math.ceil(rate*effect.duration),rate);
 const data=buffer.getChannelData(0);
 let seed=0x73ad92+kind,low=0;
 const filter=1-Math.exp(-5700/rate);
 for(let i=0;i<data.length;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const noise=seed/0x80000000-1;
  low+=(noise-low)*filter;
  const time=i/rate,high=noise-low;
  let sample=0;
  for(const [delay,decay,crack,body,hz,ring] of effect.layers){
   const t=time-delay;
   if(t>=0)sample+=(crack*high+body*low+ring*Math.sin(2*Math.PI*hz*t))*Math.exp(-decay*t);
  }
  data[i]=effect.volume*Math.tanh(sample)*Math.min(1,time*4000,(effect.duration-time)*1600);
 }
 weaponBuffers.set(kind,buffer);
 return buffer;
}
function sound(kind){
 if($('mute').checked||!audio||audio.state!=='running')return;
 const effect=weaponEffects.get(kind);
 if(effect){
  const source=audio.createBufferSource();
  source.buffer=weaponBuffer(kind,effect);source.connect(audio.destination);
  source.addEventListener('ended',()=>source.disconnect());source.start();return;
 }
 const osc=audio.createOscillator(),gain=audio.createGain(),time=audio.currentTime;
 osc.type='sine';osc.frequency.setValueAtTime(kind===1?820:190,time);osc.frequency.exponentialRampToValueAtTime(kind===1?1200:70,time+.06);
 gain.gain.setValueAtTime(.055,time);gain.gain.exponentialRampToValueAtTime(.001,time+.075);osc.connect(gain);gain.connect(audio.destination);osc.start(time);osc.stop(time+.08);osc.addEventListener('ended',()=>{osc.disconnect();gain.disconnect();});
}
// This platform object is the explicit C++/browser ABI, not a fake game state API.
globalThis.CY={
 renderer:null,
 setMinimap:minimap.setWorld,
 drawMinimap(x,z,yaw){if(session)minimap.draw(x,z,yaw,session.allies,session.alive);},
 teammateLabel(slot,x,y){
  const label=$('teammate-label');
  const name=slot>=0&&session?.names[slot];
  label.hidden=!name;
  if(!name)return;
  text('teammate-label',name);
  label.classList.toggle('team-orange',session.team===1);
  label.style.left=`${x*100}%`;label.style.top=`${y*100}%`;
 },
 sendInput(message){if(session?.playing)rawSend(message);},
 lockChanged(locked){
  if(!session)return;
  if(locked){$('pause').hidden=true;firstEntry=false;$('game').focus({preventScroll:true});}
  else showPause(firstEntry);
 },
 lockError(){text('lock-status','마우스를 고정하지 못했어요. 미리보기 창이 아닌 Chrome·Edge의 게임 주소를 직접 열고 다시 눌러 주세요.');},
 feedback(kind){sound(kind);},
 hud(state){
  if(!session)return;
  text('weapon-name',state.weapon===1?'권총 / 12':'소총 / 24');text('grenade-count',state.grenades);
  for(let i=0;i<2;i++){const active=i===state.weapon;$(`weapon-slot-${i}`).classList.toggle('active',active);$(`weapon-slot-${i}`).setAttribute('aria-current',String(active));}
  text('stance-state',state.hp<=0?'사망':!state.grounded?'공중':state.prone?'엎드림':state.crouch?'앉음':'서 있음');
  text('hp',state.hp);text('ammo',state.ammo);text('heading',`${(Math.round(state.heading)%360).toString().padStart(3,'0')}°`);
  compass.style.transform=`translate3d(${(compassStart-state.heading)*pixelsPerDegree}px,0,0)`;
  $('health-fill').style.width=`${Math.max(0,state.hp)}%`;$('shield').hidden=state.shield<=0;
  $('hitmarker').classList.toggle('active',state.hit>0);$('damage-vignette').classList.toggle('active',state.damage>0);$('crosshair').classList.toggle('ads',state.ads);
  text('reload-label',state.reload>0?`재장전 ${(state.reload/1000).toFixed(1)}s`:'R 재장전');
  const now=performance.now();
  if(state.kills>lastKills){killUntil=now+900;lastKills=state.kills;}
  const roundStatus=session.phase==='countdown'
   ?`${session.roundResult===-2?'라운드 시작':session.roundResult===-1?'무승부':`${teamNames[session.roundResult]} 팀 라운드 승리`} · ${session.remaining}초`:'';
  text('action-state',roundStatus||(state.hp<=0?(session.mode===GUNFIGHT_MODE?'탈락 · 다음 라운드 대기':`${(state.respawn/1000).toFixed(1)}초 후 부활`):state.equip>0?'무기 장착 중':state.reload>0?'재장전 중':state.ammo===0?'탄창이 비었어요 · R 재장전':now<killUntil?'처치 확인':''));
 },
};
$('create').addEventListener('click',()=>connect('create'));$('join').addEventListener('click',()=>connect('join'));
$('code').addEventListener('input',()=>{$('code').value=$('code').value.toUpperCase();});
$('code').addEventListener('keydown',event=>{if(event.key==='Enter')connect('join');});
$('nickname').addEventListener('keydown',event=>{if(event.key==='Enter')connect('create');});
$('resume').addEventListener('click',()=>{
 if(!session?.playing)return;settings();
 if(!audio&&globalThis.AudioContext)audio=new AudioContext();
 if(audio?.state==='suspended')audio.resume().catch(()=>{text('lock-status','효과음을 시작하지 못했어요. 음소거로도 플레이할 수 있습니다.');});
 module._client_lock();
});
$('menu').addEventListener('click',()=>{module._client_release();showPause(false);});
$('rematch').addEventListener('click',()=>{if(session?.phase==='finished'&&session.members===4)rawSend({type:'rematch'});});
$('leave').addEventListener('click',()=>{
 module._client_release();rawSend({type:'leave'});const old=socket;socket=null;old?.close(1000,'left room');backToLobby('방에서 나왔습니다. 새 방을 만들거나 다른 코드로 참가하세요.');
});
async function copyCode(feedback){
 if(!session)return;
 const room=session.room;
 try{await navigator.clipboard.writeText(room);text(feedback,'방 코드 복사됨');}
 catch{text(feedback,`방 코드 ${room}`);}
}
$('copy-code').addEventListener('click',()=>copyCode('ping'));
$('invite-code').addEventListener('click',()=>copyCode('lock-status'));
$('sensitivity').addEventListener('input',settings);$('reduce').addEventListener('change',settings);
$('game').addEventListener('contextmenu',event=>event.preventDefault());
$('game').addEventListener('rendererlost',failGraphics);$('retry').addEventListener('click',()=>location.reload());
window.addEventListener('beforeunload',()=>socket?.close());
// Keep keyboard focus inside the visible menu; game input is handled by C++.
$('pause').addEventListener('keydown',event=>{
 if(event.key!=='Tab')return;
 const items=[...$('pause').querySelectorAll('button,input')].filter(e=>!e.disabled&&!e.hidden),first=items[0],last=items.at(-1);
 if(event.shiftKey&&document.activeElement===first){last.focus();event.preventDefault();}
 else if(!event.shiftKey&&document.activeElement===last){first.focus();event.preventDefault();}
});
async function boot(){
 buttons();
 try{
  renderer=await createRenderer($('game'));globalThis.CY.renderer=renderer;text('engine',`${renderer.api} / C++ WASM`);$('engine').title=renderer.reason;
  status('그래픽 준비 완료 · C++ 게임 모듈을 불러오고 있습니다.');
  const {default:createGame}=await import('./dist/client.mjs');
  module=await createGame({locateFile:name=>new URL(`./dist/${name}`,import.meta.url).href});
  const select=$('map');
  const available=Object.entries(maps).filter(([key])=>module._client_map_available(mapId(key)));
  select.replaceChildren(...available.map(([key,label])=>new Option(label,key,false,mapId(key)===module._client_default_map())));
  text('map-count',String(available.length).padStart(2,'0'));
  settings();ready=true;buttons();status('준비됐어요. 새 방을 만들거나 친구의 코드로 참가하세요.');
 }catch(error){console.error('Game initialization failed',error);failGraphics();}
}
boot();
