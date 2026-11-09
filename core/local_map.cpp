#include "local_map.hpp"
#include "mantle.hpp"
#include "stance.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <memory>

namespace arena::local_map {
namespace {
constexpr int kMinCell = -42;
constexpr int kCells = 84;
constexpr float kCellSize = 2;
constexpr float kSkin = .018f;
constexpr float kInfinity = std::numeric_limits<float>::infinity();

struct Preset {
    const char* path;
    float min_x, max_x, min_z, max_z;
    float center_x, center_z;
    std::array<Vec3,kCapacity> seeds;
};

constexpr Preset kMaps[] = {
    {"/maps/cachette.arena",-70,70,-55,55,0,0,{{{-7.3152f,2,7.3152f},{34.1376f,2,-12.192f},
                             {-30.8864f,2,12.192f},{-24.384f,2,-16.256f}}}},
    {"/maps/cafe.arena",-16.05f,16.05f,-19.3f,19.3f,0,0,{{{-1.346f,2,-17.221f},{1.346f,2,17.221f},
                                              {1.346f,2,-17.221f},{-1.346f,2,17.221f}}}},
    {"/maps/library.arena",-30.4f,30.0f,-14.2f,14.6f,0,0,{{{-21,2,-3},{21,2,3},{-21,2,3},{21,2,-3}}}},
    {"/maps/nyc.arena",-26,20,-20,53,-3,18,{{{-12,2.4f,-3},{4,2.4f,39},{4,2.4f,-3},{-12,2.4f,39}}}},
    {"/maps/smuggler.arena",-52,45,-40,40,0,0,{{{-32.877f,4.5f,-10.877f},{24.123f,4.5f,12.123f},
                                     {-27.877f,4.5f,-10.877f},{27.123f,4.5f,13.123f}}}},
};
static_assert(std::size(kMaps)+1==static_cast<int>(MapId::count));
int index(MapId id) { return static_cast<int>(id)-1; }

Vec3 plus(Vec3 a, Vec3 b) { return {a.x+b.x,a.y+b.y,a.z+b.z}; }
Vec3 minus(Vec3 a, Vec3 b) { return {a.x-b.x,a.y-b.y,a.z-b.z}; }
Vec3 mul(Vec3 a, float b) { return {a.x*b,a.y*b,a.z*b}; }
float dot(Vec3 a, Vec3 b) { return a.x*b.x+a.y*b.y+a.z*b.z; }
Vec3 cross(Vec3 a, Vec3 b) { return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x}; }

struct Surface {
    std::array<Vec3,3> points;
    std::uint32_t flags;
};
static_assert(sizeof(Surface)==40);
constexpr std::uint32_t kStairSurface=2;

// Layer order matches the map texture arrays in web/library-materials.mjs.
enum class SurfaceLayer { wall, floor, trim, riser };
SurfaceLayer surface_layer(MapId id,const Surface& triangle,Vec3 normal) {
    const auto [a,b,c]=triangle.points;
    const bool horizontal=std::abs(normal.y)>.68f;
    if(triangle.flags&kStairSurface) return horizontal?SurfaceLayer::trim:SurfaceLayer::riser;
    const float y=(a.y+b.y+c.y)/3;
    if(horizontal) {
        if(y>7) return SurfaceLayer::wall;
        return id==MapId::library && y>1.2f?SurfaceLayer::trim:SurfaceLayer::floor;
    }
    const float bottom=std::min({a.y,b.y,c.y}), top=std::max({a.y,b.y,c.y});
    return bottom>=-.3f && top<1.4f?SurfaceLayer::trim:SurfaceLayer::wall;
}

void append_triangle(MapId id,std::vector<float>& data,const Surface& triangle,std::vector<float>* materials) {
    const auto [a,b,c]=triangle.points;
    const auto normal=cross(minus(b,a),minus(c,a));
    const float size=std::sqrt(dot(normal,normal));
    if(size<1.e-7f) return;
    const auto n=mul(normal,1/size);
    for(const auto p:triangle.points) data.insert(data.end(),{p.x,p.y,p.z,n.x,n.y,n.z});
    if(materials) materials->insert(materials->end(),3,static_cast<float>(surface_layer(id,triangle,n)));
}

int cell(float x) { return std::clamp(int(std::floor(x/kCellSize))-kMinCell,0,kCells-1); }

struct Map {
    const Preset& preset;
    std::vector<Surface> triangles;
    std::array<std::vector<std::uint32_t>,kCells*kCells> cells;

