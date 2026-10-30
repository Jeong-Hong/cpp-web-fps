#include "arena.hpp"
#include <algorithm>
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
void drive(arena::Room& room,int id,float forward,float strafe,int count) {
    arena::Input input{}; input.forward=forward; input.strafe=strafe;
    for(int i=0;i<count;++i) { send(room,id,input); room.tick(0.05f); }
    send(room,id,{});
}
void place_floor(arena::Room& room,int id,float x,float z) {
    for(int axis=0;axis<2;++axis) {
        for(int i=0;i<400;++i) {
            const auto p=room.players()[id].position;
            const float delta=axis==0?x-p.x:z-p.z;
            if(std::abs(delta)<0.000001f) break;
            arena::Input input{};
            if(axis==0) input.strafe=std::clamp(delta/(arena::kSpeed*0.05f),-1.0f,1.0f);
            else input.forward=std::clamp(-delta/(arena::kSpeed*0.05f),-1.0f,1.0f);
            send(room,id,input); room.tick(0.05f);
        }
    }
    send(room,id,{});
    check(near(room.players()[id].position.x,x,0.00001f) && near(room.players()[id].position.z,z,0.00001f),"public floor placement reaches requested unobstructed coordinates");
}
struct CommaDecimal:std::numpunct<char> {
    char do_decimal_point() const override { return ','; }
};
int main() {
    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.weapon=1; send(room,id,input); room.tick(0.01f); ticks(room,4);
        input.fire=true; send(room,id,input); room.tick(0.01f);
        input.fire=false; input.reload=true; send(room,id,input); room.tick(0.01f);
        input.reload=false; input.fire=true; send(room,id,input); input.fire=false; send(room,id,input); room.tick(0.01f); ticks(room,24);
        check(room.players()[id].shot==1 && room.players()[id].pistol_ammo==12 && !room.players()[id].semi_pending,"reload-rejected pistol press never fires after the reload finishes");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.weapon=1; input.pitch=1.45f; send(room,id,input); room.tick(0.01f); ticks(room,4);
        for(int i=0;i<15;++i) {
            input.fire=true; send(room,id,input); room.tick(0.01f);
            input.fire=false; send(room,id,input); ticks(room,6);
        }
        check(room.players()[id].shot==12 && room.players()[id].pistol_ammo==0 && room.players()[id].ammo==24,"pistol magazine caps at twelve actual press shots with no rifle consumption");
        input.reload=true; send(room,id,input); room.tick(0.01f); ticks(room,24);
        check(room.players()[id].pistol_ammo==12 && room.players()[id].ammo==24 && room.players()[id].shot==12,"empty pistol reload restores only its twelve-round magazine");
    }

    {
        for(float tail:{0.029f,0.03f,0.031f}) {
            arena::Room room; const int id=room.join();
            arena::Input input{}; input.weapon=1; send(room,id,input); room.tick(0.01f); ticks(room,4);
            input.fire=true; send(room,id,input); room.tick(0.01f);
            input.fire=false; send(room,id,input); ticks(room,5);
            input.fire=true; send(room,id,input); room.tick(tail);
            check(room.players()[id].shot==(tail<0.03f?1u:2u),"pistol fresh-edge interval includes exactly 280ms but not below");
        }
    }

    {
        arena::Room room; const int id=room.join(); place_floor(room,id,0,-9.6f);
        arena::Input input{}; input.grenade=true; input.pitch=1.45f; send(room,id,input); room.tick(0.01f);
        bool reflected=false;
        for(int i=0;i<12;++i) {
            room.tick(0.05f); const auto& g=room.grenades()[0];
            check(g.position.y<=5.6301f,"swept upward grenade cannot tunnel through the thin overhead beam");
            reflected=reflected || (g.velocity.y<0 && g.position.y>4);
        }
        check(reflected,"real thin beam reverses an upward throw before its ballistic apex");
    }

    {
        arena::Room room; const int id=room.join(); drive(room,id,0,-1,21);
        arena::Input input{}; input.grenade=true; input.yaw=-arena::kPi/2; send(room,id,input); room.tick(0.01f);
        check(near(room.grenades()[0].position.x,-23.15f),"grenade begins at the authoritative eye rather than beyond near cover");
        room.tick(0.05f);
        check(room.grenades()[0].position.x>=-23.3801f && room.grenades()[0].velocity.x>0,"first movement from the eye sweeps the near wall without a spawn-path tunnel");
    }

    {
        arena::Room sample; const int owner=sample.join(); arena::Input input{}; input.grenade=true; input.pitch=-1.45f;
        send(sample,owner,input); sample.tick(0.01f); ticks(sample,50);
        const auto location=sample.grenades()[0].position;
        float boundary_z=location.z+std::sqrt(36-25-(0.9f-location.y)*(0.9f-location.y));
        // Select a representable equality point; placement itself still uses public inputs.
        for(int i=0;i<64;++i) {
            const float dz=boundary_z-location.z,dy=0.9f-location.y;
            const float distance=std::sqrt(25+dy*dy+dz*dz);
            if(distance==6) break;
            boundary_z=std::nextafter(boundary_z,distance<6?std::numeric_limits<float>::infinity():-std::numeric_limits<float>::infinity());
        }
        for(float offset:{-0.001f,0.0f,0.001f}) {
            arena::Room room; const int thrower=room.join(),target=room.join();
            place_floor(room,target,location.x+5+offset,boundary_z);
            send(room,thrower,input); room.tick(0.01f); ticks(room,50);
            const auto& p=room.players()[target]; const auto& g=room.grenades()[0];
            const float dx=p.position.x-g.position.x,dy=0.9f-g.position.y,dz=p.position.z-g.position.z;
            const float distance=std::sqrt(dx*dx+dy*dy+dz*dz);
            check(offset!=0 || distance==6,"radius equality fixture is exactly six metres through public movement");
            check((offset<0 && p.hp==99 && p.damage==1) || (offset>=0 && p.hp==100 && p.damage==0),"blast is strictly inside six metres with ceil falloff");
        }
    }

    {
        arena::Room room; const int id=room.join();
        // Unit-only fixed-pool saturation; this is not live gameplay or combat evidence.
        auto& pool=const_cast<std::array<arena::Grenade,arena::kMaxGrenades>&>(room.grenades());
        for(auto& g:pool) { g.active=g.exploding=true; g.explosion=0.35f; g.owner=id; }
        arena::Input input{}; input.grenade=true; send(room,id,input); room.tick(0.01f);
        check(pool.size()==16 && room.players()[id].grenades==2 && room.players()[id].grenade_cooldown==0,"full 16-slot pool refuses a throw without consuming inventory or cooldown");
        pool[3].active=false; room.tick(0.01f);
        check(room.players()[id].grenades==2 && !pool[3].active,"full-pool rejected request is consumed instead of waiting for a slot");
        send(room,id,input); room.tick(0.01f);
        check(room.players()[id].grenades==1 && pool[3].active && !pool[3].exploding,"a new request reuses one free effect slot");
    }

    {
        arena::Room room; const int id=room.join(); arena::Input input{}; input.grenade=true;
        send(room,id,input); room.tick(0.01f); ticks(room,9); room.tick(0.049f);
        send(room,id,input); room.tick(0.0005f);
        check(room.players()[id].grenades==1 && room.players()[id].grenade_cooldown>0,"grenade refuses a fresh request just before 500ms");
        send(room,id,input); room.tick(0.0005f);
        check(room.players()[id].grenades==0 && room.grenades()[1].active,"grenade cooldown accepts a fresh throw at exactly 500ms");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.weapon=1; send(room,id,input); room.tick(0.01f); ticks(room,4);
        input.fire=true; send(room,id,input); room.tick(0.01f);
        input.fire=false; send(room,id,input); ticks(room,5); room.tick(0.029f);
        input.fire=true; send(room,id,input); room.tick(0.0005f);
        check(room.players()[id].shot==1 && !room.players()[id].semi_pending,"pistol rejects and consumes a new press just below 280ms");
        room.tick(0.0005f); check(room.players()[id].cooldown==0 && room.players()[id].shot==1,"consumed cooldown edge cannot replay at exact 280ms");
        input.fire=false; send(room,id,input); input.fire=true; send(room,id,input); room.tick(0.01f);
        check(room.players()[id].shot==2,"only a new press can resume pistol fire after rejected cooldown");
    }

    {
        arena::Room room; const int owner=room.join(),killer=room.join(),target=room.join();
        drive(room,target,0,-1,16); drive(room,target,1,0,156); drive(room,target,0,1,16);
        check(near(room.players()[target].position.x,-18) && near(room.players()[target].position.z,-21),"dead-owner fixture uses a routed target outside the north rifle lane");
        arena::Input shot{}; shot.fire=true;
        for(int i=0;i<2;++i) {send(room,owner,shot);room.tick(0.01f);send(room,owner,{});ticks(room,3);}
        check(room.players()[target].hp==50,"dead-owner fixture weakens the nearby target through two actual hits");
        arena::Input input{}; input.grenade=true; input.pitch=-1.45f; send(room,owner,input); room.tick(0.01f);
        shot.yaw=-arena::kPi/2;
        for(int i=0;i<4;++i) {send(room,killer,shot);room.tick(0.01f);send(room,killer,{});if(i<3)ticks(room,3);}
        check(room.players()[owner].hp==0 && room.grenades()[0].active,"dead owner retains its in-flight projectile");
        for(int i=0;i<50 && !room.grenades()[0].exploding;++i) room.tick(0.05f);
        check(room.players()[owner].hp==0 && room.players()[owner].kills==1 && room.players()[target].hp==0 && room.players()[target].deaths==1 && room.players()[killer].kills==1,"grenade thrown before owner death still awards one opponent kill");
        ticks(room,6); check(room.players()[owner].kills==1 && room.players()[target].deaths==1,"lingering explosion cannot score the same victim again");
    }

    {
        arena::Room room; const int thrower=room.join(),other=room.join();
        arena::Input input{}; input.grenade=true; input.pitch=-1.45f; send(room,thrower,input); room.tick(0.01f);
        arena::Input shot{}; shot.fire=true; shot.yaw=-arena::kPi/2; send(room,other,shot); room.tick(0.01f); send(room,other,{});
        check(room.players()[thrower].hp==75,"suicide fixture weakens the thrower with a real opponent shot");
        ticks(room,49); room.tick(0.04f);
        check(room.players()[thrower].hp==0 && room.players()[thrower].deaths==1 && room.players()[thrower].kills==0 && room.players()[other].kills==0,"self lethal blast records one death without awarding a suicide kill");
    }

    {
        arena::Room room; const int thrower=room.join(); drive(room,thrower,0,1,136);
        arena::Input input{}; input.grenade=true; input.pitch=-1.45f; send(room,thrower,input); room.tick(0.01f);
        ticks(room,30); const int target=room.join(); ticks(room,20);
        check(room.players()[target].shield>0 && room.players()[target].hp==100 && room.players()[target].damage==0 && room.grenades()[0].exploding,"fresh spawn shield blocks a real in-range grenade explosion");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.fire=true; send(room,id,input); room.tick(0.01f);
        input.fire=false; input.reload=true; send(room,id,input); room.tick(0.01f);
        input.reload=false; input.fire=input.grenade=true; send(room,id,input); room.tick(0.01f);
        check(room.players()[id].reload>0 && room.players()[id].shot==1 && room.players()[id].grenades==1 && room.grenades()[0].active,"grenade request remains independent of gun reload and firing");
    }

    {
        const auto handle=room_create(); const int id=room_join(handle);
        room_input_v2(handle,id,0,0,0,0,0,0,0,1,0,1,1,0); room_tick(handle,0.01f);
        for(int i=0;i<4;++i) room_tick(handle,0.05f);
        room_input_v2(handle,id,0,0,0,0,1,0,0,2,0,1,1,1); room_tick(handle,0.01f);
        const auto old_locale=std::locale(); std::locale::global(std::locale(std::locale::classic(),new CommaDecimal));
        check(EM_ASM_INT({
            const s=JSON.parse(UTF8ToString($0)); const g=s.grenades[0];
            return s.grenades.length===1 && Object.keys(g).sort().join(",")==="exploding,explosion,fuse,id,owner,vx,vy,vz,x,y,z" &&
                Object.values(g).filter(v=>typeof v==="number").every(Number.isFinite) && g.owner===0 && g.id>0 && g.fuse===2500 && g.explosion===0 && g.exploding===false && Math.abs(g.y-0.95)<0.001 &&
                s.players[0].ammo===11 && s.players[0].rifleAmmo===24 && s.players[0].pistolAmmo===11 && s.players[0].grenadeCount===1 && s.players[0].crouch===true;
        },room_snapshot(handle))==1,"snapshot includes exact finite active grenade schema and millisecond fuse");
        for(int i=0;i<50;++i) room_tick(handle,0.05f);
        check(EM_ASM_INT({const g=JSON.parse(UTF8ToString($0)).grenades[0];return g.exploding===true && g.fuse===0 && Math.abs(g.explosion-350)<0.001 && g.vx===0 && g.vy===0 && g.vz===0;},room_snapshot(handle))==1,"explosion snapshot exposes boolean state and remaining effect milliseconds");
        room_leave(handle,id);
        check(EM_ASM_INT({const s=JSON.parse(UTF8ToString($0));return s.players.length===0 && s.grenades.length===0;},room_snapshot(handle))==1,"snapshot excludes inactive players and removed owner effects");
        std::locale::global(old_locale); room_destroy(handle);
    }

    {
        const auto handle=room_create(); const int id=room_join(handle);
        check(room_input_v2(handle,id,0,0,0,0,0,0,0,4,1,1,1,1)==1,"v2 ABI accepts old argument order followed by jump crouch weapon grenade");
        room_tick(handle,0.01f); const auto& room=*reinterpret_cast<const arena::Room*>(handle); const auto& p=room.players()[id];
        check(p.ack==4 && p.position.y>0 && p.crouching && p.weapon==1 && p.grenades==1,"v2 ABI executes all new authoritative actions");
        for(int field=0;field<6;++field) for(int bad:{-1,2}) {
            std::array<int,6> flags{}; flags[field]=bad;
            check(room_input_v2(handle,id,0,0,0,0,flags[0],flags[1],flags[2],5,flags[3],flags[4],0,flags[5])==0 && p.ack==4,"v2 ABI refuses every non-boolean integer flag before ack");
        }
        check(room_input_v2(handle,id,0,0,0,0,0,0,0,5,0,0,2,0)==0 && room_input_v2(handle,id,0,0,0,std::numeric_limits<float>::quiet_NaN(),0,0,0,5,0,0,0,0)==0 && p.ack==4,"v2 ABI fully validates selection and floats before ack");
        check(room_input_v2(0,0,0,0,0,0,0,0,0,1,0,0,0,0)==0,"null v2 ABI input fails safely");
        room_input(handle,id,0,0,0,0,0,0,0,6); room_tick(handle,0.01f);
        check(p.weapon==0 && !p.crouching && p.grenades==1,"legacy ABI explicitly defaults to rifle standing and no new actions");
        room_destroy(handle);
    }

    {
        arena::Room room; const int shooter=room.join(),target=room.join(); ticks(room,30);
        arena::Input target_input{}; target_input.weapon=1; send(room,target,target_input); room.tick(0.01f); ticks(room,4);
        target_input.fire=true; target_input.pitch=1.45f; send(room,target,target_input); room.tick(0.01f);
        target_input.fire=false; target_input.crouch=target_input.grenade=true; target_input.pitch=-1.45f; send(room,target,target_input); room.tick(0.01f);
        target_input.grenade=false; send(room,target,target_input);
        arena::Input fire{}; fire.fire=fire.crouch=true; fire.yaw=arena::kPi/2;
        for(int i=0;i<3;++i) {send(room,shooter,fire);room.tick(0.01f);fire.fire=false;send(room,shooter,fire);ticks(room,3);fire.fire=true;}
        target_input.fire=target_input.jump=target_input.grenade=true; send(room,target,target_input);
        send(room,shooter,fire); room.tick(0.01f);
        const auto& dead=room.players()[target];
        check(dead.hp==0 && !dead.semi_pending && !dead.input.jump && !dead.input.grenade && dead.equip==0,"death clears new pending action and equip state immediately");
        check(room.grenades()[0].active && room.grenades()[0].owner==target,"death preserves a grenade already thrown by that membership");
        const auto ack=dead.ack; ticks(room,50);
        const auto& p=room.players()[target];
        check(p.hp==100 && p.weapon==0 && p.pistol_ammo==12 && p.grenades==2 && p.vertical_velocity==0 && p.grounded && !p.crouching && p.equip==0 && p.grenade_cooldown==0 && !p.semi_pending && p.ack==ack,"respawn restores all new pose and resource state while preserving ack");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.grenade=true; send(room,id,input); room.tick(0.01f);
        room.leave(id);
        check(!room.grenades()[0].active,"leaving removes flying and exploding owner projectiles before slot reuse");
        check(room.join()==id && room.players()[id].grenades==2,"new membership restores inventory without old projectiles");
        send(room,id,input); room.tick(0.01f); ticks(room,50);
        check(room.grenades()[0].active && room.grenades()[0].exploding,"leave-effect fixture reaches a real explosion");
        room.leave(id); check(!room.grenades()[0].active,"leaving also removes visible explosion effects");
    }

    {
        arena::Room room; const int thrower=room.join(),target=room.join();
        drive(room,thrower,-1,0,61);
        drive(room,target,0,-1,160); drive(room,target,-1,0,84); drive(room,target,0,1,16);
        check(near(room.players()[thrower].position.z,-2.85f) && near(room.players()[target].position.x,-18) && near(room.players()[target].position.z,3),"blast-cover fixture routes public players around the existing west cover");
        arena::Input input{}; input.grenade=input.crouch=true; input.yaw=arena::kPi; input.pitch=-1.45f; send(room,thrower,input); room.tick(0.01f); ticks(room,50);
        const auto& g=room.grenades()[0]; const auto& p=room.players()[target];
        const float distance=std::sqrt((p.position.x-g.position.x)*(p.position.x-g.position.x)+(p.position.z-g.position.z)*(p.position.z-g.position.z)+(0.9f-g.position.y)*(0.9f-g.position.y));
        check(distance<6 && p.shield==0 && p.hp==100 && p.damage==0,"solid cover blocks a real in-range grenade blast");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.grenade=true; input.pitch=-1.45f; send(room,id,input); room.tick(0.01f); ticks(room,50);
        const auto& p=room.players()[id]; const auto& g=room.grenades()[0];
        const float dx=p.position.x-g.position.x,dy=p.position.y+arena::body_height(p.crouching)/2-g.position.y,dz=p.position.z-g.position.z;
        const float distance=std::sqrt(dx*dx+dy*dy+dz*dz);
        const int expected=static_cast<int>(std::ceil(100*(1-distance/6)));
        check(g.exploding && p.hp==100-expected && p.hp<100 && p.damage==1,"real grenade explosion damages the thrower by body-centre distance");
        ticks(room,6); check(p.damage==1 && p.kills==0,"one explosion damages once and self damage awards no kill");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.grenade=true; input.yaw=-arena::kPi/2; send(room,id,input); room.tick(0.01f);
        bool reflected=false;
        for(int i=0;i<15;++i) {
            room.tick(0.05f); const auto& g=room.grenades()[0];
            check(g.position.x>=-23.3801f,"swept grenade radius never passes through the perimeter solid");
            reflected=reflected || g.velocity.x>0;
        }
        check(reflected,"solid side reflection reverses the incoming velocity");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.grenade=true; input.pitch=-1.45f; send(room,id,input); room.tick(0.01f);
        bool bounced=false;
        for(int i=0;i<40;++i) {
            room.tick(0.05f); const auto& g=room.grenades()[0];
            check(g.position.y>=arena::kGrenadeRadius,"grenades bounce above the ground and settle without tunneling");
            if(g.velocity.y>0) bounced=true;
        }
        const auto& g=room.grenades()[0];
        check(bounced && near(g.position.y,arena::kGrenadeRadius) && g.velocity.y==0 && std::hypot(g.velocity.x,g.velocity.z)<0.2f,"restitution and surface damping settle a downward throw");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.grenade=true; send(room,id,input); room.tick(0.01f);
        const auto identity=room.grenades()[0].id;
        ticks(room,49); room.tick(0.049f);
        check(!room.grenades()[0].exploding && room.grenades()[0].fuse>0,"fuse cannot expire just before 2.5 seconds");
        room.tick(0.001f); const auto& g=room.grenades()[0];
        check(g.active && g.exploding && g.id==identity && g.fuse==0 && near(g.explosion,0.35f),"grenade becomes one stable-id explosion at exactly 2.5 seconds");
        const auto position=g.position; ticks(room,6); room.tick(0.049f);
        check(g.active && g.explosion>0 && g.position.x==position.x && g.position.y==position.y && g.position.z==position.z,"explosion effect remains stationary just before 350ms");
        room.tick(0.001f); check(!g.active,"explosion slot is freed at exactly 350ms");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.grenade=true; input.yaw=arena::kPi/2; send(room,id,input); room.tick(0.01f);
        room.tick(0.05f); const auto& g=room.grenades()[0];
        check(near(g.position.x,-17.4f) && near(g.position.y,1.755f) && near(g.velocity.y,3.1f) && near(g.fuse,2.45f),"grenade flight advances authoritative velocity and gravity after input expiry");
        ticks(room,5); check(!room.players()[id].input.fire && room.grenades()[0].position.x>-15 && room.grenades()[0].fuse<2.21f,"grenade motion and fuse continue without new controls");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.grenade=true; send(room,id,input); input.grenade=false; send(room,id,input); room.tick(0.01f);
        check(room.players()[id].grenades==1 && room.grenades()[0].active,"coalesced grenade pulse survives newer false input");
        input.grenade=true; send(room,id,input); room.tick(0.01f);
        check(room.players()[id].grenades==1 && !room.grenades()[1].active,"cooldown-rejected throw does not consume inventory");
        ticks(room,10); check(room.players()[id].grenades==1,"rejected throw cannot leak across cooldown");
        send(room,id,input); room.tick(0.01f); check(room.players()[id].grenades==0 && room.grenades()[1].active && room.grenades()[1].id!=room.grenades()[0].id,"second fresh throw consumes the last resource with a distinct stable id");
        ticks(room,10); send(room,id,input); room.tick(0.01f);
        check(room.players()[id].grenades==0 && !room.grenades()[2].active,"inventory never goes negative or replenishes itself");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.grenade=true; input.crouch=true; input.yaw=arena::kPi/2; send(room,id,input); room.tick(0.01f);
        const auto& p=room.players()[id]; const auto& g=room.grenades()[0];
        check(p.grenades==1 && g.active && g.owner==id && g.id!=0,"fresh throw creates one authoritative grenade and spends inventory");
        check(!g.exploding && near(g.position.x,-18) && near(g.position.y,0.95f) && near(g.position.z,-18) && near(g.velocity.x,12) && near(g.velocity.y,4) && near(g.fuse,2.5f),"throw uses actual crouched eye and authoritative aim with speed and upward impulse");
        check(p.shield==0 && near(p.grenade_cooldown,0.5f) && !p.input.grenade,"throw breaks shield and consumes exactly one request");
        ticks(room,2); check(room.players()[id].grenades==1,"held throw request never repeats without fresh input");
    }

    {
        arena::Room room; const int shooter=room.join(),target=room.join(); ticks(room,30);
        arena::Input crouch{}; crouch.crouch=true; send(room,target,crouch);
        arena::Input fire{}; fire.fire=true; fire.yaw=arena::kPi/2; send(room,shooter,fire); room.tick(0.01f);
        check(room.players()[target].hp==100 && near(room.players()[shooter].trace.x,23.5f),"standing horizontal shot passes above a crouched target");
        fire.fire=false; send(room,shooter,fire); ticks(room,3);
        fire.crouch=fire.fire=true; send(room,shooter,fire); room.tick(0.01f);
        check(room.players()[target].hp==75 && near(room.players()[shooter].trace.y,0.95f),"crouched shooter originates hitscan at the actual lower eye height");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.weapon=1; send(room,id,input); room.tick(0.01f); ticks(room,4);
        input.fire=true; send(room,id,input); room.tick(0.01f);
        input.fire=false; input.reload=true; send(room,id,input); input.reload=false; send(room,id,input); room.tick(0.01f);
        check(near(room.players()[id].reload,1.2f) && room.players()[id].pistol_ammo==11,"pistol reload starts its own 1.2 second timer");
        ticks(room,23); room.tick(0.049f);
        check(room.players()[id].reload>0 && room.players()[id].pistol_ammo==11,"pistol reload cannot finish just before 1.2 seconds");
        room.tick(0.001f);
        check(room.players()[id].reload==0 && room.players()[id].pistol_ammo==12 && room.players()[id].ammo==24,"pistol reload completes at equality without touching rifle magazine");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.weapon=1; input.fire=true; send(room,id,input); input.fire=false; send(room,id,input); room.tick(0.01f);
        check(room.players()[id].shot==0 && room.players()[id].pistol_ammo==12 && !room.players()[id].semi_pending,"equip rejects and consumes a coalesced pistol press");
        ticks(room,4); room.tick(0.01f);
        check(room.players()[id].shot==0,"rejected equip edge never replays when equip ends");
        input.fire=true; send(room,id,input); room.tick(0.01f);
        input.weapon=0; send(room,id,input); room.tick(0.01f);
        const float cooldown=room.players()[id].cooldown;
        input.weapon=1; send(room,id,input); room.tick(0.01f);
        check(cooldown>0.26f && room.players()[id].cooldown>0.25f,"weapon switching preserves shared shot cooldown");
        for(int i=0;i<8;++i) { send(room,id,input); room.tick(0.05f); }
        check(room.players()[id].shot==1 && room.players()[id].pistol_ammo==11,"switching while fire is held synthesizes no pistol edge");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.weapon=1; send(room,id,input); room.tick(0.01f); ticks(room,4);
        input.fire=true;
        for(int i=0;i<20;++i) {send(room,id,input);room.tick(0.05f);}
        check(room.players()[id].shot==1 && room.players()[id].pistol_ammo==11,"pistol held fire never repeats without a new rising edge");
        input.fire=false; send(room,id,input); input.fire=true; send(room,id,input); input.fire=false; send(room,id,input); room.tick(0.01f);
        check(room.players()[id].shot==2 && room.players()[id].pistol_ammo==10,"pistol rising edge survives newer release before the tick");
        const auto ack=room.players()[id].ack; input.fire=true; input.seq=ack;
        check(room.set_input(id,input),"duplicate pistol press is ignored successfully"); ticks(room,6);
        check(room.players()[id].shot==2,"duplicate pistol edge never fires later");
    }

    {
        arena::Room room; const int shooter=room.join(),target=room.join(); ticks(room,30);
        arena::Input input{}; input.weapon=1; input.yaw=arena::kPi/2; send(room,shooter,input); room.tick(0.01f); ticks(room,4);
        input.fire=true; send(room,shooter,input); room.tick(0.01f);
        const auto& p=room.players()[shooter];
        check(p.ammo==24 && p.pistol_ammo==11 && room.players()[target].hp==66 && near(p.cooldown,0.28f),"pistol shot spends its own magazine and deals 34 damage");
        check(arena::active_ammo(p)==11 && arena::weapon_definition(1).magazine==12 && !arena::weapon_definition(1).automatic && near(arena::weapon_definition(1).reload,1.2f),"pistol definition and const active magazine expose the approved balance");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.fire=true; send(room,id,input); room.tick(0.01f);
        input.fire=false; input.reload=true; send(room,id,input); room.tick(0.01f);
        input.reload=false; input.weapon=1; send(room,id,input); room.tick(0.01f);
        check(room.players()[id].weapon==1 && near(room.players()[id].equip,0.2f) && room.players()[id].reload==0 && room.players()[id].ammo==23 && room.players()[id].pistol_ammo==12,"selection equips pistol for exactly 200ms without refilling");
        send(room,id,input); ticks(room,3); room.tick(0.049f);
        check(room.players()[id].equip>0 && room.players()[id].equip<0.002f,"same selection does not restart equip before exact boundary");
        room.tick(0.001f); check(room.players()[id].equip==0,"equip completes at exactly 200ms");
    }

    {
        arena::Room room; const int id=room.join();
        for(int weapon:{-1,2,2147483647}) {
            arena::Input input{}; input.seq=1; input.weapon=weapon; input.jump=input.grenade=true;
            check(!room.set_input(id,input) && room.players()[id].ack==0,"weapon outside zero or one is refused before ack");
        }
        room.tick(0.05f); check(room.players()[id].grounded,"invalid weapon cannot enqueue motion actions");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.forward=input.strafe=1; send(room,id,input);
        ticks(room,4); room.tick(0.04f);
        const auto from=room.players()[id].position; room.tick(0.05f);
        const auto to=room.players()[id].position;
        check(near(std::hypot(to.x-from.x,to.z-from.z),0.05f),"partial final input window preserves normalized diagonal speed");
    }

    {
        arena::Input crouch{}; crouch.crouch=true; crouch.strafe=-1;
        const auto low=arena::step_motion({{4.45f,4.5f,-10},0,false,true},crouch,0.05f);
        check(near(low.position.x,4.325f),"crouching body passes below a solid that blocks standing height");
        crouch.crouch=false;
        const auto tall=arena::step_motion({{4.45f,4.5f,-10},0,false,false},crouch,0.05f);
        check(near(tall.position.x,4.35f),"standing side collision uses the full body height and radius");
    }

    {
        const auto s=arena::step_motion({{0,3.9f,-10},8,false,false},{},0.05f);
        check(near(s.position.y,3.95f) && s.vertical_velocity==0 && !s.grounded,"upward body motion stops at the solid underside");
        const auto crouch=arena::step_motion({{0,4.6f,-10},8,false,true},[]{arena::Input i{};i.crouch=true;return i;}(),0.05f);
        check(near(crouch.position.y,4.65f),"underside sweep uses the actual crouching body height");
    }

    {
        // Unit-only top/edge fixtures; room combat fixtures do not alter private positions.
        arena::Input input{}; input.strafe=1;
        const auto edge=arena::step_motion({{-16.2f,2,0},0,true,false},input,0.05f);
        check(!edge.grounded && edge.position.y<2 && edge.vertical_velocity<0,"walking off a solid top immediately loses support");
        const auto supported=arena::step_motion({{-18,2,0},0,true,false},{},0.05f);
        check(supported.grounded && supported.position.y==2,"body remains grounded on an exact solid top");
        const auto phantom=arena::step_motion({{0,3,-18},0,true,false},{},0.05f);
        check(!phantom.grounded && phantom.position.y<3,"grounded flag alone cannot suspend a body without physical support");
    }

    {
        // Unit-only: west cover top is y=2.
        const auto s=arena::step_motion({{-18,2.1f,0},-2,false,false},{},0.05f);
        check(near(s.position.y,2) && s.grounded && s.vertical_velocity==0,"falling body lands on an actual solid top");
        const auto decoration=arena::step_motion({{2,6.8f,1},-2,false,false},{},0.05f);
        check(decoration.position.y<6.7f && !decoration.grounded,"non-solid rooftop decoration never supplies a landing surface");
    }

    {
        // Unit-only geometric boundary under the existing overhead beam (bottom y=5.75).
        arena::Input input{};
        auto state=arena::step_motion({{0,4.5f,-10},0,false,true},input,0.01f);
        check(state.crouching,"standing expansion is refused below a solid ceiling");
        state.position.x=5;
        state=arena::step_motion(state,input,0.01f);
        check(!state.crouching,"outstanding stand request succeeds after leaving ceiling geometry");
        state=arena::step_motion({{0,3.95f,-10},0,false,true},input,0.01f);
        check(!state.crouching,"standing height exactly touching the underside is allowed");
    }

    {
        arena::Input input{}; input.crouch=true; input.forward=input.strafe=1; input.sprint=true;
        const auto state=arena::step_motion({{-18,0,-18},0,true,false},input,0.05f);
        check(near(std::hypot(state.position.x+18,state.position.z+18),0.125f),"diagonal crouch remains capped at 2.5 mps");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.crouch=true; input.forward=1; input.sprint=true; send(room,id,input); room.tick(0.05f);
        const auto& p=room.players()[id];
        check(p.crouching && near(p.position.z,-18.125f),"crouch changes actual stance and suppresses sprint to 2.5 mps");
        check(near(arena::body_height(true),1.1f) && near(arena::eye_height(true),0.95f) && near(arena::body_height(false),1.8f) && near(arena::eye_height(false),1.6f),"shared body and eye helpers expose actual stance dimensions");
        input={}; send(room,id,input); room.tick(0.05f);
        check(!room.players()[id].crouching,"clear-space stand request restores actual standing stance");
    }

    {
        arena::Input input{}; input.jump=true; input.forward=1;
        const auto motion=arena::step_motion({{-18,0,-18},0,true,false},input,0.05f);
        check(near(motion.position.z,-18.25f) && near(motion.position.y,0.355f) && near(motion.vertical_velocity,7.1f) && !motion.grounded,"shared prediction advances the same jump and walking physics");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.jump=true; send(room,id,input);
        input.jump=false; send(room,id,input); room.tick(0.05f);
        check(room.players()[id].position.y>0,"coalesced jump pulse survives newer false input");
        const auto ack=room.players()[id].ack;
        input.jump=true; input.seq=ack; check(room.set_input(id,input),"duplicate jump is ignored successfully");
        ticks(room,30);
        check(room.players()[id].grounded && room.players()[id].position.y==0,"consumed or duplicate jump cannot replay on landing");
        send(room,id,input); room.tick(0.05f);
        const float speed=room.players()[id].vertical_velocity;
        send(room,id,input); room.tick(0.05f);
        check(room.players()[id].vertical_velocity<speed,"airborne jump request cannot reset upward velocity");
        ticks(room,30);
        check(room.players()[id].grounded,"airborne request is not buffered until landing");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input jump{}; jump.jump=true; send(room,id,jump);
        ticks(room,30);
        const auto& p=room.players()[id];
        check(p.position.y==0 && p.vertical_velocity==0 && p.grounded,"jump lands on the floor with zero vertical speed");
    }

    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.jump=true; input.seq=0;
        check(room.set_input(id,input),"jump request is a valid public input");
        room.tick(1.0f/60);
        check(room.players()[id].position.y>0.05f && !room.players()[id].grounded,"jump lifts feet using authoritative vertical motion");
    }
    {
        arena::Room room;
        const int id=room.join();
        arena::Input input{};
        input.seq=0; input.forward=1; input.yaw=0;
        room.set_input(id,input); room.tick(0.05f);
        check(near(room.players()[id].position.z,-18.25f),"first valid sequence zero drives movement");
        input.forward=-1;
        room.set_input(id,input); room.tick(0.05f);
        check(near(room.players()[id].position.z,-18.5f),"duplicate sequence zero cannot replace held input");
        input.seq=1;
        room.set_input(id,input); room.tick(0.05f);
        check(near(room.players()[id].position.z,-18.25f),"strictly newer sequence replaces held input");
        room.leave(id); room.join(); input.seq=0; input.forward=1;
        room.set_input(id,input); room.tick(0.05f);
        check(near(room.players()[id].position.z,-18.25f),"rejoin resets receipt state and accepts first sequence zero");
    }
    {
        arena::Room room; const int id=room.join();
        arena::Input input{}; input.seq=0; input.fire=true;
        room.set_input(id,input); room.tick(0.05f);
        check(room.players()[id].ammo==23,"queued reload fixture fires a real round");
        input.seq=1; input.fire=false; input.reload=true; room.set_input(id,input);
        input.seq=2; input.reload=false; room.set_input(id,input); room.tick(0.05f);
        check(room.players()[id].reload>1.4f,"queued reload survives newer held-state input before tick");
        check(!room.players()[id].input.reload,"reload pulse is consumed once at the simulation tick");
        ticks(room,30);
        input.seq=3; input.fire=true; room.set_input(id,input); room.tick(0.05f);
        input.seq=1; input.fire=false; input.reload=true; room.set_input(id,input);
        input.seq=4; input.reload=false; room.set_input(id,input); room.tick(0.05f);
        check(room.players()[id].reload==0,"replayed old reload pulse cannot start another reload");
    }
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
        check(std::string(room_snapshot(0))=="{\"time\":0,\"players\":[],\"grenades\":[]}","null snapshot is a valid finite empty JSON room");
        const auto handle=room_create();
        check(std::string(room_snapshot(handle))=="{\"time\":0,\"players\":[],\"grenades\":[]}","empty room snapshot has exact transport envelope");
        room_join(handle); room_join(handle); room_leave(handle,0);
        const auto old_locale=std::locale();
        std::locale::global(std::locale(std::locale::classic(),new CommaDecimal));
        const char* snapshot=room_snapshot(handle);
        check(EM_ASM_INT({
            const s=JSON.parse(UTF8ToString($0));
            const expected="id,x,y,z,yaw,pitch,hp,ammo,kills,deaths,reload,respawn,shield,shot,hit,damage,ack,trace,vy,grounded,crouch,weapon,rifleAmmo,pistolAmmo,grenadeCount,equip".split(",").sort().join(",");
            return Object.keys(s).sort().join(",")==="grenades,players,time" && s.grenades.length===0 && s.time===0 && s.players.length===1 && s.players[0].id===1 &&
                s.players.every(p => Object.keys(p).sort().join(",")===expected &&
                    Object.values(p).filter(v => typeof v==="number").every(Number.isFinite) && p.trace.length===3 && p.trace.every(Number.isFinite)) &&
                s.players[0].shield===1500 && s.players[0].respawn===0 && s.players[0].reload===0 && s.players[0].vy===0 && s.players[0].grounded===true && s.players[0].crouch===false && s.players[0].weapon===0 && s.players[0].rifleAmmo===24 && s.players[0].pistolAmmo===12 && s.players[0].grenadeCount===2 && s.players[0].equip===0;
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
