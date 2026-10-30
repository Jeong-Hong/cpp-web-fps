import {createRenderer} from './gpu.mjs';
const $=id=>document.getElementById(id);
const text=(id,value)=>{const node=$(id);const next=String(value);if(node.textContent!==next)node.textContent=next;};
let module,renderer,socket=null,session=null,busy=false,ready=false,joinTimer=null,pingTimer=null,audio=null;
let firstEntry=true,lastScore='',lastKills=0,killUntil=0;
const motion=matchMedia('(prefers-reduced-motion: reduce)');
$('reduce').checked=motion.matches;
const errors={ROOM_NOT_FOUND:'방을 찾지 못했어요. 친구에게 코드를 다시 확인해 주세요.',ROOM_FULL:'이미 4명이 참가한 방이에요. 다른 방을 만들어 주세요.',SERVER_FULL:'서버가 가득 찼어요. 잠시 후 다시 시도해 주세요.',INVALID_NAME:'닉네임은 제어 문자를 제외한 1~16자로 입력해 주세요.',INVALID_CODE:'방 코드는 0~9, A~F로 된 6자리입니다.',INVALID_MESSAGE:'통신 형식이 맞지 않아요. 새로고침 후 다시 입장해 주세요.',RATE_LIMIT:'너무 많은 요청이 발생했어요. 잠시 후 다시 입장해 주세요.'};
function status(message,error=false){text('lobby-status',message);$('lobby-status').classList.toggle('error',error);}
function buttons(){for(const id of ['create','join'])$(id).disabled=!ready||busy;}
function setBusy(value){busy=value;buttons();}
function settings(){module?._client_settings(Number($('sensitivity').value),$('reduce').checked?1:0);text('sensitivity-value',Number($('sensitivity').value).toFixed(2).replace(/0$/,''));}
function showPause(initial=false){if(!session)return;$('pause').hidden=false;text('pause-title',initial?'입장 완료':'잠시 조작을 멈췄어요');text('pause-description',initial?'아래 버튼을 누르면 마우스가 게임에 고정됩니다.':'다른 참가자의 전투는 계속되고 있습니다.');text('resume',initial?'클릭하고 플레이 ↗':'플레이로 돌아가기 ↗');if(document.hasFocus())$('resume').focus();}
function backToLobby(message,error=false){
 clearTimeout(joinTimer);clearInterval(pingTimer);module?._client_stop();session=null;firstEntry=true;lastScore='';lastKills=0;killUntil=0;
 $('pause').hidden=true;$('hud').hidden=true;$('lobby').hidden=false;setBusy(false);status(message,error);$('create').focus();
}
function failGraphics(){
 ready=false;buttons();module?._client_release();socket?.close(1000,'renderer unavailable');renderer?.dispose();
 $('fatal').hidden=false;text('fatal-message','그래픽 장치를 사용할 수 없어요. 다른 GPU 작업을 줄이거나 최신 Chrome·Edge에서 다시 열어 주세요.');
}
function rawSend(message){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));}
function updatePlayers(state){
 const names=state.names||{},ordered=[...state.players].sort((a,b)=>b.kills-a.kills||a.id-b.id);
 const signature=JSON.stringify(ordered.map(p=>[p.id,names[p.id],p.kills,p.deaths]));
 if(signature===lastScore)return;lastScore=signature;
 $('players').replaceChildren(...ordered.map(p=>{const li=document.createElement('li');if(p.id===session.id)li.className='me';const name=document.createElement('span');name.className='player-name';name.textContent=(names[p.id]||`플레이어 ${p.id+1}`)+(p.id===session.id?' · 나':'');const score=document.createElement('span');score.className='score-values';score.textContent=`${p.kills} / ${p.deaths}`;li.append(name,score);return li;}));
 text('count',`${state.players.length} / 4`);
}
function applyState(state){
 if(!session||state.room!==session.room||!Array.isArray(state.players))return;
 module._client_begin_state();
 for(const p of state.players){module._client_player(p.id,p.x,p.y,p.z,p.yaw,p.pitch,p.hp,p.ammo,p.kills,p.deaths,p.reload,p.respawn,p.shield,p.shot,p.hit,p.damage,p.ack,...p.trace);}
 module._client_end_state();updatePlayers(state);
}
function connect(type){
 if(!ready||busy||session)return;
 const name=$('nickname').value.trim();
 if(!name||Array.from(name).length>16||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(name)){status(errors.INVALID_NAME,true);$('nickname').focus();return;}
 const code=$('code').value;
 if(type==='join'&&!/^[A-F0-9]{6}$/.test(code)){status(errors.INVALID_CODE,true);$('code').focus();return;}
 setBusy(true);status(type==='create'?'서버에 새 방을 만들고 있습니다.':'친구의 방에 연결하고 있습니다.');
 const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);socket=ws;
 joinTimer=setTimeout(()=>{if(socket!==ws||session)return;ws.close();status('서버가 응답하지 않아요. 서버 실행 상태를 확인해 주세요.',true);setBusy(false);},6000);
 ws.addEventListener('open',()=>{if(socket!==ws)return;ws.send(JSON.stringify(type==='create'?{type,name}:{type,name,code}));});
 ws.addEventListener('message',event=>{
  if(socket!==ws)return;
  let message;try{message=JSON.parse(event.data);}catch{ws.close(1002,'invalid server data');return;}
  if(message.type==='welcome'){
   clearTimeout(joinTimer);setBusy(false);session={room:message.room,id:message.id};module._client_start(session.id);settings();
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
function sound(kind){
 if($('mute').checked||!audio||audio.state!=='running')return;
 const osc=audio.createOscillator(),gain=audio.createGain(),time=audio.currentTime;
 osc.type=kind===0?'sawtooth':'sine';osc.frequency.setValueAtTime(kind===0?145:kind===1?820:190,time);osc.frequency.exponentialRampToValueAtTime(kind===0?52:kind===1?1200:70,time+.06);
 gain.gain.setValueAtTime(kind===0?.035:.055,time);gain.gain.exponentialRampToValueAtTime(.001,time+.075);osc.connect(gain);gain.connect(audio.destination);osc.start(time);osc.stop(time+.08);osc.addEventListener('ended',()=>{osc.disconnect();gain.disconnect();});
}
// This platform object is the explicit C++/browser ABI, not a fake game state API.
globalThis.CY={
 renderer:null,
 sendInput(message){if(session)rawSend(message);},
 lockChanged(locked){
  if(!session)return;
  if(locked){$('pause').hidden=true;firstEntry=false;$('game').focus({preventScroll:true});}
  else showPause(firstEntry);
 },
 lockError(){text('lock-status','마우스를 고정하지 못했어요. 미리보기 창이 아닌 Chrome·Edge의 게임 주소를 직접 열고 다시 눌러 주세요.');},
 feedback(kind){sound(kind);},
 hud(state){
  if(!session)return;
  text('hp',state.hp);text('ammo',state.ammo);text('heading',`${Math.round(state.heading).toString().padStart(3,'0')}°`);
  $('health-fill').style.width=`${Math.max(0,state.hp)}%`;$('shield').hidden=state.shield<=0;
  $('hitmarker').classList.toggle('active',state.hit>0);$('damage-vignette').classList.toggle('active',state.damage>0);$('crosshair').classList.toggle('ads',state.ads);
  text('reload-label',state.reload>0?`재장전 ${(state.reload/1000).toFixed(1)}s`:'R 재장전');
  const now=performance.now();
  if(state.kills>lastKills){killUntil=now+900;lastKills=state.kills;}
  text('action-state',state.hp<=0?`${(state.respawn/1000).toFixed(1)}초 후 부활`:state.reload>0?'재장전 중':state.ammo===0?'탄창이 비었어요 · R 재장전':now<killUntil?'처치 확인':'');
 },
};
$('create').addEventListener('click',()=>connect('create'));$('join').addEventListener('click',()=>connect('join'));
$('code').addEventListener('input',()=>{$('code').value=$('code').value.toUpperCase();});
$('code').addEventListener('keydown',event=>{if(event.key==='Enter')connect('join');});
$('nickname').addEventListener('keydown',event=>{if(event.key==='Enter')connect('create');});
$('resume').addEventListener('click',()=>{
 if(!session)return;settings();
 if(!audio&&globalThis.AudioContext)audio=new AudioContext();
 if(audio?.state==='suspended')audio.resume().catch(()=>{text('lock-status','효과음을 시작하지 못했어요. 음소거로도 플레이할 수 있습니다.');});
 module._client_lock();
});
$('menu').addEventListener('click',()=>{module._client_release();showPause(false);});
$('leave').addEventListener('click',()=>{
 module._client_release();rawSend({type:'leave'});const old=socket;socket=null;old?.close(1000,'left room');backToLobby('방에서 나왔습니다. 새 방을 만들거나 다른 코드로 참가하세요.');
});
$('copy-code').addEventListener('click',async()=>{
 if(!session)return;
 try{await navigator.clipboard.writeText(session.room);text('ping','방 코드 복사됨');}
 catch{text('ping',`방 코드 ${session.room}`);}
});
$('sensitivity').addEventListener('input',settings);$('reduce').addEventListener('change',settings);
$('game').addEventListener('contextmenu',event=>event.preventDefault());
$('game').addEventListener('rendererlost',failGraphics);$('retry').addEventListener('click',()=>location.reload());
window.addEventListener('beforeunload',()=>socket?.close());
// Keep keyboard focus inside the visible menu; game input is handled by C++.
$('pause').addEventListener('keydown',event=>{
 if(event.key!=='Tab')return;
 const items=[...$('pause').querySelectorAll('button,input')].filter(e=>!e.disabled),first=items[0],last=items.at(-1);
 if(event.shiftKey&&document.activeElement===first){last.focus();event.preventDefault();}
 else if(!event.shiftKey&&document.activeElement===last){first.focus();event.preventDefault();}
});
async function boot(){
 try{
  renderer=await createRenderer($('game'));globalThis.CY.renderer=renderer;text('engine',`${renderer.api} / C++ WASM`);$('engine').title=renderer.reason;
  status('그래픽 준비 완료 · C++ 게임 모듈을 불러오고 있습니다.');
  const {default:createGame}=await import('./dist/client.mjs');
  module=await createGame({locateFile:name=>new URL(`./dist/${name}`,import.meta.url).href});
  settings();ready=true;buttons();status('준비됐어요. 새 방을 만들거나 친구의 코드로 참가하세요.');
 }catch(error){console.error('Game initialization failed',error);failGraphics();}
}
boot();
