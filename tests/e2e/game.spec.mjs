import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import WebSocket from 'ws';
const observe=page=>{
 const channel=new EventEmitter();channel.state=null;channel.welcome=null;channel.errors=[];channel.inputs=[];
 page.on('pageerror',e=>channel.errors.push(e.message));
 page.on('websocket',socket=>socket.on('framesent',event=>{try{channel.lastSent=JSON.parse(String(event.payload));if(channel.lastSent.type==='input'){channel.inputs.push(channel.lastSent);if(channel.inputs.length>512)channel.inputs.shift();}}catch{channel.lastSent=null;}}));
 page.on('websocket',socket=>socket.on('framereceived',event=>{
  let m;try{m=JSON.parse(String(event.payload));}catch{return;}
  if(m.type==='state')channel.state=m;if(m.type==='welcome')channel.welcome=m;channel.emit('data',m);
 }));
 channel.wait=(predicate,timeout=7000)=>{
  for(const m of [channel.state,channel.welcome])if(m&&predicate(m))return Promise.resolve(m);
  return new Promise((resolve,reject)=>{
   const listener=m=>{if(predicate(m)){clearTimeout(timer);channel.off('data',listener);resolve(m);}};
   const timer=setTimeout(()=>{channel.off('data',listener);reject(Error('browser public state deadline'));},timeout);channel.on('data',listener);
  });
 };return channel;
};
const channelLast=channel=>channel.lastSent;
async function enter(page,name,code){
 await page.goto('/');await page.bringToFront();await expect(page.locator('#create')).toBeEnabled({timeout:15000});
 await page.getByLabel('닉네임',{exact:true}).fill(name);
 if(code){await page.getByLabel('방 코드',{exact:true}).fill(code);await page.getByRole('button',{name:'참가',exact:true}).click();}
 else await page.getByRole('button',{name:'새 방 만들기',exact:true}).click();
 await expect(page.locator('#pause')).toBeVisible();
}
for(const [reducedMotion,forceWebGL] of [['reduce',false],['no-preference',false],['reduce',true]]) test(`actual C++ controls, server ammo, reload and Esc (${reducedMotion}${forceWebGL?'/WebGL2':''})`,async({browser})=>{
 const scenario=reducedMotion+(forceWebGL?'-webgl':'');
 const context=await browser.newContext({reducedMotion,viewport:{width:1440,height:900}});
 if(forceWebGL)await context.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
 const page=await context.newPage(),channel=observe(page);
 try{
  await enter(page,'QA_CONTROLS');await channel.wait(m=>m.type==='state'&&m.players.length===1);
  const id=channel.welcome.id,initial=channel.state.players.find(p=>p.id===id);
  // Test-only observation after the real C++ renderer. Never inject a game event.
  await page.evaluate(()=>{
   window.__flash=0;window.__shotFrame=null;
   const hud=CY.hud;CY.hud=s=>{hud(s);window.__flash=s.flash;};
   const draw=CY.renderer.draw.bind(CY.renderer);CY.renderer.draw=(...args)=>{draw(...args);if(window.__flash>0&&!window.__shotFrame)window.__shotFrame=document.querySelector('canvas').toDataURL('image/png');};
  });
  await page.bringToFront();expect(await page.evaluate(()=>document.visibilityState)).toBe('visible');
  await page.getByRole('button',{name:/클릭하고 플레이/}).click();
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
  await page.keyboard.down('KeyW');
  await channel.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&Math.hypot(p.x-initial.x,p.z-initial.z)>.6));
  await page.keyboard.up('KeyW');
  const oldYaw=channel.state.players.find(p=>p.id===id).yaw;
  await page.mouse.move(850,450,{steps:4});
  await channel.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&Math.abs(p.yaw-oldYaw)>.04));
  const heading=await page.locator('#heading').textContent();await page.waitForTimeout(250);
  expect(await page.locator('#heading').textContent()).toBe(heading);
  await page.mouse.down();await channel.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.ammo<24));
  await expect.poll(()=>page.evaluate(()=>!!window.__shotFrame)).toBe(true);await page.mouse.up();
  const frame=await page.evaluate(()=>window.__shotFrame);await mkdir('work',{recursive:true});await writeFile(`work/firing-${scenario}.png`,Buffer.from(frame.split(',')[1],'base64'));
  await page.keyboard.press('KeyR');await channel.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.reload>0));
  await channel.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.reload===0&&p.ammo===24));
  await page.screenshot({path:`work/play-${scenario}.png`});
  await page.evaluate(()=>{window.__escapeSeen=false;document.addEventListener('keydown',e=>{if(e.code==='Escape')window.__escapeSeen=true;},true);});
  await page.keyboard.press('Escape');console.log('Escape diagnostic',JSON.stringify(await page.evaluate(()=>({received:window.__escapeSeen,locked:document.pointerLockElement?.id}))));await expect.poll(()=>page.evaluate(()=>document.pointerLockElement===null)).toBe(true);
  await expect(page.locator('#pause')).toBeVisible();await page.screenshot({path:`work/menu-${scenario}.png`});
  expect(await page.locator('#reduce').isChecked()).toBe(reducedMotion==='reduce');
  await page.getByRole('button',{name:/방 나가기/}).click();await expect(page.locator('#create')).toBeEnabled();
  expect(channel.errors).toEqual([]);
 }finally{await context.close();}
});
test('four independent browser contexts agree on membership; fifth gets room full',async({browser})=>{
 const contexts=[],pages=[],channels=[];
 try{
  let code;
  for(let i=0;i<4;i++){
   const ctx=await browser.newContext({viewport:{width:1280,height:800}});contexts.push(ctx);const page=await ctx.newPage();pages.push(page);channels.push(observe(page));
   await enter(page,`QA_BROWSER_${i+1}`,code);code=await page.locator('#copy-code').textContent();
  }
  await Promise.all(channels.map(c=>c.wait(m=>m.type==='state'&&m.players.length===4)));
  for(const page of pages)await expect(page.locator('#count')).toHaveText('4 / 4');
  const ids=channels.map(c=>c.welcome.id);expect(new Set(ids).size).toBe(4);
  const ctx=await browser.newContext();contexts.push(ctx);const fifth=await ctx.newPage();
  await fifth.goto('/');await expect(fifth.locator('#join')).toBeEnabled();await fifth.locator('#nickname').fill('QA_FIFTH');await fifth.locator('#code').fill(code);await fifth.locator('#join').click();
  await expect(fifth.locator('#lobby-status')).toContainText('이미 4명');await expect(fifth.locator('#create')).toBeEnabled();
  for(const c of channels)expect(c.errors).toEqual([]);
  console.log('Observed independent browser ids',JSON.stringify(ids));
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
test('served C++ lobby and live menu retain layout at desktop, tablet and phone widths',async({page})=>{
 const c=observe(page);await page.goto('/');await page.bringToFront();await expect(page.locator('#create')).toBeEnabled();
 for(const width of [1440,768,375]){
  await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>innerWidth)).toBe(width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`work/lobby-${width}.png`});
 }
 await page.setViewportSize({width:1440,height:900});await page.locator('#create').click();await expect(page.locator('#pause')).toBeVisible();
 const room=await page.locator('#copy-code').textContent();
 for(const width of [1440,768,375]){
  await page.setViewportSize({width,height:900});expect(await page.locator('#copy-code').textContent()).toBe(room);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`work/live-menu-${width}.png`});
 }
 await page.bringToFront();await page.locator('#resume').click();await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
 await page.keyboard.press('Digit2');await page.keyboard.press('KeyC');await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===c.welcome.id&&p.weapon===1&&p.crouch));
 for(const width of [1440,768,375]){
  await page.setViewportSize({width,height:900});expect(await page.locator('#copy-code').textContent()).toBe(room);
  const layout=await page.evaluate(()=>{const a=document.querySelector('.life').getBoundingClientRect(),b=document.querySelector('.ammo').getBoundingClientRect();return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,separate:a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,fonts:['stance-state','weapon-name','grenade-label'].map(id=>parseFloat(getComputedStyle(document.getElementById(id)).fontSize))};});
  expect(layout.width).toBe(width);expect(layout.overflow).toBe(false);expect(layout.separate).toBe(true);expect(layout.fonts.every(n=>n>=14)).toBe(true);await page.screenshot({path:`work/live-hud-${width}.png`});
 }
 await page.keyboard.press('Escape');await page.locator('#leave').click();expect(c.errors).toEqual([]);
});

