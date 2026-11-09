// Thin platform adapter: C++ supplies every instance transform, color and camera.
import { mapMaterials } from './library-materials.mjs';

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
const FX_LIMIT=8192, FX_STRIDE=7, EMPTY_FX=new Float32Array();
const WORLD_INSTANCE=new Float32Array([0,0,0,1,1,1,.49,.47,.41,0,0]);
const wgsl=(textured=false)=>`
struct Globals { vp:mat4x4f, eye:vec4f };
@group(0) @binding(0) var<uniform> g:Globals;
${textured?'@group(0) @binding(1) var tiles:texture_2d_array<f32>; @group(0) @binding(2) var tileSampler:sampler;':''}
struct VOut {
 @builtin(position) position:vec4f, @location(0) color:vec3f, @location(1) distance:f32,
 ${textured?'@location(2) uv:vec2f, @location(3) @interpolate(flat) layer:i32,':''}
};
fn rotate(p:vec3f,y:f32,t:f32)->vec3f {
 let a=vec3f(p.x,cos(t)*p.y-sin(t)*p.z,sin(t)*p.y+cos(t)*p.z);
 return vec3f(cos(y)*a.x-sin(y)*a.z,a.y,sin(y)*a.x+cos(y)*a.z);
}
@vertex fn vs(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) center:vec3f,
 @location(3) size:vec3f,@location(4) color:vec3f,@location(5) yaw:f32,@location(6) pitch:f32
 ${textured?', @location(7) layer:f32':''})->VOut {
 let world=rotate(p*size,yaw,pitch)+center;
 let normal=rotate(n,yaw,pitch);
 var o:VOut; let clip=g.vp*vec4f(world,1);
 o.position=vec4f(clip.xy,(clip.z+clip.w)*.5,clip.w);
 let shade=.58+.42*max(0.,dot(normal,normalize(vec3f(-.4,.85,.3))));
 ${textured?'o.color=vec3f(.72+.28*max(0.,dot(normal,normalize(vec3f(-.4,.85,.3)))));':'o.color=color*shade;'}
 o.distance=distance(world,g.eye.xyz);
 ${textured?`o.layer=i32(layer);
 let wall=select(world.xy,world.zy,abs(normal.x)>abs(normal.z));
 o.uv=select(wall,world.xz,abs(normal.y)>.68)*.56;`:''}
 return o;
}
@fragment fn fs(i:VOut)->@location(0) vec4f {
 let fog=smoothstep(30.,92.,i.distance);
 let color=${textured?'i.color*textureSample(tiles,tileSampler,i.uv,i.layer).rgb':'i.color'};
 return vec4f(mix(color,vec3f(.70,.79,.80),fog),1);
}`;
const glvs=(textured=false)=>`#version 300 es
precision highp float;
layout(location=0) in vec3 p; layout(location=1) in vec3 n;
layout(location=2) in vec3 center; layout(location=3) in vec3 size;
layout(location=4) in vec3 color; layout(location=5) in float yaw; layout(location=6) in float pitch;
uniform mat4 vp; uniform vec3 eye; out vec3 vcolor; out float vdistance;
${textured?'layout(location=7) in float layer; out vec2 uv; flat out int material;':''}
vec3 rotatePoint(vec3 p,float y,float t) {
 vec3 a=vec3(p.x,cos(t)*p.y-sin(t)*p.z,sin(t)*p.y+cos(t)*p.z);
 return vec3(cos(y)*a.x-sin(y)*a.z,a.y,sin(y)*a.x+cos(y)*a.z);
}
void main(){vec3 world=rotatePoint(p*size,yaw,pitch)+center; vec3 normal=rotatePoint(n,yaw,pitch);
 gl_Position=vp*vec4(world,1.);
 float light=max(0.,dot(normal,normalize(vec3(-.4,.85,.3))));
 ${textured?`vcolor=vec3(.72+.28*light);
 material=int(layer);
 vec2 wall=abs(normal.x)>abs(normal.z)?world.zy:world.xy;
 uv=(abs(normal.y)>.68?world.xz:wall)*.56;`:'vcolor=color*(.58+.42*light);'}
 vdistance=distance(world,eye);}`;
