"""Browser adapter: dtmc.py remains the simulation and theory engine."""
import json
import numpy as np
from dtmc import MarkovChain


def begin_experiment(config_json):
    global chain, config, outcomes, times, exact_dist, exact_mean
    config = json.loads(config_json)
    chain = MarkovChain(config['transition_matrix'], config['transient'],
                        config['recurrent'], labels=config['labels'], seed=config['seed'])
    exact_dist, exact_mean = chain.theoretical_results(config['start'])
    outcomes, times = [], []
    # A separate stream keeps illustrative paths independent of the estimates.
    preview_rng = np.random.default_rng(config['seed'] + 1)
    paths = []
    for _ in range(8):
        state = config['start']
        path = [state]
        for _ in range(min(config['max_steps'], 200)):
            state = int(preview_rng.choice(chain.n, p=chain.P[state]))
            path.append(state)
            if state in chain.r_index:
                break
        paths.append(path)
    return json.dumps({'paths': paths})


def simulate_batch(size):
    absorbed, steps = chain.simulate(config['start'], size, config['max_steps'])
    outcomes.append(absorbed)
    times.append(steps)


def finish_experiment():
    dist, mean, se = chain.empirical_results(np.concatenate(outcomes), np.concatenate(times))
    return json.dumps({'empirical': dist.tolist(), 'theoretical': exact_dist.tolist(),
                       'mean': float(mean), 'exactMean': float(exact_mean), 'se': float(se),
                       'runs': int(sum(len(x) for x in times))})
