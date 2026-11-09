#include "../core/local_map.hpp"
#include <cassert>
#include <cmath>
#include <cstdio>

using namespace arena;

static void check_map(MapId map,Room& crossyard) {
    Room room(map);
    for(int slot=0;slot<kCapacity;++slot) {
        assert(room.join()==slot);
        const auto spawn=room.players()[slot].position;
        const auto ground=local_map::ray(map,spawn,{0,-1,0},.1f);
        assert(std::isfinite(ground.distance) && ground.normal.y>.5f);
        MotionState state{spawn,0,true,false};
        const auto after=step_motion(state,{1,0,spawn_yaw(slot,map),0},.05f,map);
        assert(std::hypot(after.position.x-spawn.x,after.position.z-spawn.z)>.1f);
        Input jump;
        jump.jump=true;
        const auto lifted=step_motion(state,jump,.05f,map);
        assert(lifted.position.y>spawn.y+.2f && !lifted.grounded);
        Input prone{1,0,spawn_yaw(slot,map)};
        prone.sprint=prone.jump=prone.prone=true;
        const auto crawl=step_motion(state,prone,.05f,map);
        assert(crawl.prone && !crawl.crouching && crawl.vertical_velocity<=0);
        assert(std::hypot(crawl.position.x-spawn.x,crawl.position.z-spawn.z)<.064f);
        std::printf("slot %d at %.3f %.3f %.3f\n",slot,spawn.x,spawn.y,spawn.z);
    }
    std::vector<float> materials;
    const auto vertices=local_map::render_vertices(map,&materials);
    assert(vertices.size()>100000 && vertices.size()%18==0);
    assert(materials.size()==vertices.size()/6);
    std::array<unsigned,4> used{};
    for(std::size_t i=0;i<materials.size();i+=3) {
        const auto layer=static_cast<unsigned>(materials[i]);
        assert(layer<used.size() && materials[i]==materials[i+1] && materials[i]==materials[i+2]);
        ++used[layer];
    }
    for(const auto count:used) assert(count>0);
    const auto [min_x,max_x,min_z,max_z]=local_map::bounds(map);
    for(std::size_t i=vertices.size()-8*18;i<vertices.size();i+=6) {
        assert(vertices[i]==min_x || vertices[i]==max_x);
        assert(vertices[i+2]==min_z || vertices[i+2]==max_z);
    }
    if(map==MapId::library) {
        // The northern side of this platform rises from the Library aisle.
        Input climb{1,0,kPi}; climb.jump=true;
        const MotionState aisle{{-13.42f,.04f,-4.62f},0,true};
        auto platform=step_motion(aisle,climb,1.f/60,map);
        assert(platform.mantle.active());
        for(int tick=0;tick<30 && platform.mantle.active();++tick) platform=step_motion(platform,{},1.f/60,map);
        assert(platform.grounded && std::abs(platform.position.y-.8128f)<.002f && platform.position.z>-3.8f);
        const auto steady=step_motion(platform,{},1.f/60,map);
        assert(steady.grounded && steady.position.y==platform.position.y);
        auto eye=room.players()[0].position;
        eye.y+=kEyeHeight;
        const auto direction=aim_direction(kPi/4,0);
        const auto physical=local_map::ray(map,eye,direction,14);
        assert(physical.distance>2 && physical.distance<2.4f);
        assert(std::abs(physical.normal.y)<.8f);
        // The southern flight rises east from floor level to the upper walkway.
        const auto tread_a=local_map::ray(map,{-9.90f,4,11.7f},{0,-1,0},4);
        const auto tread_b=local_map::ray(map,{-9.75f,4,11.7f},{0,-1,0},4);
        const auto next=local_map::ray(map,{-9.60f,4,11.7f},{0,-1,0},4);
        assert(tread_a.normal.y>.999f && std::abs(tread_a.distance-tread_b.distance)<.002f);
        assert(tread_a.distance-next.distance>.16f && tread_a.distance-next.distance<.20f);
        MotionState stair{{-11.7f,.04f,11.7f},0,true,false};
        for(int frame=0;frame<80;++frame)
            stair=step_motion(stair,{1,0,kPi/2,0},1.f/60,map);
        assert(stair.position.x>-6.3f && stair.position.y>2.8f);
    }
    std::printf("map %d rendered triangles: %zu\n",static_cast<int>(map),vertices.size()/18);

    const auto spawn=room.players()[0].position;
    Input input{};
    input.yaw=spawn_yaw(0,map);
    input.pitch=-1.2f;
    input.fire=true;
    const auto aim=aim_direction(input.yaw,input.pitch);
    const auto hit=local_map::ray(map,{spawn.x,spawn.y+kEyeHeight,spawn.z},aim,80);
    assert(std::isfinite(hit.distance));
    assert(room.set_input(0,input));
    room.tick(1.f/60);
    const auto trace=room.players()[0].trace;
    assert(std::abs(std::hypot(trace.x-spawn.x,trace.y-spawn.y-kEyeHeight,trace.z-spawn.z)-hit.distance)<.001f);
    crossyard.tick(1.f/60);
    assert(crossyard.players()[0].position.x==-18.f && crossyard.players()[0].position.y==0);
}

int main() {
    Room crossyard;
    assert(crossyard.join()==0);
    for(int id=1;id<static_cast<int>(MapId::count);++id) {
        const auto map=static_cast<MapId>(id);
        if(map_available(map)) check_map(map,crossyard);
    }
}
