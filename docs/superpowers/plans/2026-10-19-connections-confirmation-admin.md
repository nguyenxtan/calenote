# Connections, chat confirmation and admin implementation plan

> **For agentic workers:** Execute independent connection and confirmation tasks in parallel, then root integrates admin/router and runs whole-branch review.

**Goal:** Deliver approved usable Zalo/Telegram add/disconnect, default chat auto-confirm with account preference, and owner-only aggregate admin overview.
**Architecture:** Existing Worker/D1/session security remains authoritative. Isolated feature branch from master b11c7d4; preserve unrelated UI and immutable candidate packets. User approved design and explicitly requested implementation/full tests on2026-10-19; no further implementation approval required.
**Tech Stack:** Next16.3.4/React19/TypeScript6/Vitest4/D1/Worker.
**Spec:** User-approved in-chat design2026-10-19 and previous reviewed admin73 contract; existing disconnect design used only where consistent.

## Global constraints
- No production credentials, queries, migrations, resource/provider calls, grants, deployment or paid AI. Test synthetic local data only.
- Never infer adminidentity from email/displayname; empty/malformed allowlist denies; private aggregate access only server-authorized.
- Chat auto-confirm applies explicit complete CREATE intent, not greetings/ambiguity or other privileged actions. Clarification/validation/dedup remain.
- Disconnect is Calenote-local disable, not platformbot deletion/token revocation. Preservehistory/reminders, block ingress/egress, no backlog replay or implicit crossbot rerouting. Explicit copy states platform cleanup not performed.
- New migrations append-only, source/migration scope reviewed. No overwrite of old packets or unrelateddirtywork.

## Review focus
- Cross-account reads/mutations and defaultdenyadmin.
- Lost responses/repeated webhook confirmation duplicate effects.
- Inflight egress vs disconnect; no claim that active sends can be recalled.
- Persisted preferences omitted by old clients/migration defaults.
- FinancialUNKNOWN remainsunknown; no invented provider invoices or overlappingbudget sums.

### Task1 Connections (connection_lifecycle)
- [x] Read existingbranch implementation; preserve newermaster functionality.
- [x] RED tests ownership/add/disconnect/pending/inflight/reconnect/lastloginbot behavior; implement minimal coherent lifecycle and UI; GREEN.
- [x] Supply root sharedrouter/composition integration.

### Task2 Chat confirmation (chat_confirmation)
- [x] RED persisted accountpolicy API/store/Settings tests; default auto, manualoptin; implement GREEN.
- [x] RED actual chat explicitcomplete/missinginfo/duplicate/manual flows; implement via existing fenced confirmation GREEN.
- [x] Preserve defaultoff successor and paidHOLD; provide shared wiring.

### Task3 Admin (root)
- [x] Port reviewed73tests first to currentmaster; demonstrate missingmodules RED.
- [x] Port/adapt aggregate service/strictcontract/sessionallowlist API/UI; serverguard before any aggregatequery.
- [x] Add discoverable admin navigation only after successful server capability check, no frontendidentitytrust.
- [x] Show accountcount, recordedDAU/MAU, outstandingreserved/monthlyfinalized budget; actualprovider/invoicecost UNKNOWN with honestlabels.

### Task4 Integration/verification
- [ ] Integrate sharedrouter/composition once agents return; verify actualroutes/SQLite/security and fullsuite.
- [ ] Typecheck/lint/build/Worker dryrun/types followingguidance; synthetic desktop/mobile375/keyboard/accessibility.
- [ ] Independent wholebranchreview, fix evidencedbugs, rerun affectedchecks; commitreviewablecandidate and report remainingrelease/adminidentity gates.

## Ledger
-2026-10-19: Owner approved implementation/test of alldomains. Reuse oldcandidate only as source, revalidate oncurrentmaster.

- Ruling: multi-bot add must preserve usable login/manual creation. Added minimal primary selection0013 and explicit manual target bound into intent digest; no implicit selection among ambiguous existing bots.
- Targeted evidence: connections236tests; V2runtime42; prefs33; compatibility105; admin23; explicitmanualtarget/UI20+14. Typecheck/lint/build passed before immutable fullsuite.
- Initial fullsuite aborted130 while concurrent source edits changed provenance. Re-run on clean commit; no benchmark guard weakened.

- Independentreview found unconditionallease release after ambiguousprovidercompletion; RED/GREEN actualSQLite/ContextContract tests nowretainleases for timeout/invalidreceipt/typingfailure, release only provenpre-dispatch or settledsuccess. UNCERTAINlogin/reminder blocksdisconnect. PrimaryUI staleGET/mismatchedPATCH fix alsoRED/GREEN8tests. No provider/networkauthority change.
