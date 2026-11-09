#include "arena.hpp"
#include "local_map.hpp"
#include "mantle.hpp"
#include "stance.hpp"
#include <algorithm>
#include <cmath>
#include <limits>

namespace arena {
namespace {
constexpr float kRoundSeconds=40, kCountdownSeconds=3;
}

bool map_available(MapId map) { return map==MapId::crossyard || local_map::available(map); }

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

Vec3 spawn_point(int slot,MapId map) {
    if(map!=MapId::crossyard) return local_map::spawn(map,slot);
    if(slot<0 || slot>=kCapacity) return {};
    return {slot%2?18.0f:-18.0f,0,slot/2?18.0f:-18.0f};
}
float spawn_yaw(int slot,MapId map) {
    const auto p=spawn_point(slot,map);
    if(map!=MapId::crossyard) return local_map::spawn_yaw(map,p);
    return std::atan2(-p.x,p.z);
}
Room::Room(MapId map,RoomMode mode)
    : map_(map),mode_(mode),countdown_(gunfight()?kCountdownSeconds:0),round_left_(kRoundSeconds) {}

void Room::deploy(int slot,int spawn) {
    auto& player=players_[slot];
    const Player previous=player;
    player=Player{};
    player.active=true;
    player.received_input=previous.received_input;
    player.ack=previous.ack;
    player.kills=previous.kills;
    player.deaths=previous.deaths;
    player.shot=previous.shot;
    player.shot_weapon=previous.shot_weapon;
    player.reloads=previous.reloads;
    player.hit=previous.hit;
    player.damage=previous.damage;
    if(previous.active) player.stale=0.25f;
    player.position=spawn_point(spawn,map_);
    player.yaw=spawn_yaw(spawn,map_);
    player.shield=gunfight()?0:1.5f;
    player.trace={player.position.x,player.position.y+kEyeHeight,player.position.z};
}

void Room::reset_players() {
    grenades_={};
    for(int slot=0;slot<kCapacity;++slot) if(players_[slot].active) deploy(slot,slot);
    ++deployment_;
}

int Room::join() {
    for(int slot=0;slot<kCapacity;++slot) if(!players_[slot].active) {
        deploy(slot,slot);
        if(restart_round_ && count()==kCapacity) {
            restart_round_=false;
            if(round_result_!=-2) ++round_;
            round_result_=-2;
            round_left_=kRoundSeconds;
            countdown_=kCountdownSeconds;
            reset_players();
        }
        return slot;
    }
    return -1;
}
void Room::leave(int slot) {
    if(slot<0 || slot>=kCapacity || !players_[slot].active) return;
    if(gunfight() && playing()) restart_round_=true;
    for(auto& grenade:grenades_) if(grenade.active && grenade.owner==slot) grenade=Grenade{};
    players_[slot]=Player{};
    if(team_mode()) {
        for(auto& player:players_) if(player.active) {
            player.input={};
            player.input.weapon=player.weapon;
            player.input.crouch=player.crouching;
            player.input.prone=player.prone;
            player.semi_pending=player.last_fire_down=false;
            player.stale=0.25f;
        }
    }
}
int Room::count() const {
    return static_cast<int>(std::count_if(players_.begin(),players_.end(),[](const Player& p) { return p.active; }));
}

bool Room::teammates(int a,int b) const {
    return team_mode() && a>=0 && a<kCapacity && a!=b && team(a)==team(b);
}

void Room::credit_kill(int slot) {
    ++players_[slot].kills;
    if(mode_==RoomMode::two_vs_two && ++team_scores_[team(slot)]>=target_score()) winner_=team(slot);
}

MatchPhase Room::phase() const {
    if(winner_>=0) return MatchPhase::finished;
    if(!playing()) return MatchPhase::waiting;
    return countdown_>0?MatchPhase::countdown:MatchPhase::live;
}

float Room::phase_seconds() const {
    if(!playing() || !gunfight()) return 0;
    return countdown_>0?countdown_:round_left_;
}

bool Room::rematch() {
    if(winner_<0 || count()!=kCapacity) return false;
    winner_=-1;
    round_=1;
    round_result_=-2;
    countdown_=gunfight()?kCountdownSeconds:0;
    round_left_=kRoundSeconds;
    team_scores_={};
    for(auto& player:players_) player.kills=player.deaths=0;
    reset_players();
    return true;
}

const WeaponDefinition& weapon_definition(int weapon) {
    static const WeaponDefinition rifle{24,25,0.12f,1.5f,true,.025f,5.5f,.18f};
    static const WeaponDefinition pistol{12,34,0.28f,1.2f,false,.044f,10.f,.066f};
    return weapon==1?pistol:rifle;
}
bool holding_rifle_recoil(const Player& player) {
    return player.hp>0 && player.weapon==0 && player.input.fire && player.stale<.25f &&
           player.ammo>0 && player.reload==0 && player.equip==0 && !mantle_uses_hands(player.mantle);
}
float recover_weapon_recoil(int weapon,float recoil,float dt,bool held) {
    if(recoil==0 || held) return recoil;
    const float remaining=recoil*std::exp(-weapon_definition(weapon).recoil_recovery*dt);
    return remaining<.0001f?0:remaining;
}
float recoil_aim_pitch(float pitch,float recoil) { return std::clamp(pitch+recoil,-1.45f,1.45f); }
int& active_ammo(Player& player) { return player.weapon==1?player.pistol_ammo:player.ammo; }
int active_ammo(const Player& player) { return player.weapon==1?player.pistol_ammo:player.ammo; }

bool valid_input(const Input& input) {
    return input.weapon>=0 && input.weapon<=1 && input.seq<=2147483647u &&
        std::isfinite(input.forward) && std::abs(input.forward)<=1 &&
        std::isfinite(input.strafe) && std::abs(input.strafe)<=1 &&
        std::isfinite(input.yaw) && std::abs(input.yaw)<=kPi &&
        std::isfinite(input.pitch) && std::abs(input.pitch)<=1.45f;
}
bool Room::set_input(int slot,const Input& input) {
    if(slot<0 || slot>=kCapacity || !players_[slot].active || !valid_input(input)) return false;
    auto& player=players_[slot];
    if(player.received_input && input.seq<=player.ack) return true;
    player.received_input=true;
    player.ack=input.seq;
    if(player.hp<=0 || phase()!=MatchPhase::live) return true;
    player.semi_pending=player.semi_pending || (input.fire && !player.last_fire_down);
    player.last_fire_down=input.fire;
    const bool reload_requested=player.input.reload || input.reload;
    const bool jump_requested=player.input.jump || input.jump;
    const bool grenade_requested=player.input.grenade || input.grenade;
    player.input=input;
    player.input.reload=reload_requested;
    player.input.jump=jump_requested;
    player.input.grenade=grenade_requested;
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
void begin_respawn(Player& victim,bool respawns) {
    ++victim.deaths;
    victim.respawn=respawns?2.5f:0;
    victim.reload=victim.cooldown=victim.shield=victim.equip=victim.grenade_cooldown=0;
    victim.semi_pending=victim.last_fire_down=false;
    victim.input={};
    victim.stale=0.25f;
    victim.mantle={};
    victim.recoil=0;
}

float world_hit(MapId map,Vec3 origin,Vec3 direction,float limit) {
    if(map!=MapId::crossyard) return std::min(limit,local_map::ray(map,origin,direction,limit).distance);
    float nearest=limit;
    for(const auto& box:world_boxes()) if(box.solid) nearest=std::min(nearest,ray_box(origin,direction,box,limit));
    return nearest;
}

float player_hit(Vec3 origin,Vec3 direction,const Player& player) {
    const float height=body_height(player.crouching,player.prone);
    if(!player.prone) {
        const Box body{player.position.x,player.position.y+height/2,player.position.z,kRadius*2,height,kRadius*2,1,1,1};
        return ray_box(origin,direction,body);
    }
    const float s=std::sin(player.yaw), c=std::cos(player.yaw);
    const auto to_local=[=](Vec3 v) { return Vec3{c*v.x+s*v.z,v.y,-s*v.x+c*v.z}; };
    const Vec3 relative{origin.x-player.position.x,origin.y-player.position.y,origin.z-player.position.z};
    const Box body{0,height/2,0,kRadius*2,height,kProneLength,1,1,1};
    return ray_box(to_local(relative),to_local(direction),body);
}

// Sweep the sphere centre against expanded solids, then integrate the reflected remainder.
void advance_grenade(Grenade& grenade,float dt,MapId map) {
    grenade.velocity.y-=kGravity*dt;
    float remaining=dt;
    for(int bounce=0;bounce<6 && remaining>0;++bounce) {
        const Vec3 delta{grenade.velocity.x*remaining,grenade.velocity.y*remaining,grenade.velocity.z*remaining};
        float first=1;
        Vec3 normal{};
        bool collision=false;
        if(map!=MapId::crossyard) {
            const float travel=std::sqrt(delta.x*delta.x+delta.y*delta.y+delta.z*delta.z);
            if(travel>0) {
                const Vec3 direction{delta.x/travel,delta.y/travel,delta.z/travel};
                const auto hit=local_map::ray(map,grenade.position,direction,travel+kGrenadeRadius);
                if(std::isfinite(hit.distance)) {
                    first=std::clamp((hit.distance-kGrenadeRadius)/travel,0.0f,1.0f);
                    normal=hit.normal;
                    collision=true;
                }
            }
        } else {
            if(delta.y<0 && grenade.position.y+delta.y<=kGrenadeRadius) {
                first=std::clamp((kGrenadeRadius-grenade.position.y)/delta.y,0.0f,1.0f);
                normal={0,1,0};
                collision=true;
            }
            for(const auto& box:world_boxes()) {
                if(!box.solid) continue;
                const std::array<float,3> origin{grenade.position.x,grenade.position.y,grenade.position.z};
                const std::array<float,3> direction{delta.x,delta.y,delta.z};
                const std::array<float,3> centre{box.x,box.y,box.z};
                const std::array<float,3> extent{box.sx/2+kGrenadeRadius,box.sy/2+kGrenadeRadius,box.sz/2+kGrenadeRadius};
                float enter=-std::numeric_limits<float>::infinity(),exit=1;
                Vec3 entering{};
                bool miss=false;
                for(int axis=0;axis<3;++axis) {
                    const float lo=centre[axis]-extent[axis],hi=centre[axis]+extent[axis];
                    if(direction[axis]==0) {
                        if(origin[axis]<lo || origin[axis]>hi) { miss=true; break; }
                    } else {
                        float a=(lo-origin[axis])/direction[axis],b=(hi-origin[axis])/direction[axis];
                        const float sign=direction[axis]>0?-1.0f:1.0f;
                        if(a>b) std::swap(a,b);
                        if(a>enter) { enter=a; entering={axis==0?sign:0,axis==1?sign:0,axis==2?sign:0}; }
                        exit=std::min(exit,b);
                        if(enter>exit) { miss=true; break; }
                    }
                }
                if(!miss && enter>=-0.000001f && enter<=first && exit>=0) {
                    first=std::max(0.0f,enter);
                    normal=entering;
                    collision=true;
                }
            }
        }
        grenade.position.x+=delta.x*first;
        grenade.position.y+=delta.y*first;
        grenade.position.z+=delta.z*first;
        if(!collision) break;
        const float incoming=grenade.velocity.x*normal.x+grenade.velocity.y*normal.y+grenade.velocity.z*normal.z;
        grenade.velocity.x=0.6f*(grenade.velocity.x-incoming*normal.x)-0.45f*incoming*normal.x;
        grenade.velocity.y=0.6f*(grenade.velocity.y-incoming*normal.y)-0.45f*incoming*normal.y;
        grenade.velocity.z=0.6f*(grenade.velocity.z-incoming*normal.z)-0.45f*incoming*normal.z;
        if(normal.y>0 && grenade.velocity.y<0.5f) grenade.velocity.y=0;
        if(map==MapId::crossyard && normal.y>0 && grenade.position.y<kGrenadeRadius+0.00001f) grenade.position.y=kGrenadeRadius;
        remaining*=1-first;
    }
}

}

bool clear_sight(MapId map,Vec3 origin,Vec3 destination) {
    const Vec3 delta{destination.x-origin.x,destination.y-origin.y,destination.z-origin.z};
    const float distance=std::hypot(delta.x,delta.y,delta.z);
    if(distance<=0.02f) return true;
    return world_hit(map,origin,{delta.x/distance,delta.y/distance,delta.z/distance},distance)>=distance-0.02f;
}

int Room::choose_respawn(int slot) const {
    int selected=slot;
    float best=-std::numeric_limits<float>::infinity();
    for(int offset=0;offset<kCapacity;++offset) {
        const int candidate=(slot+offset)%kCapacity;
        const auto spot=spawn_point(candidate,map_);
        float enemy_distance=60, ally_distance=60;
        int exposed=0, occupied=0;
        for(int other=0;other<kCapacity;++other) {
            const auto& player=players_[other];
            if(other==slot || !player.active || player.hp<=0) continue;
            const auto pos=player.position;
            const float distance=std::hypot(pos.x-spot.x,pos.y-spot.y,pos.z-spot.z);
            if(distance<1.3f) ++occupied;
            if(teammates(slot,other)) ally_distance=std::min(ally_distance,distance);
            else {
                enemy_distance=std::min(enemy_distance,distance);
                const Vec3 eye{pos.x,pos.y+eye_height(player.crouching,player.prone),pos.z};
                if(clear_sight(map_,eye,{spot.x,spot.y+kEyeHeight,spot.z})) ++exposed;
            }
        }
        // Keep occupied points as a fallback for maps with tightly clustered starts.
        const float score=enemy_distance-ally_distance*.45f-80*exposed-1000*occupied+(team(slot)==team(candidate)?4:0);
        if(score>best) { best=score; selected=candidate; }
    }
    return selected;
}

void Room::finish_round(float dt) {
    round_left_=remaining_after(round_left_,dt);
    std::array<int,kTeamCount> health{};
    for(int slot=0;slot<kCapacity;++slot) health[team(slot)]+=players_[slot].hp;
    if(health[0]>0 && health[1]>0 && round_left_>0) return;
    round_result_=health[0]==health[1]?-1:health[0]>health[1]?0:1;
    if(round_result_>=0 && ++team_scores_[round_result_]>=target_score()) winner_=round_result_;
    else countdown_=kCountdownSeconds;
}

void Room::tick(float dt) {
    if(!std::isfinite(dt) || dt<=0 || dt>0.05f || !playing()) return;
    time_ms_+=static_cast<double>(dt)*1000;
    if(countdown_>0) {
        countdown_=remaining_after(countdown_,dt);
        if(countdown_==0) {
            if(round_result_!=-2) ++round_;
            round_result_=-2;
            round_left_=kRoundSeconds;
            reset_players();
        }
        return;
    }
    for(int slot=0;slot<kCapacity;++slot) {
        auto& player=players_[slot];
        if(!player.active) continue;
        if(player.hp<=0) {
            if(gunfight()) continue;
            player.respawn=remaining_after(player.respawn,dt);
            if(player.respawn==0) {
                deploy(slot,team_mode()?choose_respawn(slot):slot);
            }
            continue;
        }
        player.shield=remaining_after(player.shield,dt);
        player.cooldown=remaining_after(player.cooldown,dt);
        player.equip=remaining_after(player.equip,dt);
        player.grenade_cooldown=remaining_after(player.grenade_cooldown,dt);
        if(player.weapon!=player.input.weapon) {
            player.weapon=player.input.weapon;
            player.equip=0.2f;
            player.reload=0;
        }
        if(player.reload>0) {
            player.reload=remaining_after(player.reload,dt);
            if(player.reload==0) {
                active_ammo(player)=weapon_definition(player.weapon).magazine;
                ++player.reloads;
            }
        }
        const float movement_dt=std::min(dt,std::max(0.0f,0.25f-player.stale));
        Input motion_input=player.input;
        const float length=std::hypot(motion_input.forward,motion_input.strafe);
        if(length>1) { motion_input.forward/=length; motion_input.strafe/=length; }
        const float fraction=movement_dt/dt;
        motion_input.forward*=fraction;
        motion_input.strafe*=fraction;
        const auto motion=step_motion({player.position,player.vertical_velocity,player.grounded,player.crouching,player.prone,player.mantle},motion_input,dt,map_);
        player.position=motion.position;
        player.vertical_velocity=motion.vertical_velocity;
        player.grounded=motion.grounded;
        player.crouching=motion.crouching;
        player.prone=motion.prone;
        player.mantle=motion.mantle;
        player.input.jump=false;
        player.stale=std::min(0.25f,player.stale+dt);
        if(player.stale>=0.25f) {
            player.input.forward=player.input.strafe=0;
            player.input.fire=player.input.reload=player.input.sprint=false;
        }
        player.recoil=recover_weapon_recoil(player.weapon,player.recoil,dt,holding_rifle_recoil(player));
    }
    for(auto& grenade:grenades_) {
        if(!grenade.active) continue;
        if(grenade.exploding) {
            grenade.explosion=remaining_after(grenade.explosion,dt);
            if(grenade.explosion==0) grenade.active=false;
            continue;
        }
        advance_grenade(grenade,dt,map_);
        grenade.fuse=remaining_after(grenade.fuse,dt);
        if(grenade.fuse==0) {
            grenade.exploding=true;
            grenade.explosion=0.35f;
            grenade.velocity={};
            for(int target=0;target<kCapacity;++target) {
                auto& victim=players_[target];
                if(!victim.active || victim.hp<=0 || victim.shield>0 || teammates(grenade.owner,target)) continue;
                const float dx=victim.position.x-grenade.position.x;
                const float dy=victim.position.y+body_height(victim.crouching,victim.prone)/2-grenade.position.y;
                const float dz=victim.position.z-grenade.position.z;
                const float distance=std::sqrt(dx*dx+dy*dy+dz*dz);
                if(distance>=kBlastRadius) continue;
                const Vec3 direction=distance>0?Vec3{dx/distance,dy/distance,dz/distance}:Vec3{};
                if(world_hit(map_,grenade.position,direction,distance)<distance) continue;
                const int damage=static_cast<int>(std::ceil(100*(1-distance/kBlastRadius)));
                victim.hp=std::max(0,victim.hp-damage);
                ++victim.damage;
                const bool credited=grenade.owner>=0 && grenade.owner<kCapacity && players_[grenade.owner].active && grenade.owner!=target;
                if(credited) ++players_[grenade.owner].hit;
                if(victim.hp==0) {
                    if(credited) credit_kill(grenade.owner);
                    begin_respawn(victim,!gunfight());
                    if(winner_>=0) return;
                }
            }
        }
    }
    for(int slot=0;slot<kCapacity;++slot) {
        auto& player=players_[slot];
        if(!player.active || player.hp<=0) continue;
        const bool throw_requested=player.input.grenade;
        player.input.grenade=false;
        if(mantle_uses_hands(player.mantle)) {
            player.input.reload=false;
            player.semi_pending=false;
            continue;
        }
        if(throw_requested && player.grenades>0 && player.grenade_cooldown==0) {
            const auto free=std::find_if(grenades_.begin(),grenades_.end(),[](const Grenade& g) { return !g.active; });
            if(free!=grenades_.end()) {
                *free=Grenade{};
                free->active=true;
                free->id=next_grenade_id_++;
                free->owner=slot;
                free->position={player.position.x,player.position.y+eye_height(player.crouching,player.prone),player.position.z};
                const auto direction=aim_direction(player.yaw,recoil_aim_pitch(player.pitch,player.recoil));
                free->velocity={direction.x*kGrenadeThrowSpeed,direction.y*kGrenadeThrowSpeed+kGrenadeThrowLift,direction.z*kGrenadeThrowSpeed};
                --player.grenades;
                player.grenade_cooldown=0.5f;
                player.shield=0;
            }
        }
        const auto& weapon=weapon_definition(player.weapon);
        if(player.input.reload && player.reload==0 && player.equip==0 && active_ammo(player)<weapon.magazine) player.reload=weapon.reload;
        player.input.reload=false;
        const bool fire_requested=weapon.automatic?player.input.fire:player.semi_pending;
        player.semi_pending=false;
        if(!fire_requested || active_ammo(player)<=0 || player.cooldown>0 || player.reload>0 || player.equip>0) continue;
        --active_ammo(player);
        ++player.shot;
        player.shot_weapon=player.weapon;
        player.cooldown=weapon.interval;
        player.shield=0;
        const Vec3 origin{player.position.x,player.position.y+eye_height(player.crouching,player.prone),player.position.z};
        const auto direction=aim_direction(player.yaw,recoil_aim_pitch(player.pitch,player.recoil));
        player.recoil=std::min(player.recoil+weapon.recoil_kick,weapon.recoil_limit);
        float nearest=world_hit(map_,origin,direction,80);
        int target=-1;
        for(int other=0;other<kCapacity;++other) {
            const auto& candidate=players_[other];
            if(other==slot || !candidate.active || candidate.hp<=0 || teammates(slot,other)) continue;
            const float distance=player_hit(origin,direction,candidate);
            if(distance<nearest) { nearest=distance; target=other; }
        }
        player.trace={origin.x+direction.x*nearest,origin.y+direction.y*nearest,origin.z+direction.z*nearest};
        if(target>=0 && players_[target].shield<=0) {
            auto& victim=players_[target];
            victim.hp=std::max(0,victim.hp-weapon.damage);
            ++victim.damage;
            ++player.hit;
            if(victim.hp==0) {
                credit_kill(slot);
                begin_respawn(victim,!gunfight());
                if(winner_>=0) return;
            }
        }
    }
    if(gunfight()) finish_round(dt);
}

namespace {
float slide_axis(Vec3 from,float delta,bool x_axis,float height=kStandingHeight);

bool box_blocked(Vec3 feet,float height) {
    for(const auto& box:world_boxes()) {
        const float x=box.sx/2+kRadius,z=box.sz/2+kRadius;
        if(box.solid && feet.x>box.x-x && feet.x<box.x+x && feet.z>box.z-z && feet.z<box.z+z &&
           feet.y<box.y+box.sy/2 && feet.y+height>box.y-box.sy/2) return true;
    }
    return false;
}

float box_ground(Vec3 origin,float limit) {
    float top=-std::numeric_limits<float>::infinity();
    if(origin.y>=0 && origin.y<=limit && std::abs(origin.x)<=24 && std::abs(origin.z)<=24) top=0;
    for(const auto& box:world_boxes()) {
        if(!box.solid || std::abs(origin.x-box.x)>box.sx/2 || std::abs(origin.z-box.z)>box.sz/2) continue;
        const float height=box.y+box.sy/2;
        if(height<=origin.y && height>=origin.y-limit) top=std::max(top,height);
    }
    return top;
}
}

float body_height(bool crouching,bool prone) { return prone?kProneHeight:(crouching?kCrouchHeight:kStandingHeight); }
float eye_height(bool crouching,bool prone) { return prone?kProneEyeHeight:(crouching?kCrouchEyeHeight:kEyeHeight); }

MotionState step_motion(MotionState state,const Input& input,float dt,MapId map) {
    if(!std::isfinite(dt) || dt<=0 || dt>0.05f || !valid_input(input)) return state;
    if(state.mantle.active()) {
        const float remaining=mantle_duration(state.mantle)-state.mantle.elapsed;
        state=advance_mantle(state,dt);
        if(state.mantle.active() || dt<=remaining) return state;
        Input continuation=input;
        continuation.jump=false;
        return step_motion(state,continuation,dt-remaining,map);
    }
    if(map!=MapId::crossyard) return local_map::motion(map,state,input,dt);
    apply_stance(state,input,[&](float height) { return box_blocked(state.position,height); });
    if(try_mantle(state,input,[](Vec3 feet) { return box_blocked(feet,kStandingHeight); },box_ground)) return advance_mantle(state,dt);
    const float height=body_height(state.crouching,state.prone);
    float forward=input.forward,strafe=input.strafe;
    const float length=std::hypot(forward,strafe);
    if(length>1) { forward/=length; strafe/=length; }
    const float distance=movement_speed(state,input.sprint)*dt;
    const float dx=(std::sin(input.yaw)*forward+std::cos(input.yaw)*strafe)*distance;
    const float dz=(-std::cos(input.yaw)*forward+std::sin(input.yaw)*strafe)*distance;
    state.position.x=slide_axis(state.position,dx,true,height);
    state.position.z=slide_axis(state.position,dz,false,height);
    bool supported=state.position.y==0;
    for(const auto& box:world_boxes()) {
        if(box.solid && std::abs(state.position.x-box.x)<box.sx/2+kRadius &&
           std::abs(state.position.z-box.z)<box.sz/2+kRadius &&
           std::abs(state.position.y-(box.y+box.sy/2))<0.00001f) supported=true;
    }
    state.grounded=state.grounded && supported;
    if(input.jump && state.grounded && !state.prone) {
        state.vertical_velocity=kJumpSpeed;
        state.grounded=false;
    }
    if(!state.grounded) {
        state.vertical_velocity-=kGravity*dt;
        const float start=state.position.y;
        state.position.y+=state.vertical_velocity*dt;
        if(state.vertical_velocity>0) {
            for(const auto& box:world_boxes()) {
                const float bottom=box.y-box.sy/2;
                if(box.solid && std::abs(state.position.x-box.x)<box.sx/2+kRadius &&
                   std::abs(state.position.z-box.z)<box.sz/2+kRadius &&
                   start+height<=bottom && state.position.y+height>=bottom) {
                    state.position.y=std::min(state.position.y,bottom-height);
                    state.vertical_velocity=0;
                }
            }
        }
        float landing=0;
        if(state.vertical_velocity<=0) {
            for(const auto& box:world_boxes()) {
                const float top=box.y+box.sy/2;
                if(box.solid && std::abs(state.position.x-box.x)<box.sx/2+kRadius &&
                   std::abs(state.position.z-box.z)<box.sz/2+kRadius &&
                   start>=top && state.position.y<=top) landing=std::max(landing,top);
            }
            if(state.position.y<=landing) {
                state.position.y=landing;
                state.vertical_velocity=0;
                state.grounded=true;
            }
        }
    }
    return state;
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
float slide_axis(Vec3 from,float delta,bool x_axis,float height) {
    const float start=x_axis?from.x:from.z;
    float end=start+delta;
    for(const auto& box:world_boxes()) {
        if(!box.solid || box.y+box.sy/2<=from.y || box.y-box.sy/2>=from.y+height) continue;
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
