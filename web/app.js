const $ = id => document.getElementById(id);
const presets = {
  original: {note: 'Three transient states, one absorbing destination, and a recurrent pair.', matrix: [[.2,.4,.1,.2,.1,0],[.3,.1,.3,0,.1,.2],[0,.3,.3,.1,0,.3],[0,0,0,1,0,0],[0,0,0,0,.5,.5],[0,0,0,0,.7,.3]], transient: [0,1,2], start: 0},
  coin: {note: 'Wait in A, then leave for B or C. A geometric waiting time with two destinations.', matrix: [[.5,.2,.3],[0,1,0],[0,0,1]], transient: [0], start: 0},
  walk: {note: 'A symmetric random walk. The two shores, A and E, are absorbing.', matrix: [[1,0,0,0,0],[.5,0,.5,0,0],[0,.5,0,.5,0],[0,0,.5,0,.5],[0,0,0,0,1]], transient: [1,2,3], start: 2}
};
let matrix, transient, selected = 0, worker, running = false, lastResult, paths = [], positions = [], animationId, animationVersion = 0, activeConfig;
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
  lastResult = null; paths = []; stopAnimation();
  $('results').hidden = true; $('empty-results').hidden = false;
  $('download').disabled = true; $('replay').disabled = true;
  $('error').hidden = true; $('status').textContent = 'Setup changed. Ready for a new experiment.';
  $('progress').hidden = true;
  $('path-note').textContent = 'Each arrow is a possible next step. Its weight is a probability.';
}
function loadPreset(name) {
  const preset = presets[name];
  if (!preset) { $('matrix-details').open = true; return; }
  matrix = structuredClone(preset.matrix); transient = [...preset.transient]; selected = preset.start;
  $('preset-note').textContent = preset.note; $('state-count').value = matrix.length;
  invalidate(); renderEditor(); $('start').value = preset.start; renderGraph();
}
function custom() { $('preset').value = 'custom'; $('preset-note').textContent = 'Your rules, your random walk. Adjust the matrix and classifications below.'; }
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
    if (n === 6) return [[155,130],[315,205],[155,300],[580,90],[580,220],[490,340]][i];
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
    if (i===Number($('start').value)) group.append(svg('text',{'text-anchor':'middle',y:50,class:'node-caption'},'START'));
    const inspect=()=>{selected=i; stopAnimation(); renderGraph();};
    group.addEventListener('click',inspect); group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect();}}); graph.append(group);
  });
  $('map-tag').textContent = `${n} STATES`;
  $('inspector').textContent = `${label(selected)} → ` + matrix[selected].map((p,j)=>p>0?`${label(j)} (${number(p)})`:null).filter(Boolean).join(' · ');
}
function stopAnimation() { animationVersion++; cancelAnimationFrame(animationId); document.querySelector('.traveler')?.remove(); }
async function replay() {
  if (!paths.length) return; stopAnimation();
  const version=animationVersion, dot=svg('circle',{r:8,class:'traveler'}); $('graph').append(dot);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (let p=0;p<paths.length;p++) {
    const path=paths[p];
    for (let step=0;step<path.length;step++) {
      if(version!==animationVersion) return;
      const [x,y]=positions[path[step]], [sx,sy]=positions[path[Math.max(0,step-1)]];
      const duration=reduced?70:360, begin=performance.now();
      await new Promise(resolve=>{
        function frame(now) {
          if(version!==animationVersion) {resolve();return;}
          const t=Math.min(1,(now-begin)/duration), ease=t*t*(3-2*t);
          dot.setAttribute('cx',sx+(x-sx)*ease);dot.setAttribute('cy',sy+(y-sy)*ease);
          if(t<1) animationId=requestAnimationFrame(frame);else resolve();
        } animationId=requestAnimationFrame(frame);
      });
      if(version!==animationVersion) return;
      const ended=step===path.length-1;
      const suffix=ended?(transient.includes(path[step])?' · preview capped at 200 steps':' · left the transient set'):'';
      $('path-note').textContent=`Sample ${p+1} / ${paths.length} · step ${step} · ${path.slice(Math.max(0,step-9),step+1).map(label).join(' → ')}${suffix}`;
    }
  }
  dot.remove();
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
  $('run').innerHTML=value?'Running… <span>↗</span>':'Run experiment <span>↗</span>';
}
function showError(message) {
  const lines=message.split('\n').filter(Boolean); $('error').textContent=lines.at(-1); $('error').hidden=false;
  $('status').textContent='Experiment stopped. Check the setup and try again.'; $('progress').hidden=true;
  stopAnimation(); paths=[]; $('replay').disabled=true; setRunning(false);
}
function run() {
  if(running)return; invalidate();
  try {activeConfig=readConfig();}catch(error){showError(error.message);return;}
  setRunning(true); $('status').textContent='Preparing the experiment…'; $('progress').hidden=false; $('progress').value=0;
  if(!worker) {
    worker=new Worker(new URL('./worker.js',import.meta.url));
    worker.onerror=()=>{showError('The Python worker could not start. Check your connection and reload the page.');worker?.terminate();worker=null;};
    worker.onmessage=({data})=>{
      if(data.type==='status')$('status').textContent=data.message;
      if(data.type==='preview'){paths=data.paths;$('replay').disabled=false;replay();}
      if(data.type==='progress'){$('progress').value=data.done/data.total;$('status').textContent=`${data.done.toLocaleString()} / ${data.total.toLocaleString()} trajectories complete`;}
      if(data.type==='error'){showError(data.message);worker?.terminate();worker=null;}
      if(data.type==='result'){lastResult={config:activeConfig,...data.result};renderResults(lastResult);setRunning(false);$('status').textContent=`Complete · ${data.result.runs.toLocaleString()} independent trajectories`;$('progress').value=1;}
    };
  }
  worker.postMessage(activeConfig);
}
function renderResults(result) {
  $('empty-results').hidden=true;$('results').hidden=false;$('download').disabled=false;
  $('result-caption').textContent=`${result.runs.toLocaleString()} trajectories · starting at ${label(result.config.start)} · seed ${result.config.seed}. Sample-path playback uses a separate random stream.`;
  $('bars').replaceChildren();$('result-rows').replaceChildren();
  result.config.recurrent.forEach((state,i)=>{
    const e=result.empirical[i], t=result.theoretical[i];
    const row=document.createElement('div');row.className='bar-row';
    row.innerHTML=`<span class="bar-name">${label(state)}</span><div class="bar-tracks"><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,Math.min(100,e*100))}%"></div></div><div class="bar-track"><div class="bar-fill theory" style="width:${Math.max(0,Math.min(100,t*100))}%"></div></div></div><span class="bar-value">${percent(e)}<small>${percent(t)}</small></span>`;
    $('bars').append(row);
    const tr=document.createElement('tr');
    [label(state),percent(e),percent(t),`${(Math.abs(e-t)*100).toFixed(3)} pp`].forEach(text=>{const td=document.createElement('td');td.textContent=text;tr.append(td);});$('result-rows').append(tr);
  });
  $('mean').textContent=result.mean.toFixed(3);$('exact-mean').textContent=`${number(result.exactMean)} steps`;
  const half=1.96*result.se;
  $('interval').textContent=`${number(result.mean-half)} – ${number(result.mean+half)}`;
  $('ci-note').textContent=(Math.abs(result.mean-result.exactMean)<=half?'The exact mean lies inside this interval.':'The exact mean lies outside this interval; sampling variation can do this.')+' This is an approximate uncertainty estimate.';
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
$('download').addEventListener('click',()=>{
  if(!lastResult)return;
  const blob=new Blob([JSON.stringify(lastResult,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='wandering-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
loadPreset('original');$('status').textContent='Ready when you are.';
