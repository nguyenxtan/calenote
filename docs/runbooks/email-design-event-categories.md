# Transactional email and personal event categories

## Candidate behavior

OTP emails include self-contained HTML and plain text, a six-digit code, ten-minute validity and a security notice. No external image, font or tracking requests are embedded. Welcome emails are sent only after a successful first email-verified registration, never for subsequent logins or failed proof. The configured APP_ORIGIN supplies the welcome link; it contains no login token.

Apply forward migration `0018_email_welcome_delivery.sql` before deploying this candidate. A per-user durable record reserves the welcome attempt before contacting the sender. `SENT` means the provider acknowledged the request, not mailbox receipt. `ATTEMPTED` includes failed or unknown outcomes and is never automatically retried. A five-second deadline bounds the welcome wait; account verification/session remain valid if welcome delivery fails. A process interruption after reservation can lose the welcome; this intentionally favors avoiding duplicate email over retrying an unknown outcome. Existing accounts receive no retroactive welcome.

The four built-in event kinds remain. Each owner's encrypted personal document may contain up to 30 custom categories (50 characters per name). Events refer to those categories by ID, using underlying kind OTHER. API validation rejects duplicate IDs, normalized duplicate names, built-in name duplicates and dangling references. Old documents remain readable. After users save custom categories, older Workers with strict document schemas cannot read those documents; use a forward fix rather than a raw Worker rollback that would block personal scheduling. A category can be renamed; removing one leaves events as OTHER. Category metadata does not affect the scheduling fingerprint, recurrence or reminder offsets.

The editor offers bounded title hints, e.g. thay nhớt → Chăm xe and tái khám → Sức khỏe. Selecting a hint explicitly creates or reuses a normalized category. Unknown titles receive no guess. This is deterministic editor assistance, not an AI/chat integration. Pilot AI remains on HOLD; no provider calls or chat-side category creation are introduced.

## Qualification

Use synthetic HTML previews and a local static/API fixture for visual checks. These do not establish Gmail/Outlook rendering or production delivery. Unit/integration tests cover HTML injection, plain-text fallback, account proof, welcome deduplication/failure, category ownership, normalization, references, rename/delete and unchanged reminder scheduling.

This candidate changes backend behavior and requires its own exact-SHA production approval. Prior fba90c7 release authority does not authorize this candidate, migration 0018 or additional test email sends. Preserve existing sender domain, root mail DNS, bindings, admin grants and paid AI HOLD.
