# Markov Chain Simulator

A static, interactive companion to `dtmc.py`. Edit a transition matrix, classify
states, choose a transient starting state, and compare independent simulated
trajectories with exact matrix solutions.

## Run the Python program

Requires Python 3.10+ and NumPy:

```sh
python3 -m pip install -r requirements.txt
python3 dtmc.py  # Reads input.json and writes output.txt next to the script
python3 -m unittest discover -s tests -v
```

Edit `input.json` to set `matrix`, `transient`, `recurrent`, and `starts`.
Optional fields are `labels`, `num_runs` (default 200,000), and `seed` (default 10).
State indices are zero-based. Use at least two runs to estimate the standard error.

`dtmc.py` follows `main.py`, with only an optional `on_step` callback added to
`simulate` for website animation. The command-line input, validation, calculations,
and reports follow `main.py` unchanged. Browser-specific handling stays in `web/`.

## Preview the website

Serve the repository root over HTTP (opening `index.html` as a `file://` URL does
not support the worker and source fetches):

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>. No npm dependencies, build step, or Python server
API is needed. The HTTP server only serves files.

The page offers:

- Three presets, an editable matrix, and user-selected classifications.
- 2–12 states, 2–200,000 trajectories, start state, seed, and step limit controls.
- A directed graph with outgoing probabilities on state selection.
- Concurrent playback of every simulated trajectory, with per-state counts and
  percentages, pause/resume, replay, and a live speed slider with 0.25×, 0.5×, 1×, and 2× options (default: 0.5×). Points remain at their first entry states.
  Points fill strips below each state; strip length is proportional to its population. Playback is capped at 200 steps; estimation
  continues beyond that cap up to the configured step limit.
- First-entry distributions, absolute differences, mean exit time, and an
  approximate 95% confidence interval for the mean.
- Progress updates, cancellation, and downloadable JSON containing configuration
  and results.

The browser loads the **same `dtmc.py` file** through
[Pyodide 0.27.7](https://pyodide.org/en/0.27.7/usage/webworker.html), with NumPy in a
Web Worker. `web/bridge.py` adapts its output for the interface. The UI does not
reimplement the theoretical solution in JavaScript. Simulations run in batches
of up to 1,000 for progress reporting. Playback records the actual runs through an optional `on_step` observer in
`MarkovChain.simulate`; it does not draw a separate sample. Each batch transfers
one byte per run per recorded step to the UI (up to about 40 MB for 200,000 runs
and 201 frames). Large ensembles render at a lower frame rate without omitting
trajectories. If some runs are still transient at step 200, the graph labels the
playback limit and retains their states at that step. Repeated
browser runs with identical settings reproduce results; batching means those
samples need not be identical to a single command-line simulation call.

The first experiment downloads Python and NumPy from jsDelivr, so an internet
connection is required and the first load can take time. The interface uses local system fonts. Computation and experiment
inputs stay in the browser; there is no application backend or analytics.

## Host on GitHub Pages

All asset URLs are relative, including the Python source fetch, so the site works
at a repository subpath such as `/STPR-Markov-Chains/`.

1. Commit and push these files to the branch you want to publish.
2. In the GitHub repository, open **Settings → Pages**.
3. Select **Deploy from a branch**, choose that branch and **/ (root)**, and save.
4. Open the URL GitHub reports after the deployment completes.

Keep `index.html`, `dtmc.py`, `.nojekyll`, and the `web/` directory together at the
published root. No build workflow is necessary. This change prepares the site;
it does not enable Pages or push to GitHub on your behalf.

## What does “ending up” mean?

Every trajectory stops on its **first entry into the recurrent/absorbing set**.
An absorbing state is a final destination. A nonabsorbing recurrent state may
continue moving within its closed class, so its reported probability is an
*entry-state probability*, not a long-run occupancy probability.

Writing `Q = P[T,T]` and `S = P[T,R]`, the exact first-entry probabilities and
expected exit times solve:

```text
(I - Q) B = S
(I - Q) t = 1
```

`numpy.linalg.inv` computes the fundamental matrix, as in `main.py`. The displayed
interval is `sample_mean ± 1.96 × sample_standard_error`, a large-sample normal
approximation. It is not a correctness test; with few runs or a long-tailed exit
time distribution it can be unreliable. Very slowly exiting chains may need a
larger step limit and can take substantial time to simulate.

## Verification

Automated checks cover known exact answers, stochastic estimates, step counting,
noncontiguous state ordering, nonabsorbing recurrent classes, invalid inputs,
step-limit failure, and the Python browser adapter. JavaScript syntax is checked
with `node --check web/app.js` and `node --check web/worker.js`.
Run `node tests/test_worker.cjs` for worker batching and repository-subpath URL
checks (mocked Python runtime; not a browser integration test).
`node tests/test_playback.mjs` checks concurrent state counts and completed runs;
`node tests/test_animation.mjs` checks all-points rendering and pause/replay with
a mocked canvas. Python tests also check recorded paths against the estimates
and verify that the playback cap does not truncate simulation results.

Browser visual and end-to-end verification was unavailable in the authoring
session; the local HTTP server and Python checks were verified.
