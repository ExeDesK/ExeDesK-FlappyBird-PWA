import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,Bird} from '../site/src/game.js';
import {cyclicLerp,previousFor} from '../site/src/atlas.js';
import {F,Random,SIN,Animation,Tween,overlaps} from '../site/src/math.js';
import {FixedClock} from '../site/src/clock.js';
import {PerfProfiler} from '../site/src/perf.js';
import {computeDisplaySize,defaultAspectForCapabilities,compositeLandColor,skyColorForBackground,renderQualityScale} from '../site/src/display.js';
const reference=JSON.parse(readFileSync(new URL('./java-reference.json',import.meta.url)));
const bits=n=>new Int32Array(new Float32Array([n]).buffer)[0];
for(const {seed,values} of reference.random)test(`Java PRNG: seed ${seed}, 500 outputs`,()=>{
 const r=new Random(seed);assert.deepEqual(Array.from({length:500},()=>r.next()),values);
});
test('Bird arithmetic agrees bit-for-bit with JVM reference across 2000 updates',()=>{
 const b=new Bird(new Random(1),()=>{});b.idle=false;
 for(const row of reference.bird){const frame=row[0];if(frame===1||frame%19===0||frame%71===0)b.flap();b.tick();
  assert.deepEqual([frame,b.y,bits(b.velocity),bits(b.gravity),bits(b.rotation),bits(b.rotationSpeed)],row,`frame ${frame}`);
 }
});
test('360-entry sine table agrees with JVM reference',()=>{assert.deepEqual([...SIN].map(bits),reference.sin);});
test('Idle bob uses 8 degrees/update and wraps after 45',()=>{
 const b=new Bird(new Random(1),()=>{});for(let i=0;i<45;i++)b.tick();assert.equal(b.phase,0);assert.equal(b.y,246);assert.equal(b.bob,0);
});
test('Hitbox is inclusive on touching edges',()=>{
 assert.equal(overlaps(80,246,20,20,100,240,52,320),true);
 assert.equal(overlaps(80,246,20,20,101,240,52,320),false);
});
test('Flaps above the top are ignored',()=>{
 const b=new Bird(new Random(1),()=>{});b.y=-1;b.velocity=3;assert.equal(b.flap(),false);assert.equal(b.velocity,3);
});
test('Ground clamps to y=380 and kills vertical speed',()=>{
 const b=new Bird(new Random(1),()=>{});b.idle=false;for(let i=0;i<100;i++)b.tick();assert.equal(b.y,380);assert.equal(b.velocity,0);assert.equal(b.gravity,0);
});
test('Animation clock uses integer thresholds 33 and 100, with +15',()=>{
 const fast=new Animation([0,1,2],30,false);fast.tick();fast.tick();assert.equal(fast.frame,0);fast.tick();assert.equal(fast.frame,1);
 const slow=new Animation([0,1,2],10,true);for(let i=0;i<6;i++)slow.tick();assert.equal(slow.frame,0);slow.tick();assert.equal(slow.frame,1);
});
test('Tween IDs 5 and 11 are cubic-out and quintic-out, 30 frames per half second',()=>{
 for(const [id,mid] of [[5,.875],[11,.96875]]){const t=new Tween();t.start(0,1,id,.5);for(let i=0;i<15;i++)t.tick();assert.equal(t.value,mid);for(let i=0;i<15;i++)t.tick();assert.equal(t.value,1);assert.equal(t.done,true);}
});
test('1000-delay events fire after 34 updates; 500-delay after 17',()=>{
 const g=new Game({seed:1});g.tick();let hits=[];g.event=(id)=>{if(id>=90)hits.push({id,frame:g.frame});};g.queue(99,1000);g.queue(98,500);
 for(let i=0;i<34;i++)g.tick();assert.deepEqual(hits,[{id:98,frame:18},{id:99,frame:35}]);
});
test('Score increments at pipe x=bird x, not when its trailing edge passes',()=>{
 const g=new Game({seed:1});g.tick();g.hidden=0;g.speed=2;g.pipes[0].x=82;g.bird.x=80;g.score=0;g.movePipes();assert.equal(g.score,1);
 g.movePipes();assert.equal(g.score,1);
});
test('Pipe positions survive reset; spacing is 157 after recycling',()=>{
 const g=new Game({seed:1});g.tick();g.pipes=[{x:-53,y:210},{x:104,y:250},{x:261,y:300}];g.menuReset();assert.equal(g.pipes[0].x,-53);
 g.hidden=0;g.movePipes();assert.equal(g.pipes[2].x-g.pipes[1].x,157);assert.ok(g.pipes[2].y>=180&&g.pipes[2].y<360);
});
test('Menu -> play release -> ready -> flying -> death -> panel -> replay',()=>{
 const g=new Game({seed:12345});for(let i=0;i<40;i++)g.tick();assert.equal(g.state,'MENU');
 g.tick({touches:[{x:78,y:375}]});g.tick({touches:[]});for(let i=0;i<65;i++)g.tick();assert.equal(g.state,'READY');
 g.tick({tap:{x:144,y:256}});assert.equal(g.state,'PLAYING');
 for(let i=0;i<220;i++)g.tick();assert.equal(g.state,'GAME_OVER');assert.equal(g.panel.stage,2);assert.equal(g.play.active,true);
 g.tick({touches:[{x:78,y:375}]});g.tick();for(let i=0;i<65;i++)g.tick();assert.equal(g.state,'READY');assert.equal(g.score,0);
});
test('Two runs with the same input stream and seed are deterministic',()=>{
 const a=new Game({seed:-9876543}),b=new Game({seed:-9876543});
 for(let i=0;i<2000;i++){
  let input={};if(i===45)input.touches=[{x:78,y:375}];if(i>110&&i%21===0)input.tap={x:144,y:256};
  a.tick(input);b.tick(input);assert.deepEqual(a.snapshot(),b.snapshot());
 }
});
test('All display-list sprite names resolve in supplied atlas',()=>{
 const names=new Set(readFileSync(new URL('../site/assets/atlas.txt',import.meta.url),'utf8').trim().split(/\r?\n/).map(l=>l.split(' ')[0]));
 const g=new Game({seed:10});for(let i=0;i<400;i++){
  g.tick(i===40?{touches:[{x:78,y:375}]}:i===120?{tap:{x:144,y:256}}:{});
  for(const c of g.commands)assert.ok(names.has(c.name),c.name);
 }
});
for(const hz of [30,60,90,120,144,240])test(`60 simulation updates/sec at ${hz} Hz presentation`,()=>{
 const clock=new FixedClock(60);let ticks=0;
 for(let i=0;i<=hz*10;i++)ticks+=clock.steps(i*1000/hz);
 assert.equal(ticks,600);
});
test('Slow displays catch up to 60 Hz while large background gaps stay bounded',()=>{
 const c=new FixedClock(60,5);let n=0;
 for(let i=0;i<=300;i++)n+=c.steps(i*1000/30);
 assert.equal(n,600);
 assert.equal(c.steps(100000),5);
 assert.ok(c.steps(100001)<=1);
 c.reset();assert.equal(c.steps(100002),0);
});
test('Score panel medals and record thresholds match all four native tiers',()=>{
 for(const [score,medal] of [[0,-1],[9,-1],[10,3],[19,3],[20,2],[29,2],[30,1],[39,1],[40,0],[99,0]]){
  const g=new Game({seed:1,best:5});g.panel.start(score,5);
  for(let i=0;i<65;i++)g.panel.tick(g);
  assert.equal(g.panel.stage,2);assert.equal(g.panel.score,score);assert.equal(g.panel.medal,medal);
  assert.equal(g.best,Math.max(score,5));assert.equal(g.panel.newRecord,score>5);
 }
});
test('Sparse replay survives JSON export and reproduces the exact final snapshot',async()=>{
 const {runReplay}=await import('../tools/replay.mjs');
 const seed=-1234567,bestAtBoot=12,g=new Game({seed,best:bestAtBoot});const inputs=[];
 let previous='';
 for(let frame=1;frame<=600;frame++){
  let input={touches:[]};if(frame===45)input.touches=[{x:78,y:375}];
  if(frame>110&&frame%22===0)input.tap={x:144,y:256};
  const signature=JSON.stringify(input);
  if(signature!==previous||input.tap)inputs.push({frame,...input});previous=signature;
  g.tick(input);
 }
 const data={schema:'flappy13-replay-v1',seed,bestAtBoot,totalFrames:g.frame,truncated:false,inputs,final:g.snapshot()};
 assert.deepEqual(runReplay(JSON.parse(JSON.stringify(data))),g.snapshot());
});

