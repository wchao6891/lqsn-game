const APP_CACHE='lqsn-app-4a39635720c2';
const ASSET_CACHE='lqsn-assets-7b542bf4e7bb';
const KEEP=new Set([APP_CACHE,ASSET_CACHE]);
const SCOPE=new URL('./',self.location.href).pathname;
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(
  keys.filter(key=>key.startsWith('lqsn-')&&!KEEP.has(key)).map(key=>caches.delete(key))
 )).catch(()=>{}).then(()=>self.clients.claim()));
});
function cacheable(response){
 if(!response||!response.ok||response.status!==200||response.type!=='basic')return false;
 const type=response.headers.get('content-type')||'';
 if(/^\s*text\/html\b/i.test(type))return false;
 return true;
}
self.addEventListener('fetch',event=>{
 const {request}=event;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 const path=url.pathname;
 if(!path.startsWith(SCOPE))return;
 const rel=path.slice(SCOPE.length);
 if(!rel||rel==='sw.js'||rel.endsWith('.html')||request.mode==='navigate')return;
 const bucket=(rel.startsWith('game-assets/')||rel.startsWith('vendor/'))?ASSET_CACHE:APP_CACHE;
 event.respondWith((async()=>{
  try{
   const cache=await caches.open(bucket);
   const cached=await cache.match(request);
   if(cached)return cached;
   const response=await fetch(request);
   if(cacheable(response)){
    const copy=response.clone();
    event.waitUntil(cache.put(request,copy).catch(()=>{}));
   }
   return response;
  }catch{
   return fetch(request);
  }
 })());
});
