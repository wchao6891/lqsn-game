// Flow-first desktop profile: native CSS pixels, at most a Full HD drawing
// buffer. UI text is DOM, so this budget only affects the 3D canvas.
export const RENDER_QUALITY=Object.freeze({maxPixelRatio:1,pixelBudget:1920*1080,maxFps:60,maxStepSeconds:.035,softwareLevel:2});
// Lower budgets keep the CSS viewport and input coordinates intact.
const pixelBudgets=[RENDER_QUALITY.pixelBudget,960*600,640*400,536*335,448*280];
// A GPU-rendered PC match retains a 720p-equivalent buffer, bounded by the
// actual viewport. This keeps player silhouettes and court markings readable.
const desktopPixelBudgets=[RENDER_QUALITY.pixelBudget,1600*900,1280*720];
const softwareLevel=RENDER_QUALITY.softwareLevel;
// Split the first step below the software starting tier into equal relative steps.
const softwarePixelBudgets=[
 ...pixelBudgets.slice(0,softwareLevel+1),
 Math.sqrt(pixelBudgets[softwareLevel]*pixelBudgets[softwareLevel+1]),
 ...pixelBudgets.slice(softwareLevel+1)
];
function renderBudgets(desktop,software){
 return desktop?desktopPixelBudgets:software?softwarePixelBudgets:pixelBudgets;
}
export function renderPixelRatio(width,height,dpr,level=0,desktop=false,software=false){
 const budgets=renderBudgets(desktop,software);
 return Math.min(dpr,RENDER_QUALITY.maxPixelRatio,Math.sqrt(budgets[level]/(width*height)));
}

// Inactive scenes draw once when invalidated, then release the animation loop.
// Resuming starts a new clock; time spent in another tab never advances play.
export function createRenderLoop({step,draw,isActive,isHidden,initialQuality=0,desktop=false,software=false,onQualityChange,request=requestAnimationFrame,cancel=cancelAnimationFrame}){
 let pending=0,last=null,lastRefresh=null,next=0,quality=initialQuality;
 let slow=0,fast=0,fastFrames=0,upgradedAt=-Infinity,retryAt=0;
 let paceTime=0,paceFrames=0,longestInterval=0,paceProbe=null;
 let softwareCadence=null,slowSamples=0;
 let lowestRecheckAvailable=true,steadyLowestSeconds=0;
 const interval=1000/RENDER_QUALITY.maxFps;
 const stepLimit=RENDER_QUALITY.maxStepSeconds;
 const recoverySeconds=8,retrySeconds=30;
 const minimumDrawRate=50,paceWindow=1,maxPaceInterval=2/RENDER_QUALITY.maxFps;
 const measureActualCadence=desktop||software;
 const lowestQuality=renderBudgets(desktop,software).length-1;
 function wake(){if(!pending&&!isHidden())pending=request(frame);}
 function resetPace(){paceTime=paceFrames=longestInterval=0;}
 function changeQuality(level){
  quality=level;if(!measureActualCadence)slow=0;
  fast=fastFrames=slowSamples=steadyLowestSeconds=0;resetPace();onQualityChange?.(quality);
 }
 function resetClock(){
  last=lastRefresh=null;next=0;slow=fast=fastFrames=slowSamples=steadyLowestSeconds=0;resetPace();
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
  const sample={rate:software?paceFrames/paceTime:frames/seconds,short,
   onTarget:software?paceFrames>=Math.floor(paceTime*minimumDrawRate):!short,seconds:software?paceTime:seconds};
  resetPace();return sample;
 }
 function adjustQuality(elapsed,time){
  // Count sustained render pressure. A shader compile, resize or single
  // long frame contributes at most one tenth of a second.
  if(elapsed>stepLimit){slow+=Math.min(.1,elapsed);fast=fastFrames=0;}
  else{
   slow=Math.max(0,slow-elapsed);
   if(quality&&time>=retryAt){fast+=elapsed;fastFrames++;}
  }
  const pace=samplePace(elapsed);
  if(pace&&paceProbe){
   if(paceProbe.sharper){
    const slower=!pace.onTarget&&(paceProbe.rate-pace.rate)*pace.seconds>=1;
    if(!slower||!paceProbe.early)retryAt=time+1000*(slower?retrySeconds:recoverySeconds);
    const previousLevel=paceProbe.level;paceProbe=null;
    if(slower)changeQuality(previousLevel);
    else softwareCadence=pace.rate;
    return;
   }
   const faster=(pace.rate-paceProbe.rate)*pace.seconds>=1;
   if(software&&faster&&quality===lowestQuality&&paceProbe.level===quality-1&&softwareCadence>=minimumDrawRate){
    // A higher resolution recently kept up. The load might have eased at
    // the same time as this downgrade, so confirm once before staying here.
    softwareCadence=pace.rate;
    lowestRecheckAvailable=false;
    paceProbe={level:quality,rate:pace.rate,sharper:true};
    retryAt=time+1000*retrySeconds;
    changeQuality(quality-1);
    return;
   }
   if(pace.onTarget&&(!software||faster)){
    // The previous tier already failed at this load. Give the successful
    // budget the same time to settle as after an unsuccessful probe.
    if(software)softwareCadence=pace.rate;
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
   const slowing=pace.short&&softwareCadence!==null&&(softwareCadence-pace.rate)*pace.seconds>=1;
   slowSamples=slowing?slowSamples+1:0;
   // New sustained load can merit a lower tier during the cooldown for
   // trying sharper frames. Use cadence at the restored tier after a probe.
   if(slowSamples>=2&&quality<lowestQuality){
    paceProbe={level:quality,rate:pace.rate};
    changeQuality(quality+1);return;
   }
   // A stable lowest tier gets one earlier recheck for a load that may have
   // passed during the opening. Keep its original retry deadline on failure.
   if(quality===lowestQuality&&lowestRecheckAvailable)
    steadyLowestSeconds=pace.onTarget?steadyLowestSeconds+pace.seconds:0;
   const early=quality===lowestQuality&&lowestRecheckAvailable&&time<retryAt&&steadyLowestSeconds>=recoverySeconds;
   if(quality>RENDER_QUALITY.softwareLevel&&(time>=retryAt||early)){
    if(quality===lowestQuality)lowestRecheckAvailable=false;
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
   if(measureActualCadence||slow<.45)paceProbe={level:quality,rate:pace.rate};
   changeQuality(quality+1);
  }else if(fast>=recoverySeconds){
   // A 60 FPS limit on a faster, mismatched display has uneven intervals.
   if(fastFrames/fast>=minimumDrawRate){paceProbe=null;softwareCadence=null;upgradedAt=time;changeQuality(quality-1);}
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
