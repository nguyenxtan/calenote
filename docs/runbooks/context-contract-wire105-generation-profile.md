# Wire105 typed generation with strict local acceptance

The e992a4f Formal Pilot stopped after its first R01 turn0 request with Google
HTTP400 invalid_argument and the sanitized cause `Schema state limit exceeded`.
No usage was confirmed. Historical UNKNOWN43 remains retained; cumulative cap
10000000microunits, conservative retained5465139, remaining4534861. Paid HOLD.
No retry, provider call, merge or deployment is part of this preparation.

The provider compiler and local acceptance validator have different jobs:

- `googleLiteEuTypedContextValidationSchemaV3(input)` retains the full prior
  input-bound validation grammar. R01 hash remains
  `0363d0b00e38f19c6cedc652eb97a2906b0129af7fce38e1ccd620adb5081f14`.
- `googleLiteEuTypedContextWireSchemaV3(input)` derives a typed structural
  superset from that exact grammar before dispatch. It removes variable numeric
  ranges, string length/pattern constraints and non-empty-only array bounds.
  Singleton numeric discriminators, input-selected types, control/source enums,
  required object keys, additionalProperties:false and maxItems:0 stay intact.
- Decoder always uses the original strict grammar, then unchanged canonical
  materialization/validation and application safety checks. No coercion, scalar
  repair, renumbering or additional AI turn is introduced. Optional advisory
  quarantine and unsupported LIST handling retain their existing behavior.

Google recommends reducing properties with constraints when a valid response
schema is too complex:
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output
https://ai.google.dev/gemini-api/docs/structured-output

These are measurements of the exact R01 schema, not Google's internal states:

| Expanded structural measure | Strict | Generation |
| --- | ---: | ---: |
| Variable numeric bounds | 146 | 0 |
| String bounds/patterns | 60 | 0 |
| Variable array bounds | 29 | 0 |
| Expanded schema bytes | 50701 | 42390 |
| Compact schema bytes | 18357 | 16880 |

The stricter local grammar remains byte-identical for this fixture. Tests verify
valid canonical outputs fit outgoing schemas across all76 healthy synthetic
Pilot requests (32scripts/84turns), while invalid numeric ranges, excess evidence,
oversized canonical titles and nested JSON strings are refused before mutation.
Full scoped validation:4109tests in35files, typecheck, scoped lint and independent
review passed. Tests deny outbound network and Keychain execution; local fake
HTTP transports are allowed. No live provider admission credit is claimed.

Preparation must freeze new application/harness/source proofs, manifest,
complete account inventory/lifecycle and cost snapshot in a new HOLD packet.
Historical consumed grants stay consumed. The dated packet contains inspection
only, not paid authority. Future inference requires fresh exact-packet owner
approval plus independently reviewed Formal2/debug2 records and trust pins.
Same model/provider/oracle, cumulative10USD including UNKNOWN,20minute ceiling,
76maxrequests, stop-on-error/budget and no retry/Full/deploy remain mandatory.
