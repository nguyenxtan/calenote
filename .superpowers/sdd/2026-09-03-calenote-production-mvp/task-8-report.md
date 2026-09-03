# Task 8 implementation report

Date: 2026-09-03

## Scope and commits

- Reviewed starting HEAD: `93b3512b036b44465cd555952c9d799f8dc8d568`.
- Task 8 implementation commit: `19b5314e43b5f8e5a3007a2be4aa3cc1e0f6ee22` (`feat: complete production auth and reminder APIs`).
- Official-review fix commit: `e5810b4e39fdec8d8e4bce087026ab0afc7cee49` (`fix: fence recovery against stale login proofs`).
- This report is committed separately because its implementation SHA must be recorded exactly.
- The controller-owned `docs/superpowers/plans/2026-09-03-calenote-production-mvp.md` modification was neither edited nor staged by Task 8. No progress file was staged.

## RED evidence

Implementation followed test-first slices. Representative observed RED runs were:

- `pnpm vitest run src/worker/routes/api-contract.test.ts`: the first browser-contract slice failed all 18 new tests before the routes and safe mappings existed; the same file was expanded as further contract cases were found.
- `pnpm vitest run src/modules/auth/login-service.test.ts`: the first migrated-D1 login slice exposed the concurrent fourth-dispatch bug (1 failure); expanded preflight coverage later exposed 6 delivery/dispatch failures, then 2 malformed-credential/verification-race failures, and finally 3 exact-snapshot/pre-provider failures before each implementation step.
- `pnpm vitest run src/worker/index.test.ts`: the noncanonical 22-character pad-bit Queue ID case failed before canonical decode/re-encode validation; the Cron isolation cases failed before the three lanes used independent settlement.
- `pnpm vitest run src/worker/routes/api-contract.test.ts -t "requires a session before resource operations"`: failed with `received 200` / `expected 401` because `GET /api/session` constructed operations before canonical-cookie rejection.
- `pnpm vitest run src/worker/router.test.ts -t "times out a stalled onboarding body"`: failed because the response remained pending (`null` instead of `Response`) before the 5-second onboarding body deadline was supplied.
- `pnpm vitest run src/modules/onboarding/recovery.test.ts src/modules/auth/login-service.test.ts` (official-review follow-up) -> 2 files failed, 3 tests failed and 41 passed: an old proof still verified after public recovery in both sequential SENDING and paused-verification interleavings, and unknown email stopped before the real-wrong crypto/D1 sequence.
- `pnpm vitest run src/modules/db/d1-workerd.integration.test.ts` reached a behavioral RED after the real binding fixture was corrected: 2 tests passed, while the paused old proof still minted a session after recovery. The two passing tests already exercised workerd D1 batch rollback and `meta.changes` classification.
- `pnpm vitest run src/modules/auth/login-service.test.ts -t "fails closed when corrupt stored ciphertext"` -> 1 failed because a submitted value equal to the generated dummy proof could pass comparison after a decrypt failure. The fix now requires both successful decryption and equality.

Each RED was observed before its corresponding production change. No test was weakened to obtain GREEN.

## GREEN evidence

Final commands were run from the production MVP worktree after the last code change:

- `pnpm vitest run src/worker/routes/api-contract.test.ts -t "requires a session before resource operations"` -> 1 passed.
- `pnpm vitest run src/worker/router.test.ts -t "times out a stalled onboarding body"` -> 1 passed.
- `pnpm vitest run src/modules/auth/login-service.test.ts src/modules/auth/dashboard-service.test.ts src/modules/db/code-store.test.ts src/modules/db/onboarding-store.test.ts src/modules/onboarding/recovery.test.ts src/modules/onboarding/retry.test.ts src/modules/onboarding/service.test.ts src/modules/reminders/api-service.test.ts src/worker/routes/api-contract.test.ts src/worker/index.test.ts src/worker/router.test.ts` -> 11 files passed, 169 tests passed.
- `pnpm test` -> 29 files passed, 451 tests passed.
- `pnpm typecheck` -> passed (`tsc --noEmit`).
- `pnpm lint` -> passed with no warnings or errors.
- `pnpm build` -> passed; Next.js 16.3.4 produced the static `/`, `/_not-found`, `/dashboard`, and `/docs` routes.
- `pnpm wrangler types --check` -> passed with Wrangler 4.128.0; `worker-configuration.d.ts` is current.
- `pnpm wrangler deploy --dry-run` -> passed with Wrangler 4.128.0; the Worker bundle, static assets, Queue, D1, assets, and APP_ORIGIN bindings were recognized. This exited at `--dry-run` and did not deploy.
- `git diff --cached --check` before the implementation commit -> passed.

