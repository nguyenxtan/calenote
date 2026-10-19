# Wire105 Formal Pilot preparation

Application candidate is exactly `575c659896862bbdc182632ae1ac3438fe98283b`.
This preparation changes tooling only. Canonical V3, storage, corpus/oracle,
model `google/gemini-2.5-flash-lite`, provider `google-vertex/eu`, 76 healthy
requests / 84 turns / 32 scripts and the 20-minute ceiling stay fixed.

`prepareTypedFormalPilot` produces `formal-pilot-preparation-105-1`, with
`PREPARED_HOLD` and `paid: HOLD`. It reads immutable application/harness proofs,
manifest, the existing account inventory, lifecycle marker hashes and
CONSERVATIVE_DEBUG_V1 accounting. It never reads credentials, acquires a lock,
creates an execution leaf or consumed marker, changes UNKNOWN, or produces a
branded paid authority. `inspectTypedFormalPilotPreparation` rederives the entire
record and rejects shape, source, harness, inventory, accounting or lifecycle drift.

The dated packet is outside the billing account namespace. Its inspection script
is read-only and does not execute inference. A successful inspection means the
frozen preparation is current; it does not open HOLD or establish key/quota or
provider schema admission. Offline fake-provider qualification earns no live
Pilot credit. All 84 turns remain to be qualified live, without prefix reuse.

## Future paid invocation

Only a fresh direct owner approval of the exact frozen packet can authorize one
FORMAL_PILOT. It must be bound at the trusted owner-facing boundary, with
independently reviewed record, owner-message and proposal hashes. Preparation
files are not converted into paid authority by changing their labels.

The separately reviewed record must use `formal-pilot-launch-authority-2` with
`wireProtocol: TYPED_105`; `FormalPilotTrust` independently pins that selector.
Its debug budget record and trust must use `t11-debug-loop-authority-2` with the
same selector. Historical v1 grants remain wire104. Cross-version selection,
probes, replay, prefix reuse, throttle successors, FULL and unbounded execution
are refused. Standalone debug executors cannot run105; a private one-shot bridge
requires the active branded Formal2 launch and its owned marker/transport callbacks.
Keychain/key/quota preflight remains required after paid authority
is approved, under the reviewed launcher credential fence.

Request schema, prompt, evidence catalogue and capabilities are rederived from
canonical input before dispatch. Each response records its actual selected
request-schema hash. Canonical D1 persistence stays V3; both gateway wrappers
preserve the105 marker for truthful prompt and attempt binding.

The cumulative cap is 10,000,000 microunits across retained history, including
all UNKNOWN upper bounds. Recheck before each request; stop on any error,
expiry or insufficient headroom. No retry, fallback, Full, deployment or successor
activation is authorized. Headroom for one request does not guarantee enough
budget for all76 at their maximum exposure. Revalidate the inventory immediately
before a future run; a frozen snapshot must never erase later charges.
