// Open at most in Full HD. A fast hardware desktop can try a Quad HD buffer.
// UI text is DOM, so these budgets only affect the 3D canvas.
const softwareLevel=2;
const sharpDesktopLevel=-1,sharpDesktopPixels=2560*1440;
export const RENDER_QUALITY=Object.freeze({maxPixelRatio:1,pixelBudget:1920*1080,maxFps:60,maxStepSeconds:.035,
 softwareLevel,desktopSoftwareLevel:softwareLevel+1});
// Lower budgets keep the CSS viewport and input coordinates intact.
const pixelBudgets=[RENDER_QUALITY.pixelBudget,960*600,640*400,536*335,448*280];
// A GPU-rendered PC match retains a 720p-equivalent buffer, bounded by the
// actual viewport. This keeps player silhouettes and court markings readable.
const desktopPixelBudgets=[RENDER_QUALITY.pixelBudget,1600*900,1280*720];
const softwareBudget=pixelBudgets[softwareLevel];
// Subdivide the first steps around the software starting tier. The midpoint
// above it missed the frame target in play, so use the smaller quarter step.
const softwarePixelBudgets=[
 ...pixelBudgets.slice(0,softwareLevel),
 Math.sqrt(softwareBudget*Math.sqrt(softwareBudget*pixelBudgets[softwareLevel-1])),
 softwareBudget,
 Math.sqrt(softwareBudget*pixelBudgets[softwareLevel+1]),
 ...pixelBudgets.slice(softwareLevel+1)
];
const softwareFloorLevel=softwarePixelBudgets.length-1;
// A playable split floor can be followed by the original one-buffer budget.
const softwareNativeFallbackLevel=softwareFloorLevel+1;
const softwareCourtSplitLevel=RENDER_QUALITY.desktopSoftwareLevel+1;
function renderBudgets(desktop,software){
 return desktop?desktopPixelBudgets:software?softwarePixelBudgets:pixelBudgets;
}
export function renderPixelRatio(width,height,dpr,level=0,desktop=false,software=false){
 const budgets=renderBudgets(desktop,software);
 const budget=desktop&&level===sharpDesktopLevel?sharpDesktopPixels:
  software&&!desktop&&level===softwareNativeFallbackLevel?budgets.at(-1):budgets[level];
 // Hardware-rendered PCs can use the display's physical pixels within the
 // same budget. A CSS pixel can be larger than a display pixel on Windows.
 const density=desktop?dpr:Math.min(dpr,RENDER_QUALITY.maxPixelRatio);
 return Math.min(density,Math.sqrt(budget/(width*height)));
}

