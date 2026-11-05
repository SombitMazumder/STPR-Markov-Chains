"""
Absorbing / transient analysis of a discrete-time Markov chain.

The user supplies the transition matrix and says which states are transient
and which are recurrent/absorbing. We then:
  1. simulate many independent trajectories from a chosen transient state,
     stopping each one the moment it leaves the transient set;
  2. estimate (a) the distribution of the first recurrent/absorbing state hit
     and (b) the mean number of steps needed to leave the transient set;
  3. compare both against exact answers from the fundamental matrix.

Theory (states ordered as transient T, recurrent R):
    P = [[Q, S],
         [0, *]]        Q = T->T block, S = T->R block
    N = (I - Q)^-1      expected visits to each transient state
    t = N @ 1           expected steps to leave T
    B = N @ S           B[i, j] = P(first recurrent state entered is j | start i)

The matrix, state classification, starting states and run count are read
from INPUT_FILE (a JSON file placed next to this script). The report for
every starting state, plus a summary table, is written to OUTPUT_FILE.
"""
from pathlib import Path
import json
import numpy as np


HERE = Path(__file__).resolve().parent
INPUT_FILE = HERE / "input.json"
OUTPUT_FILE = HERE / "output.txt"

class MarkovChain:
    def __init__(self, transition_matrix, transient, recurrent, labels=None, seed=10):
        self.P = np.asarray(transition_matrix, dtype=float)
        self.n = self.P.shape[0]
        self.transient = list(transient)
        self.recurrent = list(recurrent)
        self.labels = labels if labels is not None else [str(i) for i in range(self.n)]
        self.rng = np.random.default_rng(seed)
        self._validate()
        # Position of each state inside the transient / recurrent lists.
        self.t_index = {s: k for k, s in enumerate(self.transient)}
        self.r_index = {s: k for k, s in enumerate(self.recurrent)}

    def _validate(self):
        if self.P.ndim != 2 or self.P.shape[0] != self.P.shape[1] or self.P.shape[0] == 0:
            raise ValueError("Transition matrix must be non-empty and square.")
        if not np.all(np.isfinite(self.P)):
            raise ValueError("Transition matrix must contain finite values.")
        if np.any(self.P < 0):
            raise ValueError("Transition matrix has negative entries.")
        if not np.allclose(self.P.sum(axis=1), 1.0, atol=1e-10):
            raise ValueError("Each row of the transition matrix must sum to 1.")
        if len(self.labels) != self.n or len(set(self.labels)) != self.n:
            raise ValueError("Labels must be unique and match the number of states.")
        if not all(isinstance(s, (int, np.integer)) and not isinstance(s, (bool, np.bool_)) for s in self.transient + self.recurrent):
            raise ValueError("State indices must be integers.")
        if len(set(self.transient)) != len(self.transient) or len(set(self.recurrent)) != len(self.recurrent):
            raise ValueError("Duplicate state indices are not allowed.")
        if any(s < 0 or s >= self.n for s in self.transient + self.recurrent):
            raise ValueError("State indices must lie between 0 and n-1.")
        t, r = set(self.transient), set(self.recurrent)
        if t & r:
            raise ValueError(f"States in both classes: {sorted(t & r)}")
        if t | r != set(range(self.n)):
            raise ValueError("Every state must be classified as transient or recurrent.")
        if not t or not r:
            raise ValueError("Need at least one transient and one recurrent/absorbing state.")
        leak = self.P[np.ix_(self.recurrent, self.transient)]
        if np.any(leak > 1e-12):
            raise ValueError("Recurrent states can move to transient states, so they are not closed.")
        Q = self.P[np.ix_(self.transient, self.transient)]
        if np.max(np.abs(np.linalg.eigvals(Q))) >= 1 - 1e-12:
            raise ValueError("The transient set contains states that are not transient.")

    def simulate(self, start, num_runs, max_steps=1_000_000):
        """
        Run num_runs independent trajectories from `start` (a transient state),
        each stopping on first entry to the recurrent set.

        Returns (absorbed_in, exit_steps), arrays of length num_runs:
          absorbed_in[k] - first recurrent state reached by run k
          exit_steps[k]  - number of steps taken to get there
        """
        if start not in self.t_index:
            raise ValueError(f"Start state {start} is not a transient state.")
        is_recurrent = np.zeros(self.n, dtype=bool)
        is_recurrent[self.recurrent] = True
        current = np.full(num_runs, start, dtype=int)
        absorbed_in = np.full(num_runs, -1, dtype=int)
        exit_steps = np.zeros(num_runs, dtype=int)
        active = np.arange(num_runs)  # indices of runs still in the transient set
        step = 0
        while active.size > 0:
            step += 1
            if step > max_steps:
                raise RuntimeError("max_steps reached; check the transition matrix.")
            still_active = []
            for k in active:
                current[k] = self.rng.choice(self.n, p=self.P[current[k]])
                if is_recurrent[current[k]]:      # run k just left the transient set
                    absorbed_in[k] = current[k]
                    exit_steps[k] = step
                else:                             # still transient, keep simulating it
                    still_active.append(k)
            active = np.array(still_active, dtype=int)
        return absorbed_in, exit_steps

    def empirical_results(self, absorbed_in, exit_steps):
        counts = np.array([(absorbed_in == s).sum() for s in self.recurrent])
        dist = counts / len(absorbed_in)
        mean_exit = exit_steps.mean()
        std_err = exit_steps.std(ddof=1) / np.sqrt(len(exit_steps))
        return dist, mean_exit, std_err

    def theoretical_results(self, start):
        Q = self.P[np.ix_(self.transient, self.transient)]
        S = self.P[np.ix_(self.transient, self.recurrent)]
        N = np.linalg.inv(np.eye(len(self.transient)) - Q)  # fundamental matrix
        B = N @ S                                           # absorption probabilities
        t = N.sum(axis=1)                                   # expected exit times
        k = self.t_index[start]
        return B[k], t[k]


