#pragma once
#include "camera.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace client::weapon_fx {
using arena::Vec3;
struct Tint { float r,g,b,a; };
struct Vertex { Vec3 position; Tint color; };
static_assert(sizeof(Vertex)==7*sizeof(float));

inline Vec3 add(Vec3 a,Vec3 b) { return {a.x+b.x,a.y+b.y,a.z+b.z}; }
inline Vec3 subtract(Vec3 a,Vec3 b) { return {a.x-b.x,a.y-b.y,a.z-b.z}; }
inline Vec3 scaled(Vec3 a,float s) { return {a.x*s,a.y*s,a.z*s}; }
inline float variation(std::uint32_t seed) {
    seed=(seed^(seed>>16))*0x7feb352du;
    seed=(seed^(seed>>15))*0x846ca68bu;
    return float((seed^(seed>>16))&0xffff)/65535.f;
}

class Effects {
    static constexpr float case_life=.72f;
    struct Casing {
        Vec3 position{},velocity{};
        float remaining=0,yaw=0,pitch=0,spin=0;
        bool pistol=false;
    };
    std::array<Casing,32> casings_{};
    std::size_t next_=0;
    std::vector<Vertex> vertices_;

    void triangle(Vertex a,Vertex b,Vertex c) { vertices_.insert(vertices_.end(),{a,b,c}); }

    void draw_casing(const Casing& casing,Vec3 eye) {
        constexpr std::array<std::array<float,2>,8> circle={{{1,0},{.707107f,.707107f},{0,1},{-.707107f,.707107f},
                                                           {-1,0},{-.707107f,-.707107f},{0,-1},{.707107f,-.707107f}}};
        const auto axis=forward(casing.yaw,casing.pitch),r=right(casing.yaw),u=up(casing.yaw,casing.pitch);
        const auto to_eye=subtract(eye,casing.position);
        const float radius=casing.pistol?.0085f:.009f, length=casing.pistol?.028f:.049f;
        const float mouth=casing.pistol?.92f:.68f, alpha=std::min(casing.remaining/.13f,1.f);
        const auto radial=[&](int i){return add(scaled(r,circle[i][0]),scaled(u,circle[i][1]));};
        const auto ring=[&](int i,float z,float width){return add(casing.position,add(scaled(axis,z*length),scaled(radial(i),radius*width)));};
        for(int i=0;i<8;++i){
            const int j=(i+1)%8;
            const auto normal=add(radial(i),radial(j));
            if(dot(normal,to_eye)>0){
                const float shade=.53f+.26f*std::clamp(dot(normal,{-.24f,.50f,.12f}),0.f,1.f);
                const auto band=[&](float from,float to,float base,float end,Tint color){
                    const Vertex a{ring(i,from,base),color},b{ring(j,from,base),color};
                    const Vertex c{ring(j,to,end),color},d{ring(i,to,end),color};
                    triangle(a,b,c);triangle(a,c,d);
                };
                band(-.50f,-.37f,1.06f,1.06f,{.85f,.58f,.24f,alpha});
                band(-.37f,.24f,1,1,{shade,.68f*shade,.25f*shade,alpha});
                band(.24f,.50f,1,mouth,{shade+.08f,.65f*shade,.22f*shade,alpha});
            }
            if(dot(axis,to_eye)>0){
                const Tint lip{.83f,.56f,.22f,alpha},inside{.13f,.08f,.035f,alpha};
                const Vertex a{ring(i,.50f,mouth),lip},b{ring(j,.50f,mouth),lip};
                const Vertex c{ring(j,.50f,mouth*.58f),lip},d{ring(i,.50f,mouth*.58f),lip};
                triangle({add(casing.position,scaled(axis,.49f*length)),inside},{d.position,inside},{c.position,inside});
                triangle(a,b,c);triangle(a,c,d);
            }else{
                const Tint primer{.55f,.34f,.12f,alpha},head{.72f,.49f,.20f,alpha};
                triangle({add(casing.position,scaled(axis,-.50f*length)),primer},{ring(i,-.50f,1.06f),head},{ring(j,-.50f,1.06f),head});
            }
        }
    }

public:
    void clear() { casings_={}; next_=0; vertices_.clear(); }
    const std::vector<Vertex>& vertices() const { return vertices_; }