Official-review follow-up gates were rerun after the final production change:

- `pnpm vitest run src/modules/onboarding/recovery.test.ts src/modules/auth/login-service.test.ts src/modules/db/d1-workerd.integration.test.ts` -> 3 files passed, 49 tests passed.
- `pnpm test` -> 30 files passed, 459 tests passed.
- `pnpm typecheck` -> passed (`tsc --noEmit`).
- `pnpm lint` -> passed with no warnings or errors.
- `pnpm build` -> passed; Next.js 16.3.4 produced the static `/`, `/_not-found`, `/dashboard`, and `/docs` routes.
- `pnpm exec wrangler types --check` -> passed with Wrangler 4.128.0; generated types are current.
- `pnpm exec wrangler deploy --dry-run` -> passed; 43 built asset files and the Queue, D1, assets, and canonical APP_ORIGIN bindings were recognized, then Wrangler exited without deployment.
- `git diff --cached --check` before the official-review fix commit -> passed.
- A post-suite process check found no Miniflare/workerd process from this worktree; each runtime fixture is disposed after its test. The one-off diagnostic probe was also terminated before final gates.

The final test suite includes executable migrated-SQLite/D1 coverage for issuance/rotation and plaintext absence; real/decoy publication symmetry; rejected/ambiguous enqueue recovery; due-query plans; fresh/stale lease boundaries; overlapping fourth-dispatch Cron races; concurrent stale terminalization; consumed-SENDING selection; exact delivery-snapshot races; local token/code validation before ownership; terminal-write failure; verify-during-SENDING success/failure; same-millisecond concurrent verification; correct-versus-fifth-wrong verification; tenant-scoped dashboard/reminder reads and cancellation; create identity derivation; cancellation-versus-send; public recovery/session revocation; recovery-versus-stale authenticated rotation; and independent Cron lanes.

## Fresh Wrangler-local D1 validation

A new persistence directory, `/tmp/calenote-task8-d1.DUYG72`, was created only for this validation.

- `pnpm wrangler d1 migrations apply calenote-production --local --persist-to /tmp/calenote-task8-d1.DUYG72` -> both `0001_production_mvp.sql` and `0002_onboarding_transition_marker.sql` applied successfully; 34 commands then 2 commands completed.
- `pnpm wrangler d1 execute ... --command "PRAGMA foreign_key_check;" --json` -> success with an empty result.
- Read-only `sqlite_master`, `pragma_table_info`, and `d1_migrations` queries confirmed:
  - `login_codes` and `reminders` exist;
  - `verification_marker`, delivery `transition_marker`, and `dispatch_marker` are distinct nullable login columns;
  - `reminders.public_id` is NOT NULL;
  - the one-unconsumed, bounded due-dispatch, all-SENDING stale, rate-expiry, and reminder-due indexes exist;
  - both migration records exist.

Wrangler-local D1 rejects `PRAGMA integrity_check` with `SQLITE_AUTH`; this optional diagnostic was not used as a gate. The supported required foreign-key and schema/catalog checks passed.

The official-review follow-up repeated this validation in a new persistence directory, `/tmp/calenote-task8-review-d1.HVgA2m`:

- `pnpm exec wrangler d1 migrations apply calenote-production --local --persist-to /tmp/calenote-task8-review-d1.HVgA2m` -> both exact migrations applied locally (34 commands, then 2 commands).
- `PRAGMA foreign_key_check` through local Wrangler D1 -> success with an empty result.
- Read-only `sqlite_master`, `PRAGMA table_info(login_codes)`, and `d1_migrations` checks confirmed the login/session/audit tables, bounded due and all-SENDING indexes, distinct nullable verification/delivery/dispatch markers, and both migration records.
- The new pinned `miniflare@5.20260831.0-alpha` integration suite separately applies the same migration files through an actual workerd-backed D1 binding. It proves constraint-triggered guarded batch rollback, real `meta.changes` 1/0 behavior used by claim classification, a single recovery winner against paused verification, no partial login/connect/session/audit state, and the exact email 10/IP 30 verification rate-limit bounds.

## Design and security decisions

