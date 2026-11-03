# User updates and product gaps — 2026-10-20

Source baseline: c8c522bbf2a2995f19f0b03da18920d1a67769ab. This inventory describes source; it does not certify new provider E2E flows.

## User-facing updates

AppShell now hosts a bell and a native modal dialog with short Vietnamese updates. Acknowledgement stores only a catalogue ID in browser localStorage. It is browser-wide, not an account-level or cross-device read receipt. Opening/closing alone does not acknowledge. No notification permission, push, API, migration, or privileged access is added. Native dialog handles focus containment and Escape; closing restores the trigger. Storage denial does not prevent reading.

Maintain ProductUpdates.tsx newest first; add only verified shipped features. The first ID is the unread comparison marker. Do not import internal admin operational evidence into customer copy. This candidate is not released by its own catalogue.

## Remaining product gaps

- Daily morning brief/evening review and carry-over review: no dedicated implementation found.
- Life Calendar: annual birthday/memorial/renewal management and indefinite solar/lunar recurrence remain absent. Conversation cadence supports explicit one-off / finite daily series; see src/modules/conversation/context-contract/prompt.ts.
- Long-term personal memory and smart deadline strategies: no dedicated product subsystem found; short conversation context is not equivalent.
- Subscription plans, customer quotas and payments: absent. Admin accounting is not billing or reconciled provider cost.
- Native mobile apps, voice, Share Sheet, email ingestion and external calendar sync: no dedicated implementation found; external-source-boundary.md treats external sources as future contracts.
- Shared workspaces and multi-device session management require separate contracts; see docs/roadmap.md.
- Follow-through exists in src/modules/follow-through, src/features/follow-through and worker routes/tests. The historical release catalogue explicitly records incomplete live coverage of chat/OTP/automatic cycles. This is a verification gap, not proof that source is absent.

The roadmap contains historical claims such as admin NOT_IMPLEMENTED and pending old migrations. Use current source and exact release evidence rather than treating those paragraphs as a current feature checklist. Future admin rollout controls/active-version inventory remain distinct from the read-only release catalogue.

Recommended next product slice: annual Life Calendar events, then Daily Brief/Review. Verify existing chat follow-through production behavior before claiming full cross-channel qualification.
