#include "camera.hpp"
#include <cmath>
#include <cstdlib>
#include <iostream>
void require(bool yes,const char* message){if(!yes){std::cerr<<"FAIL "<<message<<"\n";std::exit(1);}}
int main(){
 const auto p=client::perspective(70,1.6f,.05f,150);
 for(float yaw: {0.f,arena::kPi/2}) {
  const arena::Vec3 eye{4,1.6f,-3};
  const auto v=client::view(eye,yaw,.2f);
  const auto vp=client::multiply(p,v);
  const auto f=client::forward(yaw,.2f);
  const auto clip=client::transform(vp,{eye.x+f.x*5,eye.y+f.y*5,eye.z+f.z*5});
  require(clip[3]>0,"point ahead has positive clip w");
  require(std::abs(clip[0]/clip[3])<.001f&&std::abs(clip[1]/clip[3])<.001f,"aim direction projects to screen center");
  const auto right=client::right(yaw);
  const auto side=client::transform(vp,{eye.x+f.x*5+right.x,eye.y+f.y*5,eye.z+f.z*5+right.z});
  require(side[0]/side[3]>0,"camera right projects right, not mirrored");
 }
 std::cout<<"PASS 6 C++ camera projection checks\n";
}