for(const direction of ['down','up'])test(`extreme mouse pitch ${direction} remains in the strict wire range without disconnecting`,async({page})=>{
 const c=observe(page);await enter(page,'QA_AIM_BOUNDARY');await c.wait(m=>m.type==='state');
 await page.locator('#sensitivity').focus();await page.keyboard.press('End');await expect(page.locator('#sensitivity')).toHaveValue('3');
 await page.getByRole('button',{name:/클릭하고 플레이/}).click();await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
 const result=c.wait(m=>m.type==='error'||m.type==='state'&&m.players.some(p=>p.id===c.welcome.id&&(direction==='down'?p.pitch<-1.44:p.pitch>1.44)));
 await page.mouse.move(720,direction==='down'?899:0,{steps:2});const state=await result;
 console.log('Pitch boundary diagnostic',JSON.stringify({response:state.type==='error'?state:state.players.find(p=>p.id===c.welcome.id),sent:channelLast(c)}));
 expect(state.type).toBe('state');await expect(page.locator('#hud')).toBeVisible();
});

async function ownedServer(port=0){
 const child=spawn(process.execPath,['server/main.mjs','--port',String(port)],{cwd:new URL('../../',import.meta.url),windowsHide:true,stdio:['ignore','pipe','pipe']});
 const url=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(Error('owned recovery server readiness timeout'));},10000);
  let output='';child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/CROSSYARD (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(Error(`owned recovery server exited ${code}`));});
 });
 return {url,async stop(){if(child.exitCode!==null)return;await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}};
}
test('missing-room retry and owned server disconnect recover the real UI',async({page})=>{
 let server=await ownedServer();const original=server.url;
 try{
  await page.goto(original);await page.bringToFront();await expect(page.locator('#create')).toBeEnabled();
  await page.locator('#nickname').fill('QA_RECOVERY');await page.locator('#code').fill('000000');await page.locator('#join').click();
  await expect(page.locator('#lobby-status')).toContainText('방을 찾지 못했어요');await expect(page.locator('#create')).toBeEnabled();
  await page.locator('#create').click();await expect(page.locator('#pause')).toBeVisible();
  await server.stop();await expect(page.locator('#lobby-status')).toContainText('연결이 끊겼어요');await expect(page.locator('#create')).toBeEnabled();
  await page.screenshot({path:'work/controlled-disconnect.png'});
  for(const width of [1440,768,375]){
   await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.querySelector('#lobby').scrollWidth<=innerWidth)).toBe(true);await page.locator('#lobby').evaluate(e=>{e.scrollTop=0;});await page.screenshot({path:`work/disconnect-${width}.png`});
   if(width<=768){await page.locator('#lobby').evaluate(e=>{e.scrollTop=e.scrollHeight;});await expect(page.locator('#lobby-status')).toBeInViewport();await expect(page.locator('#lobby-status')).toContainText('연결이 끊겼어요');await page.screenshot({path:`work/disconnect-${width}-bottom.png`});console.log('Observed bottom state',JSON.stringify(await page.evaluate(()=>({state:'controlled-disconnect',origin:location.origin,width:innerWidth,height:innerHeight,visibility:document.visibilityState,scrollTop:document.querySelector('#lobby').scrollTop,text:document.querySelector('#lobby-status').textContent}))));}
  }
  server=await ownedServer(Number(new URL(original).port));await page.locator('#create').click();await expect(page.locator('#pause')).toBeVisible();
  await page.locator('#leave').click();await expect(page.locator('#create')).toBeEnabled();
 }finally{await server.stop();}
});

