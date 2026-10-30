#include "arena.hpp"
#include "camera.hpp"
#include <emscripten.h>
#include <emscripten/html5.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <vector>

// Browser API access is restricted to these platform calls. All scene transforms,
// camera, movement prediction, player models and input state are authored in C++.
EM_JS(void, draw_platform,(const float* matrix,const float* data,int length,float x,float y,float z),{
 globalThis.CY.renderer.draw(HEAPF32.subarray(matrix>>2,(matrix>>2)+16),HEAPF32.subarray(data>>2,(data>>2)+length),new Float32Array([x,y,z]));
});
EM_JS(void, send_platform,(float f,float s,float yaw,float pitch,int fire,int reload,int sprint,unsigned seq,int jump),{
 // Float32 endpoints can lie a few ulps outside the JSON double contract.
 // Bound the producer's encoding; keep server validation strict.
 globalThis.CY.sendInput({type:'input',seq:seq,forward:f,strafe:s,yaw:Math.max(-Math.PI,Math.min(Math.PI,yaw)),pitch:Math.max(-1.45,Math.min(1.45,pitch)),fire:!!fire,reload:!!reload,sprint:!!sprint,jump:!!jump,crouch:false,weapon:0,grenade:false});
});
EM_JS(void, lock_platform,(int locked),{globalThis.CY.lockChanged(!!locked);});
EM_JS(void, lock_error_platform,(),{globalThis.CY.lockError();});
EM_JS(void, feedback_platform,(int kind),{globalThis.CY.feedback(kind);});
EM_JS(void, hud_platform,(int hp,int ammo,float reload,float respawn,int kills,int deaths,float heading,float hit,float damage,float flash,float shield,int ads),{
 globalThis.CY.hud({hp:hp,ammo:ammo,reload:reload,respawn:respawn,kills:kills,deaths:deaths,heading:heading,hit:hit,damage:damage,flash:flash,shield:shield,ads:!!ads});
});
EM_JS(double, canvas_aspect,(),{const c=document.getElementById('game');return Math.max(1,c.clientWidth)/Math.max(1,c.clientHeight);});

