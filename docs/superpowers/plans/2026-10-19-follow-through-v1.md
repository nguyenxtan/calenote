# Follow-through V1 implementation plan

> Required workflow: subagent-driven-development, TDD, independent task/whole-branch review, verification-before-completion. Owner approved written V1 and explicitly requested implementation/full tests with minor decisions autonomous; no repeated approval gate.

Goal: implement approved Done/Snooze/Reschedule/Stop + opt-in bounded follow-up for web and private chat.
Architecture: separate work progress and immutable delivery/run lineage, append-only0014, same existing scheduler/providers/keyring. Trigger new-root creation in the same reminder-creation transaction across web/chat/series without modifying old delivery statuses. Add explicit atomic spawn permits if needed to avoid turning child runs into new work roots.
Spec: docs/superpowers/specs/2026-10-19-personal-follow-through-v1-design.md
Base: c8119bc (design), appbase96aa378; feature branchcodex/follow-through-v1. Auth/Settings PR14 remains separate.

## Global constraints
- No production/provider/paid calls, remote migration, grants or deploy. Vietnam timezone; original private bot/channel only.
- OPEN/DONE/STOPPED progress independent of delivery. Historical reminders UNTRACKED, explicit adopt. New creation triggers atomic tracking for individual occurrences, never entire-series completion.
- Follow-up disabled by default;30m/2h/24h;max3 automated children lifetime; no replay flood or UNCERTAIN chaining. Manual presets15m/1h/tomorrow09:00 and explicit future reschedule.
- Atomic owner/chat scope, revisionCAS, durable idempotency receipt+payload digest. Child encrypts under its own reminder entity ID and retains companion details canonically. Done may not recall acquired sends; no new acquisition afterDone/Stop/current-run change.
- Schema-wholly-absent legacy fixtures may remain legacy; partial feature schema fails closed. Actual migrated Worker/SQLite tests required, not only mocks.
- Strong receipts after lost response: retry same key+body; never blind new-key replay. Side-effect-free bounded GET endpoints. Strict contract types, same-origin mutations, safe headers, input bounds/rate limits.

## Files/ownership and interfaces
1 Backend implementer owns migrations0014, src/modules/follow-through/* (exceptchatadapter), src/contracts/api/follow-through.ts +tests. Exports D1FollowThroughService(db,keyring,options?) with list(scope), act(scope,input), processDue(now,limit); scope {userId,chatIdentityId?}; actions ADOPT,DONE,STOP,SNOOZE,RESCHEDULE,POLICY. Public list should include tracked items plus clearly UNTRACKED historical entries, bounded100+cursor; avoid treating old historyOPEN. No rootworker/sharedinbound/delivery/UI edits. Provide stable typedcontract quickly.
2 Runtime implementer owns reminder delivery store guards/render, follow-through/chat-adapter.ts +tests; integrate processInbound optional followThrough handler before semantic turns. No backend-owned service/schema edits. Root wires handler/service/scheduler/actual routes. Match final servicecontract withbackend implementer. Preserve legacy optional deps/testfixtures; actual migrated guards mandatory.
3 Root owns worker versionedroutes/factory/router/Cron wiring, Today/Reminders FollowThroughPanel and browser interactions, testfixture plumbing and finalintegration. Backend andruntime work independently with explicit interface updates.

## Tasks
- [ ] Backend RED: owned creation/adoption, progress, receipts/replay/staleCAS, no leakedciphertext/plaintext, childtitle/details encryption, limit and connectionguards. GREEN atomicSQL/migration.
- [ ] Runtime RED: acquired send vsDone/currentrun fence; inactivebot, uncertainty, limit/restart; explicit provider-neutral chatref and ambiguity forZalo/Telegram. GREEN guard/handler/render.
- [ ] Root RED: real versionedroutes/session/keyring/SQLite,401/404/origin/limits, CAS actionrequests; UI preview/pending/retry/readback and oldcompat. GREEN composition/Cron/UI.
- [ ] Task reviews, fix Critical/Important; desktop1280/mobile375/keyboard/accessibility synthetic fixture QA.
- [ ] Freeze clean immutablecandidate then run one fullsuite; build/type/lint/docs/types/dryrun; finalwholebranchreview, draftPR and evidencepacket. No checkout or source edits during qualifiedfullsuite.

## Rulings
- Initial implementation may use additional ephemeral creation/spawn capability table plus scoped SQL triggers; costs some schema complexity but keeps all current creation paths atomic and preserves core reminder statuses.
- No native providerbuttons/newLLM; explicit scoped shortcodes with ambiguity refusal. Webowner may seeallownedwork; chatonlyoriginalidentity/connection.
