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
constexpr float kStandingHeight=1.8f, kCrouchHeight=1.1f, kCrouchEyeHeight=0.95f;
constexpr float kGravity=18.0f, kJumpSpeed=8.0f, kCrouchSpeed=2.5f;
constexpr int kMaxGrenades=16;
constexpr float kGrenadeRadius=0.12f, kGrenadeFuse=2.5f, kBlastRadius=6.0f;
struct Vec3 { float x=0, y=0, z=0; };
struct Box { float x,y,z,sx,sy,sz,r,g,b; bool solid=true; };
struct Input {
    float forward=0, strafe=0, yaw=0, pitch=0;
    bool fire=false, reload=false, sprint=false;
    std::uint32_t seq=0;
    bool jump=false, crouch=false;
    int weapon=0;
    bool grenade=false;
};
struct MotionState {
    Vec3 position{};
    float vertical_velocity=0;
    bool grounded=true, crouching=false;
};
struct WeaponDefinition { int magazine, damage; float interval, reload; bool automatic; };
struct Grenade {
    bool active=false, exploding=false;
    std::uint32_t id=0;
    int owner=-1;
    Vec3 position{}, velocity{};
    float fuse=kGrenadeFuse, explosion=0;
};
struct Player {
    bool active=false, received_input=false;
    Vec3 position{};
    float yaw=0, pitch=0;
    int hp=100, ammo=24, kills=0, deaths=0;
    float reload=0, respawn=0, shield=0, cooldown=0, stale=0;
    std::uint32_t shot=0, hit=0, damage=0, ack=0;
    Vec3 trace{};
    Input input{};
    float vertical_velocity=0, equip=0, grenade_cooldown=0;
    bool grounded=true, crouching=false, semi_pending=false;
    int weapon=0, pistol_ammo=12, grenades=2;
};
const WeaponDefinition& weapon_definition(int weapon);
int& active_ammo(Player& player);
int active_ammo(const Player& player);
float body_height(bool crouching);
float eye_height(bool crouching);
MotionState step_motion(MotionState state,const Input& input,float dt);
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
    const std::array<Grenade,kMaxGrenades>& grenades() const { return grenades_; }
private:
    std::array<Player,kCapacity> players_{};
    double time_ms_=0;
    std::array<Grenade,kMaxGrenades> grenades_{};
    std::uint32_t next_grenade_id_=1;
};
}
