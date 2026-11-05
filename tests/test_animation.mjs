// Canvas/controller checks without browser automation or a Pyodide download.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {frameStates, populations} from '../web/playback.mjs';
const ids = new Set([...readFileSync('index.html','utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
const app = readFileSync('web/app.js','utf8');
for (const match of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.has(match[1]), `Missing element ${match[1]}`);
const elements = new Map([...ids].map(id=>[id, {hidden:false,textContent:'',value:'',setAttribute(key,value){this[key]=value;}}]));
for(let i=0;i<3;i++) elements.set(`count-${i}`,{textContent:''});
let points=[], clock=0;
const canvas = {scale(){},clearRect(){points=[];},fillRect(x,y,w,h){points.push([x,y,w,h]);}};
elements.get('particles').getContext=()=>canvas;
const context=vm.createContext({
  document:{getElementById:id=>elements.get(id),querySelectorAll:()=>[]},
  frameStates,populations,performance:{now:()=>clock},
  requestAnimationFrame:()=>1,cancelAnimationFrame(){},
  matchMedia:()=>({matches:false}),
});
let source=app.replace(/^import[^\n]+\n/,'').replaceAll('import.meta.url', "'https://example.test/web/app.js'");
source=source.slice(0,source.indexOf("$('preset').addEventListener"));
vm.runInContext(source, context);
assert.equal(vm.runInContext('playbackSpeed',context),0.5,'Default playback speed should be 0.5×');
vm.runInContext(`
  matrix=[[.5,.25,.25],[0,1,0],[0,0,1]]; transient=[0]; positions=[[100,100],[300,100],[500,100]];
  activeConfig={num_runs:4}; lastResult={}; totalFrames=3;
  chunks=[{offset:0,count:4,frameCount:3,states:Uint8Array.from([0,0,0,0,1,2,0,0,1,2,2,2])}];
  replay();
`,context);
assert.equal(points.length,4,'Every run should be drawn in the same frame');
assert.match(elements.get('count-0').textContent,/4 · 100/);
vm.runInContext('prepareFrame(2); drawPoints(0);',context);
assert.equal(points.length,4,'Completed trajectories must remain visible');
assert.match(elements.get('count-1').textContent,/1 · 25/);
assert.match(elements.get('count-2').textContent,/3 · 75/);
assert.match(elements.get('path-note').textContent,/4 \/ 4 exited/);
assert.ok(points[0][0]>=248 && points[0][0]<275,'State B strip should occupy 25% of its 100-unit track');
for(const point of points.slice(1)) assert.ok(point[0]>=448 && point[0]<525,'State C strip should occupy 75% of its track');
for(const point of points) assert.ok(point[1]>144 && point[1]<158,'Points should collect below states, not in rings');
vm.runInContext('stopAnimation(false); tick(5000);',context);
assert.equal(points.length,4,'Pause should preserve the frame');
vm.runInContext('replay();',context);
assert.match(elements.get('count-0').textContent,/4 · 100/);
// Changing speed advances from the same playhead, without resampling or restart.
elements.get('speed').value='0';
vm.runInContext('setPlaybackSpeed(); tick(100);',context);
assert.equal(vm.runInContext('elapsed',context),25);
assert.equal(elements.get('speed-value').textContent,'0.25×');
clock=100;
elements.get('speed').value='3';
vm.runInContext('setPlaybackSpeed();',context);
assert.equal(vm.runInContext('elapsed',context),25,'Speed changes must not move the playhead');
vm.runInContext('tick(200);',context);
assert.equal(vm.runInContext('elapsed',context),225);
assert.equal(elements.get('speed')['aria-valuetext'],'2 times speed');
vm.runInContext('paused=true; tick(300);',context);
assert.equal(vm.runInContext('elapsed',context),225,'Pause must hold at any speed');
vm.runInContext('replay();',context);
assert.equal(vm.runInContext('playbackSpeed',context),2,'Replay should retain the selected rate');
vm.runInContext('stopAnimation();',context);
assert.equal(points.length,0,'Invalidating a run should clear the canvas');

// A large population must fill the interior of the strip instead of its perimeter.
vm.runInContext(`
  activeConfig={num_runs:10000}; totalFrames=1;
  chunks=[{offset:0,count:10000,frameCount:1,states:new Uint8Array(10000)}];
  replay();
`,context);
assert.equal(points.length,10000);
const interior=points.filter(([x,y,w,h])=>x+w/2>75 && x+w/2<125 && y+h/2>149 && y+h/2<155).length;
assert.ok(interior>2200 && interior<2800,`Filled strip expected; found ${interior} points in the central quarter`);
console.log('Animation controller: filled population strips, simultaneous points, counts, live speed changes, pause, replay, and page bindings passed.');
