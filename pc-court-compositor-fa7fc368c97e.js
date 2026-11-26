import * as T from './vendor/three.module.js';

function hide(objects,hidden){
 for(const object of objects)if(object.visible){object.visible=false;hidden.push(object);}
}

function restore(hidden){
 for(const object of hidden)object.visible=true;
 hidden.length=0;
}

export class SoftwareCourtCompositor{
 constructor(arena){
  const stadium=[...arena.root.children,...arena.targets.children];
  // Draw the parquet and its markings together. Resampling the parquet depth
  // separately can occlude paint only a few millimetres above it.
  this.low=stadium.filter(o=>o.isMesh&&!o.name.startsWith('qgdsx_qiuc_')&&
   !o.name.startsWith('qgds_lanqiujia')&&
   [].concat(o.material).every(m=>m.toneMapped&&!m.transparent&&m.depthWrite));
  this.high=stadium.filter(o=>!this.low.includes(o));
  const bounds=new T.Box3();
  const floors=this.low.filter(o=>o.name==='qgds_qiuc_02');
  this.floors=floors.flatMap(object=>{
   const {geometry,matrixWorld}=object;
   bounds.copy(geometry.boundingBox).applyMatrix4(matrixWorld);
   return bounds.min.y===bounds.max.y?[bounds.min.y]:[];
  });
  const planes=this.floors.map(()=>new T.Vector4());
  // A shader array has a nonzero declared length even if the arena has no planar pieces.
  if(!planes.length)planes.push(new T.Vector4());
  // The arena copy carries depth into the foreground. Its stencil is
  // cleared and built separately on the screen framebuffer.
  const depthTexture=new T.DepthTexture(1,1,T.UnsignedIntType);
  // Use the same output transforms as the screen so arena materials share
  // their programs between the opening view and the split render.
  this.target=new T.WebGLRenderTarget(1,1,{format:T.RGBAFormat,type:T.UnsignedByteType,
   internalFormat:'RGBA8',colorSpace:T.SRGBColorSpace,depthTexture});
  // Three r187 selects those transforms for XR targets. RGBA8 stores the
  // already encoded values without a second hardware sRGB conversion.
  this.target.isXRRenderTarget=true;
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  this.projection=new T.Matrix4();
  this.uniforms={arenaColor:{value:this.target.texture},arenaDepth:{value:this.target.depthTexture},
   floorPlanes:{value:planes},arenaSize:{value:new T.Vector2()}};
  this.copy=new T.Mesh(geometry,new T.ShaderMaterial({uniforms:this.uniforms,depthFunc:T.AlwaysDepth,blending:T.NoBlending,
   defines:{FLOOR_PLANES:planes.length},
   vertexShader:`
    varying vec2 point;
    void main(){point=position.xy*0.5+0.5;gl_Position=vec4(position.xy,0.0,1.0);}`,
   fragmentShader:`
    uniform sampler2D arenaColor;
    uniform sampler2D arenaDepth;
    uniform vec4 floorPlanes[FLOOR_PLANES];
    uniform vec2 arenaSize;
    varying vec2 point;
    float floorDepth(vec2 p,vec4 plane){return 0.5-0.5*(dot(plane.xy,p*2.0-1.0)+plane.w)/plane.z;}
    void main(){
     gl_FragColor=vec4(texture2D(arenaColor,point).rgb,1.0);
     float depth=texture2D(arenaDepth,point).r;
     vec2 center=(floor(point*arenaSize)+vec2(0.5))/arenaSize;
     float nearestError=8.0/16777215.0,corrected=depth;
     // Snap the apron to its exact plane. Nearest depth
     // preserves other silhouettes but would cut holes in soft floor shadows.
     for(int i=0;i<FLOOR_PLANES;i++){
      vec4 plane=floorPlanes[i];
      if(plane.z==0.0)continue;
      float error=abs(floorDepth(center,plane)-depth);
      if(error<nearestError){nearestError=error;corrected=floorDepth(point,plane);}
     }
     gl_FragDepth=corrected;
    }`
  }));
  this.copy.frustumCulled=false;
  this.copyGroup=new T.Group();
  // Seed the foreground depth before Three draws any opaque scene geometry.
  this.copyGroup.renderOrder=-Infinity;
  this.copyGroup.add(this.copy);
   this.arena=arena;
  this.hidden=[];
 }

 async prepare(renderer,scene,camera){
  const materials=new T.Group();
  for(const object of this.low)materials.add(object.clone(false));
  renderer.setRenderTarget(this.target);
  let arenaReady;
  try{arenaReady=renderer.compileAsync(materials,camera,scene);}
  finally{renderer.setRenderTarget(null);}
  await Promise.all([arenaReady,renderer.compileAsync(this.copy,camera,scene)]);
 }

 dispose(){
  this.target.dispose();
  this.copy.geometry.dispose();
  this.copy.material.dispose();
 }

 draw(renderer,scene,camera,width,height,needsStencil=true){
  const {arena,hidden,target,uniforms}=this;
  if(width!==target.width||height!==target.height){
   target.setSize(width,height);
   uniforms.arenaSize.value.set(width,height);
  }
  if(this.floors.length){
   this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).invert().transpose();
   this.floors.forEach((y,i)=>uniforms.floorPlanes.value[i].set(0,1,0,-y).applyMatrix4(this.projection));
  }
  const background=scene.background,autoWorld=scene.matrixWorldAutoUpdate;
  const autoClear=renderer.autoClear,autoReset=renderer.info.autoReset;
  renderer.info.autoReset=false;renderer.info.reset();
  try{
   if(autoWorld)scene.updateMatrixWorld();
   scene.matrixWorldAutoUpdate=false;
   for(const object of scene.children){
    if(object!==arena.root&&object!==arena.targets&&!object.isLight&&object.visible){
     object.visible=false;hidden.push(object);
    }
   }
   hide(this.high,hidden);
   renderer.autoClear=true;
   renderer.setRenderTarget(target);
   renderer.render(scene,camera);
   restore(hidden);
   renderer.setRenderTarget(null);
   renderer.autoClear=false;
   // Clear before the foreground draws on frames that read its stencil.
   if(needsStencil)renderer.clearStencil();
   scene.background=null;
   hide(this.low,hidden);
   scene.add(this.copyGroup);
   renderer.render(scene,camera);
  }finally{
   this.copyGroup.removeFromParent();
   restore(hidden);
   scene.background=background;
   scene.matrixWorldAutoUpdate=autoWorld;
   renderer.setRenderTarget(null);
   renderer.autoClear=autoClear;
   renderer.info.autoReset=autoReset;
  }
 }
}
