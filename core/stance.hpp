#pragma once
#include "arena.hpp"

namespace arena {
template<class Blocked>
void apply_stance(MotionState& state,const Input& input,Blocked blocked) {
    if(input.prone && !state.grounded && !state.prone) return;
    const bool crouching=input.crouch && !input.prone;
    const float height=body_height(crouching,input.prone);
    if(height>body_height(state.crouching,state.prone) && blocked(height)) return;
    state.crouching=crouching;
    state.prone=input.prone;
}

inline float movement_speed(const MotionState& state,bool sprint) {
    if(state.prone) return kProneSpeed;
    if(state.crouching) return kCrouchSpeed;
    return sprint?kSprintSpeed:kSpeed;
}
}
