import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import openapi_compat as oc  # noqa: E402


def spec():
    return {
        "paths": {
            "/a": {
                "post": {
                    "parameters": [
                        {
                            "in": "query",
                            "name": "q",
                            "required": False,
                            "schema": {"type": "string"},
                        }
                    ],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/In"}
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/Out"}
                                }
                            }
                        }
                    },
                }
            }
        },
        "components": {
            "schemas": {
                "In": {
                    "type": "object",
                    "required": ["x"],
                    "properties": {
                        "x": {"type": "string", "maxLength": 10},
                        "kind": {"type": "string", "enum": ["a", "b"]},
                    },
                },
                "Out": {
                    "type": "object",
                    "required": ["id"],
                    "properties": {"id": {"type": "string"}, "n": {"type": "integer"}},
                },
            }
        },
    }


def breaking(mutate):
    new = copy.deepcopy(spec())
    mutate(new)
    return oc.find_breaking(spec(), new)


class OpenApiCompat(unittest.TestCase):
    def test_identical_is_clean(self):
        self.assertEqual(oc.find_breaking(spec(), spec()), [])

    def test_additions_are_allowed(self):
        def m(s):
            s["paths"]["/b"] = {"get": {"responses": {"200": {}}}}
            s["components"]["schemas"]["Out"]["properties"]["extra"] = {
                "type": "string"
            }
            s["components"]["schemas"]["In"]["properties"]["opt"] = {"type": "string"}
            s["paths"]["/a"]["post"]["parameters"].append(
                {
                    "in": "header",
                    "name": "X-New",
                    "required": False,
                    "schema": {"type": "string"},
                }
            )

        self.assertEqual(breaking(m), [])

    def test_removed_path_and_operation(self):
        self.assertTrue(
            any("path removed" in e for e in breaking(lambda s: s["paths"].pop("/a")))
        )
        self.assertTrue(
            any(
                "operation removed" in e
                for e in breaking(lambda s: s["paths"]["/a"].pop("post"))
            )
        )

    def test_removed_and_renamed_response_field(self):
        def rm(s):
            del s["components"]["schemas"]["Out"]["properties"]["n"]

        def rename(s):
            p = s["components"]["schemas"]["Out"]["properties"]
            p["count"] = p.pop("n")

        self.assertTrue(any("'n' removed" in e for e in breaking(rm)))
        self.assertTrue(any("'n' removed" in e for e in breaking(rename)))

    def test_type_change(self):
        def m(s):
            s["components"]["schemas"]["Out"]["properties"]["n"]["type"] = "string"

        self.assertTrue(any("type changed" in e for e in breaking(m)))

    def test_new_required_param_and_field(self):
        def p(s):
            s["paths"]["/a"]["post"]["parameters"].append(
                {
                    "in": "query",
                    "name": "must",
                    "required": True,
                    "schema": {"type": "string"},
                }
            )

        def f(s):
            s["components"]["schemas"]["In"]["required"].append("kind")

        def became(s):
            s["paths"]["/a"]["post"]["parameters"][0]["required"] = True

        self.assertTrue(any("new required" in e for e in breaking(p)))
        self.assertTrue(any("newly required" in e for e in breaking(f)))
        self.assertTrue(any("became required" in e for e in breaking(became)))

    def test_tightened_validation_and_enum(self):
        def tight(s):
            s["components"]["schemas"]["In"]["properties"]["x"]["maxLength"] = 5

        def enum(s):
            s["components"]["schemas"]["In"]["properties"]["kind"]["enum"] = ["a"]

        self.assertTrue(any("maxLength" in e for e in breaking(tight)))
        self.assertTrue(any("enum" in e for e in breaking(enum)))

    def test_response_no_longer_required(self):
        def m(s):
            s["components"]["schemas"]["Out"]["required"] = []

        self.assertTrue(any("no longer guaranteed" in e for e in breaking(m)))

    def test_committed_snapshot_matches_live_app(self):
        import json

        try:
            live = oc.load_live_spec()
        except ImportError as exc:  # plain python3 without the API deps (release-tooling job)
            self.skipTest(f"API deps not installed: {exc}")
        snap = json.loads(oc.SNAPSHOT.read_text(encoding="utf-8"))
        self.assertEqual(oc.find_breaking(snap, live), [])


if __name__ == "__main__":
    unittest.main()
