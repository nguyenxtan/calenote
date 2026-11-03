# Keyed AI production cutover implementation plan

> **For agentic workers:** Use superpowers:executing-plans for native implementation; request a read-only final review before merge.

**Goal:** Merge the qualified AI repair with current master and deploy the actual keyed AI runtime to the existing Cloudflare Worker.

**Architecture:** Preserve master's production features, data schema and release metadata. Move the byte-equivalent tested gateway/schema transformations into src, reuse it from benchmark tools, then activate Queue/HTTP/cron coherently using the serving version's full commit tag. Keep canonical storage/encryption identity unchanged.

**Tech Stack:** TypeScript, Zod, Cloudflare Workers/D1/Queues, Wrangler, Vitest.

**Spec:** User requests merge into the correct production branch and deploy Cloudflare; docs/implementation/ai-keyed-comparison-2026-11-03.md records the qualified synthetic contract. Runtime promotion choices below are the implementer's choices within that request, not an extra owner-approved privacy or budget expansion.

## Global constraints

- Production branch master; preserve legacy main and existing feature branch.
- Same GPT-5 mini low/Azure Sweden route, required ZDR, no fallback,3072 output,45s timeout,32KiB response.
- Preserve atomic budgets50 calls/owner/day,500000 microunits/owner/month,2000000/global/day. Exact reservation116759 from400000 input exposure at275000 and3072 output at2200000 microunits/million.
- Synthetic inference key lifetime ceiling remainsUSD2; never install the expiring test/management key as a production secret.
- No new migration or secret rotation for transport promotion. Inspect actual remote schema; auth currently denies D1 read with7403, owner asked to reauthenticate while preparation continues.
- Keep CONTEXT_PROTOCOL_V3 canonical storage, ownership fences and confirmation authority.
- Upload once with exact40hex master SHA tag; record rollback version and promote that immutable version; provider-free HTTP smoke only.

## Review focus

- Unsupported recurrence must reach backend semantic policy, not advisory prose only.
- Shared runtime/benchmark requests must retain the exact139 wire/schema/provider limits.
- Atomic reservation must equal gateway maximum, including unknown-dispatch retention.
- Queue/HTTP/cron must share activation/source identity; malformed/missing tag must fail closed.
- Expired successor contexts must purge without touching incompatible legacy ownership or encrypted data.
- Existing master personal-assistant/follow-through commands and auth must retain their dispatch precedence.

## Tasks

- [x] Preserve tested repair as candidate commit after fresh full suite; merge origin/master on feature branch, resolve two known conflict areas preserving both behaviors, frozen-install dependencies.
- [x] Add failing parity/admission tests; move gateway and schema helpers into production infrastructure, keep benchmark entrypoints as reexports/adapters, run parity/security tests.
- [x] Add failing runtime profile/reservation tests; add exact keyed parser and matching D1 limits while retaining legacy parsers; update canonical vars and generated Worker types.
- [x] Add failing entrypoint/HTTP/expiry tests; activate with valid CF_VERSION_METADATA.tag and add family2 expiry cleanup; preserve master command ordering and privacy.
- [ ] Run full pnpm check and fresh full32 synthetic campaign on final merged source within existingUSD2; obtain independent read-only review and fix blockers.
- [ ] Commit immutable reviewed result, update master without force, push. Verify remote migration and secret-name preflight, upload tagged version, promote once, verify health/release metadata/assets and record rollback evidence.

## Authority and limitations

The user already directed autonomous work and explicitly requested merge/deploy; no repeat integration-choice menu is needed. Existing production credentials remain in Cloudflare. Any unavailable required authentication remains a real external prerequisite, not an authorization inferred from elapsed time. Synthetic qualification does not claim real bot delivery or heldout performance.

## Execution ledger

- Baseline: fresh276 files/10608 tests pass (2 existing optional skips),654.74s; candidate a62fd6b preserves the original139 qualified repair.
- Merge2e4c12d includes current master f11b19d; two conflicts resolved preserving master UI test and personalized successor replies with keyed emission identity.99 merge-focused tests pass.
- Gateway:5 new regression tests failed for missing runtime factory/parser, then28 gateway tests pass. Qualified R01/R07/R10 request hashes match the original full139 exchanges exactly.
- Composition:3 regressions failed for missing metadata activation, mismatched/absent reservation and uncleared family2 state; then18 composition tests pass with actual SQLiteD1 reservation116759 and expiry cleanup.
- Local/UI:3 local reads attempted model calls and real app Inbox had no preview before wiring; all61 focused consumer/config/API tests pass after retaining exact local reads and enabling all3 real pages. One test-only TypeScript excess-property annotation corrected afterward.
- Cloudflare reauthentication completed; remote migrations through master have no pending changes; readonly active-context count is empty, no legacy active state to drain. Rollback version50e1bffb-0bdd-4125-8ae6-8dc40f1a25fd, original master f11b19d223ddb01abfe9bc1c096d07fc331b8c51.
- Ruling: keep explicit preview confirmation for the qualified successor; the old auto-save preference is not granted new confirmation authority. Product release notes disclose this behavior.
- Ruling: preserve exact local read-only interception only, never fallback after arbitrary model failure; master memory/follow-through and reply personalization remain intact.
- Ruling: preserve existing production secrets and all account budget ceilings; do not install the expiring test key or management key.

- Full engineering attempt on f45198e found12 failures in legacy V1/V2 tests that implicitly consumed the newly changed production vars. All336 other files passed. The paid cutover campaign was stopped only after response settlement:23 calls,knownUSD0.050113668,unknown0,no request in flight; it is not acceptance evidence.
- Ruling: retain the new canonical production route. Historical legacy tests use a fixed reviewed Gemini fixture, and historical MOCK benchmark tests use an isolated reference root. Root/accounting/live authority fences remain unchanged; current keyed production explicitly fails the old benchmark preflight. No frozen business oracle/manifests were changed.
- Additional regression coverage uses current canonical vars through real composition/D1 for3 tightened atomic limits and complete inbound-to-family2-preview creation with settled cost. A malformed text/plain fake response was corrected to application/json; production media validation was not relaxed.
- Final source review found no Critical/Important blockers. Deferred minor:3 pre-existing-in-change comments still say synthetic/dormant (keyed-small-protocol.ts2,keyed-small-wire.ts1,composition-root.ts458); no behavior change needed for those comments.
