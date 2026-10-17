# Wire104 qualification handoff — 2026-10-16

Status: **PAID HOLD; Formal Pilot and Full not qualified**. This is a read-only
handoff for integration source `1344bf9ff50d8da7b2419abc262eaa70ad2debc8`.
It creates no authority or execution reservation. Final integrated application
and harness SHAs must be reviewed and frozen before any later qualification.

## Frozen scope

The current protocol is canonical/prompt `calenote-context-3`, input
`calenote-context-input-2`, state `calenote-context-state-2`, wire
`google-gemini-2.5-flash-lite-vertex-eu-context-title-presence-104`, uncertainty
codebook `context-uncertainty-fields-1`, storage fence family 2.

Pure `deriveBoundedPilotManifest(root)` currently produces manifest SHA256
`7d9a0e1ea2a8d48c559989770905e21256b81ba81a0d0706b48c0148eaa2ba59`:
32 fixture executions, 84 application turns, 76 ordered healthy-provider targets.
The first seven targets are R01 turns 0–1, R02 turns 0–2, R03 turns 0–1.
Fault/control turns remain part of all 84 application turns; 76 is the healthy
HTTP ceiling, not a shortened corpus. The outer historical Pilot limits remain
192 calls/20 minutes; Full remains 80 scripts/158 turns, 480 calls/45 minutes.

Model/provider remain `google/gemini-2.5-flash-lite` via `google-vertex/eu`,
stream false, retry zero, fallback none, strict schema, ZDR and data-collection
deny. Limits stay input 1,800 characters/12,000 tokens, output 1,536 tokens,
response 32,768 bytes, request timeout 30 seconds. Per-request financial exposure
is 105,472 microunits. No schema probe or sacrificial quota call is required by
this handoff.

The frozen oracle requires all 32 Pilot scripts, complete healthy schema
validity, all detail assertions, no mandatory failures and zero safety failures.
Full requires at least 76/80 scripts, 31 held-outs, 99% healthy schema validity,
all detail assertions, no mandatory failures and zero safety failures. Historical
wire103 passed its first six turns but failed R03 turn 1 notes assertions.
Wire104 has no live evaluation; no prefix credit is carried forward.

## Ledger-only snapshot; no readiness claim

The source-hardcoded account root exists at
`/Users/bichtuyen/code/calenote/.worktrees/product-experience-v2/.superpowers/sdd/2026-09-28-llm-context-contract-implementation`.
Only directory metadata and validated `campaign.jsonl` accounting were read.
No credentials, owner messages, responses.json, raw provider payloads or private
conversation data were read. No locks or ledger records were written.

At this inspection the root contains 261 histories, inventory digest
`e30734260b6d363fcc14f6345a5ac48df0e2234c314e7f8068d6fce7d41bf22b`.
PILOT has 1,023 reservation rows: 982 settled calls totaling 926,785 ledger
microunits, and 1,265,664 unknown-exposure microunits. FULL is zero. There are
29 prospective unresolved claims, 14 consumed-message markers and no root
account.lock. These figures differ from the October 13 checkpoint; they do not
supersede its historical observations or establish complete owner-approved
account inventory. No exact sub-microunit USD total was derived.

The ordinary confirmed-cost policy rejects a prospective unresolved claim;
this snapshot has 29. Its nominal $1.50 cap is not a fresh allocation. The
separate conservative debug policy may account for UNKNOWN against a reviewed
cap of at most $10, but this inspection did not load or authenticate that grant.
Neither the old $1.50/$1.00 runbook figures nor the historical $10 debug
headroom is current paid permission. Reconcile the expected complete account
namespace, policy and immutable historical records before a readiness claim.
Do not release UNKNOWN or rewrite history to make a gate pass.

## Next stage

1. Finish offline integration/review, freeze explicit application and harness
   SHAs, and regenerate the unchanged manifest and loaded-source proof. The
   following is a pure metadata command, with no grant, accounting or network:

   ```sh
   node --import ./tools/benchmark/register-conversation-loader.mjs --input-type=module -e 'import {deriveBoundedPilotManifest} from "./tools/benchmark/context-bounded-pilot.ts"; console.log(JSON.stringify(deriveBoundedPilotManifest(process.cwd())));'
   ```

2. Independently reconcile the accounting inventory and applicable owner-approved
   policy. Generic `inspectConfirmedCampaignCost` also reads responses.json for
   precision, so it was deliberately not invoked in this metadata-only audit.
3. Obtain fresh direct paid approval bound to the exact candidate/harness,
   manifest, route, policy, cap and ordered Formal Pilot scope. Broad completion
   permission and possession of credentials are insufficient. Existing direct
   messages, consumed markers and stopped execution directories cannot be
   repackaged or resumed. The Google-429 successor mechanism requires its own
   reviewed throttle evidence and fresh scope; a settled semantic failure is
   not eligible for a 429 recovery exception.
4. Only after those gates, reviewed trusted orchestration may bind fresh pins
   and use either the specifically approved bounded-Pilot authority path or the
   specifically approved conservative debug-loop `FORMAL_PILOT` path. These are
   distinct policies, not interchangeable launchers. The latter entrypoints are
   `loadTrustedDebugLoop` and `runTrustedDebugLoopExecution`; there is no generic
   debug-loop CLI that safely supplies missing trust pins. Do not run the older
   generic live CLI as a substitute for current reviewed authority.
5. Actual execution starts at R01 turn 0 and stops on the first failed gate,
   semantic/action oracle, transport or accounting boundary. No automatic retry,
   prefix reuse or Full start. Formal Pilot PASS must bind the exact source,
   full evidence, final ledger and report before separately authorized Full.

No further semantic implementation gap was established by this audit. The
remaining blockers are source-bound qualification, accounting/authority
readiness, then separately authorized Full and release gates. Runtime and UI
capabilities remain default off; migration 0009 stays local review only.

## Accounting reconciliation checkpoint — 2026-10-16

The later independent read-only audit classified the29 prospective claims more
precisely: all have DISPATCH, FINISH with null observedMicrounits, and STOP
UNKNOWN_USAGE. There are no prospective pre-dispatch claims or missing FINISHes.
All29 existing response artifacts were projected for accounting metadata only;
26 report HTTP400 and3 no HTTPstatus, with no numeric bound cost evidence for
any unresolved call. No financial claim can be reconciled from those artifacts.
The existing grammar disallows a second FINISH; these are terminal UNKNOWN,
not open calls to finish with an invented zero.

The same261-history inventory digest remains unchanged. Its41 UNKNOWN comprise
12 historical and29 prospective. The prospective full request bounds total
3,058,688 microunits, in addition to1,265,664 historical UNKNOWN exposure and
926,785 known ledger settlements: conservative retained exposure5,251,137.
These numbers are safety accounting, not actual spend, a new cap, paid permission
or complete authenticated account inventory. No UNKNOWN was released and no
ledger/consumed marker was rewritten. Ordinary confirmed-cost admission remains
blocked. Keep PAID HOLD and historical incident UNKNOWN.

Offline bugfixes and release preparation after this checkpoint do not qualify
wire104. Freeze the eventual exact application/harness source anew; the original
manifest remains unchanged. See
[completion status](../implementation/product-closeout-status.md) for implementation
versus qualification/release boundaries. Prior source-bound grants and release
packets cannot be silently reused for a changed PR HEAD.