namespace {
using arena::Vec3;
struct Remote {
 bool active=false,seen=false,seeded=false;
 Vec3 target{},position{},trace{};
 float yaw=0,pitch=0,reload=0,respawn=0,shield=0,flash=0;
 int hp=100,ammo=24,kills=0,deaths=0;
 unsigned shot=0,hit=0,damage=0,ack=0;
};
std::array<Remote,arena::kCapacity> peers{};
std::vector<float> instances;
int mine=-1;
bool locked=false,fire=false,ads=false,reload_pressed=false,reduced=false;
bool key_w=false,key_a=false,key_s=false,key_d=false,key_shift=false;
bool jump_pressed=false,jump_predict=false,grounded=true,crouching=false;
float vertical_velocity=0;
float yaw=0,pitch=0,sensitivity=.0022f,hit_time=0,damage_time=0;
Vec3 position{};
unsigned sequence=0;
double previous_time=0,next_input=0;

Vec3 plus(Vec3 a,Vec3 b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
Vec3 scale(Vec3 a,float f){return {a.x*f,a.y*f,a.z*f};}
float distance2(Vec3 a,Vec3 b){return (a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y)+(a.z-b.z)*(a.z-b.z);}
float wrap(float angle){while(angle>arena::kPi)angle-=2*arena::kPi;while(angle<-arena::kPi)angle+=2*arena::kPi;return angle;}
void clear_controls(){key_w=key_a=key_s=key_d=key_shift=fire=ads=reload_pressed=jump_pressed=jump_predict=false;}
void send_controls(){
 if(mine<0)return;
 const bool alive=peers[mine].active&&peers[mine].hp>0;
 send_platform(locked&&alive?float(key_w)-float(key_s):0,locked&&alive?float(key_d)-float(key_a):0,yaw,pitch,locked&&alive&&fire,locked&&alive&&reload_pressed,locked&&alive&&key_shift,++sequence,locked&&alive&&jump_pressed);
 reload_pressed=jump_pressed=false;
}
void add_box(Vec3 p,Vec3 size,Vec3 color,float y=0,float t=0){
 instances.insert(instances.end(),{p.x,p.y,p.z,size.x,size.y,size.z,color.x,color.y,color.z,y,t});
}
Vec3 camera_point(Vec3 eye,Vec3 f,Vec3 r,Vec3 u,float x,float y,float ahead){return plus(eye,plus(scale(r,x),plus(scale(u,y),scale(f,ahead))));}
void beam(Vec3 a,Vec3 b,Vec3 color){
 const auto d=Vec3{b.x-a.x,b.y-a.y,b.z-a.z};const float length=std::sqrt(client::dot(d,d));if(length<.01f)return;
 add_box(scale(plus(a,b),.5f),{.024f,.024f,length},color,std::atan2(d.x,-d.z),std::asin(d.y/length));
}
void player_model(int id,const Remote& p){
 const Vec3 colors[]={{.96f,.40f,.20f},{.19f,.57f,.63f},{.72f,.73f,.35f},{.55f,.39f,.65f}};
 const auto color=p.shield>0?Vec3{.79f,.91f,.69f}:colors[id];
 const auto right=client::right(p.yaw),forward=client::forward(p.yaw,p.pitch);
 add_box(plus(p.position,{0,.88f,0}),{.62f,.80f,.35f},color,p.yaw);
 add_box(plus(p.position,{0,1.47f,0}),{.34f,.33f,.34f},{.70f,.58f,.43f},p.yaw);
 add_box(plus(p.position,{0,1.67f,0}),{.41f,.20f,.41f},{.22f,.29f,.25f},p.yaw);
 for(float s:{-1.f,1.f})add_box(plus(p.position,plus(scale(right,.17f*s),{0,.28f,0})),{.23f,.55f,.28f},{.21f,.27f,.23f},p.yaw);
 const Vec3 weapon=plus(p.position,plus(Vec3{0,1.2f,0},scale(forward,.45f)));
 add_box(weapon,{.12f,.13f,.65f},{.14f,.19f,.18f},p.yaw,p.pitch);
 add_box(plus(p.position,{0,.012f,0}),{.85f,.018f,.85f},{.28f,.34f,.30f});
 if(p.flash>0){const auto muzzle=plus(weapon,scale(forward,.4f));add_box(muzzle,{.13f,.13f,.20f},{2.5f,1.6f,.3f},p.yaw,p.pitch);beam(muzzle,p.trace,{1.9f,1.3f,.3f});}
}
void frame(){
 const double now=emscripten_get_now();
 const float dt=std::clamp(float((now-previous_time)/1000.0),0.f,.05f);previous_time=now;
 hit_time=std::max(0.f,hit_time-dt);damage_time=std::max(0.f,damage_time-dt);
 for(auto& p:peers){p.flash=std::max(0.f,p.flash-dt);p.reload=std::max(0.f,p.reload-dt*1000);p.respawn=std::max(0.f,p.respawn-dt*1000);p.shield=std::max(0.f,p.shield-dt*1000);}
 Vec3 eye{};float camera_yaw=0,camera_pitch=0,fov=70;
 if(mine>=0){
  auto& me=peers[mine];
  if(me.hp>0&&dt>0){
   arena::Input input;input.forward=locked?float(key_w)-float(key_s):0;input.strafe=locked?float(key_d)-float(key_a):0;input.yaw=yaw;input.sprint=locked&&key_shift;input.jump=locked&&jump_predict;
   const auto motion=arena::step_motion({position,vertical_velocity,grounded,crouching},input,dt);
   position=motion.position;vertical_velocity=motion.vertical_velocity;grounded=motion.grounded;crouching=motion.crouching;jump_predict=false;
  }
  eye=plus(position,{0,arena::kEyeHeight,0});camera_yaw=yaw;camera_pitch=pitch;
  if(!reduced&&me.flash>0)camera_pitch+=me.flash*.07f;
  fov=ads?49.f:70.f;
  if(now>=next_input){send_controls();next_input=now+1000.0/30.0;}
  hud_platform(me.hp,me.ammo,me.reload,me.respawn,me.kills,me.deaths,std::fmod(yaw*180.f/arena::kPi+360.f,360.f),hit_time,damage_time,me.flash,me.shield,ads);
 } else {
  const float orbit=.76f+(reduced?0:std::sin(float(now)*.000025f)*.06f);
  eye={std::sin(orbit)*44.f,22.f,std::cos(orbit)*44.f};camera_yaw=-orbit;camera_pitch=-.42f;fov=62.f;
 }
 instances.clear();
 for(const auto& b:arena::world_boxes())add_box({b.x,b.y,b.z},{b.sx,b.sy,b.sz},{b.r,b.g,b.b});
 // Low, non-colliding markings keep lanes legible without an external texture.
 for(int i=-20;i<=20;i+=4){add_box({float(i),.012f,-15},{1.8f,.018f,.10f},{.88f,.86f,.60f});add_box({15,.012f,float(i)},{.10f,.018f,1.8f},{.88f,.86f,.60f});}
 for(int id=0;id<arena::kCapacity;++id){auto& p=peers[id];if(!p.active||p.hp<=0||id==mine)continue;
  const float a=1-std::exp(-dt*14.f);p.position=plus(p.position,scale({p.target.x-p.position.x,p.target.y-p.position.y,p.target.z-p.position.z},a));player_model(id,p);
 }
 if(mine>=0&&peers[mine].hp>0){
  const auto& me=peers[mine];const auto f=client::forward(camera_yaw,camera_pitch),r=client::right(camera_yaw),u=client::up(camera_yaw,camera_pitch);
  const float sway=!reduced&&locked&&(key_w||key_a||key_s||key_d)?std::sin(float(now)*.011f)*.012f:0;
  const float x=ads?.045f:.30f,y=ads?-.19f:-.29f;
  const float kick=reduced?0:me.flash*.65f;
  const auto gun=camera_point(eye,f,r,u,x,y+sway,.61f-kick);
  add_box(gun,{.14f,.15f,.46f},{.12f,.16f,.15f},yaw,camera_pitch);
  add_box(plus(gun,scale(u,.10f)),{.065f,.07f,.15f},{.055f,.08f,.07f},yaw,camera_pitch);
  add_box(plus(gun,scale(f,.33f)),{.045f,.045f,.31f},{.21f,.25f,.23f},yaw,camera_pitch);
  add_box(plus(gun,plus(scale(f,-.13f),scale(u,-.12f))),{.08f,.23f,.10f},{.21f,.27f,.23f},yaw,camera_pitch-.18f);
  add_box(plus(gun,plus(scale(f,.09f),scale(u,-.08f))),{.17f,.10f,.17f},{.52f,.44f,.31f},yaw,camera_pitch);
  if(me.flash>0){
   const auto muzzle=plus(gun,scale(f,.52f));add_box(muzzle,{.15f,.15f,.25f},{2.6f,1.7f,.35f},yaw,camera_pitch);
   beam(muzzle,me.trace,{2.f,1.4f,.35f});
  }
 }
 const auto matrix=client::multiply(client::perspective(fov,float(canvas_aspect()),.035f,155.f),client::view(eye,camera_yaw,camera_pitch));
 draw_platform(matrix.data(),instances.data(),int(instances.size()),eye.x,eye.y,eye.z);
}
EM_BOOL key_event(int type,const EmscriptenKeyboardEvent* event,void*){
 const bool down=type==EMSCRIPTEN_EVENT_KEYDOWN;
 if(!locked&&down)return EM_FALSE;
 if(down&&std::strcmp(event->code,"Escape")==0){clear_controls();send_controls();emscripten_exit_pointerlock();return EM_TRUE;}
 bool* key=nullptr;
 if(std::strcmp(event->code,"KeyW")==0)key=&key_w;
 if(std::strcmp(event->code,"KeyA")==0)key=&key_a;
 if(std::strcmp(event->code,"KeyS")==0)key=&key_s;
 if(std::strcmp(event->code,"KeyD")==0)key=&key_d;
 if(std::strcmp(event->code,"ShiftLeft")==0||std::strcmp(event->code,"ShiftRight")==0)key=&key_shift;
 if(key){*key=down;return locked?EM_TRUE:EM_FALSE;}
 if(locked&&down&&!event->repeat&&std::strcmp(event->code,"KeyR")==0){reload_pressed=true;return EM_TRUE;}
 if(locked&&down&&!event->repeat&&std::strcmp(event->code,"Space")==0){jump_pressed=jump_predict=true;return EM_TRUE;}
 return EM_FALSE;
}
EM_BOOL mouse_move(int,const EmscriptenMouseEvent* event,void*){
 if(!locked)return EM_FALSE;
 yaw=wrap(yaw+float(event->movementX)*sensitivity*(ads?.65f:1.f));pitch=std::clamp(pitch-float(event->movementY)*sensitivity*(ads?.65f:1.f),-1.45f,1.45f);return EM_TRUE;
}
EM_BOOL mouse_button(int type,const EmscriptenMouseEvent* event,void*){
 const bool down=type==EMSCRIPTEN_EVENT_MOUSEDOWN;
 if(down&&!locked)return EM_FALSE;
 if(event->button==0)fire=down;
 if(event->button==2)ads=down;
 return locked?EM_TRUE:EM_FALSE;
}
EM_BOOL lock_change(int,const EmscriptenPointerlockChangeEvent* event,void*){
 locked=event->isActive;if(!locked){clear_controls();send_controls();}lock_platform(locked);return EM_TRUE;
}
EM_BOOL blur_event(int,const EmscriptenFocusEvent*,void*){clear_controls();send_controls();emscripten_exit_pointerlock();return EM_FALSE;}
EM_BOOL visibility_event(int,const EmscriptenVisibilityChangeEvent* event,void*){if(event->hidden){clear_controls();send_controls();emscripten_exit_pointerlock();}return EM_FALSE;}
}

extern "C" {
EMSCRIPTEN_KEEPALIVE void client_start(int slot){
 if(slot<0||slot>=arena::kCapacity)return;
 mine=slot;sequence=0;next_input=0;hit_time=damage_time=0;clear_controls();for(auto& p:peers)p=Remote{};
 position=arena::spawn_point(slot);yaw=arena::spawn_yaw(slot);pitch=0;vertical_velocity=0;grounded=true;crouching=false;
}
EMSCRIPTEN_KEEPALIVE void client_stop(){mine=-1;clear_controls();locked=false;emscripten_exit_pointerlock();for(auto& p:peers)p=Remote{};}
EMSCRIPTEN_KEEPALIVE void client_release(){clear_controls();send_controls();emscripten_exit_pointerlock();}
EMSCRIPTEN_KEEPALIVE void client_lock(){
 if(mine<0)return;
 const auto result=emscripten_request_pointerlock("#game",EM_FALSE);
 if(result!=EMSCRIPTEN_RESULT_SUCCESS&&result!=EMSCRIPTEN_RESULT_DEFERRED)lock_error_platform();
}
EMSCRIPTEN_KEEPALIVE void client_settings(float value,int reduce){sensitivity=std::clamp(value,.25f,3.f)*.0022f;reduced=reduce!=0;}
EMSCRIPTEN_KEEPALIVE void client_begin_state(){for(auto& p:peers)p.seen=false;}
EMSCRIPTEN_KEEPALIVE void client_player(int slot,float x,float y,float z,float server_yaw,float server_pitch,int hp,int ammo,int kills,int deaths,float reload,float respawn,float shield,unsigned shot,unsigned hit,unsigned damage,unsigned ack,float tx,float ty,float tz){
 if(slot<0||slot>=arena::kCapacity)return;
 auto& p=peers[slot];const bool first=!p.seeded,reborn=p.hp<=0&&hp>0;
 p.active=p.seen=true;p.target={x,y,z};
 if(first||reborn)p.position=p.target;
 if(slot==mine){
  if(first||reborn){position=p.target;yaw=server_yaw;pitch=server_pitch;clear_controls();}
  else {const float a=distance2(position,p.target)>4.f?1.f:.25f;position=plus(position,scale({x-position.x,y-position.y,z-position.z},a));}
  // Never replace local aim with an earlier authoritative snapshot.
  if(!first&&hit>p.hit){hit_time=.18f;feedback_platform(1);}
  if(!first&&damage>p.damage){damage_time=.28f;feedback_platform(2);}
  if(hp<=0)clear_controls();
 }
 if(!first&&shot>p.shot){p.flash=.095f;if(slot==mine)feedback_platform(0);}
 p.yaw=server_yaw;p.pitch=server_pitch;p.hp=hp;p.ammo=ammo;p.kills=kills;p.deaths=deaths;
 p.reload=reload;p.respawn=respawn;p.shield=shield;p.shot=shot;p.hit=hit;p.damage=damage;p.ack=ack;p.trace={tx,ty,tz};p.seeded=true;
}
EMSCRIPTEN_KEEPALIVE void client_motion(int slot,float vy,int on_ground,int crouch){
 if(slot==mine){vertical_velocity=vy;grounded=on_ground!=0;crouching=crouch!=0;}
}
EMSCRIPTEN_KEEPALIVE void client_end_state(){for(auto& p:peers)if(!p.seen){p.active=false;p.seeded=false;p.flash=0;}}
}
int main(){
 instances.reserve(4096*11);
 emscripten_set_keydown_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW,nullptr,EM_FALSE,key_event);
 emscripten_set_keyup_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW,nullptr,EM_FALSE,key_event);
 emscripten_set_mousemove_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT,nullptr,EM_FALSE,mouse_move);
 emscripten_set_mousedown_callback("#game",nullptr,EM_FALSE,mouse_button);
 emscripten_set_mouseup_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT,nullptr,EM_FALSE,mouse_button);
 emscripten_set_pointerlockchange_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT,nullptr,EM_FALSE,lock_change);
 emscripten_set_blur_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW,nullptr,EM_FALSE,blur_event);
 emscripten_set_visibilitychange_callback(nullptr,EM_FALSE,visibility_event);
 previous_time=emscripten_get_now();emscripten_set_main_loop(frame,0,1);return 0;
}
