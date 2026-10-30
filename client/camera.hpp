#pragma once
#include "arena.hpp"
#include <array>
#include <cmath>
namespace client {
using Mat4=std::array<float,16>;
inline arena::Vec3 forward(float yaw,float pitch){return {std::sin(yaw)*std::cos(pitch),std::sin(pitch),-std::cos(yaw)*std::cos(pitch)};}
inline arena::Vec3 right(float yaw){return {std::cos(yaw),0,std::sin(yaw)};}
inline arena::Vec3 up(float yaw,float pitch){return {-std::sin(yaw)*std::sin(pitch),std::cos(pitch),std::cos(yaw)*std::sin(pitch)};}
inline float dot(arena::Vec3 a,arena::Vec3 b){return a.x*b.x+a.y*b.y+a.z*b.z;}
inline Mat4 perspective(float degrees,float aspect,float nearPlane,float farPlane){
 const float f=1/std::tan(degrees*arena::kPi/360.f);
 return {f/aspect,0,0,0,0,f,0,0,0,0,(farPlane+nearPlane)/(nearPlane-farPlane),-1,0,0,2*farPlane*nearPlane/(nearPlane-farPlane),0};
}
inline Mat4 view(arena::Vec3 eye,float yaw,float pitch){
 const auto r=right(yaw),u=up(yaw,pitch),f=forward(yaw,pitch);
 return {r.x,u.x,-f.x,0,r.y,u.y,-f.y,0,r.z,u.z,-f.z,0,-dot(r,eye),-dot(u,eye),dot(f,eye),1};
}
inline Mat4 multiply(const Mat4& a,const Mat4& b){
 Mat4 out{};for(int col=0;col<4;++col)for(int row=0;row<4;++row)for(int k=0;k<4;++k)out[col*4+row]+=a[k*4+row]*b[col*4+k];return out;
}
inline std::array<float,4> transform(const Mat4& m,arena::Vec3 p){
 return {m[0]*p.x+m[4]*p.y+m[8]*p.z+m[12],m[1]*p.x+m[5]*p.y+m[9]*p.z+m[13],m[2]*p.x+m[6]*p.y+m[10]*p.z+m[14],m[3]*p.x+m[7]*p.y+m[11]*p.z+m[15]};
}
}