    explicit Map(const Preset& config) : preset(config) {
        auto* file=std::fopen(preset.path,"rb");
        std::array<std::uint32_t,2> header{};
        if(!file || std::fread(header.data(),sizeof(header),1,file)!=1 ||
           header[0]!=0x31415943 || header[1]==0 || header[1]>200000) std::abort();
        triangles.resize(header[1]);
        if(std::fread(triangles.data(),sizeof(Surface),triangles.size(),file)!=triangles.size() ||
           std::fgetc(file)!=EOF) std::abort();
        std::fclose(file);
        add_perimeter();
        for(std::uint32_t id=0; id<triangles.size(); ++id) {
            const auto [a,b,c]=triangles[id].points;
            for(const auto p:{a,b,c})
                if(!std::isfinite(p.x)||!std::isfinite(p.y)||!std::isfinite(p.z)) std::abort();
            const int x0=cell(std::min({a.x,b.x,c.x})), x1=cell(std::max({a.x,b.x,c.x}));
            const int z0=cell(std::min({a.z,b.z,c.z})), z1=cell(std::max({a.z,b.z,c.z}));
            for(int x=x0;x<=x1;++x)
                for(int z=z0;z<=z1;++z) cells[x*kCells+z].push_back(id);
        }
    }

    void add_perimeter() {
        // Give the existing play limits an opaque surface at normal play height.
        const auto& p=preset;
        const auto highest=std::max_element(p.seeds.begin(),p.seeds.end(),
                                            [](Vec3 a,Vec3 b){return a.y<b.y;});
        const float top=highest->y+2;
        constexpr float bottom=-15;
        const std::array<Vec3,4> corners{{{p.min_x,bottom,p.min_z},{p.max_x,bottom,p.min_z},
                                          {p.max_x,bottom,p.max_z},{p.min_x,bottom,p.max_z}}};
        for(std::size_t i=0;i<corners.size();++i) {
            const auto a=corners[i], b=corners[(i+1)%corners.size()];
            const Vec3 c{b.x,top,b.z}, d{a.x,top,a.z};
            triangles.push_back({{a,b,c},1});
            triangles.push_back({{a,c,d},1});
        }
    }

