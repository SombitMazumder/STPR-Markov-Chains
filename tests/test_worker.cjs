// Exercise worker orchestration without a browser or downloading Pyodide.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

async function check(runs, expected) {
  const messages = [], batches = [], globals = new Map(), fetched = [];
  const py = {
    globals: {set: (key,value) => globals.set(key,value)},
    FS: {writeFile: (path,source) => assert.equal(path,'/home/pyodide/dtmc.py')},
    loadPackage: async name => assert.equal(name,'numpy'),
    runPythonAsync: async source => {
      if(source === 'begin_experiment(config_json)') {
        assert.equal(JSON.parse(globals.get('config_json')).num_runs,runs);
        return;
      }
      if(source === 'simulate_batch(batch_size)') {
        const count=globals.get('batch_size'); assert.ok(count>=2); batches.push(count);
        return JSON.stringify({count,frameCount:2,states:Buffer.concat([Buffer.alloc(count,0),Buffer.alloc(count,1)]).toString('base64')});
      }
      if(source === 'finish_experiment()') return JSON.stringify({runs});
    }
  };
  const context = vm.createContext({
    self: {location:{href:'https://example.org/repository/web/worker.js'},postMessage:value=>messages.push(value)},
    URL, Uint8Array, atob, importScripts:()=>{}, loadPyodide:async()=>py,
    fetch:async url=>{fetched.push(String(url));return {ok:true,text:async()=>''};}
  });
  vm.runInContext(readFileSync('web/worker.js','utf8'),context);
  await context.self.onmessage({data:{num_runs:runs}});
  assert.deepEqual(batches,expected);
  assert.deepEqual(fetched,['https://example.org/repository/dtmc.py','https://example.org/repository/web/bridge.py']);
  const packets=messages.filter(m=>m.type==='frames');
  let offset=0;
  for (const packet of packets) {
    assert.equal(packet.offset,offset);
    assert.equal(packet.states.length,packet.count*2);
    assert.ok(packet.states.slice(0,packet.count).every(s=>s===0));
    assert.ok(packet.states.slice(packet.count).every(s=>s===1));
    offset+=packet.count;
  }
  assert.equal(offset,runs);
  assert.equal(messages.at(-1).type,'result');
  assert.equal(messages.at(-1).result.runs,runs);
  assert.equal(messages.filter(m=>m.type==='progress').at(-1).done,runs);
}
(async()=>{
  await check(2,[2]);
  await check(1000,[1000]);
  await check(1001,[999,2]);
  await check(2001,[1000,999,2]);
  console.log('Worker batching and repository-subpath source URLs: 4 cases passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
