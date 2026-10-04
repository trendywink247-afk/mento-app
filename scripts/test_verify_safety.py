"""Exercise only the pure staging assertion; never send messages or call helplines."""

import ast
from pathlib import Path
import unittest


source = Path(__file__).resolve().parents[1] / "deploy/staging/verify-safety.py"
tree = ast.parse(source.read_text(encoding="utf-8"))
helper = next(
    node
    for node in tree.body
    if isinstance(node, ast.FunctionDef) and node.name == "assert_current_crisis_helplines"
)
namespace = {}
exec(compile(ast.Module(body=[helper], type_ignores=[]), str(source), "exec"), namespace)
check = namespace[helper.name]


class SafetyNumbersTest(unittest.TestCase):
    def test_current_numbers_normalize_dial_format(self):
        check({"helplines": [{"number": "14416"}, {"number": "1800-89-14416"}]})
        check({"helplines": [{"number": "14416"}, {"number": "1 800 89 14416"}]})

    def test_old_missing_and_malformed_numbers_fail(self):
        for payload in [
            None,
            {},
            {"helplines": "14416"},
            {"helplines": [{"number": "14416"}]},
            {"helplines": [{"number": "14416"}, {"number": "1800-599-0019"}]},
            {
                "helplines": [
                    {"number": "14416"},
                    {"number": "1800-89-14416"},
                    {"number": "18005990019"},
                ]
            },
        ]:
            with self.subTest(payload=payload), self.assertRaises(AssertionError):
                check(payload)


if __name__ == "__main__":
    unittest.main()
