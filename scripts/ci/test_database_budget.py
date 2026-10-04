import unittest
from database_budget import aggregate_budget, budget


class DatabaseBudgetTests(unittest.TestCase):
    def calculate(self, **overrides):
        inputs = dict(api_processes=2, worker_processes=1, pool_size=10,
                      max_overflow=10, queue_pool=4, migration_connections=1,
                      reserved=3, headroom=5, max_connections=50, other_connections=0)
        return budget(**(inputs | overrides))

    def test_defaults_exceed_balanced_overlap_budget(self):
        result = self.calculate()
        self.assertEqual(result["required"], 73)
        self.assertFalse(result["fits"])

    def test_bounded_pools_fit(self):
        self.assertTrue(self.calculate(pool_size=5, max_overflow=5)["fits"])

    def test_worker_connector_and_boundary_counted(self):
        self.assertTrue(self.calculate(max_connections=73)["fits"])
        self.assertFalse(self.calculate(max_connections=72)["fits"])
        self.assertEqual(self.calculate(worker_processes=2)["required"], 97)

    def test_other_clients_consume_shared_server_budget(self):
        # Explicit illustrative allowance, not measured GlitchTip configuration.
        self.assertTrue(self.calculate(pool_size=5, max_overflow=5, other_connections=7)["fits"])
        self.assertFalse(self.calculate(pool_size=5, max_overflow=5, other_connections=8)["fits"])
        with self.assertRaises(ValueError):
            self.calculate(other_connections=-1)

    def test_unbounded_or_invalid_values_rejected(self):
        for change in ({"pool_size": 0}, {"max_overflow": -1}, {"headroom": -1}):
            with self.assertRaises(ValueError):
                self.calculate(**change)

    def test_asymmetric_old_new_and_worker_pools(self):
        result = aggregate_budget(pools=[
            dict(processes=2, pool_size=5, max_overflow=5, queue_pool=0),
            dict(processes=2, pool_size=5, max_overflow=0, queue_pool=0),
            dict(processes=1, pool_size=2, max_overflow=1, queue_pool=4),
        ], migration_connections=1, reserved=3, headroom=5,
            max_connections=50, other_connections=4)
        self.assertEqual(result["required"], 50)
        self.assertTrue(result["fits"])
