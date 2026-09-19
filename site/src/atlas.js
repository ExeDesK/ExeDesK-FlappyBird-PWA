import { F, SIN, COS } from './math.js';
export async function loadAtlas() {
  const [response,image]=await Promise.all([
    fetch(new URL('../assets/atlas.txt',import.meta.url)),
    new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Impossible de charger atlas.png'));i.src=new URL('../assets/atlas.png',import.meta.url);})
  ]);
  if(!response.ok)throw new Error(`Atlas : HTTP ${response.status}`);
  const sprites={};
  for(const line of (await response.text()).trim().split(/\r?\n/)){
    const [name,...values]=line.trim().split(/\s+/);const [w,h,u,v,uw,vh]=values.map(Number);
    if(values.length!==6 || values.some(x=>!Number.isFinite(Number(x))))throw new Error(`Ligne atlas invalide : ${name}`);
    // Pixel rectangles are exact integer regions; UV decimals encode float32 values.
    const x=Math.round(F(u)*image.width), y=Math.round(F(v)*image.height);
    if(x<0||y<0||x+w>image.width||y+h>image.height)throw new Error(`Sprite hors atlas : ${name}`);
    sprites[name]={name,w,h,x,y,u:F(u),v:F(v),u2:F(F(u)+F(uw)),v2:F(F(v)+F(vh))};
  }
  return {image,sprites};
}

export function lerp(a,b,t){return a+(b-a)*t;}
export function cyclicLerp(a,b,t,period){
  let delta=b-a;
  const half=period/2;
  if(delta>half)delta-=period;
  else if(delta<-half)delta+=period;
  let value=a+delta*t;
  while(value<=-period)value+=period;
  while(value>0)value-=period;
  return value;
}
export function previousFor(current,index,previous){
  if(current?.key){
    for(let i=0;i<previous.length;i++)if(previous[i]?.key===current.key)return previous[i];
    return null;
  }
  const p=previous[index];
  return p&&p.name===current.name?p:null;
}

