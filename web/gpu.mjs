// Thin platform adapter: C++ supplies every instance transform, color and camera.
export function cubeVertices() {
  const faces = [
    [[1,0,0], [[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5],[.5,-.5,.5]]],
    [[-1,0,0], [[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5],[-.5,-.5,-.5]]],
    [[0,1,0], [[-.5,.5,-.5],[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5]]],
    [[0,-1,0], [[-.5,-.5,.5],[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5]]],
    [[0,0,1], [[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5],[-.5,-.5,.5]]],
    [[0,0,-1], [[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[.5,-.5,-.5]]],
  ];
  return new Float32Array(faces.flatMap(([n,p])=>[0,1,2,0,2,3].flatMap(i=>[...p[i],...n])));
}
const LIMIT=4096, STRIDE=11, SKY=[.70,.79,.80,1];
const wgsl=`
struct Globals { vp:mat4x4f, eye:vec4f };
@group(0) @binding(0) var<uniform> g:Globals;
struct VOut { @builtin(position) position:vec4f, @location(0) color:vec3f, @location(1) distance:f32 };
fn rotate(p:vec3f,y:f32,t:f32)->vec3f {
 let a=vec3f(p.x,cos(t)*p.y-sin(t)*p.z,sin(t)*p.y+cos(t)*p.z);
 return vec3f(cos(y)*a.x-sin(y)*a.z,a.y,sin(y)*a.x+cos(y)*a.z);
}
@vertex fn vs(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) center:vec3f,
 @location(3) size:vec3f,@location(4) color:vec3f,@location(5) yaw:f32,@location(6) pitch:f32)->VOut {
 let world=rotate(p*size,yaw,pitch)+center;
 let normal=rotate(n,yaw,pitch);
 var o:VOut; let clip=g.vp*vec4f(world,1);
 o.position=vec4f(clip.xy,(clip.z+clip.w)*.5,clip.w);
 let shade=.58+.42*max(0.,dot(normal,normalize(vec3f(-.4,.85,.3))));
 o.color=color*shade; o.distance=distance(world,g.eye.xyz); return o;
}
@fragment fn fs(i:VOut)->@location(0) vec4f {
 let fog=smoothstep(30.,92.,i.distance);
 return vec4f(mix(i.color,vec3f(.70,.79,.80),fog),1);
}`;
const glvs=`#version 300 es
precision highp float;
layout(location=0) in vec3 p; layout(location=1) in vec3 n;
layout(location=2) in vec3 center; layout(location=3) in vec3 size;
layout(location=4) in vec3 color; layout(location=5) in float yaw; layout(location=6) in float pitch;
uniform mat4 vp; uniform vec3 eye; out vec3 vcolor; out float vdistance;
vec3 rotatePoint(vec3 p,float y,float t) {
 vec3 a=vec3(p.x,cos(t)*p.y-sin(t)*p.z,sin(t)*p.y+cos(t)*p.z);
 return vec3(cos(y)*a.x-sin(y)*a.z,a.y,sin(y)*a.x+cos(y)*a.z);
}
void main(){vec3 world=rotatePoint(p*size,yaw,pitch)+center; vec3 normal=rotatePoint(n,yaw,pitch);
 gl_Position=vp*vec4(world,1.); vcolor=color*(.58+.42*max(0.,dot(normal,normalize(vec3(-.4,.85,.3)))));
 vdistance=distance(world,eye);}`;
const glfs=`#version 300 es
precision highp float;
in vec3 vcolor; in float vdistance; out vec4 result;
void main(){result=vec4(mix(vcolor,vec3(.70,.79,.80),smoothstep(30.,92.,vdistance)),1.);}`;
function dimensions(canvas) {
  const ratio=Math.min(globalThis.devicePixelRatio||1,1.5);
  const w=Math.max(1,Math.round(canvas.clientWidth*ratio)), h=Math.max(1,Math.round(canvas.clientHeight*ratio));
  if(canvas.width!==w||canvas.height!==h) {canvas.width=w;canvas.height=h;}
  return [w,h];
}
function validate(matrix,instances,eye) {
  if(matrix.length!==16||eye.length!==3||instances.length%STRIDE||instances.length>LIMIT*STRIDE) throw Error('Invalid C++ render buffers');
}
async function webgpu(canvas) {
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter) throw Error('No WebGPU adapter');
  const device=await adapter.requestDevice();
  device.pushErrorScope('validation');
  const shader=device.createShaderModule({code:wgsl});
  const format=navigator.gpu.getPreferredCanvasFormat();
  const pipeline=await device.createRenderPipelineAsync({layout:'auto',
    vertex:{module:shader,entryPoint:'vs',buffers:[
      {arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]},
      {arrayStride:44,stepMode:'instance',attributes:[{shaderLocation:2,offset:0,format:'float32x3'},{shaderLocation:3,offset:12,format:'float32x3'},{shaderLocation:4,offset:24,format:'float32x3'},{shaderLocation:5,offset:36,format:'float32'},{shaderLocation:6,offset:40,format:'float32'}]},
    ]},fragment:{module:shader,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list',cullMode:'none'},
    depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},multisample:{count:4}});
  const validationError=await device.popErrorScope();
  if(validationError) throw Error(validationError.message);
  const context=canvas.getContext('webgpu');
  if(!context) throw Error('WebGPU context unavailable');
  context.configure({device,format,alphaMode:'opaque'});
  const vertex=device.createBuffer({size:cubeVertices().byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(vertex,0,cubeVertices());
  const instances=device.createBuffer({size:LIMIT*44,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const uniforms=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniforms}}]});
  let depth,color,lastW=0,lastH=0,disposed=false;
  device.lost.then(info=>{if(!disposed) canvas.dispatchEvent(new CustomEvent('rendererlost',{detail:info.reason}));});
  device.addEventListener('uncapturederror',event=>canvas.dispatchEvent(new CustomEvent('rendererlost',{detail:event.error.message})));
  return {api:'WebGPU',reason:'',draw(matrix,data,eye){
    validate(matrix,data,eye);if(disposed)return;
    const [w,h]=dimensions(canvas);
    if(w!==lastW||h!==lastH){depth?.destroy();color?.destroy();
      depth=device.createTexture({size:[w,h],format:'depth24plus',sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});
      color=device.createTexture({size:[w,h],format,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});lastW=w;lastH=h;}
    const u=new Float32Array(20);u.set(matrix);u.set(eye,16);
    device.queue.writeBuffer(uniforms,0,u);if(data.length)device.queue.writeBuffer(instances,0,data);
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:color.createView(),resolveTarget:context.getCurrentTexture().createView(),clearValue:SKY,loadOp:'clear',storeOp:'discard'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.setVertexBuffer(0,vertex);pass.setVertexBuffer(1,instances);pass.draw(36,data.length/STRIDE);pass.end();device.queue.submit([encoder.finish()]);
  },dispose(){disposed=true;depth?.destroy();color?.destroy();vertex.destroy();instances.destroy();uniforms.destroy();device.destroy();}};
}
function webgl(canvas,reason) {
  const gl=canvas.getContext('webgl2',{antialias:true,alpha:false,preserveDrawingBuffer:true});
  if(!gl)throw Error('WebGPU and WebGL2 are unavailable');
  const shader=(kind,source)=>{const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const vs=shader(gl.VERTEX_SHADER,glvs), fs=shader(gl.FRAGMENT_SHADER,glfs);
  const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.deleteShader(vs);gl.deleteShader(fs);
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);
  const vertex=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertex);gl.bufferData(gl.ARRAY_BUFFER,cubeVertices(),gl.STATIC_DRAW);
  for(let i=0;i<2;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,24,i*12);}
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,LIMIT*44,gl.DYNAMIC_DRAW);
  for(const [loc,size,offset] of [[2,3,0],[3,3,12],[4,3,24],[5,1,36],[6,1,40]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,44,offset);gl.vertexAttribDivisor(loc,1);}
  const vp=gl.getUniformLocation(program,'vp'), camera=gl.getUniformLocation(program,'eye');
  let disposed=false;
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();canvas.dispatchEvent(new CustomEvent('rendererlost',{detail:'WebGL context lost'}));});
  return {api:'WebGL2',reason,draw(matrix,instances,eye){
    validate(matrix,instances,eye);if(disposed)return;
    const [w,h]=dimensions(canvas);gl.viewport(0,0,w,h);gl.enable(gl.DEPTH_TEST);gl.clearColor(...SKY);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);gl.bindVertexArray(vao);gl.uniformMatrix4fv(vp,false,matrix);gl.uniform3fv(camera,eye);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,instances);gl.drawArraysInstanced(gl.TRIANGLES,0,36,instances.length/STRIDE);
  },dispose(){disposed=true;gl.deleteBuffer(vertex);gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteProgram(program);}};
}
export async function createRenderer(canvas,{forceWebGL=false}={}) {
  let reason=forceWebGL?'WebGL2 selected':(!globalThis.isSecureContext?'WebGPU requires HTTPS or localhost':'WebGPU API unavailable');
  if(!forceWebGL&&globalThis.isSecureContext&&globalThis.navigator?.gpu){
    try{return await webgpu(canvas);}catch(error){reason=`WebGPU initialization failed: ${error.message}`;console.warn(reason);}
  }
  return webgl(canvas,reason);
}