test('real browser hit, kill and incoming-damage feedback through an ordinary socket peer',async({page,baseURL})=>{
 const c=observe(page);await enter(page,'QA_VISUAL');
 const room=await page.locator('#copy-code').textContent();
 const target=new WebSocket(baseURL.replace('http:','ws:')+'/ws',{origin:baseURL});
 let sequence=0,timer;
 try{
  await new Promise((resolve,reject)=>{target.once('open',resolve);target.once('error',reject);});
  const welcome=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('visual target join deadline')),4000);target.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome'){clearTimeout(timeout);resolve(m);}if(m.type==='error'){clearTimeout(timeout);reject(Error(m.code));}});});
  target.send(JSON.stringify({type:'join',name:'QA_SOCKET_TARGET',code:room}));const other=await welcome;
  await c.wait(m=>m.type==='state'&&m.players.length===2&&m.players.find(p=>p.id===other.id)?.shield===0);
  const me=c.state.players.find(p=>p.id===c.welcome.id),victim=c.state.players.find(p=>p.id===other.id);
  const dx=victim.x-me.x,dz=victim.z-me.z,wantedYaw=Math.atan2(dx,-dz),wantedPitch=Math.atan2(-.75,Math.hypot(dx,dz));
  const button=await page.locator('#resume').boundingBox();await page.bringToFront();await page.locator('#resume').click();
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
  await page.mouse.move(button.x+button.width/2+(wantedYaw-me.yaw)/.0022,button.y+button.height/2-wantedPitch/.0022);
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===me.id&&Math.abs(p.yaw-wantedYaw)<.008));
  for(let tap=0;tap<4;++tap){
   const shot=c.state.players.find(p=>p.id===me.id).shot;
   await page.mouse.down();await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===me.id&&p.shot>shot));await page.mouse.up();
   if(tap===0){await expect(page.locator('#hitmarker')).toHaveClass(/active/);await page.screenshot({path:'work/browser-hit.png'});}
   if(c.state.players.find(p=>p.id===other.id).hp===0)break;
   await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===me.id&&!p.recoilHeld&&p.recoil<.004));
  }
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===other.id&&p.hp===0));
  await expect(page.locator('#players li.me .score-values')).toHaveText('1 / 0');
  await page.waitForTimeout(350);
  await expect(page.locator('#action-state')).toHaveText('처치 확인',{timeout:200});
  await page.screenshot({path:'work/kill-confirmation.png'});
  await page.waitForTimeout(900);
  await expect(page.locator('#action-state')).toHaveText('');
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===other.id&&p.hp===100&&p.deaths===1));
  const aimBack={yaw:Math.atan2(-dx,dz),pitch:wantedPitch};
  const send=fire=>target.send(JSON.stringify({type:'input',seq:++sequence,forward:0,strafe:0,...aimBack,fire,reload:false,sprint:false,jump:false,crouch:false,weapon:0,grenade:false}));
  send(true);timer=setInterval(()=>send(true),33);
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===me.id&&p.hp<=75));clearInterval(timer);timer=null;send(false);
  await expect(page.locator('#damage-vignette')).toHaveClass(/active/);await page.screenshot({path:'work/browser-damage.png'});
  console.log('Observed browser combat',JSON.stringify({mine:c.welcome.id,target:other.id,health:c.state.players.find(p=>p.id===me.id).hp,kills:c.state.players.find(p=>p.id===me.id).kills}));
  await page.keyboard.press('Escape');await page.locator('#leave').click();expect(c.errors).toEqual([]);
 }finally{clearInterval(timer);target.close();}
});

test('Space edge jumps, lands and does not repeat while held through real C++ input',async({page})=>{
 const c=observe(page),jumps=[];
 page.on('websocket',s=>s.on('framesent',event=>{const p=JSON.parse(String(event.payload));if(p.type==='input'&&p.jump)jumps.push(p.seq);}));
 await enter(page,'QA_JUMP');await c.wait(m=>m.type==='state');
 const id=c.welcome.id;await page.bringToFront();expect(await page.evaluate(()=>document.visibilityState)).toBe('visible');
 await page.locator('#resume').click();await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
 await page.evaluate(()=>{window.__jumpEye=0;window.__jumpHands=false;const draw=CY.renderer.draw.bind(CY.renderer);CY.renderer.draw=(...args)=>{draw(...args);window.__jumpEye=Math.max(window.__jumpEye,args[2][1]);window.__jumpHands||=args[1].some((v,i)=>i%11===3&&Math.abs(v-.126)<.001);};});
 await page.keyboard.down('Space');
 await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.y>.12&&!p.grounded),1200).catch(()=>{throw Error('missing authoritative jump action');});
 expect(await page.evaluate(()=>window.__jumpEye)).toBeGreaterThan(1.7);await page.screenshot({path:'work/actions-jump.png'});
 await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.y===0&&p.grounded),2500);
 await page.waitForTimeout(200);expect(c.state.players.find(p=>p.id===id)).toMatchObject({y:0,grounded:true});expect(jumps).toHaveLength(1);
 expect(await page.evaluate(()=>window.__jumpHands)).toBe(false);
 await page.keyboard.up('Space');await page.keyboard.press('Escape');await page.locator('#leave').click();expect(c.errors).toEqual([]);
});

for(const [high,forceWebGL,sprint=false] of [[true,false],[true,true],[false,false],[true,false,true]])test(`W and Space climb ${sprint?'2.4 m and continue sprinting':high?'2 m with both hands':'1.4 m without hands'} (${forceWebGL?'WebGL2':'auto'})`,async({page})=>{
 if(forceWebGL)await page.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
 const c=observe(page);await enter(page,'QA_MANTLE');await c.wait(m=>m.type==='state');
 const id=c.welcome.id;
 const playerWhen=predicate=>c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&predicate(p)),9000);
 const initial=c.state.players.find(p=>p.id===id);
 const button=await page.locator('#resume').boundingBox();
 await page.locator('#resume').click();await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
 const face=async yaw=>{
  await page.mouse.move(button.x+button.width/2+(yaw-initial.yaw)/.0022,button.y+button.height/2);
  await playerWhen(p=>Math.abs(p.yaw-yaw)<.005);
 };
 const walkUntil=async predicate=>{
  await page.keyboard.down('KeyW');await playerWhen(predicate);await page.keyboard.up('KeyW');
 };
 if(!high){
  await face(Math.PI/2);await walkUntil(p=>p.x>=-6.7);
  await face(Math.PI-.003);await walkUntil(p=>p.z>=14.2);
  await face(Math.PI/2);await walkUntil(p=>p.x>=3.9);
 }
 if(sprint){
  await face(Math.PI/2);await page.keyboard.down('ShiftLeft');await walkUntil(p=>p.x>=10.9);
 }
 await face(Math.PI-.003);
 const ledgeZ=sprint?6.5:high?-2.5:15, height=sprint?2.4:high?2:1.4;
 await page.evaluate(height=>{
  window.__mantleFrames=[];
  const draw=CY.renderer.draw.bind(CY.renderer);
  CY.renderer.draw=(matrix,instances,eye,fx)=>{
   draw(matrix,instances,eye,fx);
   const palms=[];let rifle=false;
   for(let i=0;i<instances.length;i+=11){
    if(Math.abs(instances[i+3]-.14)<.001&&Math.abs(instances[i+5]-.46)<.001)rifle=true;
    if(Math.abs(instances[i+3]-.126)>=.001)continue;
    const p=instances.subarray(i,i+3),clip=row=>matrix[row]*p[0]+matrix[row+4]*p[1]+matrix[row+8]*p[2]+matrix[row+12];
    const w=clip(3);
    palms.push({y:p[1],z:p[2],visible:w>0&&Math.abs(clip(0))<w&&Math.abs(clip(1))<w});
   }
   window.__mantleFrames.push({eye:eye[1],z:eye[2],palms,rifle});
   if(!window.__mantleImage&&palms.filter(p=>p.visible&&Math.abs(p.y-height-.046)<.025).length===2)
    window.__mantleImage=document.querySelector('canvas').toDataURL('image/png');
  };
 },height);
 await page.keyboard.down('KeyW');await playerWhen(p=>p.z>=ledgeZ-(sprint?.95:.40));
 await page.keyboard.press('Space');
 const climbing=await playerWhen(p=>Array.isArray(p.mantle)&&p.y>0&&p.y<height&&!p.grounded);
 const path=climbing.players.find(p=>p.id===id).mantle;
 expect(path).toHaveLength(15);expect(path[5]).toBeCloseTo(height);
 expect(path[8]).toBeCloseTo(high?height:0);expect(path[11]).toBeCloseTo(high?height:0);
 expect(path[14]).toBe(sprint?1:0);
 if(sprint)expect(path[13]).toBeGreaterThan(.15);
 await page.keyboard.press('KeyE');
 await playerWhen(p=>p.grounded&&Math.abs(p.y-height)<.01&&p.z>ledgeZ+.3);
 if(sprint)await playerWhen(p=>p.grounded&&Math.abs(p.y-height)<.01&&p.z>path[6]+.60);
 await page.keyboard.up('KeyW');
 if(sprint)await page.keyboard.up('ShiftLeft');
 const standingEye=height+1.6;
 await expect.poll(()=>page.evaluate(()=>window.__mantleFrames.at(-1).eye)).toBeCloseTo(standingEye,1);
 const {frames,image}=await page.evaluate(()=>({frames:window.__mantleFrames,image:window.__mantleImage}));
 expect(frames.filter(frame=>frame.eye>1.8&&frame.eye<standingEye-.15).length).toBeGreaterThan(2);
 expect(frames.every((frame,i)=>i===0||(frame.eye>=frames[i-1].eye-.05&&frame.eye-frames[i-1].eye<.9))).toBe(true);
 expect(frames.every(frame=>frame.eye>=standingEye-.01||frame.z<ledgeZ)).toBe(true);
 if(high)expect(frames.some(frame=>frame.palms.filter(p=>p.visible).length===2)).toBe(true);
 else expect(frames.every(frame=>frame.palms.length===0&&frame.rifle)).toBe(true);
 if(sprint){
  const crossing=frames.filter(frame=>frame.eye>1.75&&frame.z<path[6]+.5);
  expect(crossing.length).toBeGreaterThan(8);
  expect(crossing.filter((frame,i)=>i>0&&frame.z-crossing[i-1].z<.002).length).toBeLessThanOrEqual(1);
 }
 if(image)await writeFile(`work/mantle-contact-${sprint?'sprint':forceWebGL?'webgl':'auto'}.png`,Buffer.from(image.split(',')[1],'base64'));
 expect(c.state.players.find(p=>p.id===id).grenadeCount).toBe(high?1:0);
 await page.keyboard.press('Escape');await page.locator('#leave').click();expect(c.errors).toEqual([]);
});

