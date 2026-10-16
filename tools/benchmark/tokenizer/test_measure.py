import unittest
import warnings
from measure import measure, block_network, NETWORK_ATTEMPTS


class ScopeTests(unittest.TestCase):
    def test_network_guard_denies_connection_before_network_access(self):
        self.assertTrue(block_network())
        self.assertIn("socket.connect", NETWORK_ATTEMPTS)

    def test_preserves_full_schema_and_reports_unsupported_projection(self):
        schema = '{"type":"object","$defs":{"x":{"type":"string"}},"properties":{"x":{"$ref":"#/$defs/x"}},"additionalProperties":false}'
        result = measure({"prompt": "System text", "inputJson": '{"text":"Mai 8h nhắc gọi mẹ"}', "schemaJson": schema, "wireJson": '{"diagnostic":"only"}', "outputJson": '{"ok":true}'})
        self.assertEqual(result.get("schemaUnchanged"), True)
        self.assertGreater(result["applicationTextTokens"], 0)
        self.assertGreater(result["rawJsonDiagnosticTokens"], 0)
        self.assertEqual(result["sdkTextProjectionTokens"], result["applicationTextTokens"])
        self.assertIsNone(result["sdkFullStructuredTokens"])
        self.assertTrue(any("$defs" in str(error["path"]) for error in result["unsupportedSchema"]))
        self.assertEqual(result["routeFramingTokens"], "UNKNOWN")

    def test_supported_schema_count_is_separate_from_raw_json(self):
        result = measure({"prompt": "System", "inputJson": "Hello", "schemaJson": '{"type":"OBJECT","properties":{"title":{"type":"STRING"}},"required":["title"]}', "wireJson": '{}', "outputJson": '{}'})
        self.assertGreater(result.get("sdkFullStructuredTokens", 0), result.get("applicationTextTokens", 0))
        self.assertEqual(result["routeFramingTokens"], "UNKNOWN")


if __name__ == "__main__":
    warnings.filterwarnings("ignore", message=".*local tokenizer.*")
    unittest.main()
