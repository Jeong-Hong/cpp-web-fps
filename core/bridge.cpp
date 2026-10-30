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
EMSCRIPTEN_KEEPALIVE void room_destroy(std::uintptr_t handle) {
    delete reinterpret_cast<arena::Room*>(handle);
}
EMSCRIPTEN_KEEPALIVE int room_join(std::uintptr_t handle) {
    return handle?reinterpret_cast<arena::Room*>(handle)->join():-1;
}
EMSCRIPTEN_KEEPALIVE void room_leave(std::uintptr_t handle,int slot) {
    if(handle) reinterpret_cast<arena::Room*>(handle)->leave(slot);
}
EMSCRIPTEN_KEEPALIVE int room_input(std::uintptr_t handle,int slot,float forward,float strafe,float yaw,float pitch,int fire,int reload,int sprint,std::uint32_t seq) {
    if(!handle || (fire!=0 && fire!=1) || (reload!=0 && reload!=1) || (sprint!=0 && sprint!=1)) return 0;
    const arena::Input input{forward,strafe,yaw,pitch,fire!=0,reload!=0,sprint!=0,seq};
    return reinterpret_cast<arena::Room*>(handle)->set_input(slot,input)?1:0;
}
EMSCRIPTEN_KEEPALIVE const char* room_snapshot(std::uintptr_t handle) {
    static thread_local std::string snapshot;
    if(!handle) return "{\"time\":0,\"players\":[]}";
    const auto& room=*reinterpret_cast<const arena::Room*>(handle);
    std::ostringstream out;
    out.imbue(std::locale::classic());
    out<<std::setprecision(std::numeric_limits<double>::max_digits10);
    out<<"{\"time\":"<<finite_number(room.time())<<",\"players\":[";
    bool first=true;
    for(int slot=0;slot<arena::kCapacity;++slot) {
        const auto& p=room.players()[slot];
        if(!p.active) continue;
        if(!first) out<<',';
        first=false;
        out<<"{\"id\":"<<slot
           <<",\"x\":"<<finite_number(p.position.x)
           <<",\"y\":"<<finite_number(p.position.y)
           <<",\"z\":"<<finite_number(p.position.z)
           <<",\"yaw\":"<<finite_number(p.yaw)
           <<",\"pitch\":"<<finite_number(p.pitch)
           <<",\"hp\":"<<p.hp<<",\"ammo\":"<<p.ammo
           <<",\"kills\":"<<p.kills<<",\"deaths\":"<<p.deaths
           <<",\"reload\":"<<finite_number(static_cast<double>(p.reload)*1000)
           <<",\"respawn\":"<<finite_number(static_cast<double>(p.respawn)*1000)
           <<",\"shield\":"<<finite_number(static_cast<double>(p.shield)*1000)
           <<",\"shot\":"<<p.shot<<",\"hit\":"<<p.hit<<",\"damage\":"<<p.damage<<",\"ack\":"<<p.ack
           <<",\"trace\":["<<finite_number(p.trace.x)<<','<<finite_number(p.trace.y)<<','<<finite_number(p.trace.z)<<"]}";
    }
    out<<"]}";
    snapshot=out.str();
    return snapshot.c_str();
}
EMSCRIPTEN_KEEPALIVE void room_tick(std::uintptr_t handle,float seconds) {
    if(handle) reinterpret_cast<arena::Room*>(handle)->tick(seconds);
}
}
