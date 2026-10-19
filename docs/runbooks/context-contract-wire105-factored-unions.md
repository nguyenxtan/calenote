# Wire105 generation-only union factoring

Scope: offline repair/preparation after app408dba8 returned GoogleHTTP400
`Schema state limit exceeded` on the first Pilot request. UNKNOWN44 is retained;
cumulative cap10000000microunits, retained5570611, remaining4429389. PaidHOLD.
No credentials, provider metadata/inference, retry, merge or deploy in this task.

The outgoing schema now dereferences and factors object/array alternatives:

- Factor only pure union nodes without sibling constraints. Object alternatives
  must share the exact shell, required list, additionalProperties setting and
  property-key set; array alternatives must share the exact shell except items.
- Recursively join corresponding property/item schemas. Different typed object
  shapes stay separate. Plain strings remain business strings; dates, changes,
  evidence and alternatives remain typed objects/arrays rather than encoded JSON.
- Sibling value correlations may broaden for generation. The strict input-bound
  decoder still uses the original schema and canonical validation before any
  mutation. There is no repair, coercion or renumbering.
- Pure oneOf becomes an inclusive union in generation, preventing exclusion when
  widened branches overlap. The strict validator retains original oneOf. Current
  generation definitions are tested to contain no remaining exclusive union.

R01 strict hash stays0363d0b00e38f19c6cedc652eb97a2906b0129af7fce38e1ccd620adb5081f14.
New generation hash8617d57ad8aa3a75b0c41be2f5efeca99c4ed72686e97b99b9a36d288f73057f.
These are structural measurements, not the Google compiler's internal states:

| R01 measure | Previous408dba8 generation | Factored generation |
| --- | ---: | ---: |
| Compact bytes | 16880 | 10147 |
| Expanded bytes | 42390 | 24416 |
| Expanded structural nodes | 983 | 582 |
| Expanded union branches | 218 | 165 |

Tests assert required typed object keys remain closed, uncertainty items become
one typed object, generation admits a deliberately mismatched numeric field /
string alternative but strict decoding refuses it, and actual service rejects
before draft/reminder mutation. Existing76healthy synthetic requests fit outgoing
schemas and qualify32scripts/84turns against unchanged oracle. Strict schema,
canonical, corpus, prompt, model/provider and accounting policy remain unchanged.

Validation:4111tests in35files, typecheck, scoped lint and independent source
review passed. Tests deny outbound network and Keychain CLI; localhost fake HTTP
transports are allowed. Provider admission remainsUNVERIFIED; no live Pilot credit.

Freeze a fresh source/harness proof, full account inventory/lifecycle, costs,
manifest and read-only inspector in a newHOLD packet. No paid authority is created.
Any later paid execution requires direct exact-packet owner approval and reviewed
Formal2/debug2 records plus independent trust pins. Keep cap/UNKNOWN/model/provider/
oracle, stop on error/budget, no retry, Full or deploy. Consumed grants stay consumed.
