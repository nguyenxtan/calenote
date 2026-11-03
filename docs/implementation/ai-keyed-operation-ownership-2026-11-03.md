# Keyed emission: resolved operation ownership

The keyed producer selects a reminder action and its target together.
`CONTINUE_CURRENT_REMINDER` and `START_NEW_REMINDER` declare both a known
reminder action and a resolved target. These two emission branches cannot also
declare that the action or target is unresolved. `ASK_WHICH_REMINDER` represents
an unresolved reminder target; targeted `UNKNOWN_ACTION_*` represents an unknown
action, including when its target is already known.

This is a restriction on the selected keyed emission language. The canonical
V3 schema and its legacy105/106 consumers retain their existing wider acceptance.
It does not derive a target from input, force a resolved operation, or change
confirmation authority. The model must still choose the source-grounded branch.

## Transport rule

For the two resolved reminder branches, the internal operation-uncertainty
carrier has capacity zero. The existing fixed-empty codec omits that property
from generation and restores only its structural empty array after strict
validation against the selected schema. Any received property, including `[]`,
is refused. A received nonempty uncertainty is never discarded or translated
into a different operation. Encoding a contradictory canonical proposal fails.

`ASK_WHICH_REMINDER`, unknown actions, and all field-level uncertainty policies
remain unchanged. Missing scheduling operands remain the deterministic
resolver's responsibility. Genuine unknown field content can still be expressed
as field-level ambiguity on a resolved reminder.

We deliberately retain the existing zero/one/two-candidate uncertainty language
on unresolved and unknown branches. CanonicalV3 permits zero candidates, and an
unknown action can have a single known target. Requiring two fabricated target
alternatives would remove those supported meanings. This differs from the
reviewer's optional suggestion to require two candidates on every branch.

The selected-schema policy and prompt revision identify this change as141.
Canonical storage/AAD, wire-family136 syntax, provider route, account budgets,
field eligibility, evidence checks and business oracles remain unchanged.

## Validation

- The captured140 R03 contradiction is refused unchanged by the selected schema
  and decoder; known CURRENT/NEW proposals still roundtrip without the carrier.
- Encoding a contradictory proposal fails without deleting its authored issue.
- D07's genuinely unresolved CURRENT/NEW alternatives remain intact in the
  complete144-state canonical roundtrip audit.
- Existing targeted-unknown one-candidate and field-level unknown-location
  regressions remain valid; legacy105/106 coverage stays unchanged.
- R03's captured failure is an offline counterfactual only. Qualification
  requires a fresh complete32-script/84-turn live campaign on the final source.
