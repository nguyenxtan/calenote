# ProviderWire v12: query evidence complexity correction

## Scope and evidence

The single terminal v11 application validation returned HTTP 400 from Google,
`INVALID_ARGUMENT / Schema state limit exceeded`, before any model output.
Trace `a458c6f6cf310f18-HKG`. This is not a model evidence-generation failure.
No additional provider request is part of this correction.

Actual fully transformed schema generation at immutable commits fd6fddb (v10,
historically live admitted) and 9c3bc72 (v11, rejected) yields:

| Emitted syntactic metric | v10 | v11 | v12 |
| --- | ---: | ---: | ---: |
| Objects | 29 | 32 | 32 |
| Properties / required entries | 143 | 152 | 149 |
| Nullable unions | 12 | 18 | 12 |
| Unions / branches | 19 / 51 | 25 / 63 | 19 / 51 |
| Enum nodes / values | 27 / 105 | 27 / 105 | 27 / 105 |
| Definitions / references | 18 / 42 | 18 / 48 | 18 / 42 |
| Arrays | 4 | 4 | 4 |
| Syntactic object depth (references not expanded) | 2 | 3 | 3 |
| Serialized schema bytes | 11118 | 12027 | 11655 |

v11 introduced a three-slot object in each LIST / CALENDAR_DATE / CAPABILITY
branch. Each optional secondary/tertiary slot adds a nullable evidence union:
six added unions, twelve branches and six references. Evidence definitions are
interned, not copied wholesale into $defs; their references still multiply at
use sites. Other enum domains and definitions are unchanged. This exactly
attributes the emitted structural increase, but does not reveal Google's
private state calculator or prove a numeric threshold. Live acceptance of v12
remains unverified. Syntactic metrics are not a substitute for that gate.

## Representation decision

Use one required structured `primaryEvidence` plus required string
`additionalEvidenceJson`, encoding zero to two **wire-shaped** evidence objects
as a JSON array. No extras means the string `"[]"`. Each extra is traversed by
the same strict evidence codec, including discriminator, required keys, scope
shape and inactive-padding rules. Decoder rejects missing/invalid primary,
non-string extras, malformed JSON, non-array JSON, more than two extras,
unknown keys and canonical-invalid refs. It never repairs or selects evidence.
String input is bounded by the existing 32768-byte transport ceiling before
JSON parsing. Source exact-match and semantic support validation are unchanged.

This reuses the existing low-state serialized uncertainty-alternative pattern.
Compared with a new shared evidence registry or source-index scheme, it adds no
fact namespace, mapping authority, input preprocessor or source-selection rule.
Compared with fully serialized evidence, it retains one structurally required
typed primary evidence. Compared with v11, it removes both optional-object
nullable unions per query branch. Canonical evidence remains ordered 1..3.

The raw provider language for extras is intentionally broader than canonical;
the strict deterministic decoder narrows it before canonical/evidence admission.
Inactive query padding remains authority-free and untraversed. No additional
inference, coercion, automatic evidence or fallback is introduced.

## Execution and review boundary

- TDD compact codec and structural guard, independent codec fixtures, actual
  R01 application fake-transport path, malicious/missing/excess extras.
- Version wire as context-query-evidence-compact-12; canonical/input/state and
  authority classes remain unchanged. Prompt explicitly describes scalar extras;
  runner request/schema digests and finite protocol registry track that version.
- Keep Google $defs interning, scalar normalization, uncertainty codebook,
  omitted annotation compatibility and inactive-padding protections intact.
- Guard emitted unions/references against the measured v10 baseline and pin the
  normalized schema digest eb1dd33768911fdad7cd1e957c427882515b0dee56a6256102a0e96d0c8cca08.
- Run focused, historical authority/version, full check and independent C0/I0
  review; commit locally once green. Do not mutate historical ledgers or grants.
- New candidate requires fresh direct paid authorization later. No live request,
  Keychain access, push, migration or deployment in this offline task.
