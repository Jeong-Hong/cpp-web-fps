#pragma once
#include <array>
#include <cstdint>
#include <vector>

namespace arena {
constexpr int kCapacity = 4;
constexpr int kTeamCount = 2;
constexpr float kEyeHeight = 1.6f;
constexpr float kRadius = 0.35f;
constexpr float kSpeed = 5.0f;
constexpr float kSprintSpeed = 7.0f;
constexpr float kPi = 3.14159265358979323846f;
constexpr float kStandingHeight=1.8f, kCrouchHeight=1.1f, kCrouchEyeHeight=0.95f;
constexpr float kGravity=18.0f, kJumpSpeed=8.0f, kCrouchSpeed=2.5f;
constexpr float kProneHeight=0.58f, kProneEyeHeight=0.43f, kProneSpeed=1.25f, kProneLength=1.6f;
constexpr int kMaxGrenades=16;
constexpr int kGrenadesPerSpawn=1;
constexpr float kGrenadeRadius=0.12f, kGrenadeFuse=2.5f, kBlastRadius=6.0f;
constexpr float kGrenadeThrowSpeed=18.0f, kGrenadeThrowLift=6.0f;
struct Vec3 { float x=0, y=0, z=0; };
struct MantleState {
    Vec3 start{}, landing{};
    std::array<Vec3,2> grips{};
    float elapsed=-1;
    float approach=0;
    bool sprint=false;
    bool active() const { return elapsed>=0; }
};
// Values are part of the Wasm ABI and match web/maps.mjs.
enum class MapId { crossyard, cachette, cafe, library, nyc, smuggler, count };
enum class RoomMode { free_for_all, two_vs_two, gunfight };
enum class MatchPhase { live, waiting, countdown, finished };
bool map_available(MapId map);
struct Box { float x,y,z,sx,sy,sz,r,g,b; bool solid=true; };
struct Input {
    float forward=0, strafe=0, yaw=0, pitch=0;
    bool fire=false, reload=false, sprint=false;
    std::uint32_t seq=0;
    bool jump=false, crouch=false;
    int weapon=0;
    bool grenade=false;
    bool prone=false;
};
struct MotionState {
    Vec3 position{};
    float vertical_velocity=0;
    bool grounded=true, crouching=false, prone=false;
    MantleState mantle{};
};
struct WeaponDefinition {
    int magazine, damage;
    float interval, reload;
    bool automatic;
    float recoil_kick, recoil_recovery, recoil_limit;
};
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
    float yaw=0, pitch=0, recoil=0;
    int hp=100, ammo=24, kills=0, deaths=0;
    float reload=0, respawn=0, shield=0, cooldown=0, stale=0;
    std::uint32_t shot=0, reloads=0, hit=0, damage=0, ack=0;
    Vec3 trace{};
    Input input{};
    float vertical_velocity=0, equip=0, grenade_cooldown=0;
    // Remember the accepted button level even when executable controls time out.
    bool grounded=true, crouching=false, prone=false, semi_pending=false, last_fire_down=false;
    int weapon=0, shot_weapon=0, pistol_ammo=12, grenades=kGrenadesPerSpawn;
    MantleState mantle{};
};
const WeaponDefinition& weapon_definition(int weapon);
bool holding_rifle_recoil(const Player& player);
float recover_weapon_recoil(int weapon,float recoil,float dt,bool held=false);
float recoil_aim_pitch(float pitch,float recoil);
int& active_ammo(Player& player);
int active_ammo(const Player& player);
float body_height(bool crouching,bool prone=false);
float eye_height(bool crouching,bool prone=false);
MotionState step_motion(MotionState state,const Input& input,float dt,MapId map=MapId::crossyard);
const std::vector<Box>& world_boxes();
Vec3 spawn_point(int slot,MapId map=MapId::crossyard);
float spawn_yaw(int slot,MapId map=MapId::crossyard);
bool valid_input(const Input& input);
Vec3 move_position(Vec3 from, float forward, float strafe, float yaw, float dt, bool sprint);
Vec3 aim_direction(float yaw,float pitch);
// Returns infinity on miss; max_distance bounds the ray.
float ray_box(Vec3 origin,Vec3 direction,const Box& box,float max_distance=80.0f);
bool clear_sight(MapId map,Vec3 origin,Vec3 destination);
class Room {
public:
    explicit Room(MapId map=MapId::crossyard,RoomMode mode=RoomMode::free_for_all);
    int join();
    void leave(int slot);
    bool set_input(int slot,const Input& input);
    void tick(float dt);
    int count() const;
    bool team_mode() const { return mode_!=RoomMode::free_for_all; }
    bool gunfight() const { return mode_==RoomMode::gunfight; }
    bool playing() const { return !team_mode() || (winner_<0 && count()==kCapacity); }
    MatchPhase phase() const;
    int target_score() const { return gunfight()?6:20; }
    int winner() const { return winner_; }
    int round() const { return round_; }
    int round_result() const { return round_result_; }
    float phase_seconds() const;
    unsigned deployment() const { return deployment_; }
    bool rematch();
    // The map presets group opposing spawns by even and odd slot numbers.
    int team(int slot) const { return slot%kTeamCount; }
    const std::array<int,kTeamCount>& team_scores() const { return team_scores_; }
    double time() const { return time_ms_; }
    const std::array<Player,kCapacity>& players() const { return players_; }
    const std::array<Grenade,kMaxGrenades>& grenades() const { return grenades_; }
private:
    bool teammates(int a,int b) const;
    void credit_kill(int slot);
    void deploy(int slot,int spawn);
    void reset_players();
    int choose_respawn(int slot) const;
    void finish_round(float dt);
    const MapId map_;
    const RoomMode mode_;
    std::array<int,kTeamCount> team_scores_{};
    std::array<Player,kCapacity> players_{};
    double time_ms_=0;
    std::array<Grenade,kMaxGrenades> grenades_{};
    std::uint32_t next_grenade_id_=1;
    int winner_=-1, round_=1, round_result_=-2;
    float countdown_=0, round_left_=40;
    bool restart_round_=false;
    unsigned deployment_=0;
};
}
