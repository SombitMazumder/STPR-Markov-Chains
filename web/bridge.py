"""Browser adapter: estimates and animation share the same simulated runs."""
import base64
import json
import numpy as np
from dtmc import MarkovChain

PLAYBACK_STEPS = 200


def begin_experiment(config_json):
    global chain, config, outcomes, times, exact_dist, exact_mean
    config = json.loads(config_json)
    chain = MarkovChain(config['transition_matrix'], config['transient'],
                        config['recurrent'], labels=config['labels'], seed=config['seed'])
    if chain.n > 256:
        raise ValueError('Browser playback supports at most 256 states.')
    exact_dist, exact_mean = chain.theoretical_results(config['start'])
    outcomes, times = [], []


def simulate_batch(size):
    frames = []

    def record(step, states):
        if step <= PLAYBACK_STEPS:
            frames.append(states.astype(np.uint8))

    absorbed, steps = chain.simulate(config['start'], size, config['max_steps'], on_step=record)
    outcomes.append(absorbed)
    times.append(steps)
    # One byte per trajectory per frame; cap playback memory, not simulation time.
    return json.dumps({'count': size, 'frameCount': len(frames),
                       'states': base64.b64encode(np.stack(frames).tobytes()).decode('ascii')})


def finish_experiment():
    dist, mean, se = chain.empirical_results(np.concatenate(outcomes), np.concatenate(times))
    return json.dumps({'empirical': dist.tolist(), 'theoretical': exact_dist.tolist(),
                       'mean': float(mean), 'exactMean': float(exact_mean), 'se': float(se),
                       'runs': int(sum(len(x) for x in times))})
