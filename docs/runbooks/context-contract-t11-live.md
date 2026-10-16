# T11 trusted context campaign orchestration

This runbook prepares local orchestration only. It does not authorize paid
execution. Existing accepted runtime, frozen manifests and financial histories
remain authoritative. No historical R01 prefix applies to wire authority-10.

The fixed trusted bootstrap location is
`.superpowers/sdd/2026-09-28-llm-context-contract-implementation/trusted-orchestration/bootstrap.mjs`.
CLI options and environment variables cannot provide trust pins or capabilities.
The reviewed local bootstrap exports a default plain object, not a bearer
capability. `createCampaignAuthorizationLoader` alone creates the in-memory
branded capability after record and complete inventory validation.

## Controller activation after source review

1. Freeze and verify source/tests/docs, obtain independent review, and selectively
   commit the reviewed source. Supply that explicit immutable SHA to the
   subsequent assembly. Do not resolve arbitrary current HEAD as authorization.
2. In a sanitized zero-network Node process with the documented conversation
   loader, obtain `preflightContextCampaign({root})`,
   `computeContextExecutionContract(root)` and
   `auditCampaignAccountRoot(accountRoot, targetDirectory)`. Verify source SHA
   equals the explicitly reviewed SHA. Do not edit source after this point.
3. Account root is the real absolute existing implementation plan directory,
   retaining all 25 original PILOT histories including R01_REPLAY. Use a new
   canonical target `<accountRoot>/<uniqueRunId>/PILOT`; creating its empty
   directory is nonfinancial. Reject symlinks, escapes, omitted histories and
   divergent hashes. Preserve every original ledger byte. Expected historical
   PILOT retained is 1,060,966 microUSD, UNKNOWN 1,054,720 microUSD, remaining
   439,034 microUSD of the unchanged 1,500,000 ceiling. FULL retained is zero
   against the separate unchanged 1,000,000 ceiling. UNKNOWN is part of retained,
   never an additional debt. Inherited BEGIN debt is not counted twice.
4. Assemble a compact `JSON.stringify(record)` owner configuration record, with
   exactly these fields: version `context-contract-live-3`, method
   `OBSERVABLE_CANARY`, authorizationId supplied by controller review, account
   `PILOT`, sourceSha/provenanceDigest/protocolDigest/corpusDigest from the checked
   frozen source, runId, approvedAt, startedAt, expiresAt, priorLedgers, pilotLedger.
   Use `priorLedgers = audit.bindings.filter(b => b.account === 'PILOT').map(({directory, finalHash}) => ({directory, finalHash}))`
   in canonical audit order and `pilotLedger = null`. Approval timestamps must
   reflect the actual approved local configuration, not a invented paid grant.
   Pin the SHA256 of the exact compact record bytes. No newline or pretty-print
   substitution is accepted. All paths must be real absolute paths.
5. Use explicit timestamps: startedAt is fixed at assembly/admission time;
   effective PILOT expiry is `min(expiresAt, startedAt + 1200000)`. FULL uses
   2,700,000 ms. Record expiry must be strictly after preflight's current clock.
   An expired record fails; no loader refreshes clocks, renews approval or resets
   a budget. Review a replacement configuration separately if the 20-minute
   pending window expires. Existing attempt rows forbid executing that target
   again; a genuinely new reviewed target retains all old holds in inventory.
6. Assemble the fixed bootstrap default export with exactly these fields:
   version `context-contract-trusted-orchestration-1`, candidateSha,
   provenanceDigest, contractDigest, ownerRecordPath,
   reviewedOwnerRecordSha256, accountRoot, targetDirectory, inventoryDigest,
   paidConfirmation `PENDING`. Use the reviewed record pin independently of any
   owner-record selfhash. The reviewer checks the actual bootstrap, record,
   immutable SHA and unchanged full inventory before activation.
