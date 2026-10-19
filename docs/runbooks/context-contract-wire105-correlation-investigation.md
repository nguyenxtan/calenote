# Wire105 correlated grammar investigation after e9b4313

Status: LOCAL_CANDIDATE; paid HOLD. No next Pilot proposal or authority created.

## Evidence and limits

The one authorized e9b43136bd4cb4c2c4fdb7703ca9af46e73f2173 Formal Pilot
stopped at R01 turn0: Google HTTP400 `Schema state limit exceeded`.
Outgoing schema hash: ee577c42a5f9afa90bcacee29681155cd6f8441ceb939c1061b85dff2dc22195.
The integer-domain repair was insufficient; it did not isolate the unique cause.
UNKNOWN46 and remaining4,218,445microunits of the cumulative10,000,000 cap remain.

Historical wire104 admitted schema hash:
492a283db43db63cd3e05c8ec24168837085b13f2a5e0759cabf648bdd190678.
That request succeeded, not the entire historical Pilot. It is not an equivalent
typed-object control: typed operands, evidence and other schema differences
remain confounders. Expanded union inventory21 versus54 is not compiler state.

## Concrete structure and narrow correction

`factorGenerationUnions` independently unioned every property of matching
object shells. In QueryPeriod this combines kind/date/offset/from/through
from different variants. DAY with a relative date, offset1 and non-null range
endpoints was accepted by e9 generation but rejected by strict validation.
This was an intentional generation superset, not proof of canonical acceptance
or a decoder bug. It is a credible structural hypothesis for grammar complexity.

Retain transformed `kind` object alternatives whenever more than one sibling
schema differs. For identical complete shells, a single differing property can
still be unioned distributively. Each original transformed branch remains
included, so strict accepted values remain in the generation language. No
canonical/strict decoder change, coercion, field-code renumbering, stringified
objects, model/provider change or oracle relaxation is involved.

The guard only covers kind-bearing objects. Nondiscriminated object and array
factoring remain generation supersets and separate hypotheses. In particular,
array<A>|array<B> can permit mixed arrays after factoring; no claim that this
candidate removes every source of widening or all nested unions.

## Validation

A real mixed-period regression failed before the guard and passed afterward.
256 representative finite control combinations using one relative-day operand
match strict validation:18accepted and238rejected. This is not an exhaustive
proof for the entire DateOperand domain. Structural preservation of original
branches supplies the inclusion argument; focused tests supply witnesses.

36 relevant test files /4,115 tests pass, including all76synthetic healthy
Pilot requests, typed codec/service refusal and no-mutation regression tests.
Typecheck and scoped ESLint pass. Independent review found no correctness
blocker; its wording and unused-assignment nits were corrected. Full repository
suite/build/CI were not run for this local candidate; old4,114test evidence
belongs only to e9. No provider, Keychain, Cloudflare or deployment calls were
made for this investigation.

No offline Google compiler is available in this evidence. Google's root cause,
compiled-state reduction, provider admission and Pilot PASS remain UNVERIFIED.
Do not create or execute another paid run using the consumed e9 owner grant.