async function publicPeer(baseURL,room,name){
 const ws=new WebSocket(baseURL.replace('http:','ws:')+'/ws',{origin:baseURL}),events=new EventEmitter();let latest,welcome,seq=0;const history=[];
 ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.type==='state'){latest=m;history.push(m);if(history.length>64)history.shift();}if(m.type==='welcome')welcome=m;events.emit('data',m);});
 const wait=(predicate,timeout=6000)=>{for(const m of [latest,welcome,...history])if(m&&predicate(m))return Promise.resolve(m);return new Promise((resolve,reject)=>{const handler=m=>{if(predicate(m)){clearTimeout(timer);events.off('data',handler);resolve(m);}};const timer=setTimeout(()=>{events.off('data',handler);reject(Error('public peer state deadline'));},timeout);events.on('data',handler);});};
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.send(JSON.stringify({type:'join',name,code:room}));const joined=await wait(m=>m.type==='welcome');
 return {id:joined.id,wait,input(fields={}){ws.send(JSON.stringify({type:'input',seq:++seq,forward:0,strafe:0,yaw:0,pitch:0,fire:false,reload:false,sprint:false,jump:false,crouch:false,weapon:0,grenade:false,...fields}));},close(){ws.close();}};
}

for(const forceWebGL of [false,true])test(`weapon flash fades and brass ejects for rifle and pistol (${forceWebGL?'WebGL2':'auto'})`,async({page})=>{
 if(forceWebGL)await page.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
 const c=observe(page);await enter(page,'QA_WEAPON_FX');await c.wait(m=>m.type==='state');const id=c.welcome.id;
 const playerWhen=async predicate=>(await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&predicate(p)))).players.find(p=>p.id===id);
 const yaw=c.state.players.find(p=>p.id===id).yaw;
 await page.locator('#resume').click();await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
 await page.evaluate(yaw=>{
  const record=window.__fx={frames:[],image:null,brassImage:null};
  const draw=CY.renderer.draw.bind(CY.renderer),canvas=document.querySelector('canvas');
  const lateral=(x,z)=>x*Math.cos(yaw)+z*Math.sin(yaw);
  CY.renderer.draw=(matrix,instances,eye,fx)=>{
   draw(matrix,instances,eye,fx);
   let peak=0,feather=false,port=null,square=false;
   const brass=[];
   for(let i=0;i<instances.length;i+=11){
    const dims=(x,y,z)=>Math.abs(instances[i+3]-x)<.0004&&Math.abs(instances[i+4]-y)<.0004&&Math.abs(instances[i+5]-z)<.0004;
    if(dims(.009,.041,.107)||dims(.008,.029,.066))port=Array.from(instances.subarray(i,i+3));
    if(dims(.15,.15,.25)||dims(.13,.13,.20))square=true;
   }
   for(let i=0;i<fx.length;i+=7){
    if(fx[i+3]>1){peak=Math.max(peak,fx[i+6]);feather||=fx[i+6]===0;}
    else brass.push([fx[i],fx[i+1],fx[i+2]]);
   }
   const side=brass.map(p=>lateral(p[0],p[2])).sort((a,b)=>a-b);
   const groups=side.length?1+side.filter((n,i)=>i>0&&n-side[i-1]>.075).length:0;
   const center=brass.length?[0,1,2].map(i=>brass.reduce((sum,p)=>sum+p[i],0)/brass.length):null;
   const delta=port&&center?Math.hypot(...center.map((v,i)=>v-port[i])):null;
   const inView=center&&(()=>{
    const clip=row=>matrix[row]*center[0]+matrix[row+4]*center[1]+matrix[row+8]*center[2]+matrix[row+12];
    const w=clip(3);return w>0&&Math.abs(clip(0))<w&&Math.abs(clip(1))<w;
   })();
   record.frames.push({time:performance.now(),peak,feather,square,groups,delta,inView,
    side:center?lateral(center[0],center[2]):null,y:center?.[1]??null});
   if(record.frames.length>600)record.frames.shift();
   if(!record.image&&peak>.40&&inView)record.image=canvas.toDataURL('image/png');
   if(!record.brassImage&&peak===0&&groups===1&&inView&&delta>.16&&delta<.32)record.brassImage=canvas.toDataURL('image/png');
  };
 },yaw);
 for(const [weapon,shots] of [[0,3],[1,1]]){
  await page.keyboard.press(weapon===1?'Digit2':'Digit1');
  const before=await playerWhen(p=>p.weapon===weapon&&p.equip===0);
  await page.evaluate(()=>{window.__fx.frames=[];window.__fx.image=null;window.__fx.brassImage=null;});
  await page.mouse.down();await playerWhen(p=>p.weapon===weapon&&p.shot>=before.shot+shots);await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>Math.max(...window.__fx.frames.map(f=>f.groups)))).toBeGreaterThanOrEqual(shots);
  await expect.poll(()=>page.evaluate(()=>window.__fx.frames.at(-1)?.groups)).toBe(0);
  const {frames,image,brassImage}=await page.evaluate(()=>window.__fx);
  const active=frames.filter(f=>f.groups>0);
  expect(frames.every(f=>!f.square)).toBe(true);
  expect(frames.some(f=>f.peak>.30&&f.feather)).toBe(true);
  expect(active[0].delta).toBeLessThan(.07);expect(active[0].inView).toBe(true);
  if(weapon===1){
   expect(Math.max(...active.map(f=>f.groups))).toBe(1);
   expect(Math.max(...active.map(f=>f.side))-active[0].side).toBeGreaterThan(.35);
   expect(Math.max(...active.map(f=>f.y))-active[0].y).toBeGreaterThan(.02);
   expect(active.at(-1).y).toBeLessThan(active[0].y-.25);
   const flashes=frames.filter(f=>f.peak>0);expect(flashes.at(-1).time-flashes[0].time).toBeLessThan(90);
  }
  if(image)await writeFile(`work/weapon-fx-${weapon}-${forceWebGL?'webgl':'auto'}.png`,Buffer.from(image.split(',')[1],'base64'));
  if(brassImage)await writeFile(`work/weapon-brass-${weapon}-${forceWebGL?'webgl':'auto'}.png`,Buffer.from(brassImage.split(',')[1],'base64'));
 }
 console.log('Weapon effects renderer',await page.evaluate(()=>CY.renderer.api));
 await page.keyboard.press('Escape');await page.locator('#leave').click();expect(c.errors).toEqual([]);
});

