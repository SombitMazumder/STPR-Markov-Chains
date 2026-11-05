# Wandering — a Markov chain notebook

A static, interactive companion to `dtmc.py`. Edit a transition matrix, classify
states, choose a transient starting state, and compare independent simulated
trajectories with exact matrix solutions.

## Run the Python program

Requires Python 3.10+ and NumPy:

```sh
python3 -m pip install -r requirements.txt
python3 dtmc.py                       # Original six-state example, 200,000 runs
python3 dtmc.py --config example.json # User-defined example
python3 -m unittest discover -s tests -v
```

A JSON configuration requires `transition_matrix`, `transient`, `recurrent`, and
`start`. State indices are zero-based. Optional fields: `labels`, `num_runs`
(default 200,000), `seed` (default 10), `max_steps` (default 1,000,000).
`example.json` is a complete, editable example. At least two trajectories are
required to estimate the standard error.

The engine rejects duplicate/noninteger indices, inconsistent classifications,
invalid probabilities, and nonpositive step limits. Rows must sum to one within
an absolute tolerance of `1e-10`; only this small rounding discrepancy is
normalized. Recurrent states must belong to closed communicating classes, and
all transient states must be able to reach the recurrent set. A run exceeding
the step limit raises an error instead of silently biasing the estimates.

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
- Eight animated illustrative trajectories, capped at 200 steps for playback.
- First-entry distributions, absolute differences, mean exit time, and an
  approximate 95% confidence interval for the mean.
- Progress updates, cancellation, and downloadable JSON containing configuration
  and results.

The browser loads the **same `dtmc.py` file** through
[Pyodide 0.27.7](https://pyodide.org/en/0.27.7/usage/webworker.html), with NumPy in a
Web Worker. `web/bridge.py` adapts its output for the interface. The UI does not
reimplement the theoretical solution in JavaScript. Simulations run in batches
of up to 1,000 for progress reporting. Sample-path playback uses a separate
seeded random stream and is not included in the empirical estimates. Repeated
browser runs with identical settings reproduce results; batching means those
samples need not be identical to a single command-line simulation call.

The first experiment downloads Python and NumPy from jsDelivr, so an internet
connection is required and the first load can take time. Google Fonts supplies
the typefaces, with local serif/sans-serif fallbacks. Computation and experiment
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

`numpy.linalg.solve` avoids explicitly computing an inverse. The displayed
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

Browser visual and end-to-end verification was unavailable in the authoring
session; the local HTTP server and Python checks were verified.
