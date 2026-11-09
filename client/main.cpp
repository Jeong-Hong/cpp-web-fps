#include "arena.hpp"
#include "../core/local_map.hpp"
#include "../core/mantle.hpp"
#include "camera.hpp"
#include "weapon_effects.hpp"
#include <emscripten.h>
#include <emscripten/html5.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <vector>

// Browser API access is restricted to these platform calls. All scene transforms,
// camera, movement prediction, player models and input state are authored in C++.
EM_JS(void, draw_platform,(const float* matrix,const float* data,int length,const void* fx,int fx_length,float x,float y,float z,float yaw,int in_room),{
 globalThis.CY.renderer.draw(HEAPF32.subarray(matrix>>2,(matrix>>2)+16),HEAPF32.subarray(data>>2,(data>>2)+length),new Float32Array([x,y,z]),HEAPF32.subarray(fx>>2,(fx>>2)+fx_length));
 if(in_room)globalThis.CY.drawMinimap?.(x,z,yaw);
});
EM_JS(void, world_platform,(const float* data,int length,const float* layers,int count,int map),{
 const geometry=HEAPF32.subarray(data>>2,(data>>2)+length);
 const materials=HEAPF32.subarray(layers>>2,(layers>>2)+count);
 globalThis.CY.renderer.setWorldMesh?.(geometry,materials,map);
});
EM_JS(void, minimap_platform,(const float* data,int length,int mesh,float min_x,float max_x,float min_z,float max_z),{
 const geometry=HEAPF32.subarray(data>>2,(data>>2)+length);
 globalThis.CY.setMinimap?.(geometry,mesh,[min_x,max_x,min_z,max_z]);
});
EM_JS(void, send_platform,(float f,float s,float yaw,float pitch,int fire,int reload,int sprint,unsigned seq,int jump,int crouch,int weapon,int grenade,int prone),{
 // Float32 endpoints can lie a few ulps outside the JSON double contract.
 // Bound the producer's encoding; keep server validation strict.
 globalThis.CY.sendInput({type:'input',seq:seq,forward:f,strafe:s,yaw:Math.max(-Math.PI,Math.min(Math.PI,yaw)),pitch:Math.max(-1.45,Math.min(1.45,pitch)),fire:!!fire,reload:!!reload,sprint:!!sprint,jump:!!jump,crouch:!!crouch,weapon:weapon,grenade:!!grenade,prone:!!prone});
});
EM_JS(void, lock_platform,(int locked),{globalThis.CY.lockChanged(!!locked);});
EM_JS(void, lock_error_platform,(),{globalThis.CY.lockError();});
EM_JS(void, feedback_platform,(int kind),{globalThis.CY.feedback(kind);});
EM_JS(void, teammate_platform,(int slot,float x,float y),{globalThis.CY.teammateLabel?.(slot,x,y);});
EM_JS(void, hud_platform,(int hp,int ammo,float reload,float respawn,int kills,int deaths,float heading,float hit,float damage,float flash,float shield,int ads,int on_ground,int crouch,int weapon,int grenades,float equip,int prone),{
 globalThis.CY.hud({hp:hp,ammo:ammo,reload:reload,respawn:respawn,kills:kills,deaths:deaths,heading:heading,hit:hit,damage:damage,flash:flash,shield:shield,ads:!!ads,grounded:!!on_ground,crouch:!!crouch,weapon:weapon,grenades:grenades,equip:equip,prone:!!prone});
});
EM_JS(double, canvas_aspect,(),{const c=document.getElementById('game');return Math.max(1,c.clientWidth)/Math.max(1,c.clientHeight);});