test('Performance profiler reports cadence and drop buckets',()=>{
 const p=new PerfProfiler(100);p.start(0);
 for(let i=0;i<=6;i++)p.frame(i*16.6667,1,0.4);
 const r=p.result;assert.ok(r);assert.ok(r.rafFps>50&&r.rafFps<70);assert.equal(r.over33,0);assert.equal(r.steps1,7);assert.equal(r.maxSteps,1);
});


test('Land interpolation crosses the 24 px wrap forward without visual rollback',()=>{
 assert.equal(cyclicLerp(-22,0,0,24),-22);
 assert.equal(cyclicLerp(-22,0,.5,24),-23);
 assert.equal(cyclicLerp(-22,0,1,24),0);
});

test('Render identities follow a pipe across slot recycling',()=>{
 const previous=[{name:'pipe_up',key:'pipe-7-up',x:104},{name:'pipe_up',key:'pipe-8-up',x:261}];
 const current=[{name:'pipe_up',key:'pipe-8-up',x:259},{name:'pipe_up',key:'pipe-9-up',x:416}];
 assert.equal(previousFor(current[0],0,previous),previous[1]);
 assert.equal(previousFor(current[1],1,previous),null);
});

test('All visible pipe commands carry stable render identities',()=>{
 const g=new Game({seed:123});g.tick();
 g.menu=false;g.hidden=0;g.speed=2;g.bird.idle=false;g.tick();
 const pipes=g.commands.filter(c=>c.name==='pipe_up'||c.name==='pipe_down');
 assert.equal(pipes.length,6);
 assert.ok(pipes.every(c=>typeof c.key==='string'&&c.key.startsWith('pipe-')));
});


