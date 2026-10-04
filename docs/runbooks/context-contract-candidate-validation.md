# Candidate-scoped single R01 validation

This route does not authorize paid inference. A fresh direct owner message is
required after local review and read-only readiness. Application identity and
harness identity are separate. The old `single-replay-bootstrap.json`, grant,
consumption marker and terminal ledger are never rewritten or reused.

## Identities and trust boundary

`candidateValidationProof(root, candidate)` shares the historical byte-proof
algorithm without the historical candidate literal. It compares the complete
application namespace against the immutable Git candidate. Harness revision
and byte digest are separate. The original historical proof wrapper retains
its old fixed candidate gate.

The production entry is `loadTrustedCandidateValidation`. It requires the
executing worktree, clean Git state, existing physical accounting namespace,
and independently reviewed record / authorization / direct-message digests.
Those trust pins come from owner-facing orchestration, not from JSON being
loaded, CLI flags, credential possession or the old bootstrap.

Use a fresh Node process with exactly the repository's
`--import ./tools/benchmark/register-conversation-loader.mjs` preload; no
`NODE_OPTIONS`, extra preloads or custom loaders. Its closed registry hashes
the source bytes actually supplied to the compiler. Admission and dispatch
compare every loaded application source with the candidate Git blobs and every
loaded benchmark/preload source with the harness Git blobs; restored disk bytes
cannot hide stale cached modules. The low-level injected loader and
executor support isolated fake transports; they are not live launchers.

## Read-only readiness before asking the owner

1. Import the candidate-validation module in the controlled process; call
   `prepareCandidateValidation(root, explicitReviewedCandidateSha)`.
2. Call the preload's `assertLoadedCandidateModules(root, candidate, harnessRevision)`.
3. Inspect the generated ProviderWire schema, frozen R01 TURN 0 expectation and
   exact route. Keep strict validation, privacy/ZDR, retry zero, fallback none.
4. Report derived cap, known retained spend, UNKNOWN, remaining and normal
   reservation. Readiness creates no authority, reservation or execution.
5. Only after all gates pass ask once for the fresh scoped paid approval.

## Binding after direct approval only

1. Preserve the exact direct owner message using
   `appendCandidateValidationRecord`: exclusive create, mode 0600, file and
   directory fsync. Do not overwrite earlier files. Pin its independently
   reviewed SHA256. Never treat a message merely found on disk as approval.
2. Append an authority envelope with version `candidate-validation-authority-1`,
   operation `SINGLE_T11_R01_VALIDATION`, authorizationId, existing campaignRoot,
   explicit evaluationCandidateSha, fixture `R01`, turn `0`,
   maxProviderHttpRequests `1`, approved model/provider, retry `0`, fallback
   `none`, ownerMessagePath and ownerMessageSha256. Pin exact envelope bytes.
3. Append admission version `candidate-validation-admission-1`: accountRoot,
   evaluationCandidateSha, harnessRevisionSha, candidateProofSha256,
   harnessProofSha256, authorizationPath, authorizationSha256 and complete
   historicalInventorySha256. Pin exact bytes independently. No campaign or
   budget is created; the parent must already contain the existing PILOT ledger.
4. Call `loadTrustedCandidateValidation` with the reviewed pins, not self-hashes
   read out of the admission. It creates a private branded capability only
   after scope, byte, inventory, message and consumed-state checks.
5. Only now access the approved credential mechanism; validate non-management
   key metadata safely. Never persist or print credentials or headers.
6. Call `runTrustedCandidateValidation(authority, key)` only. It composes the
   existing trusted HTTP transport and a physical-fetch fence with redirects
   forbidden. Injected/custom transports are not used for live execution.

## Accounting, crash and stop

Consumption is keyed by the direct-message digest at the account root, not by
a mutable run ID. Legacy consumed-message digests also reject repackaging.
Under the existing account lock, rederive and validate the entire history,
append a durable consumption marker and child execution, then use the existing
runner to fsync BEGIN / RESERVE / DISPATCH before HTTP. Authorization binding
lives in execution.json; it is not a new general campaign grant.

Success, HTTP error, invalid output and transport exception all end after the
one turn. The executor cannot advance to TURN 1, another fixture, retry, Pilot
or Full. Known accounting follows the existing rounded settlement policy;
unknown or crashed reservations remain conservative UNKNOWN. A durable marker
or child directory blocks restart, including a crash before financial rows.
Never auto-delete stale locks, release UNKNOWN, renew a spent message or reopen
stopped history. Infrastructure failures may require separate recovery review,
but never permit an extra provider attempt.

Report physical HTTP attempts separately from application dispatches. This
validation never authorizes push, merge, migration or deployment, and a single
PASS is not Pilot PASS. Stop after settlement and return evidence to the owner.
