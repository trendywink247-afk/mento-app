import unittest
from database_budget import budget


class DatabaseBudgetTests(unittest.TestCase):
    def calculate(self, **overrides):
        inputs = dict(api_processes=2, worker_processes=1, pool_size=10,
                      max_overflow=10, queue_pool=4, migration_connections=1,
                      reserved=3, headroom=5, max_connections=50)
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

    def test_unbounded_or_invalid_values_rejected(self):
        for change in ({"pool_size": 0}, {"max_overflow": -1}, {"headroom": -1}):
            with self.assertRaises(ValueError):
                self.calculate(**change)
