// Fixed 60 Hz simulation clock, independent from display refresh rate.
// The simulation remains faithful to the original tick-based game while the
// renderer can interpolate between the two latest states to hide rAF jitter.
export class FixedClock {
  constructor(hz=60,maxCatchUp=5){
    this.period=1000/hz;
    this.maxCatchUp=maxCatchUp;
    this.last=null;
    this.accumulator=0;
  }
  reset(){this.last=null;this.accumulator=0;}
  steps(now){
    if(this.last===null){this.last=now;return 0;}
    let elapsed=now-this.last;
    this.last=now;
    if(elapsed<0)elapsed=0;
    if(elapsed>250)elapsed=250;
    this.accumulator+=elapsed;
    let steps=0;
    while(this.accumulator+1e-7>=this.period&&steps<this.maxCatchUp){
      this.accumulator-=this.period;
      steps++;
    }
    if(steps===this.maxCatchUp&&this.accumulator>=this.period){
      this.accumulator%=this.period;
    }
    return steps;
  }
  alpha(){
    if(this.period<=0)return 0;
    return Math.max(0,Math.min(1,this.accumulator/this.period));
  }
}
