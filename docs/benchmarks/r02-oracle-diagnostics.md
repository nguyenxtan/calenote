# R02 turn 0 offline assertion investigation

Owner task: attachment `c19bf55f-f763-46f7-b2ce-f09a143a1ef0`.
Start harness: `6d687de42f6f2ce9a07f3e778b821b2d8191759a`.
Application candidate: `bb233e9ee0740a673acebb7523c81b3e5a96b858`.

## Historical evidence and preservation

Formal V12 Pilot stopped terminally after three provider requests: both R01
turns passed; R02 turn 0 failed the complete application oracle. Generation
`gen-1791179354-38JNEgjG0CF6o7jWpDqq` returned HTTP 200; canonical and evidence
validation passed. Status was CLARIFICATION_REQUESTED, pendingField was
reminderTime, mutations were zero and R02 LIST reads were zero. The one LIST
read belongs to R01 turn 1. Actual Pilot cost was USD 0.0013225; historical
UNKNOWN exposure remains USD 1.265664. This task makes no accounting writes.

The terminal execution contains ledger, response metadata, application trace,
target claim/settlement/terminal records and consolidated report. No provider
reply, normalized interpretation or complete observation was retained.
`context-contract-probe.ts` uses `SqliteD1Database`, whose database is
`:memory:`; `runContextFixtureCampaign` closes it in finally. Its snapshot,
inputs, selected reply and complete observation are not available after stop.
The live projection has neither slot values nor individual assertion results.
No historical report is backfilled with inferred diagnostics.

Offline comparison of the retained projection with the frozen oracle proves
five matches: applicationStatus, pendingField, mutationCount, queryRange and
HEALTHY fullSchemaValid. All 13 expected slot paths and 13 other expected
paths (dispatches, occurrences, revisions/expiries, child/transaction/send counts,
previews and canonical reminders), plus four internal persistence assertions,
are unavailable. Missing artifact data is not treated as an actual missing
application property or a synthetic failed assertion.

## Exact fixture and oracle ownership

Canonical source: `src/modules/conversation/context-contract/benchmark/regressions.json`,
R02, turn 0. There is no preceding USER turn or pending draft. Frozen proposal
fixtures in `tools/benchmark/context-contract-fixtures.ts` encode CREATE_REMINDER
with the explicit event date, title/location, DAILY frequency and count two;
notification time and event relation remain unresolved. The application must
ask for reminderTime, preserve the full expected slots/context/draft revisions
and expiry times, have no previews/occurrences/reminders/transactions and send
one clarification. The fixture does not explicitly assert an intent or
effectiveDirective field; status/slots/pending state are its observable contract.

`scoreContextCampaign` checks every expected field/detail field, status,
dispatches/mutations, full-schema validity for HEALTHY, optional source/kind/
decision/api/delivery, reply include/exclude constraints, all internal assertions,
occurrences/pendingField/revisions/expiry/query/child/transaction/send/preview/
canonical-reminder expectations, and safety predicates. The runner also requires
one actual dispatch per HEALTHY turn. Diagnostics use that exact predicate set;
they do not narrow the fixture to pendingField alone.

## Required root-cause answers before any semantic fix

1. Exact historical failed assertions: **not recoverable** from retained data.
2. Exact expected state: the unchanged frozen R02 turn 0 oracle above.
3. Exact actual complete state: unavailable; only status, pendingField, structural
   validity, downstream trace, zero mutations/reads and oracle FAIL survive.
4. Did model semantics differ? Unknown: no retained proposal.
5. Should backend reject/reconcile a difference? Cannot determine without #4.
6. Did backend identify missing reminderTime? Yes, retained trace proves it.
7. Was clarification correct but adjacent state wrong? Status and target match;
   reply wording and complete adjacent state are not retained, so unknown.
8. Owning layer of the historical mismatch: unknown. Proven separate defect:
   benchmark projection omitted per-assertion evidence before probe disposal.
9. Unchanged layers: application semantics, context persistence, ProviderWire
   v12, canonical schema, evidence verification, prompt, provider/model, frozen
   fixtures, authorization/accounting and historical records.

No A–G application root-cause classification is justified. Reporting loss is
proven, but does not establish CASE F's premise that internal state was correct.
No semantic fix is attempted. Deterministic fixture execution is explicitly
not a reconstruction of the historical provider generation.

## Behavior-neutral diagnostic fix

`tools/benchmark/context-contract.ts` centralizes the existing turn predicates
and exposes `diagnoseContextTurn`. Strict scalar equality, deep slot/fact
equality, truthy internal assertions and safety checks retain their old behavior.
Nested mismatches identify safe paths; missing/extra keys report KEY_PRESENCE.
Unknown path components and strings are hashed, approved finite control enums
are allowlisted, counters/booleans are bounded, and arrays expose count/digest
only. At most 128 failed assertions are persisted with total count/truncation.
Parent structural failures remain failures even if no child differs.

`context-contract-runner.ts` saves these sanitized diagnostics in each new
application-evidence/report before the existing first-failure stop. PASS emits
an empty list. Raw proposals, quotes, reply text, title/location/notes, owner/chat
identities and credentials never enter the diagnostic projection.

## TDD and verification

- Initial eight diagnostics tests failed for missing function before implementation.
- Runner persistence assertion failed before the projection was added.
- Review edge regressions failed for prototype-only mismatch, missing/extra
  undefined keys, inherited enum-map names and signed-zero scalar equality.
- R01/R02 deterministic actual service, wire, canonical/evidence, storage/readback
  and complete oracle tests protect all five turns; no historical PASS claim.
- Focused and full checks run in an external-network/Keychain-denying sandbox.
- Independent review is required before the local diagnostics-only commit.

Focused verification: 133 PASS (15 diagnostic tests, 68 context-contract tests,
50 runner tests). Independent re-review after repairing the observed edge
regressions: CRITICAL=0 / IMPORTANT=0 / MINOR=0. Full check completed with exit 0:
157 test files / 7995 PASS / 2 existing skips. Documentation checks, typecheck,
lint, build, generated Worker type check and deployment dry-run passed. Dry-run
is not deployment. `git diff --check` passed. Byte comparison verified all 778
files in the historical task/accounting directory unchanged; ledger hash-chain
PASS, confirmed total USD 0.0085269, historical UNKNOWN 12 / USD 1.265664,
prospective UNKNOWN zero. External provider requests, LLM calls and credential
access for this task were zero. Application/config/fixture delta is empty.

End boundary: local commit only. No fresh paid grant, replay, Pilot continuation,
Full, push, merge, migration or deploy. Next gate is
`OWNER_REVIEW_OF_R02_ASSERTION_DIAGNOSTICS_BEFORE_ANY_NEW_PAID_REPRODUCTION`.