namespace {
using arena::Vec3;
using arena::MapId;
enum FeedbackSound { rifle_shot, hit_confirmed, took_damage, grenade_blast, pistol_shot, magazine_out, magazine_in };
MapId current_map=MapId::crossyard;
void append_box_mesh(const arena::Box& box,std::vector<float>& vertices,std::vector<float>& materials) {
 const float x0=box.x-box.sx/2,x1=box.x+box.sx/2,y0=box.y-box.sy/2,y1=box.y+box.sy/2,z0=box.z-box.sz/2,z1=box.z+box.sz/2;
 const Vec3 corners[]={{x0,y0,z0},{x0,y0,z1},{x0,y1,z0},{x0,y1,z1},{x1,y0,z0},{x1,y0,z1},{x1,y1,z0},{x1,y1,z1}};
 constexpr int faces[][4]={{4,6,7,5},{1,3,2,0},{3,7,6,2},{0,4,5,1},{5,7,3,1},{0,2,6,4}};
 constexpr Vec3 normals[]={{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
 // Retain the original ground, timber cover and painted industrial accents.
 const float layer=box.sx==48 && box.sz==48?1.f:
                   box.r>box.g+.07f?(box.g>box.b+.23f?3.f:2.f):0.f;
 for(int face=0;face<6;++face)for(int index:{0,1,2,0,2,3}) {
  const auto p=corners[faces[face][index]],n=normals[face];
  vertices.insert(vertices.end(),{p.x,p.y,p.z,n.x,n.y,n.z});
  materials.push_back(layer);
 }
}
void publish_world(MapId map) {
 std::vector<float> materials;
 if(map==MapId::crossyard){
  std::vector<float> mesh,footprints;
  for(const auto& box:arena::world_boxes()){
   append_box_mesh(box,mesh,materials);
   if(box.solid)footprints.insert(footprints.end(),{box.x,box.z,box.sx,box.sz});
  }
  world_platform(mesh.data(),int(mesh.size()),materials.data(),int(materials.size()),static_cast<int>(map));
  minimap_platform(footprints.data(),int(footprints.size()),0,-24,24,-24,24);
 }else{
  const auto mesh=arena::local_map::render_vertices(map,&materials);
  const auto [min_x,max_x,min_z,max_z]=arena::local_map::bounds(map);
  world_platform(mesh.data(),int(mesh.size()),materials.data(),int(materials.size()),static_cast<int>(map));
  minimap_platform(mesh.data(),int(mesh.size()),1,min_x,max_x,min_z,max_z);
 }
}
void set_map(MapId map) {
 if(map==current_map)return;
 publish_world(map);
 current_map=map;
}
struct Remote {
 bool active=false,seen=false,seeded=false,crouching=false,prone=false;
 bool reloading=false,reload_removed=false,reload_seat_pending=false,recoil_held=false;
 Vec3 target{},position{},trace{};
 float yaw=0,pitch=0,recoil=0,reload=0,reload_return=0,respawn=0,shield=0,flash=0,equip=0;
 int hp=100,ammo=24,kills=0,deaths=0,weapon=0,shot_weapon=0,grenades=arena::kGrenadesPerSpawn,team=-1;
 unsigned shot=0,ejections=0,reloads=0,hit=0,damage=0,ack=0;
 arena::MantleState mantle{};
 Vec3 mantle_server_start{};
 float mantle_sync=0;
};
std::array<Remote,arena::kCapacity> peers{};
struct VisualGrenade{bool active=false,seen=false,exploding=false;unsigned id=0;int owner=-1;Vec3 position{},target{};float explosion=0;};
// Keep old IDs reserved until end_state removes absent ones; an incoming
// snapshot can replace all authoritative slots before that reconciliation.
std::array<VisualGrenade,arena::kMaxGrenades*2> projectiles{};
std::vector<float> instances;
client::weapon_fx::Effects weapon_effects;
constexpr float kShotCycle=.095f;
int mine=-1,weapon_wanted=0;
bool locked=false,fire=false,ads=false,reload_pressed=false,reduced=false;
bool playing=true,combat=true;
bool key_w=false,key_a=false,key_s=false,key_d=false,key_shift=false;
bool jump_pressed=false,jump_predict=false,grenade_pressed=false,grounded=true,crouching=false,crouch_wanted=false;
bool prone=false,prone_wanted=false;
float vertical_velocity=0;
float yaw=0,pitch=0,sensitivity=.0022f,hit_time=0,damage_time=0;
Vec3 position{};
unsigned sequence=0;
unsigned last_jump_sequence=0,predicted_mantle_ack=0;
double previous_time=0,next_input=0;

Vec3 plus(Vec3 a,Vec3 b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
Vec3 scale(Vec3 a,float f){return {a.x*f,a.y*f,a.z*f};}
Vec3 blend(Vec3 a,Vec3 b,float t){return {std::lerp(a.x,b.x,t),std::lerp(a.y,b.y,t),std::lerp(a.z,b.z,t)};}
float distance2(Vec3 a,Vec3 b){return (a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y)+(a.z-b.z)*(a.z-b.z);}
float wrap(float angle){while(angle>arena::kPi)angle-=2*arena::kPi;while(angle<-arena::kPi)angle+=2*arena::kPi;return angle;}
void clear_controls(){key_w=key_a=key_s=key_d=key_shift=fire=ads=reload_pressed=jump_pressed=jump_predict=grenade_pressed=crouch_wanted=prone_wanted=false;}
void send_controls(){
 if(mine<0||!playing||!combat)return;
 const bool alive=peers[mine].active&&peers[mine].hp>0;
 const bool jump=locked&&alive&&jump_pressed;
 ++sequence;
 if(jump)last_jump_sequence=sequence;
 send_platform(locked&&alive?float(key_w)-float(key_s):0,locked&&alive?float(key_d)-float(key_a):0,yaw,pitch,locked&&alive&&fire,locked&&alive&&reload_pressed,locked&&alive&&key_shift,sequence,jump,locked&&alive&&crouch_wanted,weapon_wanted,locked&&alive&&grenade_pressed,locked&&alive&&prone_wanted);
 reload_pressed=jump_pressed=grenade_pressed=false;
}
void add_box(Vec3 p,Vec3 size,Vec3 color,float y=0,float t=0){
 instances.insert(instances.end(),{p.x,p.y,p.z,size.x,size.y,size.z,color.x,color.y,color.z,y,t});
}
Vec3 camera_point(Vec3 eye,Vec3 f,Vec3 r,Vec3 u,float x,float y,float ahead){return plus(eye,plus(scale(r,x),plus(scale(u,y),scale(f,ahead))));}
void beam(Vec3 a,Vec3 b,Vec3 color){
 const auto d=Vec3{b.x-a.x,b.y-a.y,b.z-a.z};const float length=std::sqrt(client::dot(d,d));if(length<.01f)return;
 add_box(scale(plus(a,b),.5f),{.007f,.007f,length},color,std::atan2(d.x,-d.z),std::asin(d.y/length));
}
constexpr float kReloadReturn=.16f;
constexpr float kMagazineRelease=.38f;
float reload_phase(const Remote& player){
 if(player.reloading)return std::clamp(1-player.reload/(arena::weapon_definition(player.weapon).reload*1000),0.f,.995f);
 return player.reload_return>0?2-player.reload_return/kReloadReturn:-1.f;
}
float reload_ease(float time,float start,float end){
 const float t=std::clamp((time-start)/(end-start),0.f,1.f);
 return t*t*(3-2*t);
}
float reload_raise(float phase){return reload_ease(phase,0,.22f)*(1-reload_ease(phase,1,2));}
void draw_forearm(Vec3 elbow,Vec3 wrist,float width,Vec3 sleeve){
 const auto delta=plus(wrist,scale(elbow,-1));
 const float length=std::sqrt(client::dot(delta,delta));
 if(length>.01f)add_box(blend(elbow,wrist,.5f),{width,width*1.05f,length},sleeve,std::atan2(delta.x,-delta.z),std::asin(std::clamp(delta.y/length,-1.f,1.f)));
}
struct MagazinePose {
 Vec3 offset{},hand{};
 bool visible=true,fresh=false;
};
MagazinePose magazine_pose(bool pistol,Vec3 center,float tilt,float phase){
 const Vec3 rest=pistol?Vec3{-.058f,-.113f,-.070f}:Vec3{-.056f,-.065f,.253f};
 const auto grip=plus(center,{-.053f,-.030f,.008f});
 const float pull=pistol?.135f:.188f;
 const Vec3 free{0,-pull*std::cos(tilt),pull*std::sin(tilt)};
 const auto pouch=plus(free,{-.19f,-.26f,-.13f});
 if(phase<0)return {{},rest};
 if(phase<.20f)return {{},blend(rest,grip,reload_ease(phase,0,.20f))};
 if(phase>=1)return {{},blend(grip,rest,reload_ease(phase,1,2))};
 Vec3 offset;
 if(phase<kMagazineRelease)offset=scale(free,reload_ease(phase,.20f,kMagazineRelease));
 else if(phase<.53f)offset=blend(free,pouch,reload_ease(phase,kMagazineRelease,.53f));
 else if(phase<.61f)offset=pouch;
 else if(phase<.83f)offset=blend(pouch,free,reload_ease(phase,.61f,.83f));
 else offset=scale(free,1-reload_ease(phase,.83f,1));
 return {offset,plus(grip,offset),phase<.53f||phase>=.61f,phase>=.61f};
}
struct WeaponPoints { Vec3 muzzle,port; };
WeaponPoints draw_weapon(int weapon,Vec3 origin,float yaw,float pitch,float size,float cycle,float phase){
 const auto f=client::forward(yaw,pitch),r=client::right(yaw),u=client::up(yaw,pitch);
 const auto point=[&](Vec3 p){return camera_point(origin,f,r,u,p.x*size,p.y*size,p.z*size);};
 const auto part=[&](Vec3 p,Vec3 bounds,Vec3 color,float tilt=0){add_box(point(p),scale(bounds,size),color,yaw,pitch+tilt);};
 constexpr Vec3 steel{.29f,.34f,.34f}, machined{.42f,.47f,.46f}, polymer{.17f,.20f,.17f}, recess{.09f,.11f,.11f};
 constexpr Vec3 olive{.32f,.37f,.26f}, gloves{.39f,.36f,.26f}, cuff{.24f,.29f,.22f};
 const bool pistol=weapon==1;
 const Vec3 center=pistol?Vec3{0,-.167f,-.086f}:Vec3{0,-.141f,.047f};
 const Vec3 base=pistol?Vec3{0,-.218f,-.100f}:Vec3{0,-.225f,.058f};
 const Vec3 body_size=pistol?Vec3{.073f,.105f,.073f}:Vec3{.104f,.177f,.115f};
 const float tilt=pistol?-.20f:.16f;
 const auto mag=magazine_pose(pistol,center,tilt,phase);
 if(mag.visible){
  const Vec3 plate_size=pistol?Vec3{.111f,.024f,.111f}:Vec3{.111f,.030f,.113f};
  part(plus(center,mag.offset),body_size,pistol?steel:polymer,tilt);
  part(plus(base,mag.offset),plate_size,pistol?recess:olive,pistol?0.f:tilt);
  if(mag.fresh){
   const float top=body_size.y*.5f;
   part(plus(plus(center,mag.offset),{0,top*std::cos(tilt),-top*std::sin(tilt)}),{.032f,.011f,.056f},{.64f,.51f,.25f},tilt);
  }
 }
 if(phase>=0){
  const auto wrist=plus(mag.hand,{-.028f,-.032f,-.038f});
  draw_forearm(point({-.33f,-.38f,-.15f}),point(wrist),.085f*size,cuff);
  part(wrist,{.081f,.079f,.074f},cuff,-.27f);
  part(mag.hand,{.089f,.081f,.109f},gloves,tilt);
  part(plus(mag.hand,{.040f,.034f,.021f}),{.038f,.038f,.063f},gloves,tilt);
 }else{
  part(mag.hand,pistol?Vec3{.067f,.077f,.110f}:Vec3{.088f,.090f,.133f},gloves,pistol?-.11f:0.f);
  if(pistol)part({-.063f,-.077f,-.012f},{.030f,.032f,.087f},gloves,.07f);
 }
 if(pistol){
  const float slide=-.067f*cycle;
  part({0,-.031f,.004f},{.106f,.081f,.233f},polymer);
  part({0,.052f,.019f+slide},{.112f,.083f,.295f},steel);
  part({0,.095f,.019f+slide},{.092f,.021f,.279f},machined);
  part({.057f,.068f,.032f+slide},{.008f,.029f,.066f},recess);
  part({0,.052f,.114f},{.042f,.043f,.113f},recess);
  part({0,.052f,.170f},{.023f,.024f,.010f},recess);
  part({0,-.132f,-.081f},{.108f,.181f,.107f},polymer,-.20f);
  part({0,-.107f,.029f},{.053f,.018f,.095f},steel);
  part({0,-.080f,.074f},{.053f,.067f,.015f},steel);
  part({0,-.077f,.004f},{.020f,.045f,.018f},recess,-.24f);
  for(float side:{-1.f,1.f}){
   for(int groove=0;groove<4;++groove)
    part({side*.056f,.050f,-.112f+groove*.016f+slide},{.005f,.060f,.006f},recess,-.13f);
   part({side*.042f,.111f,-.098f+slide},{.021f,.023f,.026f},recess);
  }
  part({0,.113f,.140f+slide},{.020f,.025f,.022f},recess);
  part({0,.124f,.128f+slide},{.013f,.010f,.007f},{.70f,.76f,.53f});
  part({.057f,-.099f,-.087f},{.070f,.092f,.106f},gloves,-.22f);
  part({.020f,-.071f,-.132f},{.077f,.056f,.041f},gloves,-.15f);
  part({.049f,-.073f,-.006f},{.027f,.028f,.081f},gloves,.05f);
  part({.066f,-.160f,-.148f},{.076f,.085f,.095f},cuff,-.34f);
  draw_forearm(point({.178f,-.34f,-.244f}),point({.066f,-.172f,-.169f}),.075f*size,cuff);
  return {point({0,.052f,.181f}),point({.061f,.068f,.032f+slide})};
 }
 part({0,0,0},{.14f,.15f,.46f},steel);
 part({0,.060f,-.030f},{.147f,.051f,.345f},machined);
 part({0,.002f,.252f},{.134f,.108f,.291f},olive);
 part({0,.010f,.455f},{.042f,.047f,.251f},steel);
 part({0,.010f,.577f},{.067f,.060f,.064f},recess);
 part({0,-.006f,-.282f},{.116f,.107f,.186f},olive);
 part({0,-.005f,-.382f},{.125f,.140f,.041f},polymer);
 part({0,-.134f,-.120f},{.084f,.147f,.083f},polymer,-.23f);
 part({0,-.113f,-.057f},{.047f,.017f,.078f},steel);
 part({0,.098f,.050f},{.056f,.025f,.469f},recess);
 for(int notch=0;notch<7;++notch)
  part({0,.113f,-.144f+notch*.065f},{.065f,.013f,.025f},steel);
 for(float side:{-1.f,1.f}){
  part({side*.069f,.018f,.260f},{.010f,.032f,.209f},recess);
  for(int vent=0;vent<4;++vent)
   part({side*.075f,.018f,.184f+vent*.045f},{.006f,.018f,.028f},steel);
  part({side*.027f,.139f,-.159f},{.018f,.038f,.037f},recess);
 }
 part({.072f,.034f,-.065f},{.009f,.041f,.107f},recess);
 part({.080f,.029f,-.108f},{.019f,.016f,.030f},machined);
 part({0,.084f,.337f},{.047f,.068f,.048f},recess);
 part({0,.136f,.337f},{.017f,.042f,.031f},recess);
 part({0,.157f,.326f},{.012f,.011f,.007f},{.70f,.76f,.53f});
 part({.046f,-.154f,-.130f},{.068f,.093f,.107f},gloves,-.19f);
 part({.063f,-.212f,-.190f},{.070f,.081f,.119f},cuff,-.39f);
 return {point({0,.010f,.611f}),point({.081f,.039f,-.062f})};
}
void draw_shot_effects(Remote& player,WeaponPoints gun,Vec3 eye,float yaw,float pitch){
 if(player.flash<=0)return;
 const bool pistol=player.shot_weapon==1;
 const bool fresh=player.ejections>0;
 for(unsigned remaining=player.ejections;remaining>0;--remaining)
  weapon_effects.eject(gun.port,yaw,pitch,pistol,player.shot-remaining+1,reduced);
 player.ejections=0;
 if(player.shot_weapon!=player.weapon)return;
 const float age=kShotCycle-player.flash;
 weapon_effects.flash(gun.muzzle,eye,yaw,pitch,fresh?0.f:age,pistol,player.shot,reduced);
 if(age<.043f){
  const auto ray=plus(player.trace,scale(gun.muzzle,-1));
  const float range=std::sqrt(client::dot(ray,ray)),start=.9f+age*92.f;
  if(range>start+.05f)beam(blend(gun.muzzle,player.trace,start/range),
                            blend(gun.muzzle,player.trace,std::min(start+.83f,range)/range),{1.34f,.99f,.45f});
 }
}
float mantle_grip(float progress){
 return arena::mantle_ease(progress/.18f)*(1-arena::mantle_ease((progress-.66f)/.30f));
}
float advance_visual_mantle(Remote& p,float dt){
 // Nudge playback towards the snapshot clock without stepping the camera backwards.
 const float duration=arena::mantle_duration(p.mantle);
 const float rate=1+std::clamp((p.mantle_sync-p.mantle.elapsed)*7,-.20f,.55f);
 const float until_end=(duration-p.mantle.elapsed)/rate;
 p.mantle_sync=std::min(duration,p.mantle_sync+dt);
 p.mantle.elapsed=dt>=until_end?duration:p.mantle.elapsed+dt*rate;
 return std::max(0.f,dt-until_end);
}
float mantle_yaw(const arena::MantleState& mantle){
 return std::atan2(mantle.landing.x-mantle.start.x,mantle.start.z-mantle.landing.z);
}
void draw_mantle_hand(Vec3 elbow,Vec3 palm,float facing,int hand,Vec3 sleeve){
 const auto forward=client::forward(facing,0),right=client::right(facing);
 const auto wrist=plus(palm,plus(scale(forward,-.09f),{0,-.022f,0}));
 draw_forearm(elbow,wrist,.10f,sleeve);
 add_box(wrist,{.109f,.092f,.066f},{.14f,.18f,.16f},facing);
 add_box(palm,{.126f,.072f,.119f},{.30f,.34f,.23f},facing);
 for(int finger=0;finger<4;++finger){
  const auto knuckle=plus(palm,plus(scale(right,(finger-1.5f)*.031f),plus(scale(forward,.066f),{0,.009f,0})));
  add_box(knuckle,{.026f,.052f,.068f},{.38f,.41f,.29f},facing);
 }
 const float inward=hand==0?1.f:-1.f;
 add_box(plus(palm,scale(right,inward*.066f)),{.034f,.060f,.080f},{.36f,.39f,.27f},facing+inward*.25f);
}
void player_model(int id,Remote& p,Vec3 eye){
 const Vec3 colors[]={{.96f,.40f,.20f},{.19f,.57f,.63f},{.72f,.73f,.35f},{.55f,.39f,.65f}};
 const Vec3 teams[]={{.26f,.64f,.95f},{.97f,.45f,.19f}};
 const auto color=p.team>=0?teams[p.team]:p.shield>0?Vec3{.79f,.91f,.69f}:colors[id];
 const float aim=arena::recoil_aim_pitch(p.pitch,p.recoil);
 const auto right=client::right(p.yaw),forward=client::forward(p.yaw,aim);
 const float height=arena::body_height(p.crouching)/arena::kStandingHeight;
 Vec3 weapon;
 if(p.prone){
  const auto flat=client::forward(p.yaw,0);
  add_box(plus(p.position,{0,.26f,0}),{.62f,.32f,.8f},color,p.yaw);
  const auto head=plus(p.position,scale(flat,.55f));
  add_box(plus(head,{0,.34f,0}),{.30f,.25f,.32f},{.70f,.58f,.43f},p.yaw);
  add_box(plus(head,{0,.48f,0}),{.37f,.16f,.37f},{.22f,.29f,.25f},p.yaw);
  const auto hips=plus(p.position,plus(scale(flat,-.54f),{0,.14f,0}));
  for(float s:{-1.f,1.f})add_box(plus(hips,scale(right,.17f*s)),{.23f,.22f,.52f},{.21f,.27f,.23f},p.yaw);
  weapon=plus(p.position,plus(Vec3{0,arena::kProneEyeHeight,0},scale(flat,.79f)));
 }else{
  add_box(plus(p.position,{0,.88f*height,0}),{.62f,.80f*height,.35f},color,p.yaw);
  add_box(plus(p.position,{0,1.47f*height,0}),{.34f,.33f*height,.34f},{.70f,.58f,.43f},p.yaw);
  add_box(plus(p.position,{0,1.67f*height,0}),{.41f,.20f*height,.41f},{.22f,.29f,.25f},p.yaw);
  for(float s:{-1.f,1.f})add_box(plus(p.position,plus(scale(right,.17f*s),{0,.28f*height,0})),{.23f,.55f*height,.28f},{.21f,.27f,.23f},p.yaw);
  weapon=plus(p.position,plus(Vec3{0,1.16f*height,0},plus(scale(right,.15f),scale(forward,.46f))));
 }
 add_box(plus(p.position,{0,.012f,0}),{.85f,.018f,.85f},{.28f,.34f,.30f});
 if(arena::mantle_uses_hands(p.mantle)){
  const float facing=mantle_yaw(p.mantle),grip=mantle_grip(arena::mantle_progress(p.mantle));
  const auto r=client::right(facing),f=client::forward(facing,0);
  for(int hand=0;hand<2;++hand){
   const auto elbow=plus(p.position,plus(scale(r,hand==0?-.32f:.32f),{0,1.06f,0}));
   const auto palm=blend(plus(elbow,plus(scale(f,.28f),{0,-.15f,0})),plus(p.mantle.grips[hand],{0,.046f,0}),grip);
   draw_mantle_hand(elbow,palm,facing,hand,color);
  }
  return;
 }
 const float cycle=std::clamp(p.flash/kShotCycle,0.f,1.f);
 const float phase=reload_phase(p),raise=reload_raise(phase);
 const float gun_yaw=p.yaw-.20f*raise,gun_pitch=aim+.26f*raise;
 const auto gun=draw_weapon(p.weapon,weapon,gun_yaw,gun_pitch,.82f,cycle,phase);
 draw_shot_effects(p,gun,eye,gun_yaw,gun_pitch);
}
void frame(){
 const double now=emscripten_get_now();
 const float dt=std::clamp(float((now-previous_time)/1000.0),0.f,.05f);previous_time=now;
 if(playing&&combat){
  hit_time=std::max(0.f,hit_time-dt);damage_time=std::max(0.f,damage_time-dt);
  for(auto& p:peers){
   p.recoil=arena::recover_weapon_recoil(p.weapon,p.recoil,dt,p.recoil_held);
   p.flash=std::max(0.f,p.flash-dt);
   if(p.flash==0)p.ejections=0;
   p.reload=std::max(p.reloading?1.f:0.f,p.reload-dt*1000);
   p.reload_return=std::max(0.f,p.reload_return-dt);
   p.respawn=std::max(0.f,p.respawn-dt*1000);p.shield=std::max(0.f,p.shield-dt*1000);p.equip=std::max(0.f,p.equip-dt*1000);
  }
 }
 Vec3 eye{};float camera_yaw=0,camera_pitch=0,fov=70,gun_lower=0,mag_phase=-1,mag_raise=0;
 bool using_hands=false;
 if(mine>=0){
  auto& me=peers[mine];
  if(playing&&combat&&me.hp>0&&dt>0){
   float move_dt=dt;
   if(me.mantle.active()&&arena::mantle_progress(me.mantle)<1){
    move_dt=advance_visual_mantle(me,dt);
    position=arena::mantle_position(me.mantle);
    grounded=arena::mantle_progress(me.mantle)>=1;
   }
   if(move_dt>0){
    arena::Input input;input.forward=locked?float(key_w)-float(key_s):0;input.strafe=locked?float(key_d)-float(key_a):0;input.yaw=yaw;input.sprint=locked&&key_shift;input.jump=locked&&jump_predict&&!me.mantle.active();input.crouch=locked&&crouch_wanted;input.prone=locked&&prone_wanted;
    const auto motion=arena::step_motion({position,vertical_velocity,grounded,crouching,prone},input,move_dt,current_map);
    if(motion.mantle.active()){
     me.mantle=motion.mantle;
     me.mantle_sync=me.mantle.elapsed;
     predicted_mantle_ack=jump_pressed?sequence+1:last_jump_sequence;
    }
    position=motion.position;vertical_velocity=motion.vertical_velocity;grounded=motion.grounded;crouching=motion.crouching;prone=motion.prone;
   }
   jump_predict=false;
  }
  using_hands=arena::mantle_uses_hands(me.mantle)&&arena::mantle_progress(me.mantle)<1;
  eye=plus(position,{0,arena::eye_height(crouching,prone),0});camera_yaw=yaw;camera_pitch=arena::recoil_aim_pitch(pitch,me.recoil);
  if(using_hands){
   const float progress=arena::mantle_progress(me.mantle);
   gun_lower=arena::mantle_ease(progress/.14f)*(1-arena::mantle_ease((progress-.84f)/.16f));
   if(!reduced)camera_pitch=std::max(-1.5f,camera_pitch-.20f*mantle_grip(progress));
  }else{
   mag_phase=reload_phase(me);
   mag_raise=reload_raise(mag_phase);
   if(playing&&combat&&me.hp>0){
    if(me.reloading&&mag_phase>=kMagazineRelease&&!me.reload_removed){
     feedback_platform(magazine_out);
     me.reload_removed=true;
    }
    if(me.reload_seat_pending)feedback_platform(magazine_in);
   }
  }
  me.reload_seat_pending=false;
  fov=ads?std::lerp(49.f,70.f,std::max(gun_lower,mag_raise)):70.f;
  if(playing&&combat&&now>=next_input){send_controls();next_input=now+1000.0/30.0;}
  hud_platform(me.hp,me.ammo,me.reload,me.respawn,me.kills,me.deaths,std::fmod(yaw*180.f/arena::kPi+360.f,360.f),hit_time,damage_time,me.flash,me.shield,ads,grounded,crouching,me.weapon,me.grenades,me.equip,prone);
 } else {
  const float orbit=.76f+(reduced?0:std::sin(float(now)*.000025f)*.06f);
  eye={std::sin(orbit)*44.f,22.f,std::cos(orbit)*44.f};camera_yaw=-orbit;camera_pitch=-.42f;fov=62.f;
 }
 instances.clear();
 weapon_effects.frame(playing&&combat?dt:0);
 if(current_map==MapId::crossyard) {
  // Low, non-colliding markings keep lanes legible without an external texture.
  for(int i=-20;i<=20;i+=4){add_box({float(i),.012f,-15},{1.8f,.018f,.10f},{.88f,.86f,.60f});add_box({15,.012f,float(i)},{.10f,.018f,1.8f},{.88f,.86f,.60f});}
 }
 for(int id=0;id<arena::kCapacity;++id){auto& p=peers[id];if(!p.active||p.hp<=0||id==mine)continue;
  if(p.mantle.active()){
   if(playing&&combat)advance_visual_mantle(p,dt);
   p.position=arena::mantle_position(p.mantle);
  }else p.position=blend(p.position,p.target,1-std::exp(-dt*14.f));
  player_model(id,p,eye);
 }
 if(using_hands&&peers[mine].hp>0){
  const auto& mantle=peers[mine].mantle;
  const float grip=mantle_grip(arena::mantle_progress(mantle)),facing=mantle_yaw(mantle);
  const auto f=client::forward(camera_yaw,camera_pitch),r=client::right(camera_yaw),u=client::up(camera_yaw,camera_pitch);
  if(grip>.01f)for(int hand=0;hand<2;++hand){
   const float side=hand==0?-1.f:1.f;
   const auto elbow=camera_point(eye,f,r,u,side*.34f,-.49f,.19f);
   const auto rest=camera_point(eye,f,r,u,side*.25f,-.49f,.46f);
   const auto palm=blend(rest,plus(mantle.grips[hand],{0,.046f,0}),grip);
   draw_mantle_hand(elbow,palm,facing,hand,{.25f,.31f,.24f});
  }
 }
 if(mine>=0&&peers[mine].hp>0&&gun_lower<.999f){
  auto& me=peers[mine];const auto f=client::forward(camera_yaw,camera_pitch),r=client::right(camera_yaw),u=client::up(camera_yaw,camera_pitch);
  const float sway=!reduced&&locked&&(key_w||key_a||key_s||key_d)?std::sin(float(now)*.011f)*.012f:0;
  const bool pistol=me.weapon==1;
  const float x=ads?0.f:pistol?.23f:.27f,y=ads?(pistol?-.124f:-.157f):(pistol?-.18f:-.22f);
  const float cycle=std::clamp(me.flash/kShotCycle,0.f,1.f),kick=reduced?0:cycle*cycle;
  const float reach=ads?(pistol?.51f:.63f):(pistol?.62f:.70f);
  const auto gun=camera_point(eye,f,r,u,std::lerp(x,.145f,mag_raise),std::lerp(y,pistol?-.085f:-.10f,mag_raise)+(ads?0:sway)*(1-mag_raise)-.68f*gun_lower,
                             std::lerp(reach,pistol?.65f:.75f,mag_raise)-(pistol?.052f:.038f)*kick);
  const float gun_yaw=yaw-mag_raise*(reduced?.15f:.30f);
  const float gun_pitch=camera_pitch+(pistol?.085f:.052f)*kick+mag_raise*(pistol?.31f:.25f);
  const auto weapon=draw_weapon(me.weapon,gun,gun_yaw,gun_pitch,1.f,cycle,mag_phase);
  draw_shot_effects(me,weapon,eye,gun_yaw,gun_pitch);
 }
 for(auto& g:projectiles)if(g.active){
  if(g.exploding){
   g.explosion=std::max(0.f,g.explosion-dt*1000);
   const float age=std::clamp(1-g.explosion/350.f,0.f,1.f),size=reduced?.85f:.45f+age*1.5f;
   add_box(g.position,{size,size,size},{2.6f,1.4f,.28f});
   const float radius=reduced?1.f:.75f+age*2.3f;
   for(int i=0;i<8;++i){const float a=i*arena::kPi/4;add_box(plus(g.position,{std::sin(a)*radius,.04f,std::cos(a)*radius}),{.13f,.13f,.13f},{2.f,1.5f,.25f});}
  }else{
   const float a=1-std::exp(-dt*22.f);g.position=plus(g.position,scale({g.target.x-g.position.x,g.target.y-g.position.y,g.target.z-g.position.z},a));
   // Keep a newly spawned projectile from enclosing the first-person camera.
   if(distance2(g.position,eye)<.5f*.5f)continue;
   add_box(g.position,{.22f,.22f,.22f},{.32f,.42f,.18f},reduced?0:float(now)*.004f);
   add_box(plus(g.position,{0,.12f,0}),{.07f,.07f,.07f},g.owner==mine?Vec3{1.8f,1.45f,.25f}:Vec3{1.8f,.8f,.25f});
  }
 }
 const auto matrix=client::multiply(client::perspective(fov,float(canvas_aspect()),.035f,155.f),client::view(eye,camera_yaw,camera_pitch));
 bool labeled=false;
 if(mine>=0&&peers[mine].team>=0&&peers[mine].hp>0){
  for(int id=0;id<arena::kCapacity;++id){
   const auto& p=peers[id];
   if(id==mine||!p.active||p.hp<=0||p.team!=peers[mine].team)continue;
   const auto head=plus(p.position,{0,arena::body_height(p.crouching,p.prone),0});
   const auto clip=client::transform(matrix,head);
   if(clip[3]>.05f&&std::abs(clip[0])<clip[3]*.96f&&std::abs(clip[1])<clip[3]*.96f&&
      distance2(eye,head)<65.f*65.f&&arena::clear_sight(current_map,eye,head)){
    teammate_platform(id,(clip[0]/clip[3]+1)/2,(1-clip[1]/clip[3])/2);labeled=true;
   }
   break;
  }
 }
 if(!labeled)teammate_platform(-1,0,0);
 weapon_effects.draw_casings(eye);
 const auto& fx=weapon_effects.vertices();
 draw_platform(matrix.data(),instances.data(),int(instances.size()),fx.data(),int(fx.size()*7),eye.x,eye.y,eye.z,yaw,mine>=0);
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
 if(locked&&down&&!event->repeat&&std::strcmp(event->code,"KeyC")==0){crouch_wanted=!crouch_wanted;prone_wanted=false;return EM_TRUE;}
 if(locked&&down&&!event->repeat&&std::strcmp(event->code,"KeyZ")==0){prone_wanted=!prone_wanted;crouch_wanted=false;return EM_TRUE;}
 if(locked&&down&&!event->repeat&&std::strcmp(event->code,"Digit1")==0){weapon_wanted=0;return EM_TRUE;}
 if(locked&&down&&!event->repeat&&std::strcmp(event->code,"Digit2")==0){weapon_wanted=1;return EM_TRUE;}
 if(locked&&down&&!event->repeat&&std::strcmp(event->code,"KeyE")==0){grenade_pressed=true;return EM_TRUE;}
 return EM_FALSE;
}
EM_BOOL mouse_move(int,const EmscriptenMouseEvent* event,void*){
 if(!locked)return EM_FALSE;
 yaw=wrap(yaw+float(event->movementX)*sensitivity*(ads?.65f:1.f));pitch=std::clamp(pitch-float(event->movementY)*sensitivity*(ads?.65f:1.f),-1.45f,1.45f);return EM_TRUE;
}
EM_BOOL mouse_button(int type,const EmscriptenMouseEvent* event,void*){
 const bool down=type==EMSCRIPTEN_EVENT_MOUSEDOWN;
 if(down&&!locked)return EM_FALSE;
 if(event->button==0){fire=down;if(locked&&mine>=0&&peers[mine].weapon==1)send_controls();}
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
EMSCRIPTEN_KEEPALIVE int client_map_available(int id){
 return arena::map_available(static_cast<MapId>(id));
}
EMSCRIPTEN_KEEPALIVE int client_default_map(){return ARENA_DEFAULT_MAP;}
EMSCRIPTEN_KEEPALIVE int client_start(int slot,int id){
 if(slot<0||slot>=arena::kCapacity||!client_map_available(id))return 0;
 set_map(static_cast<MapId>(id));
 weapon_effects.clear();
 playing=combat=true;
 mine=slot;weapon_wanted=0;sequence=last_jump_sequence=predicted_mantle_ack=0;next_input=0;hit_time=damage_time=0;clear_controls();for(auto& p:peers)p=Remote{};for(auto& g:projectiles)g=VisualGrenade{};
 position=arena::spawn_point(slot,current_map);yaw=arena::spawn_yaw(slot,current_map);pitch=0;vertical_velocity=0;grounded=true;crouching=prone=false;
 return 1;
}
EMSCRIPTEN_KEEPALIVE void client_stop(){mine=-1;set_map(MapId::crossyard);clear_controls();locked=false;emscripten_exit_pointerlock();weapon_effects.clear();for(auto& p:peers)p=Remote{};for(auto& g:projectiles)g=VisualGrenade{};}
EMSCRIPTEN_KEEPALIVE void client_set_playing(int active){playing=active!=0;if(!playing)clear_controls();}
EMSCRIPTEN_KEEPALIVE void client_set_combat(int active){combat=active!=0;if(!combat)clear_controls();}
EMSCRIPTEN_KEEPALIVE void client_reseed(){
 clear_controls();hit_time=damage_time=0;last_jump_sequence=predicted_mantle_ack=0;
 weapon_effects.clear();
 for(auto& p:peers){p.seeded=false;p.flash=0;p.ejections=0;p.mantle={};p.reloading=p.reload_removed=p.reload_seat_pending=false;p.reload_return=0;}
 for(auto& g:projectiles)g=VisualGrenade{};
}
EMSCRIPTEN_KEEPALIVE void client_release(){clear_controls();send_controls();emscripten_exit_pointerlock();}
EMSCRIPTEN_KEEPALIVE void client_lock(){
 if(mine<0||!playing)return;
 const auto result=emscripten_request_pointerlock("#game",EM_FALSE);
 if(result!=EMSCRIPTEN_RESULT_SUCCESS&&result!=EMSCRIPTEN_RESULT_DEFERRED)lock_error_platform();
}
EMSCRIPTEN_KEEPALIVE void client_settings(float value,int reduce){sensitivity=std::clamp(value,.25f,3.f)*.0022f;reduced=reduce!=0;}
EMSCRIPTEN_KEEPALIVE void client_begin_state(){for(auto& p:peers)p.seen=false;for(auto& g:projectiles)g.seen=false;}
EMSCRIPTEN_KEEPALIVE void client_player(int slot,float x,float y,float z,float server_yaw,float server_pitch,int hp,int ammo,int kills,int deaths,float reload,float respawn,float shield,unsigned shot,unsigned hit,unsigned damage,unsigned ack,float tx,float ty,float tz,int weapon,int shot_weapon,unsigned reloads){
 if(slot<0||slot>=arena::kCapacity)return;
 auto& p=peers[slot];const bool first=!p.seeded,reborn=p.hp<=0&&hp>0;
 const bool reloading=reload>0&&hp>0;
 const bool shot_now=!first&&shot>p.shot;
 const bool reset_reload=first||reborn||hp<=0||weapon!=p.weapon;
 const bool seated=!reset_reload&&p.reloading&&!reloading&&reloads>p.reloads;
 if(reset_reload||!p.reloading||!reloading)p.reload_removed=false;
 if(reset_reload||reloading)p.reload_seat_pending=false;
 else if(seated)p.reload_seat_pending=true;
 if(reset_reload||reloading||shot_now)p.reload_return=0;
 else if(seated)p.reload_return=kReloadReturn;
 p.reloading=reloading;
 p.active=p.seen=true;p.target={x,y,z};
 if(first||reborn){p.position=p.target;p.mantle={};}
 if(slot==mine){
  if(first||reborn){position=p.target;yaw=server_yaw;pitch=server_pitch;clear_controls();weapon_wanted=0;predicted_mantle_ack=0;}
  else if(!p.mantle.active())position=blend(position,p.target,distance2(position,p.target)>4.f?1.f:.25f);
  // Never replace local aim with an earlier authoritative snapshot.
  if(!first&&hit>p.hit){hit_time=.18f;feedback_platform(hit_confirmed);}
  if(!first&&damage>p.damage){damage_time=.28f;feedback_platform(took_damage);}
  if(hp<=0)clear_controls();
 }
 if(shot_now){
  p.flash=kShotCycle;
  p.shot_weapon=shot_weapon;
  p.ejections=std::min(3u,p.ejections+std::min(3u,shot-p.shot));
  if(slot==mine){
   // The rifle can fire on the same tick that the fresh magazine seats.
   if(p.reload_seat_pending){feedback_platform(magazine_in);p.reload_seat_pending=false;}
   feedback_platform(shot_weapon==1?pistol_shot:rifle_shot);
  }
 }
 p.yaw=server_yaw;p.pitch=server_pitch;p.hp=hp;p.ammo=ammo;p.kills=kills;p.deaths=deaths;
 p.reload=reload;p.respawn=respawn;p.shield=shield;p.shot=shot;p.reloads=reloads;p.hit=hit;p.damage=damage;p.ack=ack;p.trace={tx,ty,tz};p.seeded=true;
}
EMSCRIPTEN_KEEPALIVE void client_mantle(int slot,float elapsed,float sx,float sy,float sz,float x,float y,float z,float lx,float ly,float lz,float rx,float ry,float rz,float approach,int sprint){
 if(slot<0||slot>=arena::kCapacity)return;
 auto& p=peers[slot];
 if(elapsed<0){
  if(p.mantle.active()){
   const bool predicting=slot==mine&&predicted_mantle_ack!=0;
   // Snapshots from before the jump was consumed cannot cancel the local takeoff.
   if(predicting&&p.hp>0&&p.ack<=predicted_mantle_ack)return;
   const auto landing=p.mantle.landing;
   p.position=!predicting&&p.hp>0&&distance2(landing,p.target)<.16f?landing:p.target;
   if(slot==mine){
    const bool continued=!predicting&&p.hp>0&&arena::mantle_progress(p.mantle)>=1&&distance2(position,p.target)<.25f;
    if(!continued)position=p.position;
    predicted_mantle_ack=0;
   }
   p.mantle={};
  }
  return;
 }
 const Vec3 start{sx,sy,sz},landing{x,y,z};
 const bool predicted=slot==mine&&predicted_mantle_ack!=0;
 const bool close_prediction=predicted&&p.mantle.active()&&p.mantle.sprint==(sprint!=0)&&
     distance2(p.mantle.start,start)<.10f&&distance2(p.mantle.landing,landing)<.012f&&
     std::abs(p.mantle.landing.y-landing.y)<.02f;
 // A retained predicted path can have a slightly different start from the server route.
 if(!close_prediction&&(!p.mantle.active()||predicted||distance2(p.mantle_server_start,start)>.001f)){
  const float visual_elapsed=predicted&&p.mantle.active()?std::max(elapsed,p.mantle.elapsed):std::min(elapsed,.025f);
  p.mantle={start,landing,{{{lx,ly,lz},{rx,ry,rz}}},visual_elapsed,std::isfinite(approach)?approach:0,sprint!=0};
  p.mantle.elapsed=std::min(p.mantle.elapsed,arena::mantle_duration(p.mantle));
 }
 p.mantle_server_start=start;
 if(slot==mine){
  predicted_mantle_ack=0;
  if(arena::mantle_progress(p.mantle)<1){grounded=false;vertical_velocity=0;crouching=prone=false;}
 }
 p.mantle_sync=elapsed;
}
EMSCRIPTEN_KEEPALIVE void client_motion(int slot,float vy,int on_ground,int crouch,int is_prone){
 if(slot<0||slot>=arena::kCapacity)return;
 peers[slot].crouching=crouch!=0;
 peers[slot].prone=is_prone!=0;
 if(slot==mine&&!peers[slot].mantle.active()){vertical_velocity=vy;grounded=on_ground!=0;crouching=crouch!=0;prone=is_prone!=0;}
}
EMSCRIPTEN_KEEPALIVE void client_team(int slot,int team){
 if(slot>=0&&slot<arena::kCapacity)peers[slot].team=team>=0&&team<arena::kTeamCount?team:-1;
}
EMSCRIPTEN_KEEPALIVE void client_loadout(int slot,int weapon,int grenades,float equip,float recoil,int recoil_held){
 if(slot<0||slot>=arena::kCapacity)return;
 auto& p=peers[slot];
 p.weapon=weapon;p.grenades=grenades;p.equip=equip;p.recoil=recoil;p.recoil_held=recoil_held!=0;
}
EMSCRIPTEN_KEEPALIVE void client_grenade(unsigned id,int owner,float x,float y,float z,float explosion,int exploding){
 if(id==0)return;
 auto it=std::find_if(projectiles.begin(),projectiles.end(),[id](const VisualGrenade& g){return g.active&&g.id==id;});
 if(it==projectiles.end()){
  it=std::find_if(projectiles.begin(),projectiles.end(),[](const VisualGrenade& g){return !g.active;});
  if(it==projectiles.end())return;
  *it=VisualGrenade{};it->position={x,y,z};
 }
 if(exploding&&!it->exploding)feedback_platform(grenade_blast);
 it->active=it->seen=true;it->id=id;it->owner=owner;it->target={x,y,z};it->explosion=explosion;it->exploding=exploding!=0;
 if(it->exploding)it->position=it->target;
}
EMSCRIPTEN_KEEPALIVE void client_end_state(){for(auto& p:peers)if(!p.seen){p.active=false;p.seeded=false;p.flash=0;p.ejections=0;p.mantle={};}for(auto& g:projectiles)if(!g.seen)g=VisualGrenade{};}
}
int main(){
 publish_world(MapId::crossyard);
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
