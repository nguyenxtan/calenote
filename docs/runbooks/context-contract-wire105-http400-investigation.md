# Wire105 HTTP400 investigation and bounded source repair

Observed run: app575c659 / harness25d05eb, one Formal Pilot stopped at
R01 turn0. Key metadata HTTP200; first inference HTTP400, Google
`invalid_argument`. No usage confirmed. UNKNOWN41 became42, retained5359667
microunits, remaining4640333 of cumulative10000000. Old approval consumed.

The request was reconstructed offline from the frozen corpus. Its schema hash
`ea72396f909182cdc4bbe22365212c60c86246401a8d82feb154982242a4f633`
matches the failed request. Original schema19548 compact bytes,16 uncertainty
branches. Raw provider prose was discarded by the privacy projection; exact
HTTP400 cause is therefore not recoverable from this receipt. Google documents
schema complexity as a possible400 cause, not proof of this specific failure:
https://ai.google.dev/gemini-api/docs/structured-output
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output

Repair scope: associate unconstrained nested anyOf, remove singleton anyOf,
and factor object union branches only when full shells match and exactly one
property differs by a finite integer point domain. Preserve holes with anyOf
of singleton minimum/maximum bounds, never a wider interval or numeric enum.
R01 uncertainty branches16→12. Canonical codec, validation, prompt, oracle,
model/provider and transport shape remain unchanged. This is equivalent schema
simplification; live admission remains unverified.

Additional diagnostics retain fixed local nesting/size categories for previously
redacted phrasing. No provider prose, credential or customer identifier is saved.
The new tests exhaust field/reason domains against representative valid/invalid
values, not every possible payload. The immutable old R01 schema fixture checks
acceptance equivalence. Existing typed application Pilot uses76 synthetic
provider responses and all32 scripts/84 turns; mock success is not live credit.

4107 tests in35 files passed under outbound-network and Keychain execution
denial (localhost fake transports allowed). Typecheck, scoped lint and
independent review passed. No real provider call, key read, merge or deployment
was performed during this repair. Paid HOLD remains; a fresh exact-source
one-shot authority must be reviewed before further inference. Never reuse the
consumed owner/proposal grant or reset historical UNKNOWN under a new identity.