- Login request issuance uses one D1 batch to rotate earlier unconsumed codes and conditionally insert one encrypted real row. It then makes exactly one Queue send with a canonical real-or-decoy opaque ID. Queue rejection uses the same opaque-ID release call for real and decoy; it restores the exact previous dispatch lease/count/marker only while still owned and never deletes the durable code.
- Login Queue payloads contain only `{type:"DELIVER_LOGIN_CODE",loginCodeId}`. All three job types use canonical base64url decoding/re-encoding through the shared decoder, and malformed jobs are terminally acknowledged before D1 work.
- Delivery pre-reads the exact tenant, connection state, credential version/ciphertext/IV, connection timestamp/marker, private chat, code state, and dispatch snapshot. Code and token are decrypted and locally validated before a guarded SENDING CAS and before provider egress.
- Deterministic pre-provider corruption terminalizes only through an exact guarded batch; a failed/missed terminal write stays retryable. Provider ambiguity becomes UNCERTAIN and is never resent. Deterministic failure preserves any earlier verification `consumed_at`. Verification uses its own marker and never overwrites delivery or dispatch markers.
- Correct verification conditionally consumes the exact code and inserts one prepared 256-bit session plus content-free audit evidence in one guarded transaction. Concurrent correct proofs and correct-versus-fifth-wrong races yield one session winner.
- Public recovery consumes every outstanding unconsumed login proof for the recovered user inside the same guarded transaction before revoking old sessions and inserting exactly one replacement. This includes SENDING rows without changing their delivery marker, so an in-flight sender may finalize but the proof can never verify after takeover.
- Unknown/ineligible email and real wrong proof now follow the same coarse dependency sequence: a canonical random dummy challenge is encrypted in memory, session material is prepared, the selected real-or-dummy challenge is decrypted and constant-time compared, and one conditional failed-attempt write targets either the real row or a canonical no-op identity. The 10/email and 30/IP pre-checks bound this work. This reduces the observable coarse-path oracle but does not claim exact wall-clock equality.
- Encrypted login/recovery readers accept same-realm or cross-realm ArrayBuffers, typed views, and validated byte arrays returned by the local D1 binding, while continuing to reject non-byte or out-of-range values before decryption.
- Cron uses the reviewed bounded Task 7 leases and limits. Overlapping reservation/exhaustion paths are snapshot-fenced; rejected publication restores an owned prior reservation; stale SENDING terminalization installs a distinct one-winner marker. Reminder, inbound, and login lanes start together and settle independently.
- Public exact-proof onboarding always performs read-only token verification first. ACTIVE_UNBOUND and ACTIVE_BOUND recovery do not call `setWebhook`; authenticated ACTIVE_UNBOUND retry performs zero provider calls. Provider work is fenced by exact prior state/timestamp/marker. Public recovery revokes every older non-revoked user session and inserts one replacement in the same guarded transaction; authenticated retry preserves its current session.
- Authenticated connect-code rotation is fenced by the pre-read owner/state/`updated_at`/`transition_marker` snapshot so a paused old session cannot consume a code created by public recovery.
- Reminder browser IDs are distinct canonical random IDs; internal reminder IDs remain Queue/AAD-only. Browser create derives the sole personal workspace and bound private identity server-side. Create and cancellation use stable user-HMAC 30/minute limits before mutation or cancellation lookup, and cancellation is a guarded first-winner transaction.
- All Task 8 JSON routes use the exact safe response registry, JSON/no-store/nosniff headers, `Vary: Cookie` for authenticated paths, strict objects, bounded timed bodies, and origin/session guards before resource lookup or provider egress. Unknown `/api/*` paths and methods return JSON `API_NOT_FOUND` and never reach assets.
- Health is a process/config readiness check only: canonical origin, exact binding shapes, and master-key construction. It does not query D1 or disclose configuration detail. Valid request-code factory/config failures alone map to `SERVICE_UNAVAILABLE`; unrelated failures remain generic 500.

## Residual risks and exclusions

- No live Zalo/Telegram provider call, production D1 query/migration, Queue publication, secret read/write, Cloudflare resource mutation, deployment, or push occurred. Provider and remote Cloudflare behavior therefore remain release-time integration checks.
- D1 and Queue cannot commit atomically. The design deliberately leaves accepted/ambiguous work safe under duplicate Queue delivery and recovers definitely rejected publication through the minute Cron with bounded leases.
- The checked Wrangler configuration still contains the pre-production placeholder D1 database ID; real resource creation/binding and the production schema/data readiness check belong to the later release task.
- The current one-master-key/key-version-1 design is unchanged; production key rotation still requires the separately planned dual-key migration.
