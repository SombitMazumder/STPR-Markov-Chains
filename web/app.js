import {frameStates, populations} from './playback.mjs';
const $ = id => document.getElementById(id);
const presets = {
  original: {matrix: [[.2,.4,.1,.2,.1,0],[.3,.1,.3,0,.1,.2],[0,.3,.3,.1,0,.3],[0,0,0,1,0,0],[0,0,0,0,.5,.5],[0,0,0,0,.7,.3]], transient: [0,1,2], start: 0},
  coin: {matrix: [[.5,.2,.3],[0,1,0],[0,0,1]], transient: [0], start: 0},
  walk: {matrix: [[1,0,0,0,0],[.5,0,.5,0,0],[0,.5,0,.5,0],[0,0,.5,0,.5],[0,0,0,0,1]], transient: [1,2,3], start: 2}
};
let matrix, transient, selected = 0, worker, running = false, lastResult, chunks = [], positions = [], animationId, activeConfig;
let totalFrames = 0, frameIndex = 0, elapsed = 0, lastTick = 0, paused = true;
let fromStates, toStates, offsetX, offsetY, startX, startY, endX, endY;
const playbackSpeeds = [0.25, 0.5, 1, 2];
let playbackSpeed = playbackSpeeds[1];
const canvas = $('particles'), context = canvas.getContext('2d');
canvas.width = 1520; canvas.height = 860; context.scale(2, 2);
const label = i => String.fromCharCode(65 + i);
const percent = x => `${(100*x).toFixed(2)}%`;
const number = x => Number(x).toLocaleString(undefined, {maximumFractionDigits: 4});
const svgNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}
function invalidate() {
  lastResult = null; chunks = []; totalFrames = 0; frameIndex = 0; stopAnimation();
  $('results').hidden = true;
  $('download').disabled = true; $('replay').disabled = true;
  $('error').hidden = true; $('status').textContent = 'Settings changed.';
  $('progress').hidden = true;
  $('path-note').textContent = '';
  document.querySelectorAll('.node-count').forEach(el => el.textContent = '');
  document.querySelectorAll('.population-track').forEach(el => el.setAttribute('hidden', ''));
}
function loadPreset(name) {
  const preset = presets[name];
  if (!preset) { $('matrix-details').open = true; return; }
  matrix = structuredClone(preset.matrix); transient = [...preset.transient]; selected = preset.start;
  $('state-count').value = matrix.length;
  invalidate(); renderEditor(); $('start').value = preset.start; renderGraph();
}
function custom() { $('preset').value = 'custom'; }
function renderEditor() {
  const table = $('matrix'); table.replaceChildren();
  const head = document.createElement('thead'); const hr = document.createElement('tr');
  for (const name of ['from / to', ...matrix.map((_, i) => label(i)), 'sum']) { const th = document.createElement('th'); th.textContent = name; hr.append(th); }
  head.append(hr); table.append(head);
  const body = document.createElement('tbody');
  matrix.forEach((row, i) => {
    const tr = document.createElement('tr'); const th = document.createElement('th'); th.scope = 'row'; th.textContent = label(i); tr.append(th);
    row.forEach((value, j) => {
      const td = document.createElement('td'), input = document.createElement('input');
      input.type = 'number'; input.min = 0; input.max = 1; input.step = 'any'; input.value = value;
      input.setAttribute('aria-label', `Probability from ${label(i)} to ${label(j)}`);
      input.addEventListener('input', () => { matrix[i][j] = input.value === '' ? NaN : Number(input.value); custom(); invalidate(); rowTotal(i); renderGraph(); });
      td.append(input); tr.append(td);
    });
    const total = document.createElement('td'); total.id = `sum-${i}`; total.className = 'row-total'; tr.append(total); body.append(tr);
  }); table.append(body); matrix.forEach((_, i) => rowTotal(i));
  $('classifications').replaceChildren();
  matrix.forEach((_, i) => {
    const wrap = document.createElement('label'); wrap.append(`${label(i)} `);
    const select = document.createElement('select'); select.setAttribute('aria-label', `State ${label(i)} classification`);
    select.add(new Option('Transient', 'transient')); select.add(new Option('Recurrent', 'recurrent'));
    select.value = transient.includes(i) ? 'transient' : 'recurrent';
    select.addEventListener('change', () => { transient = transient.filter(s => s !== i); if (select.value === 'transient') transient.push(i); transient.sort((a,b) => a-b); custom(); invalidate(); updateStart(); renderGraph(); });
    wrap.append(select); $('classifications').append(wrap);
  }); updateStart();
}
function rowTotal(i) {
  const sum = matrix[i].reduce((a,b) => a+b, 0); const cell = $(`sum-${i}`);
  cell.textContent = Number.isFinite(sum) ? number(sum) : '—';
  cell.classList.toggle('invalid', !Number.isFinite(sum) || Math.abs(sum-1) > 1e-10);
}
function updateStart() {
  const before = Number($('start').value); $('start').replaceChildren();
  transient.forEach(i => $('start').add(new Option(label(i), i)));
  if (transient.includes(before)) $('start').value = before;
}
function isAbsorbing(i) { return matrix[i][i] === 1 && matrix[i].every((p,j) => j === i || p === 0); }
function renderGraph() {
  const graph = $('graph'); graph.replaceChildren();
  const defs = svg('defs'), marker = svg('marker', {id:'arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:5,markerHeight:5,orient:'auto-start-reverse'});
  marker.append(svg('path', {d:'M 0 0 L 10 5 L 0 10 z',fill:'#8c9c80'})); defs.append(marker); graph.append(defs);
  const n = matrix.length;
  positions = matrix.map((_,i) => {
    if (n === 6) return [[145,120],[310,215],[145,320],[580,100],[600,255],[450,340]][i];
    const angle = -Math.PI/2 + i*2*Math.PI/n;
    return [380 + 245*Math.cos(angle), 215 + 120*Math.sin(angle)];
  });
  const edgeGroup = svg('g'), labels = svg('g'); graph.append(edgeGroup,labels);
  matrix.forEach((row,i) => row.forEach((p,j) => {
    if (!(p > 0)) return;
    const [x,y] = positions[i], [tx,ty] = positions[j]; let d, lx, ly;
    if (i === j) { d = `M ${x-18} ${y-26} C ${x-65} ${y-94}, ${x+65} ${y-94}, ${x+18} ${y-26}`; lx=x; ly=y-77; }
    else {
      const dx=tx-x, dy=ty-y, length=Math.hypot(dx,dy), ux=dx/length, uy=dy/length;
      const bend = matrix[j][i] > 0 ? 23 : 8;
      const cx=(x+tx)/2-uy*bend, cy=(y+ty)/2+ux*bend;
      d=`M ${x+ux*34} ${y+uy*34} Q ${cx} ${cy} ${tx-ux*36} ${ty-uy*36}`;
      lx=(x+tx)/2-uy*bend/2; ly=(y+ty)/2+ux*bend/2-5;
    }
    edgeGroup.append(svg('path',{d,class:`edge ${i===selected?'selected':''}`,'marker-end':'url(#arrow)'}));
    if (i===selected) labels.append(svg('text',{x:lx,y:ly,'text-anchor':'middle',class:'edge-label'},Number(p.toFixed(3))));
  }));
  matrix.forEach((_,i) => {
    const [x,y]=positions[i], isT=transient.includes(i), absorbing=isAbsorbing(i);
    const group=svg('g',{class:`node ${i===selected?'selected':''}`,transform:`translate(${x},${y})`,tabindex:0,role:'button','aria-label':`State ${label(i)}, ${isT?'transient':absorbing?'absorbing':'recurrent'}. Inspect outgoing transitions.`});
    group.append(svg('circle',{r:31,fill:isT?'#dbe6d5':absorbing?'#f5dac5':'#e5dff0'}));
    if (absorbing) group.append(svg('circle',{r:26,fill:'none',style:'stroke:#bc9479;stroke-width:.7'}));
    group.append(svg('text',{'text-anchor':'middle',y:9},label(i)));
    if (i===Number($('start').value)) group.append(svg('text',{'text-anchor':'middle',y:23,class:'node-caption'},'START'));
    const track=svg('rect', {x:-50, y:44, width:100, height:16, rx:2, class:'population-track'});
    if (!lastResult) track.setAttribute('hidden', '');
    group.append(track);
    group.append(svg('text', {'text-anchor':'middle', y:80, class:'node-count', id:`count-${i}`}));
    const inspect=()=>{selected=i; renderGraph();};
    group.addEventListener('click',inspect); group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect();}}); graph.append(group);
  });
  if (lastResult && fromStates) updateCounts(fromStates, frameIndex);
  $('inspector').textContent = `${label(selected)} → ` + matrix[selected].map((p,j)=>p>0?`${label(j)} (${number(p)})`:null).filter(Boolean).join(' · ');
}
function stopAnimation(clear = true) {
  cancelAnimationFrame(animationId); paused = true;
  $('pause').hidden = true;
  if (clear) { context.clearRect(0, 0, 760, 430); fromStates = null; toStates = null; }
}
function updateCounts(states, step) {
  const counts = populations(states, matrix.length), total = activeConfig.num_runs;
  let exited = 0;
  counts.forEach((count, state) => {
    const text = $(`count-${state}`);
    if (text) text.textContent = `${count.toLocaleString()} · ${(100*count/total).toFixed(1)}%`;
    if (!transient.includes(state)) exited += count;
  });
  const capped = step === totalFrames - 1 && exited < total;
  $('path-note').textContent = `Step ${step} · ${exited.toLocaleString()} / ${total.toLocaleString()} exited${capped ? ' · 200-step playback limit' : ''}`;
}
function prepareFrame(step) {
  frameIndex = step;
  fromStates = frameStates(chunks, step, activeConfig.num_runs);
  toStates = frameStates(chunks, Math.min(step + 1, totalFrames - 1), activeConfig.num_runs);
  const before = populations(fromStates, matrix.length), after = populations(toStates, matrix.length);
  const total = activeConfig.num_runs;
  for (let i=0; i<total; i++) {
    const from=fromStates[i], to=toStates[i];
    // Filled point strips: their length is the fraction of runs in the state.
    // Independent coordinates avoid the angle/radius correlation that made rings.
    const width0=100*before[from]/total, width1=100*after[to]/total;
    startX[i]=positions[from][0]-50+offsetX[i]*width0; startY[i]=positions[from][1]+46+offsetY[i]*12;
    endX[i]=positions[to][0]-50+offsetX[i]*width1; endY[i]=positions[to][1]+46+offsetY[i]*12;
  }
  updateCounts(fromStates, step);
}
function drawPoints(fraction) {
  context.clearRect(0, 0, 760, 430);
  const t = fraction*fraction*(3-2*fraction), total = activeConfig.num_runs;
  context.fillStyle = total > 10000 ? 'rgba(55,83,61,.22)' : 'rgba(55,83,61,.55)';
  const size = total > 10000 ? 1.2 : total > 1000 ? 1.8 : 3;
  for (let i = 0; i < total; i++) {
    context.fillRect(startX[i]+(endX[i]-startX[i])*t-size/2, startY[i]+(endY[i]-startY[i])*t-size/2, size, size);
  }
}
function tick(now) {
  if (paused) return;
  // Throttle drawing for large ensembles; every trajectory is still drawn.
  const interval = activeConfig.num_runs > 50000 ? 100 : 33;
  if (now-lastTick < interval) { animationId=requestAnimationFrame(tick); return; }
  elapsed += Math.min(now-lastTick, 150)*playbackSpeed; lastTick = now;
  const position = Math.max(0, (elapsed-450)/650);
  const step = Math.min(Math.floor(position), totalFrames-1);
  if (step !== frameIndex) prepareFrame(step);
  drawPoints(step === totalFrames-1 ? 0 : position-step);
  if (step === totalFrames-1) { stopAnimation(false); return; }
  animationId=requestAnimationFrame(tick);
}
function scatterCoordinate(value) {
  // Deterministic independent scatter; does not affect simulation randomness.
  value=Math.imul(value^(value>>>16), 0x21f0aaad);
  value=Math.imul(value^(value>>>15), 0x735a2d97);
  return ((value^(value>>>15))>>>0)/4294967296;
}
function setPlaybackSpeed() {
  const index=Number($('speed').value);
  if (!Number.isInteger(index) || index<0 || index>=playbackSpeeds.length) return;
  const value=playbackSpeeds[index];
  playbackSpeed=value;
  $('speed-value').textContent=`${value}×`;
  $('speed').setAttribute('aria-valuetext', `${value} times speed`);
  // Keep the current playhead; apply the new rate only to future frames.
  lastTick=performance.now();
}
function replay() {
  if (!lastResult || !chunks.length) return;
  stopAnimation();
  const total=activeConfig.num_runs;
  offsetX=new Float32Array(total); offsetY=new Float32Array(total);
  startX=new Float32Array(total); startY=new Float32Array(total); endX=new Float32Array(total); endY=new Float32Array(total);
  for (let i=0;i<total;i++) {
    offsetX[i]=scatterCoordinate(i*2+1);
    offsetY[i]=scatterCoordinate(i*2+2);
  }
  document.querySelectorAll('.population-track').forEach(el => el.removeAttribute('hidden'));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    prepareFrame(totalFrames-1); drawPoints(0); return;
  }
  elapsed=0; lastTick=performance.now(); paused=false;
  prepareFrame(0); drawPoints(0);
  $('pause').hidden=false; $('pause').textContent='Pause';
  animationId=requestAnimationFrame(tick);
}
function boundedInteger(id,min,max,name) {
  const value=Number($(id).value);
  if($(id).value.trim() === ""||!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be an integer from ${min.toLocaleString()} to ${max.toLocaleString()}.`);
  return value;
}
function readConfig() {
  if(!transient.length||transient.length===matrix.length)throw new Error('Choose at least one transient and one recurrent state.');
  matrix.forEach((row,i)=>{
    if(row.some(p=>!Number.isFinite(p)||p<0||p>1))throw new Error(`Row ${label(i)}: probabilities must be numbers between 0 and 1.`);
    if(Math.abs(row.reduce((a,b)=>a+b,0)-1)>1e-10)throw new Error(`Row ${label(i)} must add up to 1.`);
  });
  return {transition_matrix:structuredClone(matrix),transient:[...transient],recurrent:matrix.map((_,i)=>i).filter(i=>!transient.includes(i)),labels:matrix.map((_,i)=>label(i)),start:Number($('start').value),num_runs:boundedInteger('runs',2,200000,'Trajectories'),seed:boundedInteger('seed',0,4294967295,'Seed'),max_steps:boundedInteger('limit',1,1000000,'Step limit')};
}
function setRunning(value) {
  running=value; $('settings').disabled=value; $('cancel').hidden=!value;
  document.querySelectorAll('.matrix-body input,.matrix-body select,.matrix-body button').forEach(el=>el.disabled=value);
  $('run').textContent=value?'Running…':'Run';
}
function showError(message) {
  const lines=message.split('\n').filter(Boolean); $('error').textContent=lines.at(-1); $('error').hidden=false;
  $('status').textContent='Simulation stopped. Check the settings and try again.'; $('progress').hidden=true;
  stopAnimation(); chunks=[]; $('replay').disabled=true; $('path-note').textContent=''; setRunning(false);
}
function run() {
  if(running)return; invalidate();
  try {activeConfig=readConfig();}catch(error){showError(error.message);return;}
  setRunning(true); $('status').textContent='Preparing simulation…'; $('progress').hidden=false; $('progress').value=0;
  if(!worker) {
    worker=new Worker(new URL('./worker.js',import.meta.url));
    worker.onerror=()=>{showError('The Python worker could not start. Check your connection and reload the page.');worker?.terminate();worker=null;};
    worker.onmessage=({data})=>{
      if(data.type==='status')$('status').textContent=data.message;
      if(data.type==='frames'){chunks.push(data);totalFrames=Math.max(totalFrames,data.frameCount);}
      if(data.type==='progress'){$('progress').value=data.done/data.total;$('status').textContent=`${data.done.toLocaleString()} / ${data.total.toLocaleString()} trajectories complete`;}
      if(data.type==='error'){showError(data.message);worker?.terminate();worker=null;}
      if(data.type==='result'){lastResult={config:activeConfig,...data.result};renderResults(lastResult);setRunning(false);$('status').textContent=`Complete · ${data.result.runs.toLocaleString()} independent trajectories`;$('progress').value=1;$('replay').disabled=false;replay();}
    };
  }
  worker.postMessage(activeConfig);
}
function renderResults(result) {
  $('results').hidden=false; $('download').disabled=false;
  $('result-rows').replaceChildren();
  result.config.recurrent.forEach((state,i)=>{
    const e=result.empirical[i], t=result.theoretical[i], tr=document.createElement('tr');
    [label(state),percent(e),percent(t),`${(Math.abs(e-t)*100).toFixed(3)} pp`].forEach(text=>{const td=document.createElement('td');td.textContent=text;tr.append(td);});
    $('result-rows').append(tr);
  });
  $('mean').textContent=result.mean.toFixed(3); $('exact-mean').textContent=number(result.exactMean);
  const half=1.96*result.se;
  $('interval').textContent=`${number(result.mean-half)} – ${number(result.mean+half)}`;
}
$('preset').addEventListener('change',e=>loadPreset(e.target.value));
$('start').addEventListener('change',()=>{invalidate();selected=Number($('start').value);renderGraph();});
for(const id of ['runs','seed','limit'])$(id).addEventListener('input',invalidate);
$('resize').addEventListener('click',()=>{
  try {
    const n=boundedInteger('state-count',2,12,'State count');
    if(!confirm(`Create a fresh ${n}-state matrix? This replaces the current matrix and classifications.`))return;
    matrix=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===n-1?Number(i===j):(j===i||j===i+1?.5:0)));
    transient=Array.from({length:n-1},(_,i)=>i);selected=0;custom();invalidate();renderEditor();$('start').value=0;renderGraph();
  }catch(error){showError(error.message);}
});
$('run').addEventListener('click',run);
$('cancel').addEventListener('click',()=>{worker?.terminate();worker=null;invalidate();setRunning(false);$('status').textContent='Cancelled. No incomplete estimates were reported.';});
$('replay').addEventListener('click',replay);
$('speed').addEventListener('input',setPlaybackSpeed);
$('pause').addEventListener('click',()=>{
  paused=!paused; $('pause').textContent=paused?'Resume':'Pause';
  if (paused) cancelAnimationFrame(animationId);
  else {lastTick=performance.now(); animationId=requestAnimationFrame(tick);}
});
$('download').addEventListener('click',()=>{
  if(!lastResult)return;
  const blob=new Blob([JSON.stringify(lastResult,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='markov-chain-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
loadPreset('original');$('status').textContent='Ready.';
