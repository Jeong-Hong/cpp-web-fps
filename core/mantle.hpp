#pragma once
#include "arena.hpp"
#include <algorithm>
#include <cmath>

namespace arena {
constexpr float kMantleClearance=.025f;
constexpr float kMantleHandsHeight=1.4f;

inline float mantle_duration(const MantleState& mantle) { return mantle.sprint?.36f:.42f; }
inline float mantle_progress(const MantleState& mantle) { return mantle.elapsed/mantle_duration(mantle); }

inline bool mantle_uses_hands(const MantleState& mantle) {
    return mantle.active() && mantle.landing.y>mantle.start.y+kMantleHandsHeight;
}

inline float mantle_ease(float t) {
    t=std::clamp(t,0.f,1.f);
    return t*t*(3-2*t);
}

// End slopes are distances per unit of segment progress.
inline float mantle_segment(float t,float distance,float in_slope,float out_slope) {
    return distance*mantle_ease(t)+t*(1-t)*((1-t)*in_slope-t*out_slope);
}

inline Vec3 mantle_position(const MantleState& mantle) {
    constexpr float lift_end=.53f;
    const float progress=std::clamp(mantle_progress(mantle),0.f,1.f);
    const float rise=mantle.landing.y+kMantleClearance-mantle.start.y;
    const float distance=std::hypot(mantle.landing.x-mantle.start.x,mantle.landing.z-mantle.start.z);
    const float crossing=distance-mantle.approach;
    const float duration=mantle_duration(mantle), lift_time=duration*lift_end, cross_time=duration-lift_time;
    const float speed=mantle.sprint?kSprintSpeed:kSpeed;
    const float join_speed=std::min(mantle.approach/lift_time,crossing/cross_time);
    const float lift_t=std::min(progress/lift_end,1.f);
    const float lift=mantle_segment(lift_t,rise,.85f*rise,0);
    float forward;
    if(progress<lift_end) {
        forward=mantle_segment(lift_t,mantle.approach,std::min(speed*lift_time,2*mantle.approach),join_speed*lift_time);
    } else {
        const float t=(progress-lift_end)/(1-lift_end);
        forward=mantle.approach+mantle_segment(t,crossing,join_speed*cross_time,std::min(speed*cross_time,2*crossing));
    }
    const float settle=mantle_ease((progress-.95f)/.05f);
    return {std::lerp(mantle.start.x,mantle.landing.x,forward/distance),
            mantle.start.y+lift-kMantleClearance*settle,
            std::lerp(mantle.start.z,mantle.landing.z,forward/distance)};
}

inline MotionState advance_mantle(MotionState state,float dt) {
    state.mantle.elapsed+=dt;
    state.grounded=state.mantle.elapsed>=mantle_duration(state.mantle);
    state.vertical_velocity=0;
    state.position=state.grounded?state.mantle.landing:mantle_position(state.mantle);
    if(state.grounded) state.mantle={};
    return state;
}

template<class Blocked>
bool mantle_path_clear(MantleState path,Blocked blocked) {
    const auto from=path.start,to=path.landing;
    const float travel=std::max(to.y-from.y+kMantleClearance,std::hypot(to.x-from.x,to.z-from.z));
    const int steps=static_cast<int>(std::ceil(4*travel/.045f));
    for(int i=1;i<=steps;++i) {
        path.elapsed=mantle_duration(path)*float(i)/steps;
        if(blocked(mantle_position(path))) return false;
    }
    return true;
}

// ground returns the highest walkable surface below a point, or -infinity.
template<class Blocked,class Ground>
bool try_mantle(MotionState& state,const Input& input,Blocked blocked,Ground ground) {
    if(!input.jump || input.forward<=.1f || !state.grounded || state.crouching || state.prone) return false;
    constexpr float min_rise=.34f,max_rise=2.5f;
    const auto start=state.position;
    const float highest=start.y+max_rise;
    const auto direction=aim_direction(input.yaw,0);
    const auto ahead=[&](float distance,float y) {
        return Vec3{start.x+direction.x*distance,y,start.z+direction.z*distance};
    };
    if(blocked(start) || !std::isfinite(ground({start.x,start.y+.04f,start.z},.12f))) return false;
    const int probes=input.sprint?17:9;
    for(int i=1;i<=probes;++i) {
        const float distance=i*.05f;
        if(!blocked(ahead(distance,start.y))) continue;

        // Move the whole body past the face and require space to stand on top.
        const float reach=distance+2*kRadius+.05f;
        auto landing=ahead(reach,highest+.02f);
        const float top=ground(landing,max_rise);
        if(top<start.y+min_rise || top>highest) return false;
        landing.y=top;
        constexpr float foot=kRadius*.65f;
        for(float x:{-foot,foot}) for(float z:{-foot,foot}) {
            const float corner=ground({landing.x+x,top+.06f,landing.z+z},.12f);
            if(std::abs(corner-top)>.05f) return false;
            landing.y=std::max(landing.y,corner);
        }
        if(landing.y>highest || blocked(landing)) return false;

        MantleState path{start,landing,{},0,(i-1)*.05f,input.sprint};
        // Use the approach space when it is clear, with a vertical takeoff under tight geometry.
        if(!mantle_path_clear(path,blocked)) {
            if(path.approach==0) return false;
            path.approach=0;
            if(!mantle_path_clear(path,blocked)) return false;
        }
        state.mantle=path;
        if(!mantle_uses_hands(state.mantle)) return true;
        for(int hand=0;hand<2;++hand) {
            const float side=hand==0?-.16f:.16f;
            const auto hand_probe=[&](float at) {
                auto point=ahead(at,landing.y+.09f);
                point.x-=direction.z*side;
                point.z+=direction.x*side;
                return point;
            };
            auto grip=hand_probe(reach);
            grip.y=landing.y;
            for(float at=distance+.12f;at<reach;at+=.04f) {
                auto probe=hand_probe(at);
                const float surface=ground(probe,.17f);
                if(!std::isfinite(surface)) continue;
                grip={probe.x,surface,probe.z};
                break;
            }
            state.mantle.grips[hand]=grip;
        }
        return true;
    }
    return false;
}
}