export class Renderer {
  constructor(canvas,atlas) {
    this.canvas=canvas;this.atlas=atlas;this.ctx=canvas.getContext('2d',{alpha:false});
    if(!this.ctx)throw new Error('Canvas 2D indisponible');
    this.renderScale=2;this.topPad=0;this.bottomPad=0;this.adapted=false;
    this.updateCanvasDimensions();
  }
  get totalLogicalHeight(){return 512+this.topPad+this.bottomPad;}
  updateCanvasDimensions(){
    const s=this.renderScale;
    const width=288*s,height=Math.max(1,Math.round(this.totalLogicalHeight*s));
    if(this.canvas.width!==width)this.canvas.width=width;
    if(this.canvas.height!==height)this.canvas.height=height;
    this.ctx.imageSmoothingEnabled=false;
  }
  configureViewport({topPad=0,bottomPad=0,adapted=false,renderScale=this.renderScale}={}){
    const nextScale=Math.max(1,Math.min(3,Math.round(Number(renderScale)||1)));
    const nextTop=Math.max(0,Number(topPad)||0),nextBottom=Math.max(0,Number(bottomPad)||0);
    const changed=nextScale!==this.renderScale||Math.abs(nextTop-this.topPad)>1e-6||Math.abs(nextBottom-this.bottomPad)>1e-6||!!adapted!==this.adapted;
    this.renderScale=nextScale;this.topPad=nextTop;this.bottomPad=nextBottom;this.adapted=!!adapted;
    if(changed)this.updateCanvasDimensions();
    return changed;
  }
  setRenderScale(value){return this.configureViewport({topPad:this.topPad,bottomPad:this.bottomPad,adapted:this.adapted,renderScale:value});}
  gameIdentity(){
    const s=this.renderScale;
    this.ctx.setTransform(s,0,0,s,0,s*this.topPad);
  }
  canvasIdentity(){
    const s=this.renderScale;
    this.ctx.setTransform(s,0,0,s,0,0);
  }
  spriteTransform(x,y,angle,w,h){
    const c=this.ctx,s=this.renderScale,py=y+this.topPad;
    if(angle){
      const deg=((Math.round(angle)%360)+360)%360;
      c.setTransform(s*COS[deg],s*SIN[deg],-s*SIN[deg],s*COS[deg],s*(x+w/2),s*(py+h/2));
      return true;
    }
    c.setTransform(s,0,0,s,s*x,s*py);
    return false;
  }
  sceneBackground(commands){
    for(let i=0;i<commands.length;i++)if(commands[i]?.name==='bg_night')return 'bg_night';
    return 'bg_day';
  }
  clear(background='bg_day'){
    const c=this.ctx,total=this.totalLogicalHeight;
    this.canvasIdentity();c.globalAlpha=1;c.imageSmoothingEnabled=false;
    c.fillStyle='#000';c.fillRect(0,0,288,total);
    if(this.adapted){
      c.fillStyle=background==='bg_night'?'rgb(0, 135, 147)':'rgb(78, 192, 202)';
      if(this.topPad>0)c.fillRect(0,0,288,this.topPad+0.5);
      c.fillStyle='rgb(222, 216, 149)';
      if(this.bottomPad>0)c.fillRect(0,this.topPad+512-0.5,288,this.bottomPad+1);
    }
  }
  applyOverlays(fade,flash){
    const c=this.ctx,total=this.totalLogicalHeight;this.canvasIdentity();
    if(fade>0){c.globalAlpha=Math.min(1,fade);c.fillStyle='#000';c.fillRect(0,0,288,total);}
    if(flash>0){c.globalAlpha=Math.min(1,flash);c.fillStyle='#fff';c.fillRect(0,0,288,total);}
    c.globalAlpha=1;
  }
  withGameClip(fn){
    const c=this.ctx;this.canvasIdentity();c.save();c.beginPath();c.rect(0,this.topPad,288,512);c.clip();
    try{fn();}finally{c.restore();}
  }
  paintCommand(cmd,x=cmd.x,y=cmd.y,angle=cmd.angle,alphaValue=cmd.alpha){
    const c=this.ctx,s=this.atlas.sprites[cmd.name];if(!s)throw new Error(`Sprite absent : ${cmd.name}`);
    if(alphaValue<=0)return;
    const drawnAlpha=Math.min(1,alphaValue);c.globalAlpha=drawnAlpha;c.imageSmoothingEnabled=false;
    const w=cmd.w??s.w,h=cmd.h??s.h;
    const rotated=this.spriteTransform(x,y,angle,w,h);
    if(rotated)c.drawImage(this.atlas.image,s.x,s.y,s.w,s.h,-w/2,-h/2,w,h);
    else c.drawImage(this.atlas.image,s.x,s.y,s.w,s.h,0,0,w,h);
  }
  draw(commands,debugState=null) {
    this.clear(this.sceneBackground(commands));
    let fade=0,flash=0;
    for(const cmd of commands){if(cmd.name==='black')fade=Math.min(1,cmd.alpha);else if(cmd.name==='white')flash=Math.min(1,cmd.alpha);}
    // The game itself stays clipped to its original 288x512 viewport. Only
    // upper pipes may continue into the added sky above that viewport.
    this.withGameClip(()=>{for(const cmd of commands)if(cmd.name.startsWith('bg_'))this.paintCommand(cmd);});
    if(this.adapted)for(const cmd of commands)if(cmd.name==='pipe_down')this.paintCommand(cmd);
    this.withGameClip(()=>{for(const cmd of commands){
      if(cmd.name==='black'||cmd.name==='white'||cmd.name.startsWith('bg_')||(this.adapted&&cmd.name==='pipe_down'))continue;
      this.paintCommand(cmd);
    }});
    this.applyOverlays(fade,flash);
    if(debugState)this.drawDebug(debugState);
    return {fade,flash,background:this.sceneBackground(commands)};
  }
  drawDebug(debugState){
    const c=this.ctx,s=this.renderScale;
    this.withGameClip(()=>{
      this.gameIdentity();c.lineWidth=1/s;c.strokeStyle='#ff286b';
      c.strokeRect(debugState.bird.x+.5/s,debugState.bird.y+.5/s,20,20);
      c.strokeStyle='#00e5ff';
      if(debugState.hidden<=0)for(const p of debugState.pipes){
        c.strokeRect(p.x+.5/s,p.y+.5/s,52,320);
        c.strokeRect(p.x+.5/s,p.y-416+.5/s,52,320);
      }
      c.strokeStyle='#ffe600';c.beginPath();c.moveTo(0,400+.5/s);c.lineTo(288,400+.5/s);c.stroke();
    });
    c.globalAlpha=1;
  }
  drawInterpolated(previous,current,alpha,debugState=null) {
    if(!Array.isArray(previous)||!Array.isArray(current))return this.draw(current??[],debugState);
    const a=Math.max(0,Math.min(1,Number(alpha)||0));
    this.clear(this.sceneBackground(current));
    let fade=0,flash=0;
    const values=new Array(current.length);
    for(let i=0;i<current.length;i++){
      const cmd=current[i],prev=previousFor(cmd,i,previous),same=!!prev;
      const alphaValue=same&&Number.isFinite(prev.alpha)&&Number.isFinite(cmd.alpha)?lerp(prev.alpha,cmd.alpha,a):cmd.alpha;
      if(cmd.name==='black'){fade=Math.min(1,Math.max(0,alphaValue));values[i]=null;continue;}
      if(cmd.name==='white'){flash=Math.min(1,Math.max(0,alphaValue));values[i]=null;continue;}
      let x=cmd.x,y=cmd.y;
      if(same&&Number.isFinite(prev.x)&&Number.isFinite(cmd.x)){
        if(cmd.key==='land')x=cyclicLerp(prev.x,cmd.x,a,24);
        else if(cmd.key?.startsWith('pipe-')&&Math.abs(cmd.x-prev.x)>8)x=cmd.x;
        else x=lerp(prev.x,cmd.x,a);
      }
      if(same&&Number.isFinite(prev.y)&&Number.isFinite(cmd.y))y=lerp(prev.y,cmd.y,a);
      const angle=same&&Number.isFinite(prev.angle)&&Number.isFinite(cmd.angle)?lerp(prev.angle,cmd.angle,a):cmd.angle;
      values[i]={cmd,x,y,angle,alphaValue};
    }
    const paint=v=>{if(v)this.paintCommand(v.cmd,v.x,v.y,v.angle,v.alphaValue);};
    this.withGameClip(()=>{for(const v of values)if(v?.cmd.name.startsWith('bg_'))paint(v);});
    if(this.adapted)for(const v of values)if(v?.cmd.name==='pipe_down')paint(v);
    this.withGameClip(()=>{for(const v of values){
      if(!v||v.cmd.name.startsWith('bg_')||(this.adapted&&v.cmd.name==='pipe_down'))continue;
      paint(v);
    }});
    this.applyOverlays(fade,flash);
    if(debugState)this.drawDebug(debugState);
    return {fade,flash,background:this.sceneBackground(current)};
  }

}
