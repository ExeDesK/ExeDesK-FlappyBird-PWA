export class PerfProfiler {
  constructor(windowMs=10000){
    this.windowMs=windowMs;
    this.active=false;
    this.startedAt=0;
    this.lastRaf=null;
    this.samples=[];
    this.steps=[];
    this.renderTimes=[];
    this.result=null;
  }
  start(now=performance.now()){
    this.active=true;
    this.startedAt=now;
    this.lastRaf=null;
    this.samples.length=0;
    this.steps.length=0;
    this.renderTimes.length=0;
    this.result=null;
  }
  frame(now,steps,renderMs){
    if(!this.active)return null;
    if(this.lastRaf!==null)this.samples.push(now-this.lastRaf);
    this.lastRaf=now;
    this.steps.push(steps);
    this.renderTimes.push(renderMs);
    if(now-this.startedAt>=this.windowMs){this.result=this.finish(now);return this.result;}
    return null;
  }
  finish(now=performance.now()){
    if(!this.active&&this.result)return this.result;
    this.active=false;
    const deltas=this.samples.slice().sort((a,b)=>a-b);
    const renders=this.renderTimes.slice().sort((a,b)=>a-b);
    const sum=a=>a.reduce((n,v)=>n+v,0);
    const pct=(a,p)=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*p))]:0;
    const totalMs=Math.max(1,now-this.startedAt);
    const frames=this.samples.length;
    const result={
      durationMs:totalMs,
      frames,
      rafFps:frames*1000/totalMs,
      deltaAvg:frames?sum(this.samples)/frames:0,
      deltaP50:pct(deltas,.50),deltaP95:pct(deltas,.95),deltaP99:pct(deltas,.99),deltaMax:deltas.at(-1)??0,
      over20:this.samples.filter(v=>v>20).length,
      over25:this.samples.filter(v=>v>25).length,
      over33:this.samples.filter(v=>v>33.34).length,
      renderAvg:this.renderTimes.length?sum(this.renderTimes)/this.renderTimes.length:0,
      renderP95:pct(renders,.95),renderMax:renders.at(-1)??0,
      steps0:this.steps.filter(v=>v===0).length,
      steps1:this.steps.filter(v=>v===1).length,
      steps2plus:this.steps.filter(v=>v>=2).length,
      maxSteps:this.steps.length?Math.max(...this.steps):0
    };
    this.result=result;
    return result;
  }
  format(r=this.result){
    if(!r)return 'Aucun profil disponible.';
    const pct=(n,d)=>d?Math.round(n*100/d):0;
    return [
      `Profil ${(r.durationMs/1000).toFixed(1)} s`,
      `rAF ${r.rafFps.toFixed(1)} fps`,
      `delta moy ${r.deltaAvg.toFixed(2)} ms | p95 ${r.deltaP95.toFixed(2)} | p99 ${r.deltaP99.toFixed(2)} | max ${r.deltaMax.toFixed(2)}`,
      `>20 ms ${r.over20} (${pct(r.over20,r.frames)}%) | >25 ms ${r.over25} | >33 ms ${r.over33}`,
      `render moy ${r.renderAvg.toFixed(2)} ms | p95 ${r.renderP95.toFixed(2)} | max ${r.renderMax.toFixed(2)}`,
      `ticks/rAF 0:${r.steps0} 1:${r.steps1} 2+:${r.steps2plus} | max ${r.maxSteps}`
    ].join('\n');
  }
}