for(const forceWebGL of [false,true])test(`reload hand removes and seats both magazines (${forceWebGL?'WebGL2':'auto'})`,async({page})=>{
 if(forceWebGL)await page.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
 await page.addInitScript(()=>{
  window.__heard=[];
  const start=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(...args){
   if(this.buffer&&Number.isInteger(window.__cue)){
    let peak=0;
    for(const sample of this.buffer.getChannelData(0))peak=Math.max(peak,Math.abs(sample));
    window.__heard.push({kind:window.__cue,duration:this.buffer.duration,peak});
   }
   return start.apply(this,args);
  };
 });
 const c=observe(page);await enter(page,'QA_RELOAD');await c.wait(m=>m.type==='state');const id=c.welcome.id;
 const playerWhen=async predicate=>(await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&predicate(p)))).players.find(p=>p.id===id);
 await page.locator('#resume').click();await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
 await page.evaluate(()=>{
  const samples=window.__reload={frames:[],images:{},cues:[]};
  const feedback=CY.feedback;CY.feedback=kind=>{
   samples.cues.push(kind);window.__cue=kind;
   try{feedback(kind);}finally{window.__cue=null;}
  };
  const hud=CY.hud;CY.hud=s=>{hud(s);samples.hud=s;};
  const draw=CY.renderer.draw.bind(CY.renderer);
  CY.renderer.draw=(matrix,instances,eye,fx)=>{
   draw(matrix,instances,eye,fx);
   if(!samples.hud)return;
   const {weapon,ammo,reload}=samples.hud;
   const pistol=weapon===1;
   let body=-1,mag=-1,hand=-1,right=-1,left=-1,fresh=false;
   for(let i=0;i<instances.length;i+=11){
    const isPart=(x,y,z)=>Math.abs(instances[i+3]-x)<.0003&&Math.abs(instances[i+4]-y)<.0003&&Math.abs(instances[i+5]-z)<.0003;
    if(pistol?isPart(.106,.081,.233):isPart(.14,.15,.46))body=i;
    if(pistol?isPart(.073,.105,.073):isPart(.104,.177,.115))mag=i;
    if(isPart(.089,.081,.109))hand=i;
    if(isPart(.032,.011,.056))fresh=true;
    if(isPart(.070,.092,.106))right=i;
    if(isPart(.067,.077,.110))left=i;
   }
   const onScreen=i=>{
    if(i<0)return false;
    const clip=row=>matrix[row]*instances[i]+matrix[row+4]*instances[i+1]+matrix[row+8]*instances[i+2]+matrix[row+12];
    const w=clip(3);return w>0&&Math.abs(clip(0))<w&&Math.abs(clip(1))<w;
   };
   let drop=null,grip=false;
   if(body>=0){
    const y=instances[body+9],p=instances[body+10];
    const up=[-Math.sin(y)*Math.sin(p),Math.cos(p),Math.cos(y)*Math.sin(p)];
    const height=i=>up.reduce((sum,value,axis)=>sum+value*(instances[i+axis]-instances[body+axis]),0);
    if(mag>=0)drop=-height(mag)-(pistol?.136:.141);
    grip=pistol&&onScreen(right)&&onScreen(left)&&height(right)>-.096&&height(left)>-.096;
   }
   samples.frames.push({weapon,ammo,reload,drop,fresh,grip,hand:hand>=0,visible:onScreen(hand)&&onScreen(mag),cues:samples.cues.splice(0)});
   if(samples.frames.length>500)samples.frames.shift();
   const key=`${weapon}-${fresh?'insert':'remove'}`;
   if(reload>0&&drop>.085&&onScreen(hand)&&onScreen(mag)&&!samples.images[key])samples.images[key]=document.querySelector('canvas').toDataURL('image/png');
  };
 });
 const select=async weapon=>{
  await page.keyboard.press(weapon===1?'Digit2':'Digit1');
  return playerWhen(p=>p.weapon===weapon&&p.equip===0);
 };
 const spend=async weapon=>{
  const before=await select(weapon);
  await page.mouse.down();await playerWhen(p=>p.weapon===weapon&&p.shot>before.shot);await page.mouse.up();
  return playerWhen(p=>p.weapon===weapon&&p.shot>before.shot);
 };
 for(const [weapon,full] of [[0,24],[1,12]]){
  await page.evaluate(()=>{window.__heard=[];});
  const fired=await spend(weapon);
  expect(fired.shotWeapon).toBe(weapon);
  const shotSound=weapon===1?4:0;
  await expect.poll(()=>page.evaluate(kind=>window.__heard.some(s=>s.kind===kind&&s.peak>.05),shotSound)).toBe(true);
  const duration=await page.evaluate(kind=>window.__heard.find(s=>s.kind===kind).duration,shotSound);
  expect(duration).toBeCloseTo(weapon===1?.135:.24,2);
  if(weapon===1){
   await expect.poll(()=>page.evaluate(()=>window.__reload.frames.at(-1)?.grip)).toBe(true);
   await page.screenshot({path:`work/pistol-grip-${forceWebGL?'webgl':'auto'}.png`});
  }
  await page.evaluate(()=>{window.__reload.frames=[];window.__heard=[];});
  await page.keyboard.press('KeyR');await playerWhen(p=>p.weapon===weapon&&p.reload>0);
  await playerWhen(p=>p.weapon===weapon&&p.reload===0&&p.ammo===full&&p.reloads===fired.reloads+1);
  await expect.poll(()=>page.evaluate(([weapon,full])=>window.__reload.frames.some(f=>f.weapon===weapon&&f.ammo===full&&f.reload===0&&f.drop!==null&&Math.abs(f.drop)<.01),[weapon,full])).toBe(true);
  const {frames,images}=await page.evaluate(()=>window.__reload);
  const active=frames.filter(f=>f.weapon===weapon&&f.reload>0);
  expect(active.every(f=>f.ammo<full)).toBe(true);
  expect(active.some(f=>f.hand&&f.drop>.085&&!f.fresh&&f.visible)).toBe(true);
  expect(active.some(f=>f.hand&&f.drop===null)).toBe(true);
  expect(active.some(f=>f.hand&&f.drop>.085&&f.fresh&&f.visible)).toBe(true);
  const release=frames.filter(f=>f.cues.includes(5)),seat=frames.filter(f=>f.cues.includes(6));
  expect(release).toHaveLength(1);expect(seat).toHaveLength(1);
  expect(release[0]).toMatchObject({fresh:false,hand:true});expect(release[0].drop).toBeGreaterThan(.12);
  expect(seat[0]).toMatchObject({reload:0,ammo:full});expect(Math.abs(seat[0].drop)).toBeLessThan(.01);
  expect(await page.evaluate(()=>window.__heard.filter(s=>s.kind===5||s.kind===6).map(s=>s.kind))).toEqual([5,6]);
  for(const phase of ['remove','insert']){
   const image=images[`${weapon}-${phase}`];
   if(image)await writeFile(`work/reload-${weapon}-${phase}-${forceWebGL?'webgl':'auto'}.png`,Buffer.from(image.split(',')[1],'base64'));
  }
 }

 if(!forceWebGL){
  const before=await spend(0);
  await page.evaluate(()=>{window.__heard=[];});
  await page.keyboard.press('KeyR');await playerWhen(p=>p.weapon===0&&p.reload>0);
  await page.mouse.down();
  await playerWhen(p=>p.weapon===0&&p.reloads===before.reloads+1&&p.shot>before.shot);
  await page.mouse.up();
  const cues=await page.evaluate(()=>window.__heard.map(s=>s.kind));
  expect(cues.slice(0,3)).toEqual([5,6,0]);
 }

 const beforeCancel=await spend(0);
 await page.evaluate(()=>{window.__heard=[];});
 await page.keyboard.press('KeyR');await playerWhen(p=>p.weapon===0&&p.reload>0);
 await expect.poll(()=>page.evaluate(()=>window.__heard.some(s=>s.kind===5))).toBe(true);
 await page.keyboard.press('Digit2');
 const changed=await playerWhen(p=>p.weapon===1&&p.reload===0);
 expect(changed.rifleAmmo).toBe(beforeCancel.rifleAmmo);
 expect(changed.reloads).toBe(beforeCancel.reloads);
 await expect.poll(()=>page.evaluate(()=>{const f=window.__reload.frames.at(-1);return f.weapon===1&&!f.hand&&!f.fresh;})).toBe(true);
 await select(0);await page.waitForTimeout(850);
 expect(c.state.players.find(p=>p.id===id)).toMatchObject({weapon:0,reload:0,rifleAmmo:beforeCancel.rifleAmmo});
 expect(await page.evaluate(()=>window.__heard.filter(s=>s.kind===5||s.kind===6).map(s=>s.kind))).toEqual([5]);
 await page.keyboard.press('Escape');await page.locator('#mute').check();
 await page.evaluate(()=>CY.feedback(0));
 expect(await page.evaluate(()=>window.__heard.filter(s=>s.kind===0))).toEqual([]);
 await page.locator('#leave').click();expect(c.errors).toEqual([]);
});