const glfs=(textured=false)=>`#version 300 es
precision highp float;
in vec3 vcolor; in float vdistance; out vec4 result;
${textured?'in vec2 uv; flat in int material; uniform highp sampler2DArray tiles;':''}
void main(){
 vec3 color=${textured?'vcolor*texture(tiles,vec3(uv,float(material))).rgb':'vcolor'};
 result=vec4(mix(color,vec3(.70,.79,.80),smoothstep(30.,92.,vdistance)),1.);
}`;
const fxWGSL=`
struct Globals { vp:mat4x4f, eye:vec4f };
@group(0) @binding(0) var<uniform> g:Globals;
struct VOut { @builtin(position) position:vec4f, @location(0) tint:vec4f };
@vertex fn vs(@location(0) position:vec3f,@location(1) tint:vec4f)->VOut {
 let clip=g.vp*vec4f(position,1);
 let visibility=1-smoothstep(30.,92.,distance(position,g.eye.xyz));
 return VOut(vec4f(clip.xy,(clip.z+clip.w)*.5,clip.w),vec4f(tint.rgb,tint.a*visibility));
}
@fragment fn fs(i:VOut)->@location(0) vec4f { return i.tint; }`;
const fxGLVS=`#version 300 es
precision highp float;
layout(location=0) in vec3 position; layout(location=1) in vec4 tint;
uniform mat4 vp; uniform vec3 eye; out vec4 vcolor;
void main(){
 gl_Position=vp*vec4(position,1.);
 vcolor=vec4(tint.rgb,tint.a*(1.-smoothstep(30.,92.,distance(position,eye))));
}`;
const fxGLFS=`#version 300 es
precision highp float;
in vec4 vcolor; out vec4 result;
void main(){result=vcolor;}`;
function dimensions(canvas) {
  const ratio=Math.min(globalThis.devicePixelRatio||1,1.5);
  const w=Math.max(1,Math.round(canvas.clientWidth*ratio)), h=Math.max(1,Math.round(canvas.clientHeight*ratio));
  if(canvas.width!==w||canvas.height!==h) {canvas.width=w;canvas.height=h;}
  return [w,h];
}
function validate(matrix,instances,eye,fx) {
  if(matrix.length!==16||eye.length!==3||instances.length%STRIDE||instances.length>LIMIT*STRIDE||
     fx.length%(3*FX_STRIDE)||fx.length>FX_LIMIT*FX_STRIDE) throw Error('Invalid C++ render buffers');
}
function vertexCount(data) {
  if(!(data instanceof Float32Array)||data.length%18) throw Error('Invalid C++ world mesh');
  return data.length/6;
}
function materialBufferPresent(materials,count) {
  if(!materials?.length)return false;
  if(!(materials instanceof Float32Array)||materials.length!==count)throw Error('Invalid C++ world materials');
  return true;
}
async function webgpu(canvas) {
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter) throw Error('No WebGPU adapter');
  const device=await adapter.requestDevice();
  device.pushErrorScope('validation');
  const format=navigator.gpu.getPreferredCanvasFormat();
  function pipelineDescription(textured){
    const shader=device.createShaderModule({code:wgsl(textured)});
    const buffers=[
      {arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]},
      {arrayStride:44,stepMode:'instance',attributes:[{shaderLocation:2,offset:0,format:'float32x3'},{shaderLocation:3,offset:12,format:'float32x3'},{shaderLocation:4,offset:24,format:'float32x3'},{shaderLocation:5,offset:36,format:'float32'},{shaderLocation:6,offset:40,format:'float32'}]},
    ];
    if(textured)buffers.push({arrayStride:4,attributes:[{shaderLocation:7,offset:0,format:'float32'}]});
    return {layout:'auto',vertex:{module:shader,entryPoint:'vs',buffers},
      fragment:{module:shader,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list',cullMode:'none'},
      depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},multisample:{count:4}};
  }
  const fxShader=device.createShaderModule({code:fxWGSL});
  const [pipeline,fxPipeline]=await Promise.all([
    device.createRenderPipelineAsync(pipelineDescription(false)),
    device.createRenderPipelineAsync({layout:'auto',vertex:{module:fxShader,entryPoint:'vs',buffers:[
      {arrayStride:FX_STRIDE*4,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x4'}]},
    ]},fragment:{module:fxShader,entryPoint:'fs',targets:[{format,blend:{
      color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},
    }}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'},multisample:{count:4}}),
  ]);
  const validationError=await device.popErrorScope();
  if(validationError) throw Error(validationError.message);
  const context=canvas.getContext('webgpu');
  if(!context) throw Error('WebGPU context unavailable');
  context.configure({device,format,alphaMode:'opaque'});
  const vertex=device.createBuffer({size:cubeVertices().byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(vertex,0,cubeVertices());
  const instances=device.createBuffer({size:LIMIT*44,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const effects=device.createBuffer({size:FX_LIMIT*FX_STRIDE*4,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const uniforms=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniforms}}]});
  const fxGroup=device.createBindGroup({layout:fxPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniforms}}]});
  let depth,color,world,worldInstance,layers,texturedPipeline,texture,textureMap,materialGroup;
  let worldCount=0,lastW=0,lastH=0,disposed=false;
  function prepareMaterials(map){
    if(texture)return;
    texturedPipeline??=device.createRenderPipeline(pipelineDescription(true));
    const {size,layerCount,levels}=mapMaterials(map);
    texture=device.createTexture({size:[size,size,layerCount],mipLevelCount:levels.length,
      format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    for(const [mipLevel,{width,pixels}] of levels.entries()){
      device.queue.writeTexture({texture,mipLevel},pixels,{bytesPerRow:width*4,rowsPerImage:width},[width,width,layerCount]);
    }
    const sampler=device.createSampler({addressModeU:'repeat',addressModeV:'repeat',magFilter:'linear',minFilter:'linear',mipmapFilter:'nearest'});
    materialGroup=device.createBindGroup({layout:texturedPipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:uniforms}},
      {binding:1,resource:texture.createView({dimension:'2d-array'})},
      {binding:2,resource:sampler},
    ]});
    textureMap=map;
  }
  device.lost.then(info=>{if(!disposed) canvas.dispatchEvent(new CustomEvent('rendererlost',{detail:info.reason}));});
  device.addEventListener('uncapturederror',event=>canvas.dispatchEvent(new CustomEvent('rendererlost',{detail:event.error.message})));
  return {api:'WebGPU',reason:'',setWorldMesh(data,materials,map){
    if(disposed)return;
    worldCount=vertexCount(data);
    const textured=materialBufferPresent(materials,worldCount);
    world?.destroy();worldInstance?.destroy();layers?.destroy();
    world=worldInstance=layers=undefined;
    if(!textured||map!==textureMap){texture?.destroy();texture=materialGroup=undefined;}
    if(!worldCount)return;
    const usage=GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST;
    world=device.createBuffer({size:data.byteLength,usage});
    worldInstance=device.createBuffer({size:WORLD_INSTANCE.byteLength,usage});
    device.queue.writeBuffer(world,0,data);device.queue.writeBuffer(worldInstance,0,WORLD_INSTANCE);
    if(textured){
      prepareMaterials(map);
      layers=device.createBuffer({size:materials.byteLength,usage});
      device.queue.writeBuffer(layers,0,materials);
    }
  },draw(matrix,data,eye,fx=EMPTY_FX){
    validate(matrix,data,eye,fx);if(disposed)return;
    const [w,h]=dimensions(canvas);
    if(w!==lastW||h!==lastH){depth?.destroy();color?.destroy();
      depth=device.createTexture({size:[w,h],format:'depth24plus',sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});
      color=device.createTexture({size:[w,h],format,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});lastW=w;lastH=h;}
    const u=new Float32Array(20);u.set(matrix);u.set(eye,16);
    device.queue.writeBuffer(uniforms,0,u);if(data.length)device.queue.writeBuffer(instances,0,data);
    if(fx.length)device.queue.writeBuffer(effects,0,fx);
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:color.createView(),resolveTarget:context.getCurrentTexture().createView(),clearValue:SKY,loadOp:'clear',storeOp:'discard'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);
    if(worldCount){
      if(layers){pass.setPipeline(texturedPipeline);pass.setBindGroup(0,materialGroup);}
      pass.setVertexBuffer(0,world);pass.setVertexBuffer(1,worldInstance);
      if(layers)pass.setVertexBuffer(2,layers);
      pass.draw(worldCount);
      if(layers){pass.setPipeline(pipeline);pass.setBindGroup(0,group);}
    }
    pass.setVertexBuffer(0,vertex);pass.setVertexBuffer(1,instances);pass.draw(36,data.length/STRIDE);
    if(fx.length){pass.setPipeline(fxPipeline);pass.setBindGroup(0,fxGroup);pass.setVertexBuffer(0,effects);pass.draw(fx.length/FX_STRIDE);}
    pass.end();device.queue.submit([encoder.finish()]);
  },dispose(){disposed=true;depth?.destroy();color?.destroy();world?.destroy();worldInstance?.destroy();layers?.destroy();texture?.destroy();vertex.destroy();instances.destroy();effects.destroy();uniforms.destroy();device.destroy();}};
}
function webgl(canvas,reason) {
  const gl=canvas.getContext('webgl2',{antialias:true,alpha:false,preserveDrawingBuffer:true});
  if(!gl)throw Error('WebGPU and WebGL2 are unavailable');
  const shader=(kind,source)=>{const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  function linkProgram(vertexSource,fragmentSource){
    const vs=shader(gl.VERTEX_SHADER,vertexSource),fs=shader(gl.FRAGMENT_SHADER,fragmentSource);
    const handle=gl.createProgram();gl.attachShader(handle,vs);gl.attachShader(handle,fs);gl.linkProgram(handle);
    gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(handle,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(handle));
    return {handle,vp:gl.getUniformLocation(handle,'vp'),eye:gl.getUniformLocation(handle,'eye')};
  }
  const makeProgram=textured=>linkProgram(glvs(textured),glfs(textured));
  const program=makeProgram(false);
  const fxProgram=linkProgram(fxGLVS,fxGLFS);
  const fxVao=gl.createVertexArray();gl.bindVertexArray(fxVao);
  const fxBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,fxBuffer);gl.bufferData(gl.ARRAY_BUFFER,FX_LIMIT*FX_STRIDE*4,gl.DYNAMIC_DRAW);
  for(const [location,size,offset] of [[0,3,0],[1,4,12]]){
    gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,FX_STRIDE*4,offset);
  }
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);
  const vertex=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertex);gl.bufferData(gl.ARRAY_BUFFER,cubeVertices(),gl.STATIC_DRAW);
  for(let i=0;i<2;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,24,i*12);}
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,LIMIT*44,gl.DYNAMIC_DRAW);
  for(const [loc,size,offset] of [[2,3,0],[3,3,12],[4,3,24],[5,1,36],[6,1,40]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,44,offset);gl.vertexAttribDivisor(loc,1);}
  let disposed=false,worldVao,worldBuffer,worldCount=0,layers,texture,textureMap,materialProgram;
  function prepareMaterials(map){
    if(texture)return;
    materialProgram??=makeProgram(true);
    const {size,layerCount,levels}=mapMaterials(map);
    texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D_ARRAY,texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY,levels.length,gl.RGBA8,size,size,layerCount);
    for(const [level,{width,pixels}] of levels.entries()){
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,level,0,0,0,width,width,layerCount,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    }
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    textureMap=map;
  }
  function useProgram(active,matrix,eye){
    gl.useProgram(active.handle);gl.uniformMatrix4fv(active.vp,false,matrix);gl.uniform3fv(active.eye,eye);
  }
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();canvas.dispatchEvent(new CustomEvent('rendererlost',{detail:'WebGL context lost'}));});
  return {api:'WebGL2',reason,setWorldMesh(data,materials,map){
    if(disposed)return;
    worldCount=vertexCount(data);
    const textured=materialBufferPresent(materials,worldCount);
    gl.deleteVertexArray(worldVao??null);gl.deleteBuffer(worldBuffer??null);gl.deleteBuffer(layers??null);
    worldVao=worldBuffer=layers=undefined;
    if(!textured||map!==textureMap){gl.deleteTexture(texture??null);texture=undefined;}
    if(!worldCount)return;
    worldVao=gl.createVertexArray();gl.bindVertexArray(worldVao);
    worldBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,worldBuffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    for(let i=0;i<2;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,24,i*12);}
    if(textured){
      prepareMaterials(map);
      layers=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,layers);gl.bufferData(gl.ARRAY_BUFFER,materials,gl.STATIC_DRAW);
      gl.enableVertexAttribArray(7);gl.vertexAttribPointer(7,1,gl.FLOAT,false,4,0);
    }
  },draw(matrix,instances,eye,fx=EMPTY_FX){
    validate(matrix,instances,eye,fx);if(disposed)return;
    const [w,h]=dimensions(canvas);gl.viewport(0,0,w,h);gl.enable(gl.DEPTH_TEST);gl.clearColor(...SKY);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    useProgram(layers?materialProgram:program,matrix,eye);
    if(worldCount){
      if(layers)gl.bindTexture(gl.TEXTURE_2D_ARRAY,texture);
      gl.bindVertexArray(worldVao);gl.vertexAttrib3fv(2,WORLD_INSTANCE.subarray(0,3));gl.vertexAttrib3fv(3,WORLD_INSTANCE.subarray(3,6));
      gl.vertexAttrib3fv(4,WORLD_INSTANCE.subarray(6,9));gl.vertexAttrib1f(5,0);gl.vertexAttrib1f(6,0);gl.drawArrays(gl.TRIANGLES,0,worldCount);
    }
    if(layers)useProgram(program,matrix,eye);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,instances);gl.drawArraysInstanced(gl.TRIANGLES,0,36,instances.length/STRIDE);
    if(fx.length){
      useProgram(fxProgram,matrix,eye);gl.bindVertexArray(fxVao);gl.bindBuffer(gl.ARRAY_BUFFER,fxBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,fx);
      gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES,0,fx.length/FX_STRIDE);gl.depthMask(true);gl.disable(gl.BLEND);
    }
  },dispose(){disposed=true;gl.deleteBuffer(worldBuffer??null);gl.deleteVertexArray(worldVao??null);gl.deleteBuffer(layers??null);
    gl.deleteTexture(texture??null);gl.deleteBuffer(vertex);gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);
    gl.deleteBuffer(fxBuffer);gl.deleteVertexArray(fxVao);gl.deleteProgram(fxProgram.handle);
    gl.deleteProgram(program.handle);if(materialProgram)gl.deleteProgram(materialProgram.handle);}};
}
export async function createRenderer(canvas,{forceWebGL=false}={}) {
  let reason=forceWebGL?'WebGL2 selected':(!globalThis.isSecureContext?'WebGPU requires HTTPS or localhost':'WebGPU API unavailable');
  if(!forceWebGL&&globalThis.isSecureContext&&globalThis.navigator?.gpu){
    try{return await webgpu(canvas);}catch(error){reason=`WebGPU initialization failed: ${error.message}`;console.warn(reason);}
  }
  return webgl(canvas,reason);
}
