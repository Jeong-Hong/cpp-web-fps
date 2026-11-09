import { maps } from './maps.mjs';

const size=256;
const layerCount=4;
const mapNames=Object.keys(maps);

const stoneLayer=(colors,joints,edge,facet,height=64,width=128,stagger=true)=>({colors,joints,edge,facet,height,width,stagger});
const woodLayer=(colors,joints,grain,riser=false)=>({colors,joints,grain,riser});
const metalLayer=(colors,joints,edge)=>({colors,joints,edge,metal:true});
const finishLayer=(base,colors)=>({base,colors});

// Wall, floor, trim/tread and riser. Colors are stylized from local model references.
const palettes={
  crossyard:[
    stoneLayer(['#82918f','#899694','#748481','#8b9896'],'#666f6e','#9aa8a5','#7c8a88',128,128,false),
    finishLayer('#545d5e',['#566061','#515a5c','#5a6263','#50585a']),
    woodLayer(['#936a43','#a37b50','#88613e','#aa8255'],'#654b35',['#b0885f','#795633']),
    metalLayer(['#a9944d','#b19d55','#958340','#a18c47'],'#73632f','#c5b472'),
  ],
  cachette:[
    stoneLayer(['#976953','#a1735b','#8e6050','#aa7d61'],'#756052','#b18c72','#956f5a',64,128),
    stoneLayer(['#8b8b82','#999a8d','#818279','#a29e90'],'#676a65','#acaa9b','#888b81',64,64),
    woodLayer(['#856544','#987953','#8a6a49','#a28560'],'#634f39',['#a78b69','#715338']),
    woodLayer(['#64503c','#705842','#624936','#775e47'],'#503c2d',['#80654e','#554030'],true),
  ],
  cafe:[
    finishLayer('#cbb89d',['#cdbba1','#c5b197','#d1bda3','#c8b69c']),
    stoneLayer(['#a99d8b','#b0a48f','#988b7b','#b6a991'],'#81776a','#c0b4a1','#a49b89',64,64),
    stoneLayer(['#c4b39c','#bcaa92','#cdbba4','#bfaf9b'],'#a4927e','#d4c4b0','#b9a68e',128,128,false),
    stoneLayer(['#9f907f','#a89682','#928473','#aa9b8a'],'#7e7162','#b7a995','#9c8b79',64,128,false),
  ],
  library:[
    stoneLayer(['#b8a78c','#bdad91','#ad9a7f','#c3b397'],'#998973','#c6b79d','#b3a189'),
    stoneLayer(['#aaa18c','#958b78','#b4a78e','#a19986'],'#776f61','#bcb09a','#9e937e',128,128,false),
    woodLayer(['#926745','#a57651','#8c6042','#9c6e4b'],'#674831',['#b0835d','#83593d']),
    woodLayer(['#6a4938','#714e3c','#674638','#76523e'],'#553a30',['#795442','#5e4032'],true),
  ],
  nyc:[
    stoneLayer(['#ad6648','#bd7655','#a75e44','#b26d51'],'#7d6254','#c58a6b','#ad694e',32,64),
    stoneLayer(['#838689','#919393','#787e81','#8b8e8e'],'#62696d','#a0a2a0','#7b8082',128,128,false),
    stoneLayer(['#b2b6af','#c0c2b7','#a8b0a9','#bbc2b7'],'#767d78','#d2d3c7','#abb3a9',64,64,false),
    stoneLayer(['#6a7b7d','#718588','#68797b','#80908f'],'#516366','#91a4a1','#697d7d',64,64,false),
  ],
  smuggler:[
    stoneLayer(['#889389','#97a091','#78867f','#a0a89a'],'#66726c','#aeb5a6','#87938a',64,128),
    stoneLayer(['#7b827a','#858e83','#717b74','#92968a'],'#5e6662','#a0a79a','#78857d',64,64),
    stoneLayer(['#9d9c85','#a8a68f','#949782','#b3ae97'],'#757866','#b8b59e','#989a84',128,128,false),
    stoneLayer(['#63776e','#70857a','#5c706a','#7a8b7d'],'#4d605b','#8f9e90','#687c73',64,128),
  ],
};