def report(chain, start, dist_emp, mean_emp, se_emp, dist_th, mean_th, num_runs):
    lines = []
    lines.append(f"Start state: {chain.labels[start]}   Runs: {num_runs}")
    lines.append("")
    lines.append(f"{'Final state':<14}{'Empirical':>12}{'Theoretical':>14}{'|Diff|':>10}")
    for s, e, t in zip(chain.recurrent, dist_emp, dist_th):
        lines.append(f"{chain.labels[s]:<14}{e:>12.5f}{t:>14.5f}{abs(e - t):>10.5f}")
    lines.append("")
    lines.append(f"Mean exit time  empirical: {mean_emp:.4f} (+/- {1.96 * se_emp:.4f}, 95% CI)")
    lines.append(f"Mean exit time  theoretical: {mean_th:.4f}")
    inside = abs(mean_emp - mean_th) <= 1.96 * se_emp
    lines.append(f"Theoretical value inside the 95% CI: {inside}")
    return "\n".join(lines)


def load_input(path):
    # Reading a JSON file that does not exist raises FileNotFoundError on its
    # own, with a clear message, so no extra error handling is added here.
    with open(path, "r") as f:
        cfg = json.load(f)
    return cfg


if __name__ == "__main__":
    cfg = load_input(INPUT_FILE)
    labels = cfg.get("labels")
    P = cfg["matrix"]
    transient = cfg["transient"]
    recurrent = cfg["recurrent"]
    starts = cfg["starts"]
    num_runs = cfg.get("num_runs", 200_000)
    seed = cfg.get("seed", 10)

    chain = MarkovChain(P, transient, recurrent, labels=labels, seed=seed)

    output_lines = []
    summary_rows = []
    for i, start in enumerate(starts):
        absorbed_in, exit_steps = chain.simulate(start, num_runs)
        dist_emp, mean_emp, se_emp = chain.empirical_results(absorbed_in, exit_steps)
        dist_th, mean_th = chain.theoretical_results(start)
        section = report(chain, start, dist_emp, mean_emp, se_emp, dist_th, mean_th, num_runs)
        print(f"--- Run {i + 1} of {len(starts)} ---")
        print(section)
        print()
        output_lines.append(f"--- Run {i + 1} of {len(starts)} ---")
        output_lines.append(section)
        output_lines.append("")
        inside = abs(mean_emp - mean_th) <= 1.96 * se_emp
        summary_rows.append((chain.labels[start], mean_emp, mean_th, inside))

    output_lines.append("Summary across all starting states (mean exit time)")
    output_lines.append(f"{'Start':<10}{'Empirical':>14}{'Theoretical':>14}{'In 95% CI':>12}")
    for label, mean_emp, mean_th, inside in summary_rows:
        output_lines.append(f"{label:<10}{mean_emp:>14.4f}{mean_th:>14.4f}{str(inside):>12}")

    with open(OUTPUT_FILE, "w") as f:
        f.write("\n".join(output_lines) + "\n")