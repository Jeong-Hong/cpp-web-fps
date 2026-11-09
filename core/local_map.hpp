#pragma once
#include "arena.hpp"

namespace arena::local_map {
struct Hit { float distance; Vec3 normal; };
bool available(MapId map);
std::array<float,4> bounds(MapId map);
Vec3 spawn(MapId map,int slot);
float spawn_yaw(MapId map,Vec3 position);
Hit ray(MapId map,Vec3 origin,Vec3 direction,float limit);
MotionState motion(MapId map,MotionState state,const Input& input,float dt);
std::vector<float> render_vertices(MapId map,std::vector<float>* materials=nullptr);
}
