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

- [ ] Preserve tested repair as candidate commit after fresh full suite; merge origin/master on feature branch, resolve two known conflict areas preserving both behaviors, frozen-install dependencies.
- [ ] Add failing parity/admission tests; move gateway and schema helpers into production infrastructure, keep benchmark entrypoints as reexports/adapters, run parity/security tests.
- [ ] Add failing runtime profile/reservation tests; add exact keyed parser and matching D1 limits while retaining legacy parsers; update canonical vars and generated Worker types.
- [ ] Add failing entrypoint/HTTP/expiry tests; activate with valid CF_VERSION_METADATA.tag and add family2 expiry cleanup; preserve master command ordering and privacy.
- [ ] Run full pnpm check and fresh full32 synthetic campaign on final merged source within existingUSD2; obtain independent read-only review and fix blockers.
- [ ] Commit immutable reviewed result, update master without force, push. Verify remote migration and secret-name preflight, upload tagged version, promote once, verify health/release metadata/assets and record rollback evidence.

## Authority and limitations

The user already directed autonomous work and explicitly requested merge/deploy; no repeat integration-choice menu is needed. Existing production credentials remain in Cloudflare. Any unavailable required authentication remains a real external prerequisite, not an authorization inferred from elapsed time. Synthetic qualification does not claim real bot delivery or heldout performance.
