import base64
import json
import unittest
from pathlib import Path
import numpy as np
from dtmc import MarkovChain


class MarkovChainTests(unittest.TestCase):
    def test_known_geometric_chain(self):
        chain = MarkovChain([[.5,.2,.3],[0,1,0],[0,0,1]], [0], [1,2], seed=42)
        dist, mean = chain.theoretical_results(0)
        np.testing.assert_allclose(dist, [.4,.6])
        self.assertAlmostEqual(mean, 2)
        outcomes, times = chain.simulate(0, 20000)
        empirical, observed_mean, se = chain.empirical_results(outcomes, times)
        np.testing.assert_allclose(empirical, dist, atol=.02)
        self.assertLess(abs(observed_mean - mean), 5*se)

    def test_reordered_states_and_step_count(self):
        chain = MarkovChain([[1,0,0],[1,0,0],[0,1,0]], [2,1], [0])
        outcomes, times = chain.simulate(2, 10)
        np.testing.assert_array_equal(outcomes, np.zeros(10))
        np.testing.assert_array_equal(times, np.full(10, 2))
        self.assertEqual(chain.theoretical_results(2)[1], 2)

    def test_nonabsorbing_recurrent_class(self):
        chain = MarkovChain([[0,.25,.75],[0,0,1],[0,1,0]], [0], [1,2])
        np.testing.assert_allclose(chain.theoretical_results(0)[0], [.25,.75])

    def test_rejects_bad_classifications(self):
        bad = [([[0,1],[0,1]], [0], [1,1]),
               ([[0,1],[0,1]], [0.0], [1]),
               ([[0,1],[0,1]], [False], [1]),
               ([[0,1,0],[0,0,1],[0,0,1]], [0], [1,2]),
               ([[1,0],[0,1]], [0], [1]),
               ([[0,1],[1,0]], [0], [1])]
        for args in bad:
            with self.subTest(args=args), self.assertRaises(ValueError):
                MarkovChain(*args)

    def test_matrix_validation_and_rounding(self):
        for matrix in [1, [1,0], [[.5,.500001],[0,1]], [[float('nan'),1],[0,1]], [[-.1,1.1],[0,1]]]:
            with self.subTest(matrix=matrix), self.assertRaises(ValueError):
                MarkovChain(matrix, [0], [1])
        matrix = np.array([[.5,.500000000001],[0,1]])
        before = matrix.copy()
        MarkovChain(matrix,[0],[1]).simulate(0,10)
        np.testing.assert_array_equal(matrix, before)

    def test_arguments_and_step_limit(self):
        chain = MarkovChain([[0,1,0],[0,0,1],[0,0,1]], [0,1], [2])
        for count in [0,1,-1,2.5,True]:
            with self.subTest(count=count), self.assertRaises(ValueError):
                chain.simulate(0,count)
        for limit in [0,-1,1.5,True]:
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                chain.simulate(0,10,limit)
        with self.assertRaises(RuntimeError):
            chain.simulate(0,10,max_steps=1)
        for start in [2,.5,False]:
            with self.subTest(start=start), self.assertRaises(ValueError):
                chain.theoretical_results(start)

    def test_browser_adapter_calls_shared_engine(self):
        namespace = {}
        exec(Path('web/bridge.py').read_text(), namespace)
        config = json.loads(Path('example.json').read_text())
        namespace['begin_experiment'](json.dumps(config))
        packets = [json.loads(namespace['simulate_batch'](size)) for size in (1000, 2)]
        recorded_outcomes = []
        for packet in packets:
            frames = np.frombuffer(base64.b64decode(packet['states']), dtype=np.uint8).reshape(packet['frameCount'], packet['count'])
            np.testing.assert_array_equal(frames[0], np.zeros(packet['count']))
            recorded_outcomes.append(frames[-1])
            # Exited trajectories must stay at their first entry state.
            for previous, current in zip(frames, frames[1:]):
                exited = previous != 0
                np.testing.assert_array_equal(previous[exited], current[exited])
        result = json.loads(namespace['finish_experiment']())
        self.assertEqual(result['runs'],1002)
        self.assertAlmostEqual(sum(result['empirical']),1)
        self.assertEqual(result['exactMean'],2)
        final = np.concatenate(recorded_outcomes)
        np.testing.assert_allclose(result['empirical'], [(final == s).mean() for s in config['recurrent']])

    def test_observer_does_not_change_simulation(self):
        matrix = [[.5,.2,.3],[0,1,0],[0,0,1]]
        expected = MarkovChain(matrix, [0], [1,2], seed=17).simulate(0, 50)
        frames = []
        actual = MarkovChain(matrix, [0], [1,2], seed=17).simulate(
            0, 50, on_step=lambda step, states: frames.append(states.copy()))
        for a, b in zip(expected, actual):
            np.testing.assert_array_equal(a, b)
        np.testing.assert_array_equal(frames[-1], actual[0])
        for run, exit_step in enumerate(actual[1]):
            self.assertEqual(frames[exit_step - 1][run], 0)
            self.assertEqual(frames[exit_step][run], actual[0][run])

    def test_playback_cap_does_not_truncate_estimates(self):
        namespace = {}
        exec(Path('web/bridge.py').read_text(), namespace)
        # A deterministic chain that takes 202 steps to exit.
        n = 203
        matrix = np.zeros((n,n))
        for state in range(n):
            matrix[state, min(state + 1, n - 1)] = 1
        config = {'transition_matrix':matrix.tolist(), 'transient':list(range(n-1)),
                  'recurrent':[n-1], 'labels':[str(i) for i in range(n)],
                  'start':0, 'seed':10, 'max_steps':300, 'num_runs':2}
        namespace['begin_experiment'](json.dumps(config))
        packet = json.loads(namespace['simulate_batch'](2))
        self.assertEqual(packet['frameCount'], 201)
        frames = np.frombuffer(base64.b64decode(packet['states']), dtype=np.uint8).reshape(201,2)
        np.testing.assert_array_equal(frames[-1], [200,200])
        result = json.loads(namespace['finish_experiment']())
        self.assertEqual(result['mean'], 202)
        self.assertEqual(result['empirical'], [1.0])


if __name__ == '__main__':
    unittest.main()