test('rifle model and camera recoil agree with authoritative burst traces',async({page,baseURL})=>{
 const c=observe(page);await enter(page,'QA_RECOIL');await c.wait(m=>m.type==='state');const id=c.welcome.id;
 const other=await publicPeer(baseURL,c.welcome.room,'QA_SIDEARM_MODEL');
 try{
  other.input({weapon:1});
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===other.id&&p.weapon===1));
  await page.locator('#resume').click();await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
  await page.evaluate(()=>{
   window.__gun={pitch:0,rifle:false,remotePistol:false};
   const draw=CY.renderer.draw.bind(CY.renderer);
   CY.renderer.draw=(matrix,instances,eye,fx)=>{
    draw(matrix,instances,eye,fx);
    const parts=(x,y,z)=>instances.some((v,i)=>i%11===3&&Math.abs(v-x)<.0003&&Math.abs(instances[i+1]-y)<.0003&&Math.abs(instances[i+2]-z)<.0003);
    window.__gun.pitch=Math.asin(matrix[7]);
    window.__gun.rifle=parts(.104,.177,.115)&&parts(.125,.14,.041)&&parts(.017,.042,.031);
    window.__gun.remotePistol=parts(.112*.82,.083*.82,.295*.82);
   };
  });
  await expect.poll(()=>page.evaluate(()=>window.__gun.rifle&&window.__gun.remotePistol)).toBe(true);
  await page.screenshot({path:'work/weapon-rifle.png'});
  const shotPitch=p=>Math.atan2(p.trace[1]-p.y-1.6,Math.hypot(p.trace[0]-p.x,p.trace[2]-p.z));
  const shot=async n=>(await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.shot===n))).players.find(p=>p.id===id);
  await page.mouse.down();const first=await shot(1),second=await shot(2),third=await shot(3),eighth=await shot(8);
  expect(shotPitch(first)).toBeCloseTo(first.pitch,4);
  expect(shotPitch(second)).toBeGreaterThan(second.pitch+.006);
  expect(shotPitch(third)).toBeGreaterThan(shotPitch(second));
  expect(third.recoil).toBeGreaterThan(first.recoil);
  expect(eighth.recoilHeld).toBe(true);
  expect(eighth.recoil).toBeCloseTo(.18,3);
  expect(shotPitch(eighth)-shotPitch(first)).toBeGreaterThan(.15);
  await expect.poll(()=>page.evaluate(()=>window.__gun.pitch)).toBeGreaterThan(.15);
  await page.mouse.up();
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&!p.recoilHeld));
  await expect.poll(()=>page.evaluate(()=>Math.abs(window.__gun.pitch))).toBeLessThan(.003);
  await page.keyboard.press('Escape');await page.locator('#leave').click();expect(c.errors).toEqual([]);
 }finally{other.close();}
});