    void frame(float dt) {
        vertices_.clear();
        for(auto& casing:casings_){
            if(casing.remaining<=0)continue;
            casing.remaining-=dt;
            casing.position=add(casing.position,scaled(casing.velocity,dt));
            casing.position.y-=arena::kGravity*dt*dt*.5f;
            casing.velocity.y-=arena::kGravity*dt;
            casing.yaw+=casing.spin*dt;
            casing.pitch+=casing.spin*.73f*dt;
        }
    }

    void eject(Vec3 port,float yaw,float pitch,bool pistol,std::uint32_t shot,bool reduced) {
        const auto r=right(yaw),f=forward(yaw,pitch);
        auto& casing=casings_[next_++%casings_.size()];
        const float speed=(pistol?1.25f:1.62f)+variation(shot)*.40f;
        casing={add(port,scaled(r,.012f)),add(add(scaled(r,speed),scaled(f,-.26f)),{0,1.05f+variation(shot+31)*.53f,0}),
                case_life,yaw+.75f,pitch+.20f,(reduced?3.f:8.f)+variation(shot+71)*3.f,pistol};
    }

    void draw_casings(Vec3 eye) {
        for(const auto& casing:casings_)if(casing.remaining>0)draw_casing(casing,eye);
    }

    void flash(Vec3 muzzle,Vec3 eye,float yaw,float pitch,float age,bool pistol,std::uint32_t shot,bool reduced) {
        constexpr float lifetime=.062f;
        if(age>=lifetime)return;
        const float remaining=std::clamp((lifetime-age)/(lifetime-.012f),0.f,1.f);
        const float intensity=remaining*remaining*(reduced?.58f:1.f);
        const auto center=add(muzzle,scaled(forward(yaw,pitch),pistol?.038f:.058f));
        const auto look=subtract(center,eye);
        const float facing=std::atan2(look.x,-look.z),tilt=std::atan2(look.y,std::hypot(look.x,look.z));
        const auto r=right(facing),u=up(facing,tilt);
        const float radius=(pistol?.075f:.108f)*(reduced?.78f:1.f)*(.96f+age*3);
        const float rotation=variation(shot+101)*2*arena::kPi;
        const auto radial=[&](float a){return add(scaled(r,std::cos(a)),scaled(u,std::sin(a)));};
        constexpr int lobes=12;
        std::array<Vertex,lobes> inner{},outer{};
        for(int i=0;i<lobes;++i){
            const auto direction=radial(rotation+i*2*arena::kPi/lobes);
            const float shape=(i%3==0?1.20f:.68f)+.29f*variation(shot*19u+i);
            inner[i]={add(center,scaled(direction,radius*(.31f+.10f*shape))),{1.14f,.65f,.16f,.80f*intensity}};
            outer[i]={add(center,scaled(direction,radius*shape)),{1.05f,.29f,.04f,0}};
        }
        const Vertex core{center,{1.30f,1.18f,.82f,.96f*intensity}};
        for(int i=0;i<lobes;++i){
            const int j=(i+1)%lobes;
            triangle(core,inner[i],inner[j]);
            triangle(inner[i],outer[i],outer[j]);
            triangle(inner[i],outer[j],inner[j]);
        }
        if(!reduced)for(int i=0;i<3;++i){
            const float angle=rotation+i*2.09f;
            const auto direction=radial(angle),side=radial(angle+arena::kPi*.5f);
            const auto start=add(center,scaled(direction,radius*(.75f+age*6)));
            const Tint ember{1.13f,.61f,.14f,.55f*intensity},end{1.05f,.37f,.05f,0};
            triangle({add(start,scaled(side,.003f)),ember},{add(start,scaled(side,-.003f)),ember},
                     {add(start,scaled(direction,radius*.51f)),end});
        }
    }
};
}