function polygon(context,color,points){
  context.fillStyle=color;
  context.beginPath();
  context.moveTo(...points[0]);
  for(const point of points.slice(1))context.lineTo(...point);
  context.closePath();
  context.fill();
}

function stone(context,{colors,joints,edge,facet,height,width,stagger}){
  context.fillStyle=joints;
  context.fillRect(0,0,size,size);
  for(let row=0;row<size/height;row++){
    const y=row*height, offset=stagger&&row%2?width/2:0;
    for(let col=-1;col<size/width;col++){
      const x=col*width+offset;
      const color=colors[(row*3+col+4)%colors.length];
      polygon(context,color,[[x+2,y+4],[x+width-3,y+2],[x+width-2,y+height-3],[x+3,y+height-2]]);
      context.fillStyle=edge;
      context.fillRect(x+5,y+4,width-11,2);
      polygon(context,facet,[[x+width*12/128,y+height*.64],[x+width*48/128,y+height*.42],[x+width*108/128,y+height*.53],[x+width*62/128,y+height*.78]]);
    }
  }
}

function wood(context,{colors,grain,joints,riser}){
  const height=riser?64:32;
  context.fillStyle=joints;
  context.fillRect(0,0,size,size);
  for(let row=0;row<size/height;row++){
    const y=row*height;
    context.fillStyle=colors[row%colors.length];
    context.fillRect(0,y+2,size,height-3);
    for(let stripe=0;stripe<4;stripe++){
      const x=(row*79+stripe*67)%size, top=y+5+stripe*(height-10)/4;
      for(const shift of [-size,0])polygon(context,grain[stripe%2],
        [[x+shift,top],[x+shift+45,top-1],[x+shift+105,top+1],[x+shift+58,top+2]]);
    }
    if(!riser){
      context.fillStyle='#735138';
      context.fillRect((row*73+51)%size,y+2,2,height-3);
    }
  }
}

function metal(context,{colors,joints,edge}){
  context.fillStyle=joints;context.fillRect(0,0,size,size);
  for(let x=0;x<size;x+=32){
    context.fillStyle=colors[(x/32)%colors.length];context.fillRect(x+3,0,25,size);
    context.fillStyle=edge;context.fillRect(x+3,0,4,size);
  }
}

function finish(context,{base,colors}){
  context.fillStyle=base;context.fillRect(0,0,size,size);
  for(let i=0;i<16;i++){
    const x=(i*79+29)%size,y=(i*101+11)%size;
    const w=18+(i*13)%61,h=12+(i*11)%43;
    for(const dx of [-size,0])for(const dy of [-size,0]){
      const l=x+dx,t=y+dy;
      polygon(context,colors[i%colors.length],
        [[l,t+h*.45],[l+w*.35,t],[l+w,t+h*.18],[l+w*.76,t+h],[l+w*.2,t+h*.83]]);
    }
  }
}

function downsample(pixels,width){
  const half=width/2;
  const result=new Uint8Array(half*half*4*layerCount);
  for(let layer=0;layer<layerCount;layer++){
    const source=layer*width*width*4, target=layer*half*half*4;
    for(let y=0;y<half;y++)for(let x=0;x<half;x++){
      const start=source+(y*2*width+x*2)*4, end=target+(y*half+x)*4;
      for(let channel=0;channel<4;channel++){
        const a=start+channel;
        result[end+channel]=(pixels[a]+pixels[a+4]+pixels[a+width*4]+pixels[a+width*4+4]+2)>>2;
      }
    }
  }
  return result;
}

export function mapMaterials(id=mapNames.indexOf('library')){
  const palette=palettes[mapNames[id]];
  if(!palette)throw Error('Unknown world texture palette');
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  let pixels=new Uint8Array(size*size*4*layerCount);
  for(const [i,layer] of palette.entries()){
    const paint=layer.base?finish:layer.metal?metal:layer.grain?wood:stone;
    paint(context,layer);
    pixels.set(context.getImageData(0,0,size,size).data,i*size*size*4);
  }
  const levels=[{width:size,pixels}];
  for(let width=size;width>1;width/=2){
    pixels=downsample(pixels,width);
    levels.push({width:width/2,pixels});
  }
  return {size,layerCount,levels};
}
