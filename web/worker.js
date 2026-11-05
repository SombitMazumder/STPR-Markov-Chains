/* Python runs off the UI thread. Terminating this worker also cancels a run. */
let runtime;
async function initialize() {
  self.postMessage({type: 'status', message: 'Loading Python & NumPy… first visit may take a moment.'});
  importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js');
  const py = await loadPyodide({indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'});
  await py.loadPackage('numpy');
  const sources = await Promise.all(['../dtmc.py', './bridge.py'].map(async path => {
    const response = await fetch(new URL(path, self.location.href));
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
    return response.text();
  }));
  py.FS.writeFile('/home/pyodide/dtmc.py', sources[0]);
  await py.runPythonAsync(sources[1]);
  return py;
}
self.onmessage = async ({data: config}) => {
  try {
    runtime ||= initialize();
    const py = await runtime;
    py.globals.set('config_json', JSON.stringify(config));
    const preview = JSON.parse(await py.runPythonAsync('begin_experiment(config_json)'));
    self.postMessage({type: 'preview', ...preview});
    let done = 0;
    while (done < config.num_runs) {
      let size = Math.min(1000, config.num_runs - done);
      if (config.num_runs - done - size === 1) size--;
      py.globals.set('batch_size', size);
      await py.runPythonAsync('simulate_batch(batch_size)');
      done += size;
      self.postMessage({type: 'progress', done, total: config.num_runs});
    }
    const result = JSON.parse(await py.runPythonAsync('finish_experiment()'));
    self.postMessage({type: 'result', result});
  } catch (error) {
    self.postMessage({type: 'error', message: error.message || String(error)});
  }
};
