import {Game} from './game.js';
import {Renderer,loadAtlas} from './atlas.js';
import {Audio} from './audio.js';
import {FixedClock} from './clock.js';
import {PerfProfiler} from './perf.js';
import {computeDisplaySize,defaultAspectForCapabilities,renderQualityScale} from './display.js';
const $=id=>document.getElementById(id);
const VERSION='0.2.1b';
const KEY='flappy13-personal-best-v1';
const SETTINGS_KEY='flappy13-settings-v1';
const canvas=$('game'),stage=$('stage'),options=$('options');
const sound=new Audio();
let game,renderer,paused=false,debug=new URLSearchParams(location.search).has('debug');
let installPrompt=null,cacheInfo=null,serverReachable=false,serverCheckTimer=null;
const clock=new FixedClock(60);
const profiler=new PerfProfiler(10000);
let lastPerfResult=null,cachedDebugState=null;
let raf=0,rafCount=0,tickCount=0,statsAt=0;
let previousCommands=null,currentCommands=null;
let displayLayout={width:288,height:512,gameWidth:288,gameHeight:512,scaleX:1,scaleY:1,topGap:0,bottomGap:0,topPad:0,bottomPad:0,totalLogicalHeight:512};
let resizeQueued=0,orientationBlocked=false;
let pendingTap=null,touchRecords=new Map(),trace=[],lastInputSignature='',droppedReplay=false;
const urlSeed=Number(new URLSearchParams(location.search).get('seed'));
const seed=new URLSearchParams(location.search).has('seed')&&Number.isFinite(urlSeed)?urlSeed|0:Date.now()|0;
let best=0;
try{const v=Number(localStorage.getItem(KEY));if(Number.isInteger(v)&&v>=0&&v<=2147483647)best=v;}catch{}
const bootBest=best;
const desktopDefault=matchMedia('(hover: hover) and (pointer: fine)').matches;
const settings={sound:true,aspect:defaultAspectForCapabilities({desktop:desktopDefault}),performance:false};
try{
  const saved=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');
  if(saved&&typeof saved==='object'){
    if(typeof saved.sound==='boolean')settings.sound=saved.sound;
    if(saved.aspect==='adapted'||saved.aspect==='original')settings.aspect=saved.aspect;
    if(typeof saved.performance==='boolean')settings.performance=saved.performance;
  }
}catch{}
$('sound').checked=settings.sound;
$('aspect').value=settings.aspect;
$('performance-mode').checked=settings.performance;
sound.muted=!settings.sound;
function toast(text,ms=4500){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,ms);}
function saveSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch{}}
function saveBest(value){best=Math.max(best,value);try{localStorage.setItem(KEY,String(best));}catch{toast('Record conservé pour cette session uniquement.');}$('best-score').textContent=best;}
function resize(){
  if(orientationBlocked)return;
  const w=stage.clientWidth,h=stage.clientHeight;
  const size=computeDisplaySize(w,h,{aspect:settings.aspect});
  displayLayout=size;
  stage.dataset.aspect=settings.aspect;
  stage.style.setProperty('--game-width',`${size.gameWidth}px`);
  stage.style.setProperty('--game-height',`${size.gameHeight}px`);
  canvas.style.width=`${size.width}px`;canvas.style.height=`${size.height}px`;
  if(renderer){
    renderer.configureViewport({
      topPad:size.topPad,bottomPad:size.bottomPad,adapted:settings.aspect==='adapted',
      renderScale:renderQualityScale(devicePixelRatio,{performance:settings.performance})
    });
    if(game&&currentCommands)render(clock.alpha());
  }
}
function scheduleResize(){
  if(resizeQueued||orientationBlocked)return;
  resizeQueued=requestAnimationFrame(()=>{resizeQueued=0;resize();});
}
function isMobileClass(){return navigator.maxTouchPoints>0&&Math.min(screen.width||innerWidth,screen.height||innerHeight)<1200;}
function isLandscape(){return innerWidth>innerHeight;}
async function tryLockPortrait(){
  if(!isMobileClass()||!screen.orientation?.lock)return false;
  try{await screen.orientation.lock('portrait-primary');return true;}catch{return false;}
}
function updateOrientationGuard(){
  const blocked=isMobileClass()&&isLandscape();
  orientationBlocked=blocked;
  $('orientation-lock').hidden=!blocked;
  if(blocked){clearInput();clock.reset();}
  else setTimeout(scheduleResize,80);
}
function openOptions(showScores=false){
  if(!game)return;sound.unlock();$('scores-message').hidden=!showScores;$('best-score').textContent=best;
  if(!options.open)options.showModal();clearInput();clock.reset();startServerChecks();
}
function closeOptions(){options.close();clearInput();clock.reset();stopServerChecks();canvas.focus({preventScroll:true});}
function clearInput(){touchRecords.clear();pendingTap=null;}
function position(e){const r=canvas.getBoundingClientRect();const cssScale=r.width/288||1;return{x:Math.trunc((e.clientX-r.left)/cssScale),y:Math.trunc((e.clientY-r.top)/cssScale-displayLayout.topPad)};}
function press(id,p){
  if(!game||options.open)return;sound.unlock();
  touchRecords.set(id,{...p,released:false,seen:false});pendingTap=p;
}
function release(id){const p=touchRecords.get(id);if(p){if(p.seen)touchRecords.delete(id);else p.released=true;}}
canvas.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();tryLockPortrait();canvas.focus({preventScroll:true});
  canvas.setPointerCapture(e.pointerId);press(e.pointerId,position(e));
});
canvas.addEventListener('pointerup',e=>{e.preventDefault();release(e.pointerId);});
canvas.addEventListener('pointercancel',e=>touchRecords.delete(e.pointerId));
canvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('keydown',e=>{
  if(options.open)return;
  if(e.code==='Escape'){e.preventDefault();openOptions();return;}
  if(['Space','ArrowUp','Enter'].includes(e.code)){
    e.preventDefault();if(e.repeat)return;
    // Keyboard control is an explicit PWA convenience, absent in the APK.
    const p=game?.play.active?{x:78,y:375}:{x:144,y:256};press('keyboard',p);
  }else if(e.code==='KeyH'){setDebug(!debug);}
  else if(debug&&e.code==='KeyP'){paused=!paused;syncPause();}
  else if(debug&&e.code==='KeyN'){paused=true;syncPause();tick();render();}
});
window.addEventListener('keyup',e=>{if(['Space','ArrowUp','Enter'].includes(e.code)){e.preventDefault();release('keyboard');}});
window.addEventListener('blur',()=>{clearInput();clock.reset();});
document.addEventListener('visibilitychange',()=>{clearInput();clock.reset();if(!document.hidden){tryLockPortrait();updateOrientationGuard();}});
window.addEventListener('resize',scheduleResize);
window.visualViewport?.addEventListener('resize',scheduleResize);
window.addEventListener('orientationchange',updateOrientationGuard);
screen.orientation?.addEventListener?.('change',updateOrientationGuard);
$('open-options').onclick=()=>openOptions();$('close-options').onclick=closeOptions;
options.addEventListener('close',()=>{clock.reset();stopServerChecks();});
$('aspect').onchange=()=>{settings.aspect=$('aspect').value;saveSettings();scheduleResize();};
$('performance-mode').onchange=()=>{settings.performance=$('performance-mode').checked;saveSettings();resize();toast(settings.performance?'Mode Performance : rendu interne plafonné à ×2.':'Mode Performance désactivé.');};
$('sound').onchange=()=>{settings.sound=$('sound').checked;saveSettings();sound.muted=!settings.sound;sound.unlock();};
function setDebug(value){debug=value;$('debug').checked=debug;$('diagnostic').hidden=!debug;render();}
$('debug').onchange=()=>setDebug($('debug').checked);
function syncPause(){$('pause').textContent=paused?'Reprendre':'Pause';clock.reset();}
$('pause').onclick=()=>{paused=!paused;syncPause();};
$('step').onclick=()=>{paused=true;syncPause();tick();render();};
function nextInput(){
  const touches=[...touchRecords.values()].map(({x,y})=>({x,y}));
  const input={touches};if(pendingTap){input.tap=pendingTap;pendingTap=null;}
  for(const [id,p] of touchRecords){p.seen=true;if(p.released)touchRecords.delete(id);}
  return input;
}
function tick(input=nextInput()){
  if(currentCommands) previousCommands=currentCommands.map(c=>({...c}));
  const signature=JSON.stringify(input);
  if(input.tap||signature!==lastInputSignature){
    if(trace.length<30000)trace.push({frame:game.frame+1,...structuredClone(input)});else droppedReplay=true;
    lastInputSignature=signature;
  }
  game.tick(input);
  currentCommands=game.commands.map(c=>({...c}));
  if(!previousCommands) previousCommands=currentCommands.map(c=>({...c}));
  if(debug)cachedDebugState=game.snapshot();
  tickCount++;
}
function render(alpha=1){
  if(renderer&&game)renderer.drawInterpolated(previousCommands??game.commands,currentCommands??game.commands,alpha,debug?cachedDebugState:null);
}
function perfText(result=lastPerfResult){return profiler.format(result);}
function startProfiler(){profiler.start(performance.now());lastPerfResult=null;$('perf-output').textContent='Profil en cours pendant 10 s…';$('profile').disabled=true;}
function exportPerf(){
  const data={schema:'flappy13-perf-v1',version:VERSION,userAgent:navigator.userAgent,devicePixelRatio,viewport:{innerWidth,innerHeight},result:lastPerfResult};
  const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=u;a.download=`flappy13-perf-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);
}
$('profile').onclick=startProfiler;$('export-perf').onclick=exportPerf;
function animate(now){
  rafCount++;
  if(game&&!options.open&&!document.hidden&&!paused&&!orientationBlocked){
    const steps=clock.steps(now);
    for(let i=0;i<steps;i++)tick();
    // Always render on rAF. Safari's rAF jitter can otherwise produce a
    // visible 1/0/2-tick cadence even though the average simulation speed is 60 Hz.
    const renderStarted=performance.now();
    render(clock.alpha());
    const renderMs=performance.now()-renderStarted;
    const result=profiler.frame(now,steps,renderMs);
    if(result){lastPerfResult=result;$('perf-output').textContent=perfText(result);$('profile').disabled=false;$('export-perf').disabled=false;}
  }else clock.reset();
  if(now-statsAt>=500){
    if(debug&&game){const s=game.snapshot();$('stats').textContent=`${s.state} | tick ${s.frame}\nupdates/s ${Math.round(tickCount*1000/(now-statsAt))} | rAF/s ${Math.round(rafCount*1000/(now-statsAt))}\nseed ${s.seed}\nbird (${s.bird.x}, ${s.bird.y})\nv=${s.bird.velocity.toFixed(7)} | rot=${s.bird.rotation.toFixed(4)}\nscore=${s.score} | hidden=${s.hidden}\npipes ${s.pipes.map(p=>p.x+':'+p.y).join(' / ')}`;}
    statsAt=now;tickCount=rafCount=0;
  }
  raf=requestAnimationFrame(animate);
}
function exportReplay(){
  const data={schema:'flappy13-replay-v1',version:VERSION,seed,bestAtBoot:bootBest,totalFrames:game.frame,truncated:droppedReplay,inputs:trace,final:game.snapshot()};
  const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=u;a.download=`flappy13-${seed}-${game.frame}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);
}
$('export').onclick=exportReplay;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});
$('install').onclick=async()=>{
  if(!installPrompt)return;await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('install').hidden=true;
  try{await navigator.storage?.persist?.();}catch{}
};
window.addEventListener('appinstalled',()=>{$('install').hidden=true;tryLockPortrait();toast('Application installée.');});
async function checkOffline(){
  const controller=navigator.serviceWorker?.controller;if(!controller)return false;
  const status=await new Promise(resolve=>{
    const channel=new MessageChannel();const timeout=setTimeout(()=>resolve(null),5000);
    channel.port1.onmessage=e=>{clearTimeout(timeout);channel.port1.close();resolve(e.data);};
    controller.postMessage({type:'VERIFY_CACHE'},[channel.port2]);
  });
  cacheInfo=status;
  if(status?.complete){$('offline-status').textContent=`Hors ligne prêt - ${status.count} ressources en cache.`;return true;}
  $('offline-status').textContent='Cache incomplet : garder la connexion et recharger le jeu.';return false;
}
async function checkServerReachable({silent=false}={}){
  const button=$('refresh-cache'),status=$('server-status');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),2200);
  let ok=false;
  try{
    const response=await fetch(new URL(`./__health?t=${Date.now()}`,location.href),{cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
    if(response.ok){const body=await response.json();ok=body?.ok===true;}
  }catch{}finally{clearTimeout(timeout);}
  serverReachable=ok;button.disabled=!ok;
  if(ok)status.textContent='Serveur joignable : mise à jour manuelle disponible.';
  else status.textContent='Serveur non joignable : mise à jour désactivée.';
  if(!silent&&!ok)toast('Serveur introuvable : impossible de vider le cache en sécurité.');
  return ok;
}
function stopServerChecks(){clearInterval(serverCheckTimer);serverCheckTimer=null;}
function startServerChecks(){
  stopServerChecks();
  $('refresh-cache').disabled=true;$('server-status').textContent='Recherche du serveur de mise à jour…';
  checkServerReachable({silent:true});
  // Poll only while the options dialog is open: no background network work during gameplay.
  serverCheckTimer=setInterval(()=>{if(options.open)checkServerReachable({silent:true});else stopServerChecks();},5000);
}
async function flushCacheAndUpdate(){
  const button=$('refresh-cache');
  if(!await checkServerReachable())return;
  const oldText=button.textContent;button.disabled=true;button.textContent='Mise à jour…';
  try{
    // Recheck before destructive work, then purge only Flappy caches on this origin.
    if(!await checkServerReachable())throw new Error('Le serveur ne répond plus.');
    if('caches' in window){
      const names=await caches.keys();
      await Promise.all(names.filter(name=>name.startsWith('flappy13-')).map(name=>caches.delete(name)));
    }
    if('serviceWorker' in navigator){
      const registrations=await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.filter(reg=>reg.scope===new URL('./',location.href).href).map(reg=>reg.unregister()));
    }
    const target=new URL(location.href);target.searchParams.set('_update',String(Date.now()));
    location.replace(target.href);
  }catch(error){
    button.textContent=oldText;await checkServerReachable({silent:true});toast(`Mise à jour annulée : ${error.message}`);
  }
}
$('refresh-cache').onclick=flushCacheAndUpdate;
window.addEventListener('online',()=>{if(options.open)checkServerReachable({silent:true});});
window.addEventListener('offline',()=>{serverReachable=false;$('refresh-cache').disabled=true;$('server-status').textContent='Serveur non joignable : mise à jour désactivée.';});
async function setupPWA(){
  if(!isSecureContext||!('serviceWorker' in navigator)){
    $('offline-status').textContent='Mode hors ligne PWA indisponible ici. Ouvrir sur localhost ou en HTTPS.';return;
  }
  navigator.serviceWorker.addEventListener('controllerchange',()=>checkOffline());
  const registration=await navigator.serviceWorker.register(new URL('../sw.js',import.meta.url),{updateViaCache:'none'});
  await navigator.serviceWorker.ready;
  // Ask the browser to check for a newer worker whenever the app starts online.
  try{await registration.update();}catch{}
  if(await checkOffline())toast('Hors ligne prêt : le jeu et ses sons sont en cache.');
}
async function boot(){
  try{
    if(location.protocol==='file:')throw new Error('Lance Demarrer.cmd, puis ouvre le jeu sur localhost. Ne pas ouvrir index.html directement.');
    const [atlas]=await Promise.all([loadAtlas(),sound.preload()]);
    renderer=new Renderer(canvas,atlas);
    game=new Game({seed,best,onEvent:({type,value})=>{
      if(type==='sound')sound.play(value);
      if(type==='record')saveBest(value);
      if(type==='local-scores')openOptions(true);
      if(type==='about')openOptions(false);
    }});
    $('loading').hidden=true;setDebug(debug);updateOrientationGuard();resize();tick({touches:[]});cachedDebugState=debug?game.snapshot():null;render();tryLockPortrait();
    raf=requestAnimationFrame(animate);
    // Explicit diagnostics API. No gameplay cheats on ordinary keyboard controls.
    window.flappy={
      version:VERSION,get game(){return game;},get audio(){return sound;},snapshot:()=>game.snapshot(),
      pause(value=true){paused=value;syncPause();},
      step(input={touches:[]}){paused=true;syncPause();tick(input);render();return game.snapshot();},
      cache:()=>cacheInfo,checkOffline,checkServer:checkServerReachable,flushCacheAndUpdate,exportReplay,startProfiler,perf:()=>lastPerfResult,exportPerf,layout:()=>structuredClone(displayLayout),tryLockPortrait,
      replayData:()=>({schema:'flappy13-replay-v1',version:VERSION,seed,bestAtBoot:bootBest,totalFrames:game.frame,truncated:droppedReplay,inputs:structuredClone(trace),final:game.snapshot()})
    };
    setupPWA().catch(error=>{$('offline-status').textContent=`Cache hors ligne non prêt : ${error.message}`;console.error(error);});
  }catch(error){$('loading').hidden=false;$('loading').textContent=`Impossible de démarrer : ${error.message}`;console.error(error);}
}
boot();
