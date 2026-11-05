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
        preview = json.loads(namespace['begin_experiment'](json.dumps(config)))
        self.assertEqual(len(preview['paths']), 8)
        namespace['simulate_batch'](1000)
        namespace['simulate_batch'](2)
        result = json.loads(namespace['finish_experiment']())
        self.assertEqual(result['runs'],1002)
        self.assertAlmostEqual(sum(result['empirical']),1)
        self.assertEqual(result['exactMean'],2)


if __name__ == '__main__':
    unittest.main()