    template<class Fn>
    bool visit(Vec3 lo, Vec3 hi, Fn fn) const {
        for(int x=cell(lo.x);x<=cell(hi.x);++x)
            for(int z=cell(lo.z);z<=cell(hi.z);++z)
                for(auto id:cells[x*kCells+z]) if(fn(triangles[id])) return true;
        return false;
    }
};

const Map& world(MapId id) {
    static std::array<std::unique_ptr<const Map>,std::size(kMaps)> maps;
    auto& map=maps[index(id)];
    if(!map) map=std::make_unique<const Map>(kMaps[index(id)]);
    return *map;
}

bool triangle_box(const Surface& s, Vec3 center, Vec3 extent) {
    const auto p=s.points;
    const auto lo=minus(center,extent), hi=plus(center,extent);
    if(std::min({p[0].x,p[1].x,p[2].x})>=hi.x || std::max({p[0].x,p[1].x,p[2].x})<=lo.x ||
       std::min({p[0].y,p[1].y,p[2].y})>=hi.y || std::max({p[0].y,p[1].y,p[2].y})<=lo.y ||
       std::min({p[0].z,p[1].z,p[2].z})>=hi.z || std::max({p[0].z,p[1].z,p[2].z})<=lo.z) return false;
    const auto a=minus(p[0],center), b=minus(p[1],center), c=minus(p[2],center);
    const auto separates=[&](Vec3 axis) {
        if(dot(axis,axis)<1.e-14f) return false;
        const float x=dot(a,axis), y=dot(b,axis), z=dot(c,axis);
        const float r=std::abs(axis.x)*extent.x+std::abs(axis.y)*extent.y+std::abs(axis.z)*extent.z;
        return std::min({x,y,z})>r || std::max({x,y,z})< -r;
    };
    const auto ab=minus(b,a), bc=minus(c,b), ca=minus(a,c);
    if(separates(cross(ab,bc))) return false;
    for(const auto e:{ab,bc,ca})
        if(separates({0,e.z,-e.y})||separates({-e.z,0,e.x})||separates({e.y,-e.x,0})) return false;
    return true;
}

bool blocked(const Map& map,Vec3 feet,float height) {
    const auto& preset=map.preset;
    if(feet.x<preset.min_x || feet.x>preset.max_x || feet.z<preset.min_z || feet.z>preset.max_z) return true;
    const auto center=plus(feet,{0,height/2,0});
    const Vec3 extent{kRadius-kSkin,height/2-kSkin,kRadius-kSkin};
    return map.visit(minus(center,extent),plus(center,extent),
                         [&](const Surface& s){return triangle_box(s,center,extent);});
}

Vec3 advance(const Map& map,Vec3 start,Vec3 delta,float height) {
    const float length=std::sqrt(dot(delta,delta));
    const int count=std::max(1,int(std::ceil(length/.075f)));
    for(int step=1;step<=count;++step) {
        const auto end=plus(start,mul(delta,float(step)/count));
        if(!blocked(map,end,height)) continue;
        float lo=float(step-1)/count, hi=float(step)/count;
        for(int i=0;i<8;++i) {
            const float mid=(lo+hi)/2;
            if(blocked(map,plus(start,mul(delta,mid)),height)) hi=mid; else lo=mid;
        }
        return plus(start,mul(delta,lo));
    }
    return plus(start,delta);
}

Vec3 slide(const Map& map,Vec3 start,Vec3 delta,float height,bool grounded) {
    const auto end=advance(map,start,delta,height);
    if(!grounded || dot(minus(end,start),delta)>=dot(delta,delta)*.998f) return end;
    const auto up=advance(map,start,{0,.26f,0},height);
    if(up.y-start.y<.22f) return end;
    const auto forward=advance(map,up,delta,height);
    if(dot(minus(forward,up),delta)<=dot(minus(end,start),delta)+1.e-5f) return end;
    return advance(map,forward,{0,start.y-forward.y-.06f,0},height);
}
}

bool available(MapId id) {
    if(id<=MapId::crossyard || id>=MapId::count) return false;
    auto* file=std::fopen(kMaps[index(id)].path,"rb");
    if(!file) return false;
    std::fclose(file);
    return true;
}
std::array<float,4> bounds(MapId id) {
    const auto& preset=kMaps[index(id)];
    return {preset.min_x,preset.max_x,preset.min_z,preset.max_z};
}

Hit ray(MapId id,Vec3 origin,Vec3 direction,float limit) {
    Hit hit{kInfinity,{}};
    const auto end=plus(origin,mul(direction,limit));
    const Vec3 lo{std::min(origin.x,end.x),std::min(origin.y,end.y),std::min(origin.z,end.z)};
    const Vec3 hi{std::max(origin.x,end.x),std::max(origin.y,end.y),std::max(origin.z,end.z)};
    world(id).visit(lo,hi,[&](const Surface& s) {
        const auto [a,b,c]=s.points;
        const auto e=minus(b,a), f=minus(c,a), p=cross(direction,f);
        const float det=dot(e,p);
        if(std::abs(det)<1.e-7f) return false;
        const auto t=minus(origin,a);
        const float u=dot(t,p)/det;
        if(u<0||u>1) return false;
        const auto q=cross(t,e);
        const float v=dot(direction,q)/det, d=dot(f,q)/det;
        if(v<0||u+v>1||d<.0001f||d>limit||d>=hit.distance) return false;
        const auto n=cross(e,f);
        hit={d,mul(n,(det<0?-1.f:1.f)/std::sqrt(dot(n,n)))};
        return false;
    });
    return hit;
}