test('C toggle synchronizes actual stance, eye height and remote model through public sockets',async({page,baseURL})=>{
 const c=observe(page);await enter(page,'QA_CROUCH');await c.wait(m=>m.type==='state');const id=c.welcome.id;
 const peer=await publicPeer(baseURL,c.welcome.room,'QA_STANCE_PEER');let timer;
 try{
  timer=setInterval(()=>peer.input({forward:1,yaw:-Math.PI/2,sprint:true}),50);
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===peer.id&&p.x<-6));clearInterval(timer);timer=null;peer.input({yaw:-Math.PI/2});
  const other=c.state.players.find(p=>p.id===peer.id);
  await page.evaluate(p=>{window.__stanceEye=0;window.__remoteTop=0;const draw=CY.renderer.draw.bind(CY.renderer);CY.renderer.draw=(...args)=>{draw(...args);window.__stanceEye=args[2][1];let top=0;const d=args[1];for(let i=0;i<d.length;i+=11)if(Math.abs(d[i]-p.x)<.8&&Math.abs(d[i+2]-p.z)<.8)top=Math.max(top,d[i+1]+d[i+4]/2);window.__remoteTop=top;};},other);
  const button=await page.locator('#resume').boundingBox();await page.bringToFront();await page.locator('#resume').click();await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
  const me=c.state.players.find(p=>p.id===id),wanted=Math.atan2(other.x-me.x,-(other.z-me.z));await page.mouse.move(button.x+button.width/2+(wanted-me.yaw)/.0022,button.y+button.height/2);
  await page.keyboard.down('KeyC');
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.crouch),1200).catch(()=>{throw Error('missing authoritative crouch action');});
  await expect(page.locator('#stance-state')).toHaveText('앉음');await expect.poll(()=>page.evaluate(()=>window.__stanceEye)).toBeLessThan(1.05);
  await page.keyboard.down('KeyC');await page.waitForTimeout(100);expect(c.state.players.find(p=>p.id===id).crouch).toBe(true);await page.keyboard.up('KeyC');
  await expect.poll(()=>page.evaluate(()=>window.__remoteTop)).toBeGreaterThan(1.7);peer.input({yaw:-Math.PI/2,crouch:true});
  await peer.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.crouch)&&m.players.some(p=>p.id===peer.id&&p.crouch));
  await expect.poll(()=>page.evaluate(()=>window.__remoteTop)).toBeLessThan(1.12);expect(await page.evaluate(()=>window.__remoteTop)).toBeGreaterThan(.9);
  await page.screenshot({path:'work/actions-crouch-remote.png'});
  await page.keyboard.press('KeyC');await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&!p.crouch));await expect(page.locator('#stance-state')).toHaveText('서 있음');await expect.poll(()=>page.evaluate(()=>window.__stanceEye)).toBeGreaterThan(1.5);
  await page.keyboard.press('Escape');await page.locator('#leave').click();expect(c.errors).toEqual([]);
 }finally{clearInterval(timer);peer.close();}
});

for(const [reducedMotion,forceWebGL] of [['reduce',false],['no-preference',false],['reduce',true]])test(`Digit2 selects a semi-auto pistol with independent ammo and visible feedback (${reducedMotion}${forceWebGL?'/WebGL2':''})`,async({browser})=>{
 const context=await browser.newContext({reducedMotion,viewport:{width:1440,height:900}});if(forceWebGL)await context.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
 const page=await context.newPage(),c=observe(page),scenario=reducedMotion+(forceWebGL?'-webgl':'');
 try{
  await enter(page,'QA_PISTOL');await c.wait(m=>m.type==='state');const id=c.welcome.id;
  await page.bringToFront();await page.locator('#resume').click();await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
  await page.keyboard.press('Digit2');await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.weapon===1),1200).catch(()=>{throw Error('missing authoritative pistol selection');});
  await expect(page.locator('#weapon-name')).toHaveText('권총 / 12');await expect(page.locator('#weapon-slot-1')).toHaveAttribute('aria-current','true');
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.equip===0&&p.weapon===1));
  await page.evaluate(()=>{
   window.__pistolFlash=0;window.__pistolShot=null;window.__slide={rest:null,back:0};
   const hud=CY.hud;CY.hud=s=>{hud(s);window.__pistolFlash=s.flash;};
   const draw=CY.renderer.draw.bind(CY.renderer);CY.renderer.draw=(matrix,instances,eye,fx)=>{
    draw(matrix,instances,eye,fx);let slide=-1,body=-1;
    for(let i=0;i<instances.length;i+=11){
     if(Math.abs(instances[i+3]-.112)<.0003&&Math.abs(instances[i+5]-.295)<.0003)slide=i;
     if(Math.abs(instances[i+3]-.106)<.0003&&Math.abs(instances[i+5]-.233)<.0003)body=i;
    }
    if(slide>=0&&body>=0){
     const y=instances[slide+9],p=instances[slide+10];
     const forward=[Math.sin(y)*Math.cos(p),Math.sin(p),-Math.cos(y)*Math.cos(p)];
     const relative=forward.reduce((sum,value,axis)=>sum+value*(instances[slide+axis]-instances[body+axis]),0);
     if(!window.__pistolFlash)window.__slide.rest=relative;
     else window.__slide.back=Math.max(window.__slide.back,window.__slide.rest-relative);
    }
    if(window.__pistolFlash>0&&!window.__pistolShot)window.__pistolShot=document.querySelector('canvas').toDataURL('image/png');
   };
  });
  await expect.poll(()=>page.evaluate(()=>window.__slide.rest)).not.toBeNull();
  await page.mouse.down();const fired=await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.weapon===1&&p.ammo===11));
  expect(fired.players.find(p=>p.id===id).recoil).toBeGreaterThan(.024);await page.waitForTimeout(400);
  expect(c.state.players.find(p=>p.id===id)).toMatchObject({ammo:11,pistolAmmo:11,rifleAmmo:24});await page.mouse.up();
  expect(await page.evaluate(()=>window.__slide.back)).toBeGreaterThan(.025);
  await expect.poll(()=>page.evaluate(()=>!!window.__pistolShot)).toBe(true);const image=await page.evaluate(()=>window.__pistolShot);await writeFile(`work/actions-pistol-shot-${scenario}.png`,Buffer.from(image.split(',')[1],'base64'));
  await page.mouse.click(720,450);await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.ammo===10),1500).catch(()=>{const changes=c.inputs.filter((p,i,a)=>!i||p.fire!==a[i-1].fire);console.log('Pistol brief-click observation',JSON.stringify({player:c.state.players.find(p=>p.id===id),changes}));throw Error('missing brief second pistol click');});
  await page.keyboard.press('Digit1');await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.weapon===0&&p.ammo===24));await expect(page.locator('#weapon-name')).toHaveText('소총 / 24');
  await page.keyboard.press('Digit2');await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.weapon===1&&p.equip===0&&p.ammo===10));
  await page.keyboard.press('KeyR');await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.weapon===1&&p.reload>0));
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.reload===0&&p.ammo===12&&p.weapon===1));await page.screenshot({path:`work/actions-pistol-${scenario}.png`});
  await page.keyboard.press('Escape');await expect(page.locator('#pause')).toBeVisible();await page.waitForTimeout(100);expect(c.state.players.find(p=>p.id===id).weapon).toBe(1);
  await page.locator('#leave').click();expect(c.errors).toEqual([]);
 }finally{await context.close();}
});

