/** Flappy Bird 1.3 behavior port. Source map: docs/REVERSE-ENGINEERING.md.
 * One call to tick = one original scene update. No dt-based movement.
 * The display list is built in original update/draw order and reused at 120/144 Hz.
 */
import {F,I,SIN,Random,Tween,Animation,overlaps} from './math.js';
const WINGS=[0,1,2,1,0,1,2,1,0,1,2,1];
export class Bird {
  constructor(random,queue) {
    this.random=random;this.queue=queue;this.flapAnimation=new Animation(WINGS,30,false);
    this.autoAnimation=new Animation(WINGS,10,true);this.rotationSpeed=0;this.bob=0;this.counter=30;
    this.color=random.next()%3;this.reset();
  }
  reset(){
    this.x=80;this.y=246;this.rotation=0;this.velocity=0;this.gravity=F(1);this.rotationAcceleration=F(.4);
    this.dead=false;this.idle=true;this.phase=0;this.animation=this.autoAnimation;this.animation.reset();
    this.color=this.random.next()%3;
  }
  flap(){
    if(this.idle)this.idle=false;
    if(this.y>=0&&!this.dead){
      this.animation=this.flapAnimation;this.animation.reset();
      this.velocity=F(-5);this.gravity=F(.3);this.rotationSpeed=F(-10);this.rotationAcceleration=F(.4);
      this.queue(4,5);return true;
    }return false;
  }
  tick(){
    this.animation.tick();
    if(this.idle){this.phase+=8;if(this.phase===360)this.phase=0;this.bob=F(SIN[this.phase]*F(4));return;}
    this.bob=0;this.velocity=F(this.velocity+this.gravity);
    if(this.velocity>8)this.velocity=8;
    this.y=I(F(F(this.y)+this.velocity));
    if(this.y>380){this.y=380;this.gravity=0;this.velocity=0;}
    this.rotation=F(this.rotation+this.rotationSpeed);
    this.rotationSpeed=F(this.rotationSpeed+this.rotationAcceleration);
    if(this.rotation < -20)this.rotation=-20;if(this.rotation>90)this.rotation=90;
    if(--this.counter===0)this.counter=30;
  }
  draw(g){const frame=this.animation.done?1:this.animation.frame;
    g.draw(`bird${this.color}_${frame}`,this.x-14,this.y-14+I(this.bob),1,I(this.rotation),undefined,undefined,'bird');}
}
class Button {
  constructor(name,w,h){Object.assign(this,{name,w,h,x:0,y:0,active:false,pressed:false,released:false});}
  show(x,y){Object.assign(this,{x,y,active:true,pressed:false,released:false});}
  tick(touches){
    const inside=touches.some(p=>p.x>this.x&&p.x<this.x+this.w&&p.y>this.y&&p.y<this.y+this.h);
    this.released=this.pressed&&!inside;this.pressed=inside;
  }
  draw(g){g.draw(this.name,this.x,this.y+(this.pressed?2:0));}
}
class Ready {
  constructor(){this.active=false;this.tween=new Tween();this.stage=0;}
  start(){this.active=true;this.tween.start(0,1,0,.5);this.stage=0;}
  dismiss(){this.stage=2;this.tween.start(1,0,0,.5);}
  tick(g){this.tween.tick();if(this.stage===0&&this.tween.done)this.stage=1;
    // The original keeps its F flag true after fading out. Do not reset it here.
    g.draw('text_ready',46,146,this.tween.value);g.draw('tutorial',87,220,this.tween.value);}
}
class GameOver {
  constructor(){this.active=false;this.tween=new Tween();}
  start(g){this.active=true;this.tween.start(0,1,11,1);this.y=-1;this.velocity=F(-2);this.acceleration=F(.25);this.stage=0;g.emit('sound','swooshing');}
  tick(g){
    this.tween.tick();
    if(this.y<0){this.y=I(F(F(this.y)+this.velocity));this.velocity=F(this.velocity+this.acceleration);}else this.y=0;
    if(this.stage===0&&this.tween.done){this.stage=1;g.panel.start(g.score,g.best);g.emit('sound','swooshing');}
    else if(this.stage===1&&g.panel.stage===2)this.stage=2;
    g.draw('text_game_over',42,130+this.y,this.tween.value);
  }
}
class Sparkle {
  constructor(){this.active=false;this.animation=new Animation([0,1,2,1,0],10,false);}
  start(x,y){this.x=x;this.y=y;this.active=true;this.animation.reset();}
  tick(g){if(!this.active)return;this.animation.tick();if(this.animation.done)this.active=false;
    if(this.active)g.draw(`blink_0${this.animation.frame}`,this.x-4,this.y-4);}
}
class Panel {
  constructor(){this.active=false;this.tween=new Tween();this.stage=0;this.medal=-1;}
  start(score,best){
    this.target=score;this.best=best;this.score=0;this.active=true;this.newRecord=false;
    this.x=25;this.y=504;this.tween.start(504,193,11,.5);this.stage=0;this.medal=-1;this.blink=30;
  }
  tick(g){
    if(!this.active)return;
    if(!this.tween.done)this.tween.tick();
    switch(this.stage){
      case 0:
        this.y=I(this.tween.value);
        if(this.tween.done){if(this.target<=0)this.stage=2;else{this.stage=1;this.tween.start(0,this.target,0,.5);}}break;
      case 1:
        this.score=I(this.tween.value);
        if(this.tween.done){
          this.stage=2;g.emit('record',this.score);if(this.score>g.best)g.best=this.score;
          if(this.score>this.best){this.best=this.score;this.newRecord=true;}
          this.medal=this.score>=40?0:this.score>=30?1:this.score>=20?2:this.score>=10?3:-1;
        }break;
      case 2:
        if(this.medal>=0 && --this.blink<=0){
          this.blink=30;g.sparkle(this.x+29+g.random.range(0,50),this.y+41+g.random.range(0,50));
        }break;
    }
  }
  draw(g){if(!this.active)return;
    g.draw('score_panel',this.x,this.y);
    g.smallNumber(this.score,this.x+210,this.y+36);g.smallNumber(this.best,this.x+210,this.y+78);
    if(this.newRecord)g.draw('new',this.x+142,this.y+60);
    if(this.medal>=0)g.draw(`medals_${this.medal}`,this.x+32,this.y+44);
  }
}
export class Game {
  constructor({seed=Date.now()|0,best=0,onEvent=()=>{}}={}) {
    this.seed=seed|0;this.best=Math.max(0,best|0);this.onEvent=onEvent;this.frame=0;this.replay=[];
    this.commands=[];this.outputs=[];this.events=Array.from({length:50},()=>({delay:0,id:0}));this.eventIndex=0;
    this.random=new Random(0);this.fade=new Tween();this.flash=new Tween();this.fadeEvent=0;
    this.play=new Button('button_play',116,70);this.scores=new Button('button_score',116,70);this.rate=new Button('button_rate',74,48);
    this.bird=new Bird(this.random,(id,delay)=>this.queue(id,delay));
    // Scene construction calls reset once more before the clock-based RNG seed.
    this.bird.reset();this.ready=new Ready();this.over=new GameOver();this.panel=new Panel();
    this.sparkles=Array.from({length:10},()=>new Sparkle());this.sparkleIndex=0;
    this.pipeSerial=3;this.pipes=[{x:79,y:274,rid:0},{x:236,y:274,rid:1},{x:393,y:274,rid:2}];this.spacing=157;
    this.menu=true;this.score=0;this.speed=0;this.hidden=1;this.land=0;this.background='bg_day';this.games=0;
    this.queue(6,1);this.transition(false,0,.5);this.random.seed(this.seed);
  }
  draw(name,x,y,alpha=1,angle=0,w=undefined,h=undefined,key=undefined){this.commands.push({name,x,y,alpha,angle,w,h,key});}
  emit(type,value){this.outputs.push({type,value,frame:this.frame});}
  queue(id,delay){this.events[this.eventIndex]={id,delay};this.eventIndex=(this.eventIndex+1)%50;}
  transition(toBlack,event,seconds){if(this.fade.done){this.fade.start(toBlack?0:1,toBlack?1:0,5,seconds);this.fade.tick();this.fadeEvent=event;}}
  menuReset(){
    this.background=this.random.next()%10>3?'bg_day':'bg_night';this.sparkleIndex=0;
    this.play.show(20,340);this.scores.show(152,340);this.rate.show(107,270);
    this.ready.active=false;this.over.active=false;this.panel.active=false;
    this.menu=true;this.land=0;this.bird.reset();this.speed=2;this.hidden=1;this.score=0;
    // Pipe coordinates deliberately survive restart in the APK.
  }
  event(id){
    switch(id){
      case 2:this.emit('record',this.score);this.over.start(this);break;
      case 3:this.emit('sound','die');break;
      case 4:this.emit('sound','wing');break;
      case 5:
        this.menuReset();this.play.active=this.scores.active=this.rate.active=false;this.menu=false;
        this.transition(false,0,.5);this.land=0;this.bird.reset();this.speed=2;this.hidden=1;this.score=0;this.ready.start();this.games++;break;
      case 6:this.menuReset();this.transition(false,0,.5);break;
      case 7:break; // Original external copyright action has no runtime handler.
    }
  }
  pointer(x,y){
    if(this.menu)return;
    // Quirk from flappy.c.a(II): hit zone of the never-shown pause button.
    if(x>=-20&&x<=46&&y>=-20&&y<=48)return;
    if(!this.bird.idle){if(this.speed>0)this.bird.flap();}
    else if(this.ready.active&&this.ready.stage===1){this.ready.dismiss();this.bird.idle=false;this.bird.flap();}
  }
  hit(pipe=false,markDead=false){
    if(this.flash.done){this.flash.start(1,0,11,1);this.flash.tick();}
    if(markDead)this.bird.dead=true;
    this.speed=0;this.emit('sound','hit');if(pipe)this.queue(3,500);this.queue(2,1000);
  }
  movePipes(){
    for(const p of this.pipes)p.x-=this.speed;
    const [a]=this.pipes;
    if(this.speed>0&&this.hidden<=0&&(a.x===this.bird.x||a.x===this.bird.x-1)){this.score++;this.emit('sound','point');}
    if(a.x< -52){
      this.pipes[0]={...this.pipes[1]};this.pipes[1]={...this.pipes[2]};
      this.pipes[2]={x:this.pipes[1].x+157,y:this.random.range(180,360),rid:this.pipeSerial++};
      if(this.hidden>0){this.hidden--;if(this.hidden===0){this.pipes[1].x=-52;this.pipes[0].x=-52;}}
    }
  }
  collisions(){
    const b=this.bird;
    if(b.y>=380&&this.speed>0)this.hit(false,false);
    if(!b.dead&&this.hidden<=0&&this.speed>0){
      const [p,q]=this.pipes;
      if(overlaps(b.x,b.y,20,20,p.x,p.y-416,52,320))this.hit(true,false);
      else if(overlaps(b.x,b.y,20,20,p.x,p.y,52,320))this.hit(true,true);
      if(overlaps(b.x,b.y,20,20,q.x,q.y-416,52,320)||overlaps(b.x,b.y,20,20,q.x,q.y,52,320))this.hit(true,true);
    }
  }
  bigNumber(value){
    const digits=String(Math.max(0,value));
    const width=[...digits].reduce((n,c)=>n+(c==='1'?16:24)-4,0)+2;
    let x=144-Math.trunc(width/2);
    for(const c of digits){this.draw(`font_0${c.charCodeAt(0)}`,x,78);x+=(c==='1'?16:24)-4;}
  }
  smallNumber(value,right,y){
    const digits=String(Math.max(0,value));let x=right-16;
    for(let i=digits.length-1;i>=0;i--){this.draw(`number_score_0${digits[i]}`,x,y);x-=16;}
  }
  sparkle(x,y){this.sparkles[this.sparkleIndex].start(x,y);this.sparkleIndex=(this.sparkleIndex+1)%10;}
  tick(input={}){
    this.frame++;this.commands=[];this.outputs=[];
    const taps=input.tap?[input.tap]:[];
    for(const p of taps){this.replay.push({frame:this.frame,type:'tap',x:I(p.x),y:I(p.y)});this.pointer(I(p.x),I(p.y));}
    const touches=input.touches??[];
    // Delays subtract 30 per frame, not the 15 used by sprite animations.
    for(let i=0;i<50;i++)if(this.events[i].delay>0){this.events[i].delay-=30;if(this.events[i].delay<=0)this.event(this.events[i].id);}
    this.draw(this.background,0,0,1,0,undefined,undefined,'background');
    this.land-=this.speed;if(this.land<=-24)this.land=0;
    if(!this.bird.idle)this.movePipes();
    this.bird.tick();
    if(this.menu){
      this.draw('title',55,150);this.bird.x=134;this.bird.y=218;this.bird.draw(this);this.draw('land',this.land,400,1,0,undefined,undefined,'land');
    }else{
      this.collisions();
      if(this.hidden<=0){
        // Keep all three pipes in the render list, even while off-screen.
        // This gives the interpolator a stable identity before a pipe enters the viewport.
        for(let i=0;i<3;i++){const p=this.pipes[i];const id=p.rid??`slot${i}`;this.draw('pipe_up',p.x,p.y,1,0,undefined,undefined,`pipe-${id}-up`);this.draw('pipe_down',p.x,p.y-416,1,0,undefined,undefined,`pipe-${id}-down`);}
      }
      if(this.panel.active&&this.panel.stage===2&&!this.play.active){this.play.show(20,340);this.scores.show(152,340);}
      if(this.over.active)this.over.tick(this);else this.bigNumber(this.score);
      this.bird.draw(this);this.draw('land',this.land,400,1,0,undefined,undefined,'land');
    }
    if(this.ready.active)this.ready.tick(this);
    if(this.menu)this.draw('brand_copyright',81,418);
    if(this.play.active){
      this.play.tick(touches);this.play.draw(this);this.scores.tick(touches);this.scores.draw(this);
      if(this.play.released){this.replay.push({frame:this.frame,type:'play'});this.transition(true,5,.5);this.emit('sound','swooshing');}
      if(this.scores.released){this.emit('local-scores',Math.max(this.best,this.score));this.emit('sound','swooshing');}
      if(this.rate.active){this.rate.tick(touches);this.rate.draw(this);if(this.rate.released)this.emit('about',null);}
    }
    this.panel.tick(this);
    // Pool updates occur before tween overlays and draw after the score panel.
    const start=this.commands.length;
    for(const sparkle of this.sparkles)sparkle.tick(this);
    const particleCommands=this.commands.splice(start);
    if(!this.fade.done||this.fade.value!==0){this.fade.tick();if(this.fade.done)this.event(this.fadeEvent);}
    if(!this.flash.done||this.flash.value!==0)this.flash.tick();
    this.panel.draw(this);this.commands.push(...particleCommands);
    if(!this.fade.done||this.fade.value!==0)this.draw('black',-144,-256,this.fade.value,0,864,1536);
    if(!this.flash.done||this.flash.value!==0)this.draw('white',-144,-256,this.flash.value,0,864,1536);
    for(const output of this.outputs)this.onEvent(output);
    return this.commands;
  }
  get state(){return this.menu?'MENU':this.over.active?'GAME_OVER':this.speed===0?'DYING':this.bird.idle?'READY':'PLAYING';}
  snapshot(){return {
    frame:this.frame,state:this.state,seed:this.seed,score:this.score,best:this.best,hidden:this.hidden,land:this.land,speed:this.speed,
    bird:{x:this.bird.x,y:this.bird.y,velocity:this.bird.velocity,gravity:this.bird.gravity,rotation:this.bird.rotation,rotationSpeed:this.bird.rotationSpeed,bob:this.bird.bob,phase:this.bird.phase,color:this.bird.color,idle:this.bird.idle,dead:this.bird.dead,animation:this.bird.animation.frame},
    pipes:this.pipes.map(p=>({x:p.x,y:p.y})),rng:{y:this.random.y,z:this.random.z},
    panel:{active:this.panel.active,stage:this.panel.stage,score:this.panel.score??0,y:this.panel.y??504,medal:this.panel.medal},
    ready:{active:this.ready.active,stage:this.ready.stage},fade:this.fade.value,flash:this.flash.value,
  };}
}
