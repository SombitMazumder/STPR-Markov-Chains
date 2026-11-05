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
"""

import argparse
import json
from numbers import Integral

import numpy as np


class MarkovChain:
    def __init__(self, transition_matrix, transient, recurrent, labels=None, seed=10):
        self.P = np.array(transition_matrix, dtype=float, copy=True)
        if self.P.ndim != 2 or self.P.shape[0] != self.P.shape[1]:
            raise ValueError("Transition matrix must be square.")
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
        if self.P.ndim != 2 or self.P.shape[0] != self.P.shape[1]:
            raise ValueError("Transition matrix must be square.")
        if not np.all(np.isfinite(self.P)) or np.any(self.P < 0):
            raise ValueError("Transition probabilities must be finite and nonnegative.")
        row_sums = self.P.sum(axis=1)
        if not np.allclose(row_sums, 1.0, rtol=0, atol=1e-10):
            raise ValueError("Each row of the transition matrix must sum to 1.")
        self.P /= row_sums[:, None]  # Remove only negligible rounding error.
        if len(self.labels) != self.n:
            raise ValueError("Number of labels must match number of states.")

        for states in (self.transient, self.recurrent):
            if any(not isinstance(s, Integral) or isinstance(s, (bool, np.bool_)) for s in states):
                raise ValueError("State indices must be integers.")
            if len(states) != len(set(states)):
                raise ValueError("State classifications must not contain duplicates.")
        t, r = set(self.transient), set(self.recurrent)
        if t & r:
            raise ValueError(f"States in both classes: {sorted(t & r)}")
        if t | r != set(range(self.n)):
            raise ValueError("Every state must be classified as transient or recurrent.")
        if not t or not r:
            raise ValueError("Need at least one transient and one recurrent/absorbing state.")

        # The recurrent set must be closed: no probability leaks back to transient.
        leak = self.P[np.ix_(self.recurrent, self.transient)]
        if np.any(leak > 0):
            raise ValueError("Recurrent states can move to transient states, so they are not closed.")

        # Reachability identifies closed communicating classes without SciPy.
        reachable = (self.P > 0) | np.eye(self.n, dtype=bool)
        for k in range(self.n):
            reachable |= reachable[:, k, None] & reachable[None, k, :]
        for s in self.recurrent:
            if np.any(reachable[s] & ~reachable[:, s]):
                raise ValueError(f"State {s} is not recurrent: it can leave its communicating class.")
        if not np.all(reachable[np.ix_(self.transient, self.recurrent)].any(axis=1)):
            raise ValueError("Some declared transient states cannot reach the recurrent set.")

    
    def simulate(self, start, num_runs, max_steps=1_000_000):
        """
        Run num_runs independent trajectories from `start` (a transient state),
        each stopping on first entry to the recurrent set.

        Returns (absorbed_in, exit_steps), arrays of length num_runs:
          absorbed_in[k] - first recurrent state reached by run k
          exit_steps[k]  - number of steps taken to get there
        """
        if not isinstance(start, Integral) or isinstance(start, (bool, np.bool_)) or start not in self.t_index:
            raise ValueError(f"Start state {start} is not a transient state.")
        if not isinstance(num_runs, Integral) or isinstance(num_runs, (bool, np.bool_)) or num_runs < 2:
            raise ValueError("num_runs must be an integer of at least 2 (for standard error).")
        if not isinstance(max_steps, Integral) or isinstance(max_steps, (bool, np.bool_)) or max_steps < 1:
            raise ValueError("max_steps must be a positive integer.")

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
                raise RuntimeError("max_steps reached before all runs exited; increase the step limit or revise the matrix. No incomplete estimate is reported.")

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
        if not isinstance(start, Integral) or isinstance(start, (bool, np.bool_)) or start not in self.t_index:
            raise ValueError(f"Start state {start} is not a transient state.")
        Q = self.P[np.ix_(self.transient, self.transient)]
        S = self.P[np.ix_(self.transient, self.recurrent)]
        # Solve the fundamental-matrix equations without explicitly inverting.
        solutions = np.linalg.solve(np.eye(len(self.transient)) - Q,
                                    np.column_stack((S, np.ones(len(self.transient)))))
        B, t = solutions[:, :-1], solutions[:, -1]
        k = self.t_index[start]
        return B[k], t[k]


def report(chain, start, dist_emp, mean_emp, se_emp, dist_th, mean_th, num_runs):
    print(f"Start state: {chain.labels[start]}   Runs: {num_runs}\n")
    print("Distribution of the first recurrent/absorbing state reached:")
    print(f"{'Entry state':<14}{'Empirical':>12}{'Theoretical':>14}{'|Diff|':>10}")
    for s, e, t in zip(chain.recurrent, dist_emp, dist_th):
        print(f"{chain.labels[s]:<14}{e:>12.5f}{t:>14.5f}{abs(e - t):>10.5f}")
    print(f"\nMean exit time  empirical: {mean_emp:.4f} (+/- {1.96 * se_emp:.4f}, 95% CI)")
    print(f"Mean exit time  theoretical: {mean_th:.4f}")
    inside = abs(mean_emp - mean_th) <= 1.96 * se_emp
    print(f"Theoretical value inside the 95% CI: {inside}")


def main():
    # Example: states 0-2 transient; 3 is absorbing; 4 and 5 form a recurrent
    # class with transitions between its members (not individually absorbing).
    labels = ["A", "B", "C", "D(abs)", "E(rec)", "F(rec)"]
    P = np.array([
        [0.2, 0.4, 0.1, 0.2, 0.1, 0.0],
        [0.3, 0.1, 0.3, 0.0, 0.1, 0.2],
        [0.0, 0.3, 0.3, 0.1, 0.0, 0.3],
        [0.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 0.0, 0.5, 0.5],
        [0.0, 0.0, 0.0, 0.0, 0.7, 0.3],
    ])
    transient = [0, 1, 2]
    recurrent = [3, 4, 5]
    start = 0
    num_runs = 200_000

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", help="JSON file containing transition_matrix, transient, recurrent, start; optionally labels, num_runs, seed, max_steps.")
    args = parser.parse_args()
    config = {}
    if args.config:
        with open(args.config, encoding="utf-8") as file:
            config = json.load(file)
        for key in ("transition_matrix", "transient", "recurrent", "start"):
            if key not in config:
                parser.error(f"Configuration is missing '{key}'.")
        P, transient, recurrent, start = (config[key] for key in
                                         ("transition_matrix", "transient", "recurrent", "start"))
        labels = config.get("labels")
        num_runs = config.get("num_runs", num_runs)

    chain = MarkovChain(P, transient, recurrent, labels=labels, seed=config.get("seed", 10))
    absorbed_in, exit_steps = chain.simulate(start, num_runs, config.get("max_steps", 1_000_000))
    dist_emp, mean_emp, se_emp = chain.empirical_results(absorbed_in, exit_steps)
    dist_th, mean_th = chain.theoretical_results(start)
    report(chain, start, dist_emp, mean_emp, se_emp, dist_th, mean_th, num_runs)


if __name__ == "__main__":
    main()
