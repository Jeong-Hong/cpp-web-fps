#pragma once
#include <array>
#include <cstdint>
#include <vector>

namespace arena {
constexpr int kCapacity = 4;
constexpr float kEyeHeight = 1.6f;
constexpr float kRadius = 0.35f;
constexpr float kSpeed = 5.0f;
constexpr float kSprintSpeed = 7.0f;
constexpr float kPi = 3.14159265358979323846f;
struct Vec3 { float x=0, y=0, z=0; };
struct Box { float x,y,z,sx,sy,sz,r,g,b; bool solid=true; };
struct Input {
    float forward=0, strafe=0, yaw=0, pitch=0;
    bool fire=false, reload=false, sprint=false;
    std::uint32_t seq=0;
};
struct Player {
    bool active=false;
    Vec3 position{};
    float yaw=0, pitch=0;
    int hp=100, ammo=24, kills=0, deaths=0;
    float reload=0, respawn=0, shield=0, cooldown=0, stale=0;
    std::uint32_t shot=0, hit=0, damage=0, ack=0;
    Vec3 trace{};
    Input input{};
};
const std::vector<Box>& world_boxes();
Vec3 spawn_point(int slot);
float spawn_yaw(int slot);
bool valid_input(const Input& input);
Vec3 move_position(Vec3 from, float forward, float strafe, float yaw, float dt, bool sprint);
Vec3 aim_direction(float yaw,float pitch);
// Returns infinity on miss; max_distance bounds the ray.
float ray_box(Vec3 origin,Vec3 direction,const Box& box,float max_distance=80.0f);
class Room {
public:
    int join();
    void leave(int slot);
    bool set_input(int slot,const Input& input);
    void tick(float dt);
    int count() const;
    double time() const { return time_ms_; }
    const std::array<Player,kCapacity>& players() const { return players_; }
private:
    std::array<Player,kCapacity> players_{};
    double time_ms_=0;
};
}
