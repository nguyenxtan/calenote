# R02 event-relation support correction

## Proven checkpoint

Application `bb233e9ee0740a673acebb7523c81b3e5a96b858`, harness
`dc9c8f5449d47a2a3035a4aa4d09b407ee111d13`. One terminal R02 turn-zero
validation returned HTTP 200, wire/canonical/evidence PASS, and 42/43 oracle
assertions PASS. The failing path was `fields.eventRelation`: expected null,
actual BEFORE_EVENT. Historical execution and accounting remain immutable.

## Contract reconstruction and root cause

1. `eventRelation` positions notifications relative to the event: BEFORE_EVENT
   precedes it, INCLUDING_EVENT includes its day, STARTING_ON starts from the
   stated reminder date. See canonical spec sections 3 and 5.2 and `resolve.ts`.
2. Explicit event-relative USER support or exact scoped accepted CONTEXT_FACT
   may supply a relation; count and cadence alone may not.
3. R02 has no prior context. Its first USER turn establishes exam, location,
   event date October 11, DAILY/count2, but neither reminder time nor relation.
   Its unchanged oracle asks reminderTime first. Turn one supplies BEFORE_EVENT;
   turn two supplies 08:00. The frozen fixture is not defective.
4. The old prompt separated count/offset but lacked an explicit count-versus-
   relation prohibition: PROMPT_INCOMPLETE. Its generic uncertainty instruction
   did not establish a deterministic backend support gate.
5. Wire v12 decoded the legal enum correctly; canonical validation accepted its
   shape. `validateEvidenceV3` source-bound each change separately, not at object
   level, but proved quote identity/scope rather than general entailment.
6. `mergePatchV3` retained the validated proposal. It did not independently infer
   the relation or ignore a model-supplied uncertainty. Thus this is CASE E:
   prompt contract gap plus backend field-support gap, not a decoder defect.
7. The actual provider authored BEFORE_EVENT. Its particular evidence quote was
   not retained: no claim is made about that exact quote. The local regression
   reproduces the observed semantic proposal with a valid complete fixture quote.
8. Existing LIST-range evidence verification provides the nearest ownership
   analogue: exact reference validation first, finite operand support second,
   discard unsupported operand while retaining valid semantics.
9. Backend owns admission of the relation before merge; resolution/guidance
   owns missing-field ordering. Removing a new unsupported change retains an
   established prior relation instead of erasing it.
10. ProviderWire v12, canonical schemas, model/provider, one-call policy, frozen
    fixtures, confirmation, calendar arithmetic and persistence remain unchanged.

## Minimal architecture and execution

- [x] RED: actual service/gateway/wire/D1 R02 reproduction with model-proposed
  BEFORE_EVENT and unchanged canonical oracle.
- [x] Add bounded candidate support verifier `event-relation-evidence.ts`;
  exact source spans must cover the relation production. Count-only, unknown,
  negated, quoted, hypothetical and conflicting usage grant no new authority.
  This is not a general Vietnamese semantic parser or a date extractor.
- [x] Gate V3 resolved changes and uncertainty alternatives after all structural,
  source-map, scope and freshness checks. Preserve paired evidence alignment and
  exact internal fact reuse. Revalidate adopted candidate operands.
- [x] Prompt states count/cadence cannot imply eventRelation. Update outbound
  prompt digest pins, not immutable historical records.
- [x] Preserve prior context and existing explicit REPLACE correction semantics.
- [x] Verify focused regressions, R02 43/43, R01 both turns, full check.
- [x] Independent whole-delta C0/I0 review; findings fixed and reverified.
- [x] Local commit boundary: verified correction only; stop before fresh paid validation.

## Bounded sibling audit / limits

All three eventRelation enum members and their uncertainty/adoption paths share
the gate. Other semantic enums use the same quote-identity pipeline but have
different support semantics: no generic entailment guarantee is claimed.
Calendar/frequency/count broader support work is follow-up, not part of this
correction. Unknown wording remains unresolved; it is not guessed or rewritten.
Local fake provider tests prove backend protection, not real-model compliance.
The historical R02 FAIL remains FAIL. No Pilot credit is awarded by this task.

## Verification and release boundary

Run offline `pnpm exec vitest run` for relation evidence/integration, oracle,
service, evidence, merge, guidance and runner/authority regressions; then
`pnpm check` and `git diff --check`. Network and Keychain execution are blocked.
Current-source fake authority tests use immutable test-only Git objects without
moving HEAD or changing the real index; old paid candidate grants are not relabelled.

Final offline evidence: focused service/runner/transition regressions 261 PASS;
independent relation tests 24 PASS; full `pnpm check` 159 test files, 8034 PASS,
2 existing skips, documentation checks, typecheck, lint, build, Worker type check
and deploy dry-run PASS. Independent final delta review C0/I0. The initial full
check exposed stale test-only candidate identity and valid phrase regressions;
these were corrected without changing frozen fixtures. A later typecheck caught
discriminated-union inference after filtering, corrected by canonical uncertainty
parsing and verified again by the complete check. No provider, credential,
accounting, remote or production operations occurred.

NEXT_GATE = OWNER_REVIEW_OF_EVENTRELATION_FIXED_CANDIDATE_BEFORE_FRESH_FORMAL_V12_PILOT_AUTHORIZATION
