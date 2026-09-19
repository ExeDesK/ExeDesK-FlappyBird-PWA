// Service worker logic in an in-memory harness. NOT a browser installation test.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../site/',import.meta.url));
const source=readFileSync(path.join(root,'sw.js'),'utf8');
function harness(scope='https://example.invalid/lab/flappy/'){
  const listeners={},stores=new Map();let offline=false,failPath='',network=0,claimed=false,skipped=false;
  async function fetchFile(request){
    network++;if(offline)throw new Error('Offline');
    const u=new URL(typeof request==='string'?request:request.url);
    if(u.pathname.endsWith(failPath)&&failPath)throw new Error('Simulated missing asset');
    const rel=u.pathname.slice(new URL(scope).pathname.length)||'index.html';
    const file=path.join(root,rel);if(!existsSync(file))return new Response('404',{status:404});
    return new Response(readFileSync(file));
  }
  class MemoryCache{
    constructor(){this.store=new Map();}
    async match(request){return this.store.get(typeof request==='string'?request:request.url)?.clone();}
    async put(request,response){this.store.set(typeof request==='string'?request:request.url,response.clone());}
    async addAll(requests){const values=await Promise.all(requests.map(async r=>{const response=await fetchFile(r);if(!response.ok)throw new Error('Bad response');return[r,response];}));for(const [r,v]of values)await this.put(r,v);}
  }
  const caches={async open(name){if(!stores.has(name))stores.set(name,new MemoryCache());return stores.get(name);},async keys(){return[...stores.keys()];},async delete(name){return stores.delete(name);}};
  const self={registration:{scope},location:new URL(scope+'sw.js'),clients:{async claim(){claimed=true;}},skipWaiting(){skipped=true;},addEventListener(type,fn){listeners[type]=fn;}};
  vm.runInNewContext(source,{self,caches,URL,Request,Response,fetch:fetchFile,Set});
  async function event(type,data={}){let work=Promise.resolve();listeners[type]({...data,waitUntil(p){work=p;}});await work;}
  async function get(url){let work;listeners.fetch({request:new Request(url),respondWith(p){work=p;}});return work?await work:null;}
  async function verify(){let result;await event('message',{data:{type:'VERIFY_CACHE'},ports:[{postMessage(data){result=data;}}]});return result;}
  return {event,get,verify,caches,stores,setOffline:v=>offline=v,setFail:v=>failPath=v,get network(){return network;},get claimed(){return claimed;},get skipped(){return skipped;},scope};
}
test('All 28 runtime resources are cached together, including sounds and icons',async()=>{
 const h=harness();await h.event('install');const s=await h.verify();assert.equal(s.complete,true);assert.equal(s.count,28);assert.equal(h.skipped,false);await h.event('activate');assert.equal(h.claimed,true);
});
test('After install, navigation/modules/atlas/audio return from cache with network unavailable',async()=>{
 const h=harness();await h.event('install');await h.event('activate');h.setOffline(true);const before=h.network;
 for(const rel of ['?seed=42','index.html?debug=1','src/game.js','assets/atlas.png','assets/sounds/sfx_wing.wav','icons/icon-512.png']){
  const r=await h.get(h.scope+rel);assert.equal(r.status,200,rel);assert.ok((await r.arrayBuffer()).byteLength>0);
 }assert.equal(h.network,before);
});
test('A missing precache asset rejects installation rather than claiming offline readiness',async()=>{
 const h=harness();h.setFail('sfx_wing.wav');await assert.rejects(()=>h.event('install'));assert.equal(h.stores.size,0);
});
test('Activation removes only obsolete caches of the same app scope',async()=>{
 const h=harness();const prefix='flappy13-'+encodeURIComponent(h.scope)+'-';
 await h.caches.open(prefix+'old');await h.caches.open('another-application');
 await h.event('install');await h.event('activate');assert.equal(h.stores.has(prefix+'old'),false);assert.equal(h.stores.has('another-application'),true);
});
test('Unsupported routes and external origins are not intercepted',async()=>{
 const h=harness();await h.event('install');assert.equal(await h.get('https://another.invalid/x.js'),null);assert.equal(await h.get(h.scope+'not-a-game-file'),null);
});
test('Activation of a waiting update requires an explicit message',async()=>{
 const h=harness();await h.event('install');assert.equal(h.skipped,false);await h.event('message',{data:{type:'ACTIVATE_UPDATE'}});assert.equal(h.skipped,true);
});
test('A cache completeness request reports an evicted asset',async()=>{
 const h=harness();await h.event('install');const cache=[...h.stores.values()][0];cache.store.delete(h.scope+'assets/atlas.png');const result=await h.verify();assert.equal(result.complete,false);assert.equal(result.missing.length,1);
});
