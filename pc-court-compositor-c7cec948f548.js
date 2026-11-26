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
  this.low=stadium.filter(o=>o.isMesh&&!o.name.startsWith('qgds_lanqiujia')&&
   [].concat(o.material).every(m=>m.toneMapped&&!m.transparent&&m.depthWrite));
  this.high=stadium.filter(o=>!this.low.includes(o));
  const isMarking=o=>o.name==='qgdsx_qiuc_02'||o.name==='qgdsx_qiuc_03';
  this.markings=this.low.filter(isMarking);
  this.arenaOnly=this.low.filter(o=>!isMarking(o));
  const bounds=new T.Box3();
  const floors=this.low.filter(o=>o.name.startsWith('qgdsx_qiuc_')||o.name==='qgds_qiuc_02');
  this.floors=floors.flatMap(object=>{
   const {geometry,matrixWorld}=object;
   bounds.copy(geometry.boundingBox).applyMatrix4(matrixWorld);
   return bounds.min.y===bounds.max.y?[{y:bounds.min.y,marking:isMarking(object)}]:[];
  });
  const planes=this.floors.map(()=>new T.Vector4());
  // A shader array has a nonzero declared length even if the arena has no planar pieces.
  if(!planes.length)planes.push(new T.Vector4());
  // The arena copy carries depth into the foreground. Its stencil is
  // cleared and built separately on the screen framebuffer.
  const depthTexture=new T.DepthTexture(1,1,T.UnsignedIntType);
  this.target=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthTexture});
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
     // Snap the wood, paint and apron to their exact planes. Nearest depth
     // preserves other silhouettes but would cut holes in soft floor shadows.
     for(int i=0;i<FLOOR_PLANES;i++){
      vec4 plane=floorPlanes[i];
      if(plane.z==0.0)continue;
      float error=abs(floorDepth(center,plane)-depth);
      if(error<nearestError){nearestError=error;corrected=floorDepth(point,plane);}
     }
     gl_FragDepth=corrected;
     if(depth<1.0){
      #include <tonemapping_fragment>
     }
     #include <colorspace_fragment>
    }`
  }));
  this.copy.frustumCulled=false;
  this.camera=new T.Camera();
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
  await Promise.all([arenaReady,renderer.compileAsync(this.copy,this.camera)]);
 }

 draw(renderer,scene,camera,width,height,sharpMarkings=false){
  const {arena,hidden,target,uniforms}=this;
  if(width!==target.width||height!==target.height){
   target.setSize(width,height);
   uniforms.arenaSize.value.set(width,height);
  }
  if(this.floors.length){
   this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).invert().transpose();
   this.floors.forEach(({y,marking},i)=>{
    const plane=uniforms.floorPlanes.value[i];
    if(sharpMarkings&&marking)plane.set(0,0,0,0);
    else plane.set(0,1,0,-y).applyMatrix4(this.projection);
   });
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
   if(sharpMarkings)hide(this.markings,hidden);
   renderer.autoClear=true;
   renderer.setRenderTarget(target);
   renderer.render(scene,camera);
   restore(hidden);
   renderer.setRenderTarget(null);
   renderer.autoClear=false;
   renderer.clearStencil();
   renderer.render(this.copy,this.camera);
   scene.background=null;
   hide(sharpMarkings?this.arenaOnly:this.low,hidden);
   renderer.render(scene,camera);
  }finally{
   restore(hidden);
   scene.background=background;
   scene.matrixWorldAutoUpdate=autoWorld;
   renderer.setRenderTarget(null);
   renderer.autoClear=autoClear;
   renderer.info.autoReset=autoReset;
  }
 }
}