test('Adapted aspect centers the 288:512 game and fills the full portrait height',()=>{
 const size=computeDisplaySize(440,796,{aspect:'adapted'});
 assert.ok(Math.abs(size.gameWidth-440)<1e-9);
 assert.ok(Math.abs(size.gameWidth/size.gameHeight-288/512)<1e-12);
 assert.ok(size.topGap>0&&size.bottomGap>0);
 assert.ok(Math.abs(size.topGap-size.bottomGap)<1e-9);
 assert.ok(Math.abs(size.height-796)<1e-9);
 assert.ok(Math.abs((size.topPad+512+size.bottomPad)*size.scaleY-796)<1e-8);
});

test('Adapted aspect never stretches the logical game non-uniformly',()=>{
 for(const [w,h] of [[440,796],[390,844],[1200,2200],[440,700]]){
  const size=computeDisplaySize(w,h,{aspect:'adapted'});
  assert.equal(size.scaleX,size.scaleY);
  assert.ok(size.gameWidth<=w+1e-9&&size.gameHeight<=h+1e-9);
  assert.ok(size.width<=w+1e-9&&size.height<=h+1e-9);
 }
});

test('Original aspect preserves 288:512 with no scene padding',()=>{
 const size=computeDisplaySize(440,796,{aspect:'original'});
 assert.ok(size.width<=440&&size.height<=796);
 assert.ok(Math.abs(size.width/size.height-288/512)<1e-12);
 assert.equal(size.topPad,0);assert.equal(size.bottomPad,0);
});

test('Performance mode affects backing supersampling, not CSS game size',()=>{
 const normal=computeDisplaySize(1200,2200,{aspect:'adapted'});
 const perf=computeDisplaySize(1200,2200,{aspect:'adapted',performance:true});
 assert.deepEqual(perf,normal);
 assert.equal(renderQualityScale(3,{performance:true}),2);
});

test('Aspect default is Original on desktop and Adapted on touch/mobile-class input',()=>{
 assert.equal(defaultAspectForCapabilities({desktop:true}),'original');
 assert.equal(defaultAspectForCapabilities({desktop:false}),'adapted');
});

test('Scene extension colors match original day/night sky and land',()=>{
 assert.equal(skyColorForBackground('bg_day'),'rgb(78, 192, 202)');
 assert.equal(skyColorForBackground('bg_night'),'rgb(0, 135, 147)');
 assert.equal(compositeLandColor(0,0),'rgb(222, 216, 149)');
 assert.equal(compositeLandColor(1,0),'rgb(0, 0, 0)');
 assert.equal(compositeLandColor(0,1),'rgb(255, 255, 255)');
 assert.equal(compositeLandColor(.5,0),'rgb(111, 108, 75)');
});


test('Renderer supersamples rotated sprites at x2 desktop and x3 high-DPR mobile',()=>{
 assert.equal(renderQualityScale(1,{performance:false}),2);
 assert.equal(renderQualityScale(2,{performance:false}),2);
 assert.equal(renderQualityScale(3,{performance:false}),3);
 assert.equal(renderQualityScale(4,{performance:false}),3);
 assert.equal(renderQualityScale(3,{performance:true}),2);
});

test('PWA requests portrait-primary and avoids translucent iOS status-bar blur',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../site/manifest.webmanifest',import.meta.url),'utf8'));
 const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
 assert.equal(manifest.orientation,'portrait-primary');
 assert.match(html,/apple-mobile-web-app-status-bar-style" content="black"/);
 assert.doesNotMatch(html,/black-translucent/);
});

test('Adapted scene extension is rendered by the Canvas, not a CSS pseudo-element',()=>{
 const css=readFileSync(new URL('../site/style.css',import.meta.url),'utf8');
 assert.doesNotMatch(css,/#stage\[data-aspect="adapted"\]::after/);
 assert.match(css,/#stage\[data-aspect="adapted"\],#stage\[data-aspect="original"\]\{align-items:center/);
});
