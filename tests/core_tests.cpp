#include "arena.hpp"
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <locale>
#include <string>
// The fixed test build lists game.cpp only; exercise the real C bridge in this test TU.
#include "../core/bridge.cpp"

int checks=0;
void check(bool value,const char* message) {
    ++checks;
    if(!value) { std::cerr << "FAIL: " << message << "\n"; std::exit(1); }
}
bool near(float a,float b,float eps=0.002f) { return std::abs(a-b)<eps; }
void send(arena::Room& room,int id,arena::Input input) {
    input.seq=room.players()[id].ack+1;
    check(room.set_input(id,input),"public room input accepted");
}
void ticks(arena::Room& room,int count,float dt=0.05f) {
    for(int i=0;i<count;++i) room.tick(dt);
}
struct CommaDecimal:std::numpunct<char> {
    char do_decimal_point() const override { return ','; }
};
int main() {
    const auto p=arena::move_position({0,0,-18},1,0,0,0.05f,false);
    check(near(p.z,-18.25f),"forward moves in camera direction at 5m/s");
    check(near(p.x,0),"forward preserves perpendicular position");
    const auto right=arena::move_position({0,0,-18},0,1,0,0.05f,false);
    check(near(right.x,0.25f) && near(right.z,-18),"positive strafe is local camera right");
    const auto east=arena::move_position({0,0,-18},1,0,arena::kPi/2,0.05f,false);
    check(near(east.x,0.25f) && near(east.z,-18),"positive quarter-turn forward is +X");
    const auto south=arena::move_position({0,0,-18},0,1,arena::kPi/2,0.05f,false);
    check(near(south.x,0) && near(south.z,-17.75f),"strafe rotates with camera yaw");
    const auto diagonal=arena::move_position({0,0,-18},1,1,0,0.05f,false);
    check(near(std::hypot(diagonal.x,diagonal.z+18),0.25f),"diagonal movement normalizes to walking speed");
    const auto sprint=arena::move_position({0,0,-18},1,-1,0,0.05f,true);
    check(near(std::hypot(sprint.x,sprint.z+18),0.35f),"diagonal sprint is capped at 7m/s");
    const auto analog=arena::move_position({0,0,-18},0.5f,0,0,0.05f,false);
    check(near(analog.z,-18.125f),"subunit analog movement is not normalized upward");
    for(float dt:{-0.01f,0.0f,0.0501f,std::numeric_limits<float>::quiet_NaN(),std::numeric_limits<float>::infinity()}) {
        const auto invalid=arena::move_position({2,0,-18},1,0,0,dt,false);
        check(invalid.x==2 && invalid.y==0 && invalid.z==-18,"invalid movement dt must leave position unchanged");
    }
    for(float value:{-1.01f,1.01f,std::numeric_limits<float>::quiet_NaN(),std::numeric_limits<float>::infinity()}) {
        const auto invalid=arena::move_position({2,0,-18},value,0,0,0.05f,false);
        check(invalid.x==2 && invalid.z==-18,"prediction rejects invalid movement input");
    }
    const auto wall=arena::move_position({23,0,-18},0,1,0,0.05f,false);
    check(near(wall.x,23.15f),"perimeter collision clamps player radius before wall face");
    const auto slide=arena::move_position({23,0,-18},1,1,0,0.05f,false);
    check(near(slide.x,23.15f) && near(slide.z,-18-0.25f/std::sqrt(2.0f)),"collision slides along unblocked wall axis");
    const auto warehouse=arena::move_position({0,0,-5.5f},-1,0,0,0.05f,false);
    check(near(warehouse.z,-5.35f),"central warehouse blocks movement using full box dimensions");
    const auto overhead=arena::move_position({0,0,-10.3f},-1,0,0,0.05f,false);
    check(near(overhead.z,-10.05f),"overhead solids do not block ground movement");
    const auto foundation=arena::move_position({-12,0,-11.6f},-1,0,0,0.05f,false);
    check(near(foundation.z,-11.35f),"solids ending at ground height do not block movement");
    check(arena::world_boxes().size()>=45,"industrial yard includes procedural skyline and tree geometry");
    int decorations=0;
    for(const auto& box:arena::world_boxes()) {
        check(std::isfinite(box.x) && std::isfinite(box.y) && std::isfinite(box.z) &&
              box.sx>0 && box.sy>0 && box.sz>0 &&
              box.r>=0 && box.r<=1 && box.g>=0 && box.g<=1 && box.b>=0 && box.b<=1,
              "rendered map boxes have finite centers, full dimensions and normalized RGB");
        if(!box.solid) ++decorations;
        const bool north_lane=box.solid && box.y+box.sy/2>arena::kEyeHeight && box.y-box.sy/2<arena::kEyeHeight &&
            box.z-box.sz/2<=-18 && box.z+box.sz/2>=-18 && box.x+box.sx/2>-18 && box.x-box.sx/2<18;
        check(!north_lane,"spawn 0 to 1 north firing lane stays unobstructed");
    }
    check(decorations>=20,"skyline and foliage remain non-solid decorations");
    const auto aim=arena::aim_direction(arena::kPi/2,0);
    check(near(aim.x,1) && near(aim.y,0) && near(aim.z,0),"aim uses movement yaw convention");
    const auto up=arena::aim_direction(0,0.5f);
    check(up.y>0 && near(up.z,-std::cos(0.5f)) && near(up.x*up.x+up.y*up.y+up.z*up.z,1),"positive pitch aims upward with unit direction");
    const arena::Box target{0,1,0,2,2,2,1,1,1};
    check(near(arena::ray_box({-5,1,0},{1,0,0},target),4),"ray enters centered full-dimension AABB at nearest face");
    check(std::isinf(arena::ray_box({-5,3,0},{1,0,0},target)),"parallel ray outside slab misses");
    check(std::isinf(arena::ray_box({5,1,0},{1,0,0},target)),"box behind ray origin misses");
    check(near(arena::ray_box({0,1,0},{1,0,0},target),0),"ray originating inside box hits at zero");
    check(near(arena::ray_box({-5,2,1},{1,0,0},target,4),4),"ray face and exact distance boundaries are inclusive");
    check(std::isinf(arena::ray_box({-5,1,0},{1,0,0},target,3.999f)),"ray cannot hit past max distance");
    check(std::isinf(arena::ray_box({0,1,0},{0,0,0},target)),"zero direction is a safe ray miss");
    check(std::isinf(arena::ray_box({0,1,0},{std::numeric_limits<float>::quiet_NaN(),0,0},target)),"non-finite ray is a safe miss");
    float cover=80;
    for(const auto& box:arena::world_boxes()) if(box.solid)
        cover=std::min(cover,arena::ray_box({-18,arena::kEyeHeight,-18},{0,0,1},box));
    check(near(cover,15.5f),"west cover blocks real spawn 0 to 2 sight line");
    {
        arena::Room room;
        check(room.count()==0 && room.time()==0,"new room is empty with zero simulation time");
        const std::array<arena::Vec3,4> expected={arena::Vec3{-18,0,-18},arena::Vec3{18,0,-18},arena::Vec3{-18,0,18},arena::Vec3{18,0,18}};
        for(int i=0;i<arena::kCapacity;++i) {
            check(room.join()==i,"join takes first free slot in a four-player room");
            const auto& member=room.players()[i];
            const auto spawn=arena::spawn_point(i);
            check(member.active && near(member.position.x,expected[i].x) && member.position.y==0 && near(member.position.z,expected[i].z),"slot spawns at fixed unobstructed corner");
            check(near(spawn.x,expected[i].x) && near(spawn.z,expected[i].z),"shared spawn helper matches room positions");
            const auto facing=arena::aim_direction(arena::spawn_yaw(i),0);
            check(facing.x*expected[i].x+facing.z*expected[i].z< -25 && near(member.yaw,arena::spawn_yaw(i)),"spawn camera faces arena center");
            check(member.hp==100 && member.ammo==24 && near(member.shield,1.5f) && member.ack==0,"new membership initializes health, magazine and shield in seconds");
        }
        check(room.join()==-1 && room.count()==4,"fifth player is rejected without changing capacity");
        room.leave(-1); room.leave(4);
        check(room.count()==4,"invalid leave slot is harmless");
        room.leave(2); room.leave(2);
        check(room.count()==3 && !room.players()[2].active,"leave is idempotent and clears active slot");
        check(room.join()==2 && room.count()==4,"vacant slot is reusable");
    }
    {
        arena::Input input;
        check(arena::valid_input(input),"zero input including seq zero is valid");
        input.seq=2147483647u;
        check(arena::valid_input(input),"maximum signed transport sequence is valid");
        input.seq=2147483648u;
        check(!arena::valid_input(input),"transport sequence above signed maximum is rejected");
        const std::array<float arena::Input::*,4> fields={&arena::Input::forward,&arena::Input::strafe,&arena::Input::yaw,&arena::Input::pitch};
        const std::array<float,4> limits={1,1,arena::kPi,1.45f};
        for(int field=0;field<4;++field) {
            for(float sign:{-1.0f,1.0f}) {
                input={}; input.*fields[field]=sign*limits[field];
                check(arena::valid_input(input),"input finite inclusive range boundary is accepted");
                input.*fields[field]=sign*(limits[field]+0.001f);
                check(!arena::valid_input(input),"input just outside finite range is rejected");
            }
            for(float bad:{std::numeric_limits<float>::quiet_NaN(),std::numeric_limits<float>::infinity(),-std::numeric_limits<float>::infinity()}) {
                input={}; input.*fields[field]=bad;
                check(!arena::valid_input(input),"NaN and infinities are rejected in every input float");
            }
        }
        arena::Room room;
        const int id=room.join();
        input={}; input.seq=1; input.forward=1;
        check(room.set_input(id,input),"active membership accepts validated input");
        room.tick(0.05f);
        check(near(room.players()[id].position.z,-18.25f) && room.players()[id].ack==1 && near(static_cast<float>(room.time()),50),"room advances shared movement from server dt and publishes ack/time");
        input.seq=2; input.forward=0; input.strafe=1; input.yaw=arena::kPi/2; input.pitch=0.25f;
        check(room.set_input(id,input),"fresh input is accepted");
        room.tick(0.05f);
        check(near(room.players()[id].position.z,-18) && near(room.players()[id].yaw,arena::kPi/2) && near(room.players()[id].pitch,0.25f),"authoritative movement and aim use fresh controls");
        input.seq=2; input.yaw=-1; input.fire=true;
        check(room.set_input(id,input) && near(room.players()[id].yaw,arena::kPi/2) && !room.players()[id].input.fire,"duplicate valid sequence is ignored without effects");
        input.seq=1;
        check(room.set_input(id,input) && room.players()[id].ack==2,"older valid sequence is ignored without decreasing ack");
        input.forward=2;
        check(!room.set_input(id,input) && room.players()[id].ack==2,"invalid stale input is rejected before sequence handling");
        input={}; input.seq=3;
        check(!room.set_input(-1,input) && !room.set_input(4,input) && !room.set_input(1,input),"inactive and out-of-bounds membership inputs are rejected");
        const auto before=room.players()[id];
        const double time=room.time();
        for(float dt:{-0.01f,0.0f,0.0501f,std::numeric_limits<float>::quiet_NaN(),std::numeric_limits<float>::infinity()}) room.tick(dt);
        check(room.time()==time && room.players()[id].position.z==before.position.z && room.players()[id].shield==before.shield,"invalid room dt does not advance any state or clock");
    }
    {
        arena::Room room; const int id=room.join();
        arena::Input held; held.seq=1; held.forward=1; held.yaw=arena::kPi/2; held.pitch=0.2f; held.fire=true; held.reload=true; held.sprint=false;
        check(room.set_input(id,held),"timeout fixture accepts held controls");
        for(int i=0;i<4;++i) room.tick(0.05f);
        check(near(room.players()[id].position.x,-17),"fresh controls move for first 200ms");
        check(room.set_input(id,held),"duplicate timeout packet is valid but stale");
        room.tick(0.05f);
        const auto stopped=room.players()[id];
        check(near(stopped.position.x,-16.75f),"controls integrate through exactly 250ms before expiry");
        check(stopped.input.forward==0 && stopped.input.strafe==0 && !stopped.input.fire && !stopped.input.reload && !stopped.input.sprint,"250ms timeout clears all held actions");
        for(int i=0;i<10;++i) room.tick(0.05f);
        check(near(room.players()[id].position.x,stopped.position.x) && near(room.players()[id].yaw,held.yaw) && near(room.players()[id].pitch,held.pitch),"timed-out controls stop movement while retaining aim");
        held.seq=2; held.forward=-1; held.fire=false; held.reload=false;
        check(room.set_input(id,held),"strictly newer sequence restores fresh controls");
        room.tick(0.05f);
        check(near(room.players()[id].position.x,-17),"fresh controls resume movement after timeout");
    }
    {
        arena::Room room; const int shooter=room.join(),victim=room.join(),covered=room.join();
        arena::Input fire; fire.fire=true; fire.yaw=arena::kPi/2;
        send(room,shooter,fire); room.tick(0.01f);
        check(room.players()[shooter].shot==1 && room.players()[shooter].ammo==23,"public fire consumes one round and emits one shot");
        check(room.players()[shooter].shield==0 && room.players()[victim].hp==100 && room.players()[shooter].hit==0,"firing drops own shield but cannot damage a protected target");
        check(near(room.players()[shooter].trace.x,17.65f) && near(room.players()[shooter].trace.z,-18),"shielded body physically terminates shot trace");
        send(room,shooter,{}); ticks(room,3);
        arena::Input north; north.fire=true;
        send(room,victim,north); room.tick(0.01f);
        check(room.players()[victim].shield==0 && near(room.players()[victim].trace.z,-23.5f),"protected target releases shield by firing and miss traces nearest wall");
        send(room,victim,{}); ticks(room,3);
        send(room,shooter,fire); room.tick(0.01f);
        check(room.players()[victim].hp==75 && room.players()[victim].damage==1 && room.players()[shooter].hit==1 && room.players()[shooter].shot==2,"real spawn 0 to 1 shot damages 25 and increments actual hit/damage events");
        check(near(room.players()[shooter].trace.x,17.65f),"nearest player body wins before farther perimeter surface");
        send(room,shooter,{}); ticks(room,3);
        arena::Input south; south.fire=true; south.yaw=arena::kPi;
        send(room,covered,south); room.tick(0.01f); send(room,covered,{}); ticks(room,3);
        send(room,shooter,south); room.tick(0.01f);
        check(room.players()[covered].shield==0 && room.players()[covered].hp==100 && room.players()[covered].damage==0,"real west cover occludes an unprotected player behind it");
        check(near(room.players()[shooter].trace.z,-2.5f) && room.players()[shooter].hit==1,"solid cover, not occluded player, determines trace and hit counter");
        send(room,shooter,{}); ticks(room,3);
        fire.pitch=1.45f; send(room,shooter,fire); room.tick(0.01f);
        const auto trace=room.players()[shooter].trace;
        check(near(std::sqrt((trace.x+18)*(trace.x+18)+(trace.y-arena::kEyeHeight)*(trace.y-arena::kEyeHeight)+(trace.z+18)*(trace.z+18)),80),"open-sky miss still emits finite 80m trace endpoint");
    }
    {
        arena::Room room; const int id=room.join();
        arena::Input fire; fire.fire=true; fire.pitch=1.45f;
        send(room,id,fire); room.tick(0.01f);
        check(room.players()[id].shot==1 && near(room.players()[id].cooldown,0.12f),"first shot arms 120ms cooldown in seconds");
        for(int i=0;i<11;++i) { send(room,id,fire); room.tick(0.01f); }
        check(room.players()[id].shot==1,"held fire cannot shoot again at 110ms");
        send(room,id,fire); room.tick(0.009f);
        check(room.players()[id].shot==1,"held fire cannot shoot again just below 120ms");
        send(room,id,fire); room.tick(0.001f);
        check(room.players()[id].shot==2 && room.players()[id].ammo==22,"held fire may shoot at exactly 120ms");
        for(int i=0;i<400;++i) { send(room,id,fire); room.tick(0.01f); }
        check(room.players()[id].ammo==0 && room.players()[id].shot==24,"magazine caps firing at exactly 24 shots without negative ammo or automatic refill");
        room.leave(id); check(room.join()==id,"rejoin reuses exhausted slot");
        check(room.players()[id].ammo==24 && room.players()[id].shot==0 && room.players()[id].ack==0 && room.players()[id].cooldown==0,"new membership resets all resources and event/sequence counters");
    }
    {
        arena::Room room; const int id=room.join();
        arena::Input fire; fire.fire=true; fire.pitch=1.45f;
        send(room,id,fire); ticks(room,5);
        const auto shots=room.players()[id].shot;
        check(shots>0 && !room.players()[id].input.fire,"stale fire is cleared at timeout");
        ticks(room,20);
        check(room.players()[id].shot==shots,"timed-out fire cannot continue consuming ammunition");
    }
    {
        arena::Room room; const int id=room.join();
        arena::Input reload; reload.reload=true;
        send(room,id,reload); room.tick(0.01f);
        check(room.players()[id].reload==0 && room.players()[id].ammo==24,"reload on a full magazine does nothing");
        arena::Input fire; fire.fire=true;
        send(room,id,fire); room.tick(0.01f);
        send(room,id,reload); room.tick(0.01f);
        check(near(room.players()[id].reload,1.5f) && room.players()[id].ammo==23,"manual reload starts 1.5 seconds without immediately refilling");
        reload.fire=true;
        for(int i=0;i<29;++i) { send(room,id,reload); room.tick(0.05f); }
        check(room.players()[id].shot==1 && room.players()[id].ammo==23 && near(room.players()[id].reload,0.05f),"held reload does not restart timer and firing is blocked while reloading");
        reload.fire=false; send(room,id,reload); room.tick(0.049f);
        check(room.players()[id].ammo==23 && room.players()[id].reload>0,"reload does not complete just before 1.5 seconds");
        send(room,id,reload); room.tick(0.001f);
        check(room.players()[id].ammo==24 && room.players()[id].reload==0 && room.players()[id].shot==1,"reload completes at exactly 1.5 seconds");
        send(room,id,fire); room.tick(0.01f); send(room,id,reload); room.tick(0.01f);
        ticks(room,30);
        check(room.players()[id].ammo==24 && room.players()[id].reload==0 && !room.players()[id].input.reload,"an in-progress reload finishes even after its input times out");
    }
    {
        arena::Room room; const int id=room.join();
        arena::Input fire; fire.fire=true;
        for(int i=0;i<24;++i) {
            send(room,id,fire); room.tick(0.01f); send(room,id,{}); ticks(room,3);
        }
        check(room.players()[id].ammo==0 && room.players()[id].shot==24,"reload fixture exhausts real magazine through public fire inputs");
        arena::Input reload; reload.reload=true; reload.fire=true;
        send(room,id,reload); room.tick(0.01f);
        check(room.players()[id].reload>0 && room.players()[id].shot==24,"empty magazine may reload but cannot fire during it");
        ticks(room,30);
        check(room.players()[id].ammo==24 && room.players()[id].shot==24,"empty-magazine manual reload restores exactly 24 rounds");
    }
    {
        arena::Room room; const int shooter=room.join(),victim=room.join();
        ticks(room,29); room.tick(0.049f);
        check(room.players()[victim].shield>0 && room.players()[victim].shield<0.002f,"spawn shield remains active just before 1.5 seconds");
        room.tick(0.001f);
        check(room.players()[victim].shield==0 && room.players()[shooter].shield==0,"spawn shield expires at exactly 1.5 seconds without requiring target action");
        arena::Input fire; fire.fire=true; fire.yaw=arena::kPi/2;
        send(room,shooter,fire); room.tick(0.01f);
        check(room.players()[victim].hp==75 && room.players()[shooter].hit==1,"public shot damages idle target after natural shield expiry");
    }
    {
        arena::Room room; const int shooter=room.join(),victim=room.join(); ticks(room,30);
        arena::Input sky; sky.fire=true; sky.pitch=1.45f;
        send(room,victim,sky); room.tick(0.01f);
        arena::Input reload; reload.reload=true; send(room,victim,reload); room.tick(0.01f);
        arena::Input fire; fire.fire=true; fire.yaw=arena::kPi/2;
        for(int hit=0;hit<3;++hit) {
            send(room,shooter,fire); room.tick(0.01f); send(room,shooter,{}); ticks(room,3);
        }
        check(room.players()[victim].hp==25 && room.players()[victim].reload>0,"three public hits leave target alive and reloading");
        send(room,shooter,fire); room.tick(0.01f);
        const auto dead=room.players()[victim];
        check(dead.hp==0 && dead.deaths==1 && room.players()[shooter].kills==1,"fourth public hit kills exactly once");
        check(dead.damage==4 && room.players()[shooter].hit==4 && dead.shot==1,"death preserves cumulative hit, damage and shot counters");
        check(near(dead.respawn,2.5f) && dead.reload==0 && dead.cooldown==0 && dead.shield==0,"death starts 2.5s timer and cancels weapon/shield state");
        check(dead.input.forward==0 && !dead.input.fire && !dead.input.reload,"death clears held controls immediately");
        for(int i=0;i<3;++i) { send(room,shooter,fire); room.tick(0.05f); }
        check(room.players()[shooter].kills==1 && room.players()[victim].deaths==1 && room.players()[shooter].hit==4,"further shots cannot score repeated death or hits on a corpse");
        check(near(room.players()[shooter].trace.x,23.5f),"dead player body no longer occludes live shot trace");
    }
    {
        arena::Room room; const int shooter=room.join(),victim=room.join();
        arena::Input move; move.strafe=-1; send(room,victim,move); room.tick(0.05f); send(room,victim,{});
        arena::Input sky; sky.fire=true; sky.pitch=1.45f;
        send(room,victim,sky); room.tick(0.01f); send(room,victim,{}); ticks(room,30);
        arena::Input fire; fire.fire=true; fire.yaw=arena::kPi/2;
        for(int hit=0;hit<4;++hit) {
            send(room,shooter,fire); room.tick(0.01f); send(room,shooter,{});
            if(hit<3) ticks(room,3);
        }
        check(room.players()[victim].hp==0 && near(room.players()[victim].position.x,17.75f),"respawn fixture kills target moved through real public inputs");
        const auto corpse=room.players()[victim];
        arena::Input dead; dead.forward=1; dead.strafe=1; dead.yaw=1; dead.pitch=0.5f; dead.fire=dead.reload=dead.sprint=true;
        send(room,victim,dead);
        check(room.players()[victim].ack==corpse.ack+1 && !room.players()[victim].input.fire && !room.players()[victim].input.reload && room.players()[victim].input.forward==0,"dead input is acknowledged but cannot buffer actions");
        auto invalid=dead; invalid.seq=room.players()[victim].ack+1; invalid.pitch=std::numeric_limits<float>::quiet_NaN();
        check(!room.set_input(victim,invalid) && room.players()[victim].ack==corpse.ack+1,"dead input still requires full validation before ack");
        for(int i=0;i<49;++i) {
            send(room,victim,dead); room.tick(0.05f);
            check(room.players()[victim].hp==0 && near(room.players()[victim].position.x,corpse.position.x) && room.players()[victim].shot==corpse.shot,"dead movement and firing stay disabled during respawn timer");
        }
        room.tick(0.049f);
        check(room.players()[victim].hp==0 && room.players()[victim].respawn>0,"respawn cannot complete just before 2.5 seconds");
        send(room,victim,dead); const auto last_ack=room.players()[victim].ack; room.tick(0.001f);
        const auto revived=room.players()[victim];
        check(revived.hp==100 && revived.ammo==24 && revived.respawn==0 && revived.reload==0 && revived.cooldown==0,"respawn completes exactly at 2.5 seconds with fresh health and resources");
        check(near(revived.position.x,18) && near(revived.position.z,-18) && revived.position.y==0 && near(revived.yaw,arena::spawn_yaw(victim)) && revived.pitch==0,"respawn restores own spawn position and camera");
        check(revived.deaths==1 && revived.damage==4 && revived.shot==1 && revived.ack==last_ack && room.players()[shooter].kills==1,"respawn preserves membership scores, event counters and latest ack");
        check(near(revived.shield,1.5f) && revived.input.forward==0 && !revived.input.fire && !revived.input.reload,"respawn renews shield and discards last dead-held inputs");
        room.tick(0.05f);
        check(near(room.players()[victim].position.x,18) && room.players()[victim].ammo==24 && room.players()[victim].shot==1,"dead controls do not execute on first live tick");
        move={}; move.forward=1; move.yaw=0; send(room,victim,move); room.tick(0.05f);
        check(near(room.players()[victim].position.z,-18.25f),"only a fresh post-respawn sequence can resume movement");
        room.leave(victim); check(room.join()==victim,"dead membership slot may leave and rejoin"); room.tick(0.05f);
        check(room.players()[victim].hp==100 && room.players()[victim].deaths==0 && room.players()[victim].shot==0 && room.players()[victim].ack==0 && near(room.players()[victim].position.z,-18),"leave/rejoin removes old controls and membership counters");
    }
    {
        const auto handle=room_create();
        check(handle!=0,"C ABI creates an owned room handle");
        check(room_join(handle)==0 && room_join(handle)==1 && room_join(handle)==2 && room_join(handle)==3 && room_join(handle)==-1,"C ABI enforces four-player capacity");
        check(room_input(handle,0,1,0,0,0,0,0,0,1)==1,"C ABI accepts valid input fields and flags");
        room_tick(handle,0.05f);
        const auto& state=*reinterpret_cast<const arena::Room*>(handle);
        check(near(state.players()[0].position.z,-18.25f) && state.players()[0].ack==1 && near(static_cast<float>(state.time()),50),"C ABI input and tick execute real authoritative simulation");
        check(room_input(handle,0,0,0,0,0,2,0,0,2)==0 && room_input(handle,0,0,0,0,0,0,-1,0,2)==0 && room_input(handle,0,0,0,0,0,0,0,2,2)==0,"C ABI rejects non-boolean integer flags");
        check(room_input(handle,0,0,0,std::numeric_limits<float>::infinity(),0,0,0,0,2)==0 && state.players()[0].ack==1,"C ABI cannot bypass float validation or mutate rejected ack");
        room_leave(handle,0); room_tick(handle,0.05f);
        check(state.count()==3 && !state.players()[0].active,"C ABI leave clears active membership");
        check(room_join(handle)==0 && state.players()[0].ack==0 && near(state.players()[0].position.z,-18),"C ABI rejoin does not inherit old movement or sequence");
        const auto independent=room_create(); check(room_join(independent)==0,"separate C ABI room owns independent capacity");
        room_destroy(independent); room_destroy(handle);
        check(room_join(0)==-1 && room_input(0,0,0,0,0,0,0,0,0,1)==0,"null C ABI handles fail safely");
        room_leave(0,0); room_tick(0,0.05f); room_destroy(0);
    }
    {
        check(std::string(room_snapshot(0))=="{\"time\":0,\"players\":[]}","null snapshot is a valid finite empty JSON room");
        const auto handle=room_create();
        check(std::string(room_snapshot(handle))=="{\"time\":0,\"players\":[]}","empty room snapshot has exact transport envelope");
        room_join(handle); room_join(handle); room_leave(handle,0);
        const auto old_locale=std::locale();
        std::locale::global(std::locale(std::locale::classic(),new CommaDecimal));
        const char* snapshot=room_snapshot(handle);
        check(EM_ASM_INT({
            const s=JSON.parse(UTF8ToString($0));
            const expected="id,x,y,z,yaw,pitch,hp,ammo,kills,deaths,reload,respawn,shield,shot,hit,damage,ack,trace".split(",").sort().join(",");
            return Object.keys(s).sort().join(",")==="players,time" && s.time===0 && s.players.length===1 && s.players[0].id===1 &&
                s.players.every(p => Object.keys(p).sort().join(",")===expected &&
                    Object.values(p).filter(v => typeof v==="number").every(Number.isFinite) && p.trace.length===3 && p.trace.every(Number.isFinite)) &&
                s.players[0].shield===1500 && s.players[0].respawn===0 && s.players[0].reload===0;
        },snapshot)==1,"snapshot parses as exact active-only schema with finite numbers and millisecond durations under comma locale");
        const std::string cached=snapshot;
        room_tick(handle,0.05f);
        check(cached==snapshot,"snapshot C string remains valid across tick until next snapshot call");
        snapshot=room_snapshot(handle);
        check(EM_ASM_INT({const s=JSON.parse(UTF8ToString($0)); return Math.abs(s.time-50)<0.001 && Math.abs(s.players[0].shield-1450)<0.001;},snapshot)==1,"room clock and remaining shield serialize in milliseconds");
        room_input(handle,1,0,0,0,0,1,0,0,1); room_tick(handle,0.01f);
        room_input(handle,1,0,0,0,0,0,1,0,2); room_tick(handle,0.01f);
        check(EM_ASM_INT({const p=JSON.parse(UTF8ToString($0)).players[0]; return p.ammo===23 && p.shot===1 && p.hit===0 && p.reload===1500 && p.shield===0 && p.ack===2;},room_snapshot(handle))==1,"reload snapshot converts seconds to ms and preserves authoritative resource/event values");
        std::locale::global(old_locale);
        room_destroy(handle);
    }
    std::cout << "PASS " << checks << " C++ checks\n";
}
