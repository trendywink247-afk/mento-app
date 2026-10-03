import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "classifier", Path(__file__).resolve().parents[2] / "deploy/classify-crisis-health.py"
)
classifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(classifier)


class CrisisMonitorTests(unittest.TestCase):
    def test_expected_health_and_idle(self):
        for response in ('{"status":"ok"}\n200', '{"status":"stale"}\n503'):
            self.assertTrue(classifier.acceptable(response))

    def test_fail_closed(self):
        for response in (
            '{"status":"degraded"}\n503', '{"status":"ok"}\n500',
            '{"status":"stale"}\n200', '{}\n200', '[]\n200',
            '<html>error</html>\n503', '', '{"status":null}\n200',
            '{"status":{}}\n200',
        ):
            with self.subTest(response=response):
                self.assertFalse(classifier.acceptable(response))
