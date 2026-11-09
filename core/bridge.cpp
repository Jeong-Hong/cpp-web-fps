#include "arena.hpp"
#include <cmath>
#include <iomanip>
#include <limits>
#include <locale>
#include <new>
#include <sstream>
#include <string>
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace {
double finite_number(double value) { return std::isfinite(value)?value:0; }
}

extern "C" {
EMSCRIPTEN_KEEPALIVE std::uintptr_t room_create() {
    return reinterpret_cast<std::uintptr_t>(new(std::nothrow) arena::Room);
}
EMSCRIPTEN_KEEPALIVE int room_map_available(int id) {
    return arena::map_available(static_cast<arena::MapId>(id));
}
EMSCRIPTEN_KEEPALIVE std::uintptr_t room_create_for_map(int id) {
    if(!room_map_available(id)) return 0;
    return reinterpret_cast<std::uintptr_t>(new(std::nothrow) arena::Room(static_cast<arena::MapId>(id)));
}
EMSCRIPTEN_KEEPALIVE std::uintptr_t room_create_team_match(int id) {
    if(!room_map_available(id)) return 0;
    return reinterpret_cast<std::uintptr_t>(new(std::nothrow) arena::Room(static_cast<arena::MapId>(id),arena::RoomMode::two_vs_two));
}
EMSCRIPTEN_KEEPALIVE std::uintptr_t room_create_gunfight(int id) {
    if(!room_map_available(id)) return 0;
    return reinterpret_cast<std::uintptr_t>(new(std::nothrow) arena::Room(static_cast<arena::MapId>(id),arena::RoomMode::gunfight));
}
EMSCRIPTEN_KEEPALIVE int room_rematch(std::uintptr_t handle) {
    return handle && reinterpret_cast<arena::Room*>(handle)->rematch();
}
EMSCRIPTEN_KEEPALIVE void room_destroy(std::uintptr_t handle) {
    delete reinterpret_cast<arena::Room*>(handle);
}
EMSCRIPTEN_KEEPALIVE int room_join(std::uintptr_t handle) {
    return handle?reinterpret_cast<arena::Room*>(handle)->join():-1;
}
EMSCRIPTEN_KEEPALIVE void room_leave(std::uintptr_t handle,int slot) {
    if(handle) reinterpret_cast<arena::Room*>(handle)->leave(slot);
}
EMSCRIPTEN_KEEPALIVE int room_input_v3(std::uintptr_t handle,int slot,float forward,float strafe,float yaw,float pitch,int fire,int reload,int sprint,std::uint32_t seq,int jump,int crouch,int weapon,int grenade,int prone) {
    for(int flag:{fire,reload,sprint,jump,crouch,grenade,prone}) if(flag!=0 && flag!=1) return 0;
    if(!handle) return 0;
    const arena::Input input{forward,strafe,yaw,pitch,fire!=0,reload!=0,sprint!=0,seq,jump!=0,crouch!=0,weapon,grenade!=0,prone!=0};
    return reinterpret_cast<arena::Room*>(handle)->set_input(slot,input)?1:0;
}
EMSCRIPTEN_KEEPALIVE int room_input_v2(std::uintptr_t handle,int slot,float forward,float strafe,float yaw,float pitch,int fire,int reload,int sprint,std::uint32_t seq,int jump,int crouch,int weapon,int grenade) {
    return room_input_v3(handle,slot,forward,strafe,yaw,pitch,fire,reload,sprint,seq,jump,crouch,weapon,grenade,0);
}
EMSCRIPTEN_KEEPALIVE int room_input(std::uintptr_t handle,int slot,float forward,float strafe,float yaw,float pitch,int fire,int reload,int sprint,std::uint32_t seq) {
    return room_input_v2(handle,slot,forward,strafe,yaw,pitch,fire,reload,sprint,seq,0,0,0,0);
}
EMSCRIPTEN_KEEPALIVE const char* room_snapshot(std::uintptr_t handle) {
    static thread_local std::string snapshot;
    if(!handle) return "{\"time\":0,\"players\":[],\"grenades\":[]}";
    const auto& room=*reinterpret_cast<const arena::Room*>(handle);
    std::ostringstream out;
    out.imbue(std::locale::classic());
    out<<std::setprecision(std::numeric_limits<double>::max_digits10);
    out<<"{\"time\":"<<finite_number(room.time());
    if(room.team_mode()) {
        const auto& scores=room.team_scores();
        constexpr const char* phases[]={"live","waiting","countdown","finished"};
        out<<",\"playing\":"<<(room.playing()?"true":"false")<<",\"teamScores\":["<<scores[0]<<','<<scores[1]<<']'
           <<",\"phase\":\""<<phases[static_cast<int>(room.phase())]<<"\""
           <<",\"remaining\":"<<room.phase_seconds()*1000
           <<",\"target\":"<<room.target_score()<<",\"winner\":"<<room.winner()
           <<",\"round\":"<<room.round()<<",\"roundResult\":"<<room.round_result()
           <<",\"deployment\":"<<room.deployment();
    }
    out<<",\"players\":[";
    bool first=true;
    for(int slot=0;slot<arena::kCapacity;++slot) {
        const auto& p=room.players()[slot];
        if(!p.active) continue;
        if(!first) out<<',';
        first=false;
        out<<"{\"id\":"<<slot;
        if(room.team_mode()) out<<",\"team\":"<<room.team(slot);
        out<<",\"x\":"<<finite_number(p.position.x)
           <<",\"y\":"<<finite_number(p.position.y)
           <<",\"z\":"<<finite_number(p.position.z)
           <<",\"yaw\":"<<finite_number(p.yaw)
           <<",\"pitch\":"<<finite_number(p.pitch)
           <<",\"recoil\":"<<finite_number(p.recoil)
           <<",\"recoilHeld\":"<<(arena::holding_rifle_recoil(p)?"true":"false")
           <<",\"hp\":"<<p.hp<<",\"ammo\":"<<arena::active_ammo(p)
           <<",\"vy\":"<<finite_number(p.vertical_velocity)
           <<",\"grounded\":"<<(p.grounded?"true":"false")
           <<",\"crouch\":"<<(p.crouching?"true":"false")
           <<",\"prone\":"<<(p.prone?"true":"false")
           <<",\"weapon\":"<<p.weapon
           <<",\"rifleAmmo\":"<<p.ammo
           <<",\"pistolAmmo\":"<<p.pistol_ammo
           <<",\"grenadeCount\":"<<p.grenades
           <<",\"equip\":"<<finite_number(static_cast<double>(p.equip)*1000)
           <<",\"kills\":"<<p.kills<<",\"deaths\":"<<p.deaths
           <<",\"reload\":"<<finite_number(static_cast<double>(p.reload)*1000)
           <<",\"respawn\":"<<finite_number(static_cast<double>(p.respawn)*1000)
           <<",\"shield\":"<<finite_number(static_cast<double>(p.shield)*1000)
           <<",\"shot\":"<<p.shot<<",\"shotWeapon\":"<<p.shot_weapon<<",\"reloads\":"<<p.reloads
           <<",\"hit\":"<<p.hit<<",\"damage\":"<<p.damage<<",\"ack\":"<<p.ack
           <<",\"trace\":["<<finite_number(p.trace.x)<<','<<finite_number(p.trace.y)<<','<<finite_number(p.trace.z)<<']';
        if(p.mantle.active()) {
            out<<",\"mantle\":["<<finite_number(p.mantle.elapsed);
            for(const auto point:{p.mantle.start,p.mantle.landing,p.mantle.grips[0],p.mantle.grips[1]})
                out<<','<<finite_number(point.x)<<','<<finite_number(point.y)<<','<<finite_number(point.z);
            out<<','<<finite_number(p.mantle.approach)<<','<<(p.mantle.sprint?1:0);
            out<<']';
        }
        out<<'}';
    }
    out<<"],\"grenades\":[";
    first=true;
    for(const auto& g:room.grenades()) {
        if(!g.active) continue;
        if(!first) out<<',';
        first=false;
        out<<"{\"id\":"<<g.id<<",\"owner\":"<<g.owner
           <<",\"x\":"<<finite_number(g.position.x)<<",\"y\":"<<finite_number(g.position.y)<<",\"z\":"<<finite_number(g.position.z)
           <<",\"vx\":"<<finite_number(g.velocity.x)<<",\"vy\":"<<finite_number(g.velocity.y)<<",\"vz\":"<<finite_number(g.velocity.z)
           <<",\"fuse\":"<<finite_number(static_cast<double>(g.fuse)*1000)
           <<",\"explosion\":"<<finite_number(static_cast<double>(g.explosion)*1000)
           <<",\"exploding\":"<<(g.exploding?"true":"false")<<'}';
    }
    out<<"]}";
    snapshot=out.str();
    return snapshot.c_str();
}
EMSCRIPTEN_KEEPALIVE void room_tick(std::uintptr_t handle,float seconds) {
    if(handle) reinterpret_cast<arena::Room*>(handle)->tick(seconds);
}
}