Vec3 spawn(MapId id,int slot) {
    if(slot<0||slot>=kCapacity) return {};
    const auto& map=world(id);
    for(float dx:{0.f,-.8f,.8f,-1.6f,1.6f}) for(float dz:{0.f,-.8f,.8f,-1.6f,1.6f}) {
        auto start=plus(map.preset.seeds[slot],{dx,0,dz});
        const auto ground=ray(id,start,{0,-1,0},9);
        if(!std::isfinite(ground.distance)||ground.normal.y<.5f) continue;
        start.y-=ground.distance-.04f;
        const float yaw=spawn_yaw(id,start);
        if(!blocked(map,start,kStandingHeight) && !blocked(map,plus(start,{0,.4f,0}),kStandingHeight) &&
           !blocked(map,plus(start,{.3f*std::sin(yaw),0,-.3f*std::cos(yaw)}),kStandingHeight)) return start;
    }
    std::abort();
}

float spawn_yaw(MapId id,Vec3 position) {
    const auto& preset=kMaps[index(id)];
    return std::atan2(preset.center_x-position.x,position.z-preset.center_z);
}

MotionState motion(MapId id,MotionState state,const Input& input,float dt) {
    const auto& map=world(id);
    apply_stance(state,input,[&](float height) { return blocked(map,state.position,height); });
    if(try_mantle(state,input,[&](Vec3 feet) { return blocked(map,feet,kStandingHeight); },[&](Vec3 origin,float limit) {
        const auto& preset=map.preset;
        if(origin.x<preset.min_x || origin.x>preset.max_x || origin.z<preset.min_z || origin.z>preset.max_z) return -kInfinity;
        const auto hit=ray(id,origin,{0,-1,0},limit);
        return hit.normal.y>.8f ? origin.y-hit.distance : -kInfinity;
    })) return advance_mantle(state,dt);
    const float height=body_height(state.crouching,state.prone);
    float f=input.forward, s=input.strafe;
    const float len=std::hypot(f,s);
    if(len>1) { f/=len; s/=len; }
    const float distance=movement_speed(state,input.sprint)*dt;
    const float dx=(std::sin(input.yaw)*f+std::cos(input.yaw)*s)*distance;
    const float dz=(-std::cos(input.yaw)*f+std::sin(input.yaw)*s)*distance;
    state.position=slide(map,state.position,{dx,0,0},height,state.grounded);
    state.position=slide(map,state.position,{0,0,dz},height,state.grounded);
    if(input.jump&&state.grounded&&!state.prone) { state.vertical_velocity=kJumpSpeed; state.grounded=false; }
    if(state.grounded&&!blocked(map,plus(state.position,{0,-.07f,0}),height)) state.grounded=false;
    if(!state.grounded) {
        state.vertical_velocity-=kGravity*dt;
        const float dy=state.vertical_velocity*dt;
        const float y=state.position.y;
        state.position=advance(map,state.position,{0,dy,0},height);
        if(std::abs(state.position.y-y-dy)>.0001f) {
            state.grounded=dy<0;
            state.vertical_velocity=0;
        }
    }
    if(state.position.y< -15) return {spawn(id,0),0,true,state.crouching,state.prone};
    return state;
}

std::vector<float> render_vertices(MapId id,std::vector<float>* materials) {
    const auto& triangles=world(id).triangles;
    std::vector<float> data;
    data.reserve(18*triangles.size());
    if(materials) materials->clear();
    if(materials) materials->reserve(3*triangles.size());
    for(const auto& triangle:triangles) append_triangle(id,data,triangle,materials);
    return data;
}
}