for(const [reducedMotion,forceWebGL] of [['reduce',false],['no-preference',false],['reduce',true]])test(`E edge renders authoritative grenade flight and blast with four-peer agreement (${reducedMotion}${forceWebGL?'/WebGL2':''})`,async({browser,baseURL})=>{
 const context=await browser.newContext({reducedMotion,viewport:{width:1440,height:900}});if(forceWebGL)await context.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
 const page=await context.newPage(),c=observe(page),peers=[],scenario=reducedMotion+(forceWebGL?'-webgl':'');
 try{
  await enter(page,'QA_GRENADE');await c.wait(m=>m.type==='state');const id=c.welcome.id;
  for(let i=0;i<3;i++)peers.push(await publicPeer(baseURL,c.welcome.room,`QA_OBSERVER_${i}`));await c.wait(m=>m.type==='state'&&m.players.length===4);
  const button=await page.locator('#resume').boundingBox();await page.bringToFront();expect(await page.evaluate(()=>document.visibilityState)).toBe('visible');await page.locator('#resume').click();await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
  await page.keyboard.press('Space');await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.y>.1&&!p.grounded));await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.grounded&&p.y===0));
  await page.keyboard.press('KeyC');await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.crouch));await expect(page.locator('#stance-state')).toHaveText('앉음');
  await page.mouse.move(button.x+button.width/2,button.y+button.height/2+1.15/.0022);await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.pitch<-1.1));
  await page.evaluate(()=>{window.__grenadeFlight=null;window.__grenadeBlast=null;window.__grenadeNearClip=false;window.__blastSounds=0;const feedback=CY.feedback;CY.feedback=k=>{feedback(k);if(k===3)window.__blastSounds++;};const draw=CY.renderer.draw.bind(CY.renderer);CY.renderer.draw=(...args)=>{draw(...args);let flight=false,blast=false;const d=args[1];for(let i=0;i<d.length;i+=11)if(Math.abs(d[i+3]-.22)<.001&&Math.abs(d[i+6]-.32)<.001&&Math.abs(d[i+7]-.42)<.001&&Math.hypot(d[i]-args[2][0],d[i+1]-args[2][1],d[i+2]-args[2][2])<.499)window.__grenadeNearClip=true;for(let i=0;i<d.length;i+=11)if(d[i+6]>1.7&&d[i+7]>1.3&&d[i+8]<.4){if(d[i+4]<.1)flight=true;if(d[i+4]>.3)blast=true;}if(flight&&!window.__grenadeFlight)window.__grenadeFlight=document.querySelector('canvas').toDataURL('image/png');if(blast&&!window.__grenadeBlast)window.__grenadeBlast=document.querySelector('canvas').toDataURL('image/png');};});
  await expect(page.locator('#grenade-label kbd')).toHaveText('E');
  await page.keyboard.press('KeyG');await page.waitForTimeout(100);
  await expect(page.locator('#grenade-count')).toHaveText('1');expect(c.inputs.some(p=>p.grenade)).toBe(false);
  await page.keyboard.down('KeyE');const flying=await c.wait(m=>m.type==='state'&&m.grenades.some(g=>g.owner===id&&!g.exploding),1200).catch(()=>{throw Error('missing authoritative grenade throw');});const projectile=flying.grenades.find(g=>g.owner===id);
  const firstStates=await Promise.all(peers.map(p=>p.wait(m=>m.type==='state'&&m.time===flying.time)));for(const state of firstStates){expect(state.grenades).toEqual(flying.grenades);expect(state.players).toEqual(flying.players);}
  await expect(page.locator('#grenade-count')).toHaveText('0');await expect.poll(()=>page.evaluate(()=>!!window.__grenadeFlight)).toBe(true);expect(await page.evaluate(()=>window.__grenadeNearClip),'grenade camera-near clipping').toBe(false);let image=await page.evaluate(()=>window.__grenadeFlight);await writeFile(`work/actions-grenade-flight-${scenario}.png`,Buffer.from(image.split(',')[1],'base64'));
  await page.mouse.move(button.x+button.width/2,button.y+button.height/2+.45/.0022);
  const blast=await c.wait(m=>m.type==='state'&&m.grenades.some(g=>g.id===projectile.id&&g.exploding)&&m.players.some(p=>p.id===id&&p.hp>0&&p.hp<100));
  const blastStates=await Promise.all(peers.map(p=>p.wait(m=>m.type==='state'&&m.time===blast.time)));for(const state of blastStates){expect(state.grenades).toEqual(blast.grenades);expect(state.players).toEqual(blast.players);}
  await expect.poll(()=>page.evaluate(()=>!!window.__grenadeBlast)).toBe(true);image=await page.evaluate(()=>window.__grenadeBlast);await writeFile(`work/actions-grenade-blast-${scenario}.png`,Buffer.from(image.split(',')[1],'base64'));expect(await page.evaluate(()=>window.__blastSounds)).toBe(1);
  await c.wait(m=>m.type==='state'&&m.grenades.length===0);expect(c.state.players.find(p=>p.id===id).grenadeCount).toBe(0);expect(c.inputs.filter(p=>p.grenade)).toHaveLength(1);await page.keyboard.up('KeyE');
  await page.screenshot({path:`work/actions-grenade-after-${scenario}.png`});
  await page.keyboard.press('KeyC');await page.mouse.move(button.x+button.width/2,button.y+button.height/2);await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&!p.crouch&&Math.abs(p.pitch)<.02));
  await page.keyboard.press('KeyE');await page.waitForTimeout(150);expect(c.state.grenades).toHaveLength(0);await expect(page.locator('#grenade-count')).toHaveText('0');
  await page.keyboard.press('Escape');await page.locator('#leave').click();await Promise.all(peers.map(p=>p.wait(m=>m.type==='state'&&m.players.length===3&&!m.grenades.some(g=>g.owner===id))));expect(c.errors).toEqual([]);
  console.log('Observed four-peer grenade agreement',JSON.stringify({scenario,id,projectile:projectile.id,blastTime:blast.time,selfHp:blast.players.find(p=>p.id===id).hp,observers:peers.map(p=>p.id)}));
 }finally{for(const peer of peers)peer.close();await context.close();}
});
