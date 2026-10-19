# One-run Formal Pilot launcher

Status: preparation only; PAID HOLD. A policy decision approving
CONSERVATIVE_DEBUG_V1 and a cumulative $10 cap does not authorize inference.

`context-formal-pilot-launcher.ts` adds a narrow trusted API around the existing
Formal Pilot executor. It exposes no mode, freshRun, fallback, retry, ambient-key
or generic-live-CLI option. Import and missing-authority calls cannot obtain a
credential. The application remains the reviewed deployed b11c7d4 source; this
preparation creates a separately frozen harness revision, not a product deploy.

## Before paid approval

Freeze the exact harness commit and `candidateValidationProof` for the unchanged
application candidate, actual loaded-module proof, unchanged full manifest and
physical account inventory. Audit namespace discovery separately: discovered
histories are not owner-authenticated billing evidence or a machine-wide search.
Keep all UNKNOWN unchanged. The dated proposal/namespace reports are external
local artifacts, not live authority records.

The $10 cap includes retained history. At the October19 checkpoint conservative
retained exposure was5,251,137microunits, leaving4,748,863. Maximum per-request
exposure105,472 means76 maximum-size requests plus history exceed the cap.
A bounded attempt may stop before completion; no change to PASS or the cap is
implied. Confirmed settlements can replace request bounds, UNKNOWN cannot.

## Fresh authority and trusted invocation

Only after a fresh direct paid approval, preserve the exact owner message and
append a new `formal-pilot-launch-authority-1` record. Its strict schema binds
one FORMAL_PILOT, the exact application/harness proofs, manifest, inventory,
proposal digest, debug-budget record digest and owner-message digest. Scope is
32 scripts/84 application turns/76 healthy-provider requests, outer20minutes,
unchanged google/gemini-2.5-flash-lite via google-vertex/eu, streamfalse,
retry0/fallbacknone, strict schema/ZDR/data_collection deny, cumulative$10.
No Full, probe, schema transform, replay, throttle successor or activation.

Review and freeze record/message/proposal hashes at the trusted owner-facing
boundary. Supply those independent pins to `loadFormalPilotLaunch(root,path,
trust)`, then pass its branded result to `runFormalPilotLaunch(authority,
acquireCredential)`. Trust pins must never be derived from the untrusted record
being loaded, arbitrary CLI arguments or credential possession. Existing broad
budget records and stopped/consumed messages cannot substitute. No live record
or owner message is fabricated by this preparation.

`inspectFormalPilotLaunch` is read-only but requires the same actual paid
record: it validates bounded owner/record bytes and cost metadata. Do not call it
on real account grants while HOLD remains. No launch command or key is embedded
in source/configuration. Existing owner-only credential restrictions still apply;
permission to run paid inference does not silently grant Keychain access.

## Execution fences

1. Before key acquisition, verify physical paths, independently reviewed record
   bytes, owner/proposal/debug hashes, source/harness/manifest and complete prior
   inventory. Refuse account lock, proposal/owner consumed marker, historical
   owner marker or existing computed execution leaf.
2. Existing debug executor obtains its exclusive account lock. The callback
   rechecks all pins and accounting before any execution leaf or credential.
   Write exclusive, fsynced proposal-wide and owner-message-wide markers first.
3. Only then invoke `acquireCredential`, while still holding the account lock.
   Recheck source/loaded proof/inventory after the await. Callback failures keep
   markers and the existing fail-closed lock; no automatic unlock/retry.
4. Use literal FORMAL_PILOT through the unchanged fixture/action oracle. Before
   every physical request, recheck source/loaded proof and prior inventory,
   excluding only this exact run's ledger leaf. Route/privacy, headroom, ordered
   targets, first-failure stop and HTTP fences remain in the existing executor.
5. A terminal failure or missing cost is not a settlement. Do not reset markers,
   release UNKNOWN, resume a stopped execution or start Full. Post-run evidence
   must distinguish synthetic acceptance, live Pilot PASS and production rollout.

## Verification scope

Synthetic tests use temporary accounts and fake credentials/fetch. They exercise
all76 physical-request callbacks against public frozen fixtures, first429 stop,
concurrency, record/policy/source/manifest/inventory drift, prior consumption,
late drift during key acquisition and partial-marker/key failure. The loaded
module registry is mocked only inside Vitest; real source+loaded proof must be
verified again with `register-conversation-loader.mjs` against the final commit.
Tests and review do not create paid permission or certify live provider quota.
