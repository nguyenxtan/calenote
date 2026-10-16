# Prospective single-validation confirmed-cost accounting

**Goal:** stop treating UNKNOWN historical reservations as confirmed spend,
without granting inference authority or losing campaign-wide safety.

**Architecture / stack:** TypeScript benchmark tooling, existing hash-chained
campaign ledgers and exclusive/fsynced candidate execution claims. No application,
ProviderWire, database, dependency or production configuration change. Implements
owner attachment `7b7db480-6e23-4bd3-8c4b-d8bc1e0cc340` (2026-10-05).

## Policy

New `candidate-validation-authority-2` explicitly binds
`CONFIRMED_COST_V1`; version-1 grants are not upgraded. The fresh direct owner
message, candidate, campaign, target R01 turn 0, one HTTP attempt and route
remain mandatory. This policy is only for candidate-scoped single validations,
not an authorization to run remaining Pilot/Full.

The existing reviewed Pilot cap ($1.50) is reused, never reset. Confirmed
spend derives from every PILOT FINISH across the physical account inventory,
excluding inherited BEGIN totals and UNKNOWN. Hard-cap admission retains
one-request worst-case headroom under the unchanged application financial bound;
that bound is not expected spend, a debit, or a durable financial reservation.
The execution claim records $0. Settlement alone adds actual money. This
headroom keeps the hard cap meaningful even when the final price is unknown
before dispatch. A charge beyond the bound remains recorded, not concealed;
subsequent admission fails closed.

Historical UNKNOWN holds remain byte-identical and reported separately. They
do not consume confirmed allowance. Under this prospective policy, at most one
unresolved execution claim is allowed account-wide. One new UNKNOWN (including
crash before dispatch with a durable claim) blocks every later validation,
regardless of run ID or fresh grant. Its exposure is a bound, never confirmed
cost or assumed zero. Old UNKNOWN does not pre-consume this new prospective
count; it stays an explicitly reported historical uncertainty. No reconciliation
or release mechanism is implemented here.

New FINISH can hash-chain the exact provider-reported USD cost alongside its
conservative integer-microunit ceiling; the two must agree. Legacy records that
contain only integer settlement retain that precision: metrics explicitly count
rounded-only samples rather than inventing sub-microunit accuracy. Deterministic
nearest-rank P50/P95, count, sum, average, min/max and UNKNOWN count/exposure
are reported; empty confirmed samples return null statistics.

## Execution plan and verification

- [x] Inspect existing accounting/authority/executor; preserve old history.
- [x] RED tests: prospective grammar and version-2 authority rejected by old code.
- [x] GREEN: zero-dollar durable claim, actual settlement, metrics, cap and UNKNOWN guard.
- [x] Regress both version-1 and version-2 PASS/error/throw/wire rejection;
      preserve duplicate/crash/terminal and strict authority gates.
- [x] Focused: `pnpm test tools/benchmark/context-confirmed-cost.test.ts
      tools/benchmark/context-contract-candidate-validation.test.ts
      tools/benchmark/context-contract-live.test.ts
      tools/benchmark/context-contract-single-replay.test.ts
      tools/benchmark/context-contract-runner.test.ts
      tools/benchmark/context-contract-loaded-source.test.ts`: 185 PASS.
- [x] Full: `pnpm check` under network/Keychain-denying sandbox: 155 files,
      7944 PASS / 2 existing skips; typecheck, lint, build, types and dry-run PASS.
      `git diff --check`: PASS.
- [x] Independent C0/I0 review; accounting-precision finding fixed with RED tests,
      re-reviewed C0/I0. One tooling-only commit boundary.
- [ ] Read-only candidate/runtime/schema/accounting preflight after commit.
- [ ] Ask once for fresh paid v12 R01 turn-0 authority, only when READY.
- [ ] Only after direct approval: bind grant, secure credential gate, one dispatch,
      known/UNKNOWN settlement and terminal stop. No Pilot/Full/push/release.

Files: `context-confirmed-cost.ts` owns aggregation/metrics/admission;
`context-contract-live.ts` owns backward-compatible prospective ledger grammar;
`context-contract-candidate-validation.ts` owns versioned authority and composition;
`context-contract-runner.ts` owns actual application execution/settlement.
Review focuses on shared-account cap bypass, UNKNOWN reset by new run, accounting
precision, duplicate/crash safety, authority isolation and immutable history.

Verification history: initial full run failed on two newly added precision tests
and two stale candidate pins in loaded-source positive controls. Both were fixed;
no application files changed. A concurrent focused run timed out under full-suite
load; the final isolated focused run passed without timeout relaxation or skips.
Final full and focused logs: `/tmp/calenote-cost-final-full.log` and
`/tmp/calenote-cost-serial-focused.log`. Historical accounting was not rewritten.