const foregroundPixelBudget=760*427;
// At Full HD, the lower split tier trades some distant arena samples for
// sharper players, ball and hoops. Blend from the smaller-window budget.
const lowerForegroundPixels=706*397,lowerArenaPixels=440*248;
// Full HD viewport comparison with ten moving players, using a separate
// budget for the distant arena and retaining the foreground court paint.
const floorForegroundPixels=550**2*9/16,floorArenaPixels=384*216;
export function softwareCourtRaster(width,height,dpr,level){
 const splitLevel=softwareCourtSplitLevel;
 const lowSplit=level===splitLevel+1;
 const floorSplit=level===softwareFloorLevel;
 if(level!==splitLevel&&!lowSplit&&!floorSplit)return null;
 const nativeRatio=renderPixelRatio(width,height,dpr,level,false,true);
 const density=Math.min(dpr,RENDER_QUALITY.maxPixelRatio);
 const area=width*height;
 const startupBudget=softwarePixelBudgets[RENDER_QUALITY.desktopSoftwareLevel];
 const viewportPixels=area*density**2;
 // A scaled Full HD display shows the same enlarged edges. Base the
 // foreground share on display pixels while retaining the compact-window cap.
 const displayPixels=area*dpr**2;
 const fullHdShare=lowSplit?Math.max(0,Math.min(1,(displayPixels-startupBudget)/(RENDER_QUALITY.pixelBudget-startupBudget))):0;
 const windowLimit=Math.sqrt(viewportPixels*softwarePixelBudgets[splitLevel]);
 const baseLowerBudget=Math.min(startupBudget,windowLimit);
 const extraForeground=Math.min((lowerForegroundPixels-startupBudget)*fullHdShare,Math.max(0,windowLimit-startupBudget));
 const lowerBudget=baseLowerBudget+extraForeground;
 const foregroundBudget=floorSplit?floorForegroundPixels:lowSplit?lowerBudget:foregroundPixelBudget;
 // A scaled desktop window can still show enough pixels to benefit from
 // the split floor, provided the foreground fits within its CSS pixel cap.
 if(floorSplit&&(displayPixels<=softwarePixelBudgets[splitLevel]||viewportPixels<floorForegroundPixels))return null;
 const foregroundRatio=Math.sqrt(foregroundBudget/area);
 const foreground=Math.min(density,foregroundRatio);
 // Only split here if the viewport has enough pixels for the full foreground budget.
 if(foreground<=nativeRatio||lowSplit&&density<=foregroundRatio)return null;
 const arenaBudget=softwarePixelBudgets[softwareFloorLevel];
 const baseLowerRatio=Math.sqrt(baseLowerBudget/area);
 const gainsPixels=extraForeground>0&&(Math.floor(width*foreground)>Math.floor(width*baseLowerRatio)||
  Math.floor(height*foreground)>Math.floor(height*baseLowerRatio));
 const arenaShare=gainsPixels?extraForeground/(lowerForegroundPixels-startupBudget):0;
 const adjustedArena=arenaBudget+(lowerArenaPixels-arenaBudget)*arenaShare;
 const arena=floorSplit?Math.sqrt(floorArenaPixels/area):Math.min(density,Math.sqrt(adjustedArena/area));
 return {foreground,arena,native:nativeRatio,sharpMarkings:floorSplit};
}
export function hasSoftwareCourtRaster(width,height,dpr){
 return [softwareCourtSplitLevel,softwareCourtSplitLevel+1,softwareFloorLevel].some(level=>softwareCourtRaster(width,height,dpr,level));
}

