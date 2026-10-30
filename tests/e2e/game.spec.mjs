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
  for(const width of [1440,768,375]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.querySelector('#lobby').scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`work/disconnect-${width}.png`});}
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
  const dx=victim.x-me.x,dz=victim.z-me.z,wantedYaw=Math.atan2(dx,-dz),wantedPitch=Math.atan2(-.35,Math.hypot(dx,dz));
  const button=await page.locator('#resume').boundingBox();await page.bringToFront();await page.locator('#resume').click();
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('game');
  await page.mouse.move(button.x+button.width/2+(wantedYaw-me.yaw)/.0022,button.y+button.height/2-wantedPitch/.0022);
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===me.id&&Math.abs(p.yaw-wantedYaw)<.008));
  await page.mouse.down();await expect(page.locator('#hitmarker')).toHaveClass(/active/);await page.screenshot({path:'work/browser-hit.png'});
  await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===other.id&&p.hp===0));await page.mouse.up();
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
 await page.evaluate(()=>{window.__jumpEye=0;const draw=CY.renderer.draw.bind(CY.renderer);CY.renderer.draw=(...args)=>{draw(...args);window.__jumpEye=Math.max(window.__jumpEye,args[2][1]);};});
 await page.keyboard.down('Space');
 await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.y>.12&&!p.grounded),1200).catch(()=>{throw Error('missing authoritative jump action');});
 expect(await page.evaluate(()=>window.__jumpEye)).toBeGreaterThan(1.7);await page.screenshot({path:'work/actions-jump.png'});
 await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.y===0&&p.grounded),2500);
 await page.waitForTimeout(200);expect(c.state.players.find(p=>p.id===id)).toMatchObject({y:0,grounded:true});expect(jumps).toHaveLength(1);
 await page.keyboard.up('Space');await page.keyboard.press('Escape');await page.locator('#leave').click();expect(c.errors).toEqual([]);
});

async function publicPeer(baseURL,room,name){
 const ws=new WebSocket(baseURL.replace('http:','ws:')+'/ws',{origin:baseURL}),events=new EventEmitter();let latest,welcome,seq=0;const history=[];
 ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.type==='state'){latest=m;history.push(m);if(history.length>64)history.shift();}if(m.type==='welcome')welcome=m;events.emit('data',m);});
 const wait=(predicate,timeout=6000)=>{for(const m of [latest,welcome,...history])if(m&&predicate(m))return Promise.resolve(m);return new Promise((resolve,reject)=>{const handler=m=>{if(predicate(m)){clearTimeout(timer);events.off('data',handler);resolve(m);}};const timer=setTimeout(()=>{events.off('data',handler);reject(Error('public peer state deadline'));},timeout);events.on('data',handler);});};
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.send(JSON.stringify({type:'join',name,code:room}));const joined=await wait(m=>m.type==='welcome');
 return {id:joined.id,wait,input(fields={}){ws.send(JSON.stringify({type:'input',seq:++seq,forward:0,strafe:0,yaw:0,pitch:0,fire:false,reload:false,sprint:false,jump:false,crouch:false,weapon:0,grenade:false,...fields}));},close(){ws.close();}};
}

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
  await page.evaluate(()=>{window.__pistolFlash=0;window.__pistolShot=null;const hud=CY.hud;CY.hud=s=>{hud(s);window.__pistolFlash=s.flash;};const draw=CY.renderer.draw.bind(CY.renderer);CY.renderer.draw=(...args)=>{draw(...args);if(window.__pistolFlash>0&&!window.__pistolShot)window.__pistolShot=document.querySelector('canvas').toDataURL('image/png');};});
  await page.mouse.down();await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.weapon===1&&p.ammo===11));await page.waitForTimeout(400);
  expect(c.state.players.find(p=>p.id===id)).toMatchObject({ammo:11,pistolAmmo:11,rifleAmmo:24});await page.mouse.up();
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

for(const [reducedMotion,forceWebGL] of [['reduce',false],['no-preference',false],['reduce',true]])test(`G edge renders authoritative grenade flight and blast with four-peer agreement (${reducedMotion}${forceWebGL?'/WebGL2':''})`,async({browser,baseURL})=>{
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
  await page.keyboard.down('KeyG');const flying=await c.wait(m=>m.type==='state'&&m.grenades.some(g=>g.owner===id&&!g.exploding),1200).catch(()=>{throw Error('missing authoritative grenade throw');});const projectile=flying.grenades.find(g=>g.owner===id);
  const firstStates=await Promise.all(peers.map(p=>p.wait(m=>m.type==='state'&&m.time===flying.time)));for(const state of firstStates){expect(state.grenades).toEqual(flying.grenades);expect(state.players).toEqual(flying.players);}
  await expect(page.locator('#grenade-count')).toHaveText('1');await expect.poll(()=>page.evaluate(()=>!!window.__grenadeFlight)).toBe(true);expect(await page.evaluate(()=>window.__grenadeNearClip),'grenade camera-near clipping').toBe(false);let image=await page.evaluate(()=>window.__grenadeFlight);await writeFile(`work/actions-grenade-flight-${scenario}.png`,Buffer.from(image.split(',')[1],'base64'));
  await page.mouse.move(button.x+button.width/2,button.y+button.height/2+.45/.0022);
  const blast=await c.wait(m=>m.type==='state'&&m.grenades.some(g=>g.id===projectile.id&&g.exploding)&&m.players.some(p=>p.id===id&&p.hp>0&&p.hp<100));
  const blastStates=await Promise.all(peers.map(p=>p.wait(m=>m.type==='state'&&m.time===blast.time)));for(const state of blastStates){expect(state.grenades).toEqual(blast.grenades);expect(state.players).toEqual(blast.players);}
  await expect.poll(()=>page.evaluate(()=>!!window.__grenadeBlast)).toBe(true);image=await page.evaluate(()=>window.__grenadeBlast);await writeFile(`work/actions-grenade-blast-${scenario}.png`,Buffer.from(image.split(',')[1],'base64'));expect(await page.evaluate(()=>window.__blastSounds)).toBe(1);
  await c.wait(m=>m.type==='state'&&m.grenades.length===0);expect(c.state.players.find(p=>p.id===id).grenadeCount).toBe(1);expect(c.inputs.filter(p=>p.grenade)).toHaveLength(1);await page.keyboard.up('KeyG');
  await page.screenshot({path:`work/actions-grenade-after-${scenario}.png`});
  await page.keyboard.press('KeyC');await page.mouse.move(button.x+button.width/2,button.y+button.height/2);await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&!p.crouch&&Math.abs(p.pitch)<.02));
  await page.keyboard.press('KeyG');await c.wait(m=>m.type==='state'&&m.players.some(p=>p.id===id&&p.grenadeCount===0)&&m.grenades.length===1);await expect(page.locator('#grenade-count')).toHaveText('0');
  await page.keyboard.press('KeyG');await page.waitForTimeout(150);expect(c.state.grenades).toHaveLength(1);expect(c.state.players.find(p=>p.id===id).grenadeCount).toBe(0);
  await page.keyboard.press('Escape');await page.locator('#leave').click();await Promise.all(peers.map(p=>p.wait(m=>m.type==='state'&&m.players.length===3&&!m.grenades.some(g=>g.owner===id))));expect(c.errors).toEqual([]);
  console.log('Observed four-peer grenade agreement',JSON.stringify({scenario,id,projectile:projectile.id,blastTime:blast.time,selfHp:blast.players.find(p=>p.id===id).hp,observers:peers.map(p=>p.id)}));
 }finally{for(const peer of peers)peer.close();await context.close();}
});
