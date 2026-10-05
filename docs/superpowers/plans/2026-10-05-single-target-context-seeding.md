# Trusted single-target prerequisite context seeding

Owner specification: attachment `1c60058d-dba1-4ba1-a6b7-5be0680203a5`.
Semantic baseline: `25cdd6dc0e590e6ad04ff032a6587804f9803845`.
Starting diagnostic runtime/harness: `d861b9bbffdd73d6d1251805538c404fd56c7a44`.

## Goal and trust boundary

Generalize the existing single-target executor without externally executing prior
turns, importing target oracles into context, or relaxing application contracts.
Use fixture-owned, accepted application checkpoints captured through the existing
local fixture path. The paid path reads and hydrates application state only; it
does not manufacture an earlier provider response or dispatch a prerequisite.

Ruling: existing accepted local fixture proposals may be used to prepare immutable
fixture-owned application checkpoints, not as live prerequisite responses. This
uses the owner's source hierarchy (local actual-path / trusted prior state).
Snapshots alone are insufficient: capture dependent inbound/order/context/outcome
rows or fail closed for unsupported prerequisites. Normalize synthetic identities
structurally, never by globally substituting semantic strings.

Checkpoint preparation revision is explicitly pinned to `d861b9b`; the baseline,
source revision, prefix digest and complete normalized state enter seed identity.
Synthetic prior attempt IDs become `seed-attempt`; synthetic outcome proof hashes
are omitted because they fingerprint random local attempts and cannot authorize
the selected target. No real outcome or financial ledger is modified. Original
operation keys, ordering and prior outcomes remain in the checkpoint.
The registry currently provides R01/1, R02/1 and R05/2. Other canonical targets
are admitted through the same route only when a complete reviewed prerequisite
checkpoint exists; missing or unsupported dependencies fail closed. Turn zero
uses empty initial state. A new checkpoint needs equivalence coverage through
the existing local application path, never a fixture-specific executor.

## Execution steps

- [x] Verify isolated feature checkout and immutable start identity.
- [x] RED: canonical R01 turn 1 fails `SINGLE_TARGET_CONTEXT_REQUIRED`.
- [x] Capture/validate versioned prerequisite-only application checkpoints.
- [x] Bind checkpoint digest, baseline, runtime/harness and exact target in a new
  authority version; preserve all historical formats and consumed records.
- [x] Gateway-free hydration and authoritative read-back before target dispatch.
- [x] Preserve original target ordinal and structural one-request fences.
- [x] Safe wire/canonical structural query diagnostics, without content leakage.
- [x] Focused seed/isolation/authority/crash/accounting/historical regressions.
- [x] Full check, typecheck, lint, build and diff verification.
- [x] Independent delta review, resolve Critical/Important findings.
- [ ] Local commit, then no-network/no-credential read-only preflight.
- [ ] Ask once for fresh target/seed-bound paid authority only after READY.
- [ ] After approval: one request, confirmed-cost settlement, terminal stop.

No new campaign, artificial reservation, historical rewrites, credential access
before fresh authority, push, merge, deployment, or production mutation.

## Progress

2026-10-05: RED test reproduced the exact guard failure. Independent design review
accepted checkpoint strategy with completeness/provenance/normalization/read-back
requirements; this is not an implementation review or completion claim.

Implementation delta review: Critical=0, Important=0. Source-provenance and
portable ordinal-serialization minor findings were resolved and re-reviewed:
C0/I0/M0. Final focused regression: 9 files / 331 PASS, including the immutable
32-test historical authority suite. Full `pnpm check`: 162 files / 8081 PASS /
2 existing skips; documentation tests, typecheck, lint, build, Worker types and
local deploy dry-run PASS. `git diff --check` PASS. All checks ran with external
network and Keychain subprocess access denied. No paid authority, credential
access or external provider request has occurred.

The clean orchestration checkout initially omitted newly introduced tooling
dependencies; its explicit copy list now includes them and is regression-tested.
A prefix test timed out under concurrent focused/full execution, then passed in
the sequential focused run and final normal full suite without timeout changes.

After this commit, invoke `prepareCandidateValidation` under the conversation
loader with the exact new runtime SHA and target R01/1. Hydrate its checkpoint
with a throwing prerequisite provider fixture, inspect pending state and zero
inputs, and assert loaded candidate/harness module bytes against Git. Verify
baseline ancestry, unchanged provider schema/prompt/validator semantics, ledger
inventory/hash chain, confirmed-cost hard cap and prospective UNKNOWN gate.
This read-only check must not create an authority, claim or inference. Only
after READY may the owner grant fresh version-4 authority bound to that exact
SHA, manifest and seed digest. Then existing trusted execution performs one
target dispatch and terminal settlement; no Pilot/Full continuation is allowed.