// Inactive scenes draw once when invalidated, then release the animation loop.
// Resuming starts a new clock; time spent in another tab never advances play.
export function createRenderLoop({step,draw,isActive,isHidden,initialQuality=0,desktop=false,software=false,onQualityChange,desktopHighResolution,softwareActorDetail,softwareCourtSplit,renderPrograms,request=requestAnimationFrame,cancel=cancelAnimationFrame}){
 let pending=0,last=null,lastRefresh=null,next=0,quality=initialQuality;
 let slow=0,fast=0,fastFrames=0,upgradedAt=-Infinity,retryAt=0;
 let paceTime=0,paceFrames=0,longestInterval=0,paceProbe=null;
 let lastPrograms,lastProgramCount=0,compiledPrograms=false,recheckedPace=false;
 let softwareCadence=null,slowSamples=0;
 const recheckedFloors=new Set();
 let intermediateRecheckAvailable=true;
 let splitFloorAvailable=false;
 let currentSoftwareDetail=null,detailRecheckPending=false;
 let steadyRecheckSeconds=0,earlyRecheckLevel=null,baseSteadySeconds=0;
 const interval=1000/RENDER_QUALITY.maxFps;
 const stepLimit=RENDER_QUALITY.maxStepSeconds;
 const recoverySeconds=8,retrySeconds=30;
 const minimumDrawRate=50,paceWindow=1,maxPaceInterval=2/RENDER_QUALITY.maxFps;
 const measureActualCadence=desktop||software;
 const budgets=renderBudgets(desktop,software),baseLowestQuality=budgets.length-1;
 function wake(){if(!pending&&!isHidden())pending=request(frame);}
 function resetPace(){paceTime=paceFrames=longestInterval=0;compiledPrograms=false;}
 function changeQuality(level){
  if(level!==initialQuality+1)detailRecheckPending=false;
  quality=level;if(!measureActualCadence)slow=0;
  recheckedPace=false;
  fast=fastFrames=slowSamples=steadyRecheckSeconds=baseSteadySeconds=0;earlyRecheckLevel=null;
  resetPace();onQualityChange?.(quality);
 }
 function resetClock(){
  last=lastRefresh=null;next=0;slow=fast=fastFrames=slowSamples=steadyRecheckSeconds=baseSteadySeconds=0;resetPace();
  lastPrograms=undefined;lastProgramCount=0;recheckedPace=false;
  if(paceProbe){
   if(software&&!paceProbe.sharper)softwareCadence=paceProbe.rate;
   const measuredLevel=paceProbe.level;paceProbe=null;
   if(measuredLevel!==quality)changeQuality(measuredLevel);
  }
 }
 function suspend(){if(pending)cancel(pending);pending=0;resetClock();}
 function samplePace(elapsed){
  paceTime+=measureActualCadence?elapsed:Math.min(elapsed,maxPaceInterval);paceFrames++;
  if(measureActualCadence)longestInterval=Math.max(longestInterval,elapsed);
  if(paceTime<paceWindow||measureActualCadence&&paceFrames<3)return null;
  // Ignore one isolated stall without making sustained 12 and 20 FPS both
  // look like 30 FPS. A lower PC tier must earn its loss of clarity.
  const seconds=paceTime-longestInterval,frames=paceFrames-Number(measureActualCadence);
  // One isolated stall need not trigger a probe. For software tiers, count
  // every frame when deciding whether the new resolution is worth keeping.
  const short=frames<Math.floor(seconds*minimumDrawRate);
  // A single-buffer tier needs pixel headroom. The split tier spends most
  // extra pixels on the foreground, so check its actual cadence once.
  const tryIntermediate=software&&intermediateRecheckAvailable&&quality>RENDER_QUALITY.desktopSoftwareLevel+1&&quality<baseLowestQuality&&
   (softwareCourtSplit?.(quality-1)||frames>=Math.floor(seconds*minimumDrawRate*budgets[quality-1]/budgets[quality]));
  const sample={rate:software?paceFrames/paceTime:frames/seconds,short,
   onTarget:software?paceFrames>=Math.floor(paceTime*minimumDrawRate):!short,
   seconds:software?paceTime:seconds,tryIntermediate,compiledPrograms};
  resetPace();return sample;
 }
 function adjustQuality(elapsed,time){
  const bestQuality=desktop&&desktopHighResolution?.()?sharpDesktopLevel:0;
  if(quality<bestQuality){changeQuality(bestQuality);return;}
  const splitFloor=Boolean(software&&!desktop&&softwareCourtSplit?.(softwareFloorLevel));
  const lowestQuality=splitFloor?softwareNativeFallbackLevel:baseLowestQuality;
  if(splitFloor!==splitFloorAvailable){
   splitFloorAvailable=splitFloor;
   if(quality>=baseLowestQuality||paceProbe?.level>=baseLowestQuality){
    // The same level now draws a different buffer after a resize or mode change.
    const measuredLevel=paceProbe?.sharper?paceProbe.level:quality;
    paceProbe=null;softwareCadence=null;slow=0;recheckedFloors.clear();
    if(splitFloor)retryAt=time;
    changeQuality(Math.min(measuredLevel,lowestQuality));return;
   }
  }
  // Count sustained render pressure. A shader compile, resize or single
  // long frame contributes at most one tenth of a second.
  if(elapsed>stepLimit){slow+=Math.min(.1,elapsed);fast=fastFrames=0;}
  else{
   slow=Math.max(0,slow-elapsed);
   if(quality>bestQuality&&time>=retryAt){fast+=elapsed;fastFrames++;}
  }
  const pace=samplePace(elapsed);
  const detail=pace&&software?softwareActorDetail?.()??null:currentSoftwareDetail;
  const detailChanged=detail!==currentSoftwareDetail;
  if(detailChanged){
   if(detailRecheckPending)steadyRecheckSeconds=0;
   currentSoftwareDetail=detail;
   detailRecheckPending=Boolean(detail)&&quality===initialQuality+1;
  }
  if(software&&pace){
   // A new shader can stall several refreshes. One extra sample at the
   // same resolution tells a cold effect apart from sustained render load.
   if(!pace.onTarget&&!recheckedPace&&(pace.compiledPrograms||paceProbe&&!pace.short)){
    recheckedPace=true;
    steadyRecheckSeconds=0;
    if(baseSteadySeconds<recoverySeconds)baseSteadySeconds=0;
    slowSamples=0;
    return;
   }
   if(pace.onTarget)recheckedPace=false;
  }
  if(pace&&paceProbe){
   if(paceProbe.sharper){
    const slower=!pace.onTarget&&(paceProbe.rate-pace.rate)*pace.seconds>=1;
    if(!slower||!paceProbe.early)retryAt=time+1000*(slower?retrySeconds:recoverySeconds);
    const previousLevel=paceProbe.level;paceProbe=null;
    if(slower)changeQuality(previousLevel);
    else{
     softwareCadence=pace.rate;
     upgradedAt=time;
    }
    return;
   }
   const faster=(pace.rate-paceProbe.rate)*pace.seconds>=1;
   if(software&&faster&&!splitFloor&&quality===lowestQuality&&paceProbe.level===quality-1&&softwareCadence>=minimumDrawRate){
    // A higher resolution recently kept up. The load might have eased at
    // the same time as this downgrade, so confirm once before staying here.
    softwareCadence=pace.rate;
    recheckedFloors.add(quality);
    paceProbe={level:quality,rate:pace.rate,sharper:true};
    retryAt=time+1000*retrySeconds;
    changeQuality(quality-1);
    return;
   }
   if(pace.onTarget&&(!software||faster)){
    // The previous tier already failed at this load. Give the successful
    // budget the same time to settle as after an unsuccessful probe.
    if(software){
     if(paceProbe.fromStable&&paceProbe.level===quality-1)earlyRecheckLevel=quality;
     softwareCadence=pace.rate;
    }
    paceProbe=null;
    retryAt=time+1000*retrySeconds;
   }else{
    // Two budgets can miss the same display refreshes even when a lower
    // budget can keep up. When the search ends, keep the clearest useful tier.
    if(faster)paceProbe={level:quality,rate:pace.rate};
    if(quality<lowestQuality){changeQuality(quality+1);return;}
    if(software)softwareCadence=paceProbe.rate;
    const bestLevel=paceProbe.level;paceProbe=null;
    if(measureActualCadence||bestLevel!==quality)retryAt=time+1000*retrySeconds;
    if(bestLevel!==quality)changeQuality(bestLevel);
    return;
   }
  }
  if(pace&&software){
   // The starting tier may run smoothly before any trial sets its cadence.
   // Retain that evidence through a slowdown until the resolution changes.
   if(quality===RENDER_QUALITY.desktopSoftwareLevel&&baseSteadySeconds<recoverySeconds){
    baseSteadySeconds=pace.onTarget?baseSteadySeconds+pace.seconds:0;
   }
   const slowing=pace.short&&softwareCadence!==null&&(softwareCadence-pace.rate)*pace.seconds>=1;
   slowSamples=slowing?slowSamples+1:0;
   // New sustained load can merit a lower tier during the cooldown for
   // trying sharper frames. Use cadence at the restored tier after a probe.
   if(slowSamples>=2&&quality<lowestQuality){
    const fromStable=baseSteadySeconds>=recoverySeconds||softwareCadence>=minimumDrawRate&&time-upgradedAt>=recoverySeconds*1000;
    paceProbe={level:quality,rate:pace.rate,fromStable};
    changeQuality(quality+1);return;
   }
   // Recheck a known adjacent tier or a deep opening drop after a steady run.
   // A lower opening tier may have been measured before the distant actors
   // could use their lighter meshes. Confirm the adjacent tier once they can.
   const recheckWithDetail=!detailChanged&&detailRecheckPending&&quality===initialQuality+1;
   // The split floor and the single-buffer fallback can recover independently.
   const atFloor=quality>=baseLowestQuality;
   const eligible=earlyRecheckLevel===quality||atFloor&&!recheckedFloors.has(quality)||pace.tryIntermediate||recheckWithDetail;
   steadyRecheckSeconds=eligible&&pace.onTarget?steadyRecheckSeconds+pace.seconds:0;
   const early=eligible&&time<retryAt&&steadyRecheckSeconds>=recoverySeconds;
   if(early||quality>RENDER_QUALITY.desktopSoftwareLevel&&time>=retryAt){
    if(atFloor)recheckedFloors.add(quality);
    if(pace.tryIntermediate)intermediateRecheckAvailable=false;
    paceProbe={level:quality,rate:pace.rate,sharper:true,early};
    // A pause can interrupt the trial without bypassing its retry delay.
    if(!early)retryAt=time+1000*retrySeconds;
    changeQuality(quality-1);return;
   }
  }
  const shouldProbe=pace?.short&&time>=retryAt;
  if((!measureActualCadence&&slow>=.45||shouldProbe)&&quality<lowestQuality){
   // A tier that failed shortly after an upgrade should not be retried
   // every few seconds on a device that sits between two budgets.
   if(time-upgradedAt<1000*recoverySeconds)retryAt=time+1000*retrySeconds;
   if(measureActualCadence||slow<.45){
    const fromStable=software&&(baseSteadySeconds>=recoverySeconds||quality===RENDER_QUALITY.desktopSoftwareLevel-1&&
     softwareCadence>=minimumDrawRate&&time-upgradedAt>=recoverySeconds*1000);
    paceProbe={level:quality,rate:pace.rate,fromStable};
   }
   changeQuality(quality+1);
  }else if(fast>=recoverySeconds){
   // A 60 FPS limit on a faster, mismatched display has uneven intervals.
   const rate=fastFrames/fast;
   // Prove near-full cadence before trying more pixels than the opening tier.
   if(rate>=(quality===0?RENDER_QUALITY.maxFps-1:minimumDrawRate)){
    if(software){paceProbe={level:quality,rate,sharper:true};retryAt=time+1000*retrySeconds;}
    else{paceProbe=null;softwareCadence=null;upgradedAt=time;}
    changeQuality(quality-1);
   }
   fast=fastFrames=0;
  }
 }
 function frame(time){
  pending=0;
  if(isHidden()){resetClock();return;}
  if(!isActive()){resetClock();draw();return;}
  // Use the closer display refresh and keep the overall 60 Hz schedule.
  // A slightly early timestamp should not cost a full refresh.
  const lead=lastRefresh===null?0:Math.min(interval,time-lastRefresh)/2;
  lastRefresh=time;
  if(time+lead<next){wake();return;}
  const elapsed=last===null?0:Math.max(0,(time-last)/1000);last=time;
  next=next?next+(Math.floor(Math.max(0,time-next)/interval)+1)*interval:time+interval;
  if(software&&renderPrograms){
   const programs=renderPrograms();
   const count=programs?.length??0;
   if(programs===lastPrograms)compiledPrograms ||= elapsed>0&&count>lastProgramCount;
   else if(lastPrograms){resetPace();recheckedPace=false;}
   lastPrograms=programs;lastProgramCount=count;
  }
  if(elapsed>0){
   adjustQuality(elapsed,time);
   const needed=Math.ceil(elapsed/stepLimit);
   // A desktop frame that fits in four safe steps can keep the whole input
   // interval. Cap isolated stalls outside that range and draw only once.
   const extraSteps=software||(desktop?needed<=4||slow>=.45:quality>0);
   const steps=Math.min(extraSteps?4:2,needed),dt=Math.min(stepLimit,elapsed/steps);
   // Time beyond the safe budget must not run down the clock while play is frozen.
   // Align the simulated portion with recent input when a stall exceeds the budget.
   for(let i=0;i<steps&&isActive();i++)step(dt,dt,time-(steps-i)*dt*1000);
  }
  const active=isActive();
  if(!active)resetClock();
  draw();
  if(isActive())wake();else if(active)resetClock();
 }
 return{wake,suspend};
}
