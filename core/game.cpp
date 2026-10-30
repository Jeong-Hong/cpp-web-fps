#include "arena.hpp"
#include <algorithm>
#include <cmath>
#include <limits>

namespace arena {
const std::vector<Box>& world_boxes() {
    static const std::vector<Box> boxes=[] {
        std::vector<Box> result={
        {0,-0.5f,0,48,1,48,0.23f,0.27f,0.28f,false},
        {-24,2,0,1,4,49,0.39f,0.43f,0.42f},
        {24,2,0,1,4,49,0.39f,0.43f,0.42f},
        {0,2,-24,49,4,1,0.39f,0.43f,0.42f},
        {0,2,24,49,4,1,0.39f,0.43f,0.42f},
        {0,2.5f,0,10,5,10,0.35f,0.43f,0.44f},
        {-18,1,0,3,2,5,0.52f,0.39f,0.24f},
        {0,6,-10,8,0.5f,1,0.66f,0.54f,0.22f},
        {-12,-1,-10,3,2,3,0.26f,0.28f,0.29f},
        {11,1.2f,8,4,2.4f,3,0.43f,0.37f,0.24f},
        {14,1.1f,-6,3,2.2f,5,0.33f,0.43f,0.36f},
        {-12,1.2f,10,4,2.4f,3,0.54f,0.34f,0.24f},
        {7,0.8f,-11,3,1.6f,3,0.55f,0.43f,0.24f},
        {4,0.7f,16,5,1.4f,2,0.47f,0.49f,0.44f},
        {0,5.3f,0,10.6f,0.6f,10.6f,0.24f,0.3f,0.32f,false},
        {2,6.1f,1,2,1,2,0.5f,0.52f,0.5f,false},
        {-3,5.9f,-2,1,1.2f,1,0.25f,0.29f,0.3f,false}
        };
        for(int i=-3;i<=3;++i) {
            const float p=i*10.0f;
            const float height=8.0f+(i+3)%4*3.0f;
            for(float side:{-1.0f,1.0f}) {
                result.push_back({p,height/2,side*38,7,height,7,0.25f,0.3f,0.32f,false});
                result.push_back({side*38,height/2,p,7,height,7,0.29f,0.33f,0.34f,false});
            }
        }
        for(float x:{-30.0f,30.0f}) {
            for(float z:{-20.0f,0.0f,20.0f}) {
                result.push_back({x,2,z,0.7f,4,0.7f,0.3f,0.23f,0.16f,false});
                result.push_back({x,4.6f,z,3.5f,3.8f,3.5f,0.19f,0.33f,0.24f,false});
            }
            for(float z:{-30.0f,30.0f}) {
                result.push_back({x,7,z,1,14,1,0.45f,0.46f,0.4f,false});
                result.push_back({x,13,z,5,0.7f,2,0.64f,0.54f,0.25f,false});
            }
        }
        return result;
    }();
    return boxes;
}

Vec3 spawn_point(int slot) {
    if(slot<0 || slot>=kCapacity) return {};
    return {slot%2?18.0f:-18.0f,0,slot/2?18.0f:-18.0f};
}
float spawn_yaw(int slot) {
    const auto p=spawn_point(slot);
    return std::atan2(-p.x,p.z);
}
int Room::join() {
    for(int slot=0;slot<kCapacity;++slot) if(!players_[slot].active) {
        auto& player=players_[slot];
        player=Player{};
        player.active=true;
        player.position=spawn_point(slot);
        player.yaw=spawn_yaw(slot);
        player.shield=1.5f;
        player.trace={player.position.x,kEyeHeight,player.position.z};
        return slot;
    }
    return -1;
}
void Room::leave(int slot) {
    if(slot>=0 && slot<kCapacity) players_[slot]=Player{};
}
int Room::count() const {
    return static_cast<int>(std::count_if(players_.begin(),players_.end(),[](const Player& p) { return p.active; }));
}

bool valid_input(const Input& input) {
    return input.seq<=2147483647u &&
        std::isfinite(input.forward) && std::abs(input.forward)<=1 &&
        std::isfinite(input.strafe) && std::abs(input.strafe)<=1 &&
        std::isfinite(input.yaw) && std::abs(input.yaw)<=kPi &&
        std::isfinite(input.pitch) && std::abs(input.pitch)<=1.45f;
}
bool Room::set_input(int slot,const Input& input) {
    if(slot<0 || slot>=kCapacity || !players_[slot].active || !valid_input(input)) return false;
    auto& player=players_[slot];
    if(input.seq<=player.ack) return true;
    player.ack=input.seq;
    if(player.hp<=0) return true;
    player.input=input;
    player.stale=0;
    player.yaw=input.yaw;
    player.pitch=input.pitch;
    return true;
}
namespace {
float remaining_after(float remaining,float dt) {
    const float result=std::max(0.0f,remaining-dt);
    // Repeated float subtraction at 60Hz can leave a few microseconds at an exact boundary.
    return result<0.000005f?0:result;
}
}

void Room::tick(float dt) {
    if(!std::isfinite(dt) || dt<=0 || dt>0.05f) return;
    time_ms_+=static_cast<double>(dt)*1000;
    for(int slot=0;slot<kCapacity;++slot) {
        auto& player=players_[slot];
        if(!player.active) continue;
        if(player.hp<=0) {
            player.respawn=remaining_after(player.respawn,dt);
            if(player.respawn==0) {
                player.position=spawn_point(slot);
                player.yaw=spawn_yaw(slot);
                player.pitch=0;
                player.hp=100;
                player.ammo=24;
                player.reload=player.cooldown=0;
                player.shield=1.5f;
                player.input={};
                player.stale=0.25f;
                player.trace={player.position.x,kEyeHeight,player.position.z};
            }
            continue;
        }
        player.shield=remaining_after(player.shield,dt);
        player.cooldown=remaining_after(player.cooldown,dt);
        if(player.reload>0) {
            player.reload=remaining_after(player.reload,dt);
            if(player.reload==0) player.ammo=24;
        }
        const float movement_dt=std::min(dt,std::max(0.0f,0.25f-player.stale));
        player.position=move_position(player.position,player.input.forward,player.input.strafe,player.yaw,movement_dt,player.input.sprint);
        player.stale=std::min(0.25f,player.stale+dt);
        if(player.stale>=0.25f) {
            player.input.forward=player.input.strafe=0;
            player.input.fire=player.input.reload=player.input.sprint=false;
        }
    }
    for(int slot=0;slot<kCapacity;++slot) {
        auto& player=players_[slot];
        if(!player.active || player.hp<=0) continue;
        if(player.input.reload && player.reload==0 && player.ammo<24) player.reload=1.5f;
        if(!player.input.fire || player.ammo<=0 || player.cooldown>0 || player.reload>0) continue;
        --player.ammo;
        ++player.shot;
        player.cooldown=0.12f;
        player.shield=0;
        const Vec3 origin{player.position.x,player.position.y+kEyeHeight,player.position.z};
        const auto direction=aim_direction(player.yaw,player.pitch);
        float nearest=80;
        int target=-1;
        for(const auto& box:world_boxes()) if(box.solid) nearest=std::min(nearest,ray_box(origin,direction,box));
        for(int other=0;other<kCapacity;++other) {
            const auto& candidate=players_[other];
            if(other==slot || !candidate.active || candidate.hp<=0) continue;
            const Box body{candidate.position.x,candidate.position.y+0.9f,candidate.position.z,kRadius*2,1.8f,kRadius*2,1,1,1};
            const float distance=ray_box(origin,direction,body);
            if(distance<nearest) { nearest=distance; target=other; }
        }
        player.trace={origin.x+direction.x*nearest,origin.y+direction.y*nearest,origin.z+direction.z*nearest};
        if(target>=0 && players_[target].shield<=0) {
            auto& victim=players_[target];
            victim.hp=std::max(0,victim.hp-25);
            ++victim.damage;
            ++player.hit;
            if(victim.hp==0) {
                ++player.kills;
                ++victim.deaths;
                victim.respawn=2.5f;
                victim.reload=victim.cooldown=victim.shield=0;
                victim.input={};
                victim.stale=0.25f;
            }
        }
    }
}

Vec3 aim_direction(float yaw,float pitch) {
    return {std::sin(yaw)*std::cos(pitch),std::sin(pitch),-std::cos(yaw)*std::cos(pitch)};
}

float ray_box(Vec3 origin,Vec3 direction,const Box& box,float max_distance) {
    const float miss=std::numeric_limits<float>::infinity();
    const std::array<float,3> o={origin.x,origin.y,origin.z};
    const std::array<float,3> d={direction.x,direction.y,direction.z};
    const std::array<float,3> center={box.x,box.y,box.z};
    const std::array<float,3> size={box.sx,box.sy,box.sz};
    if(!std::isfinite(max_distance) || max_distance<0 ||
       (direction.x==0 && direction.y==0 && direction.z==0)) return miss;
    float enter=0,exit=max_distance;
    for(int axis=0;axis<3;++axis) {
        if(!std::isfinite(o[axis]) || !std::isfinite(d[axis]) ||
           !std::isfinite(center[axis]) || !std::isfinite(size[axis]) || size[axis]<=0) return miss;
        const float lo=center[axis]-size[axis]/2,hi=center[axis]+size[axis]/2;
        if(d[axis]==0) {
            if(o[axis]<lo || o[axis]>hi) return miss;
        } else {
            float a=(lo-o[axis])/d[axis],b=(hi-o[axis])/d[axis];
            if(a>b) std::swap(a,b);
            enter=std::max(enter,a);
            exit=std::min(exit,b);
            if(enter>exit) return miss;
        }
    }
    return enter;
}

namespace {
float slide_axis(Vec3 from,float delta,bool x_axis) {
    const float start=x_axis?from.x:from.z;
    float end=start+delta;
    for(const auto& box:world_boxes()) {
        if(!box.solid || box.y+box.sy/2<=from.y || box.y-box.sy/2>=from.y+1.8f) continue;
        const float other=x_axis?from.z:from.x;
        const float center=x_axis?box.x:box.z;
        const float extent=(x_axis?box.sx:box.sz)/2+kRadius;
        const float other_center=x_axis?box.z:box.x;
        const float other_extent=(x_axis?box.sz:box.sx)/2+kRadius;
        if(other<=other_center-other_extent || other>=other_center+other_extent) continue;
        if(delta>0 && start<=center-extent && end>center-extent) end=std::min(end,center-extent);
        if(delta<0 && start>=center+extent && end<center+extent) end=std::max(end,center+extent);
    }
    return end;
}
}

Vec3 move_position(Vec3 from,float forward,float strafe,float yaw,float dt,bool sprint) {
    if(!std::isfinite(dt) || dt<=0 || dt>0.05f ||
       !std::isfinite(forward) || std::abs(forward)>1 ||
       !std::isfinite(strafe) || std::abs(strafe)>1 ||
       !std::isfinite(yaw) || std::abs(yaw)>kPi) return from;
    const float length=std::hypot(forward,strafe);
    if(length>1) { forward/=length; strafe/=length; }
    const float distance=(sprint?kSprintSpeed:kSpeed)*dt;
    const float dx=(std::sin(yaw)*forward+std::cos(yaw)*strafe)*distance;
    const float dz=(-std::cos(yaw)*forward+std::sin(yaw)*strafe)*distance;
    from.x=slide_axis(from,dx,true);
    from.z=slide_axis(from,dz,false);
    return from;
}
}