7. Run only the zero-network preflight:

   ```sh
   node --experimental-strip-types --import ./tools/benchmark/register-conversation-loader.mjs tools/benchmark/run-context-contract-live.mjs --preflight
   ```

   Require `authorizationStatus=CONFIGURED`,
   `credentialStatus=CREDENTIAL_MISSING`, `reason=CREDENTIAL_MISSING`,
   `paidConfirmation=PENDING`, `executionStatus=NOT_AUTHORIZED_FOR_THIS_STEP`,
   `networkRequests=0`, `secretReads=0`, and sufficient remaining budget. The
   conservative next hold is the actual gateway constant 105,472 microUSD.
   Preflight probes/releases the shared root lock and writes no campaign rows.

## Separate future paid approval

Only after direct owner paid approval for the exact candidate and immutable
configuration may the controller prepare a separate compact confirmation
record: version `context-contract-paid-confirmation-1`, status `CONFIRMED`,
candidateSha, provenanceDigest, contractDigest, ownerRecordSha256, accountRoot,
inventoryDigest, targetDirectory, runId, profile, approvedAt, expiresAt. Its
deadline must not exceed the effective fixed stage deadline. No budget field,
provider substitution, renewed clock or prefix credit is accepted.

The reviewed bootstrap's paidConfirmation then references exactly
`{status:'CONFIRMED', recordPath:<real absolute path>, reviewedSha256:<independently reviewed exact bytes>}`.
Review that artifact change, then repeat zero-network preflight. It validates
the separate confirmation without reading a key. No paid artifact is created
by the local-only implementation task.

After the real CONFIGURED milestone, prepare the macOS zsh no-echo handoff for
owner review. Disable tracing; read the key silently into a scoped local value;
pass it only to the one Node child via `OPENROUTER_API_KEY`, with a narrow clean
environment; unset it in a trap. Never echo, place it in CLI arguments, write a
secret file or persist shell tracing. The prepared child command is
`node --experimental-strip-types --import ./tools/benchmark/register-conversation-loader.mjs tools/benchmark/run-context-contract-live.mjs --run --enable-live`.
Do not instruct execution while paidConfirmation is PENDING. Git subprocesses
receive an independent fixed nonsecret environment, never the key.

## Serialization and recovery

Paid authority is attached privately to the existing branded loader capability.
Under the shared root lock, admission repeats exact source, owner, inventory and
paid-record byte/pin checks, then reads a fresh clock immediately before credential
input. A separate paid deadline fences every reservation, dispatch and HTTP
request while the owner BEGIN expiry remains its exact original bound value.
Earlier paid expiry never extends owner clocks and never releases an uncertain
reservation. Controlled expiry or record mismatch before BEGIN releases only
the lock acquired by that rejected attempt and writes no financial rows.

An exclusive `account.lock` at the shared canonical account root serializes
PILOT and FULL processes for the complete authorized execution. Creation,
contents and parent directory are fsynced before admission; release fsyncs the
parent again. Each admission revalidates the pinned complete inventory. Existing
ledger locks still protect individual durable transitions. RESERVE is fsynced
before one DISPATCH and known FINISH or conservative UNKNOWN settlement; no
automatic retry occurs. Controlled credential/admission rejection before BEGIN
releases its own acquired lock and creates no financial rows. Abnormal execution
or process death preserves the root fence. Never delete stale locks automatically.

Inspect any remaining lock and ledger through a separately authorized recovery
review. A crash after RESERVE retains its entire maximum even without DISPATCH;
a crash after DISPATCH cannot repeat that dispatch. Known FINISH replaces the
hold with observed cost; UNKNOWN retains it. A later reviewed new target includes
every old history and receives no fresh-budget reset.

FULL is prepared, not currently admitted. Its record uses FULL-only priorLedgers
within the same complete cross-stage inventory and must bind the exact current
candidate PILOT PASS ledger, report SHA256 and complete measured application
evidence. Historical source, replay, suffix and old wire PASS cannot satisfy that
guard. No FULL capability or paid grant is activated by this runbook.
