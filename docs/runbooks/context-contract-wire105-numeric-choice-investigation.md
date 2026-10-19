# Wire105 numeric-choice structural regression

Task is offline preparation only: paid HOLD, cap10000000microunits,45UNKNOWN
retained, conservative retained5676083, remaining4323917. No credentials,
provider metadata/inference, retries, Full, merge or deployment in this repair.

## Evidence and exact delta

| Evidence | Schema SHA256 | R01 uncertainty fieldCode |
| --- | --- | --- |
| Recorded wire104 R01turn0 SUCCESS | 492a283db43db63cd3e05c8ec24168837085b13f2a5e0759cabf648bdd190678 | integer range0..15 |
| Recorded c44e88e R01turn0 HTTP400 | 8617d57ad8aa3a75b0c41be2f5efeca99c4ed72686e97b99b9a36d288f73057f | anyOf16singleton integer ranges |
| New generation | Frozen in dated proposal | integer range0..15 |

The failing node is `$.uncertainties[].fieldCode`, beneath a repeated object.
Each of its16branches has only type:integer, minimum:N, maximum:N. Earlier
variable-bound removal intentionally retained singleton bounds; earlier object
factoring moved them into one16-way numeric disjunction instead of removing it.
This identifies a structural regression, not a byte-size threshold.

`context-typed-grammar-audit.test.ts` pins the exact recorded schema hashes,
reconstructs the admitted104 control, and compares expanded JSON before/after.
For R01 the ONLY changed expanded path is fieldCode. Its accepted JSON values
are identical: integers0..15, no strings/fractions/null/out-of-domain numbers.
Strict local R01 schema hash remains0363d0b00e38f19c6cedc652eb97a2906b0129af7fce38e1ccd620adb5081f14.

For input-selected noncontiguous domains, coalesce adjacent runs only. R02's
0..7 and12..15 stay two ranges; values8..11 remain forbidden. Unsafe endpoints,
additional constraints and nonadjacent points are not silently broadened. The
schema is dereferenced before lowering and references rebuilt afterward.
Objects, primitive types, full canonical validation, oracle, prompt and route
remain unchanged. No transport-string encoding or coercion is introduced.

## Boundaries of the conclusion

This is NOT Google causal proof. Google has not accepted the new schema, and
its compiler is not reproduced by the local audit. Aggregate complexity or
another compiler behavior can still cause rejection. The vendor's public issue
acknowledges no exact guidance for this exception:
https://github.com/googleapis/python-genai/issues/660

The structural auditor detects pure singleton-integer disjunctions only. An
empty audit does not imply zero unions or provider admission: R02 intentionally
retains two range alternatives. The next frozen Pilot tests this narrow
hypothesis; it must stop on failure rather than turning into automatic retries.

## Verification and package

4114tests in36files passed, including all76healthy synthetic requests through
32scripts/84turns with unchanged oracle, per-request structural audit, exact
R01 delta, R02 gaps and existing strict rejection/no-mutation tests. Typecheck,
scoped lint and independent source review passed. Tests denied outbound network
and Keychain executable access; localhost fake transports were allowed.

Dated packet freezes source/harness proofs, full history/lifecycle and costs,
manifest, structural evidence and a read-only inspector. No paid authority is
created. Fresh direct exact-packet owner approval and reviewed Formal2/debug2
trust pins remain necessary before Keychain/quota/inference. Keep cap/UNKNOWN/
model/provider/oracle, stop on error/budget, no retry/Full/deploy.
