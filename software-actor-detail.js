import * as T from './vendor/three.module.js';
import {l as fetchPackedAsset} from './chunk-PCABFFC816F597.js';

export const SOFTWARE_ACTOR_DETAIL_FILE='game-assets/software-actor-detail.v1.json';
// The 564-to-617 comparison used a 0.7-pixel projected error budget.
const projectedErrorBudget=.7;
let library;

function loadLibrary(){
 library??=fetchPackedAsset('./'+SOFTWARE_ACTOR_DETAIL_FILE,'球员远景模型读取失败')
  .then(bytes=>JSON.parse(new TextDecoder().decode(bytes)))
  .catch(error=>{library=null;throw error;});
 return library;
}

function reducedMesh(mesh,detail){
 const {geometry}=mesh,{index,groups}=geometry;
 if(!detail||detail.vertices!==geometry.attributes.position.count||detail.source.length!==groups.length||
  detail.counts.length!==groups.length||groups.some((group,i)=>detail.source[i]!==group.count)||
  !Number.isFinite(detail.error)||detail.error<0)return null;
 const bytes=atob(detail.indices),count=bytes.length/2;
 if(!Number.isInteger(count)||count>=index.count||detail.counts.reduce((a,b)=>a+b,0)!==count||
  detail.counts.some(value=>!Number.isInteger(value)||value<3||value%3))return null;
 const indices=new Uint16Array(count);
 for(let i=0;i<indices.length;i++){
  const vertex=bytes.charCodeAt(i*2)+bytes.charCodeAt(i*2+1)*256;
  if(vertex>=detail.vertices)return null;
  indices[i]=vertex;
 }
 let start=0;
 const reducedGroups=groups.map(({materialIndex},i)=>{
  const count=detail.counts[i],group={start,count,materialIndex};
  start+=count;return group;
 });
 return {geometry,index,original:index.array.slice(),groups,range:{...geometry.drawRange},
  reduced:indices,reducedGroups,error:detail.error,simplified:false};
}

export function createSoftwareActorDetail(actors,keys,details){
 const world=new T.Vector3();
 const entries=actors.map((actor,id)=>{
  const parts=[],records=details[keys[id]];
  if(records)actor.root.traverse(mesh=>{
   if(!mesh.isSkinnedMesh||mesh.userData.modelMeshIndex===undefined)return;
   const part=reducedMesh(mesh,records[mesh.userData.modelMeshIndex]);
   if(part)parts.push(part);
  });
  return {root:actor.root,parts};
 });
 return (camera,height,controlledId=null)=>{
  for(const [id,{root,parts}] of entries.entries()){
   let pixelsPerUnit=Infinity;
   if(controlledId!==null&&controlledId!==id&&root.visible){
    const depth=-world.setFromMatrixPosition(root.matrixWorld).applyMatrix4(camera.matrixWorldInverse).z;
    if(depth>camera.near)pixelsPerUnit=height*camera.projectionMatrix.elements[5]/(2*depth);
   }
   for(const part of parts){
    const {geometry,index,original,groups,range,reduced,reducedGroups,error}=part;
    const simplify=Number.isFinite(pixelsPerUnit)&&error*pixelsPerUnit<=projectedErrorBudget;
    if(part.simplified===simplify)continue;
    // Keep one WebGL index buffer per mesh across resolution and camera changes.
    const indices=simplify?reduced:original;
    index.array.set(indices);
    index.clearUpdateRanges();
    index.addUpdateRange(0,indices.length);
    index.needsUpdate=true;
    geometry.setDrawRange(simplify?0:range.start,simplify?reduced.length:range.count);
    geometry.groups=simplify?reducedGroups:groups;
    part.simplified=simplify;
   }
  }
 };
}

export async function loadSoftwareActorDetail(actors,keys){
 return createSoftwareActorDetail(actors,keys,await loadLibrary());
}
