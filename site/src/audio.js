const NAMES=['wing','point','hit','die','swooshing'];
export class Audio {
  constructor(){this.raw=new Map();this.buffers=new Map();this.context=null;this.muted=false;this.error=null;}
  async preload(){
    await Promise.all(NAMES.map(async name=>{
      const response=await fetch(new URL(`../assets/sounds/sfx_${name}.wav`,import.meta.url));
      if(!response.ok)throw new Error(`Son ${name} : HTTP ${response.status}`);
      this.raw.set(name,await response.arrayBuffer());
    }));
  }
  unlock(){
    if(!this.context){
      const Type=window.AudioContext||window.webkitAudioContext;
      if(!Type){this.error='Web Audio indisponible';return;}
      this.context=new Type();
      this.decoding=Promise.all([...this.raw].map(async([name,raw])=>{
        this.buffers.set(name,await this.context.decodeAudioData(raw.slice(0)));
      })).catch(error=>{this.error=error.message;});
    }
    // Must run synchronously within the user's gesture, before any await.
    if(this.context.state==='suspended')this.context.resume().catch(error=>{this.error=error.message;});
  }
  play(name){
    if(this.muted||!this.context||this.context.state!=='running')return;
    const buffer=this.buffers.get(name);if(!buffer)return;
    const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);source.start();
  }
}
