# Calenote V2 Public Entry Design

## Goal

Complete the V2 journey before the authenticated application: a lightweight landing page, the existing secure first-time bootstrap at `/onboarding`, passwordless returning-user login at `/login`, and a compatibility redirect from `/dashboard` to `/app/today`.

## Fixed routing

| Route | Responsibility |
| --- | --- |
| `/` | Public Landing V2; does not request session or personal data. |
| `/onboarding` | First-time setup UI backed only by the existing `POST /api/onboarding` authority. |
| `/login` | Returning-user six-digit bot-delivered OTP. |
| `/app/today` | Canonical authenticated home. |
| `/dashboard` | Compatibility redirect to `/app/today`. |

## Authority and security

`POST /api/onboarding` remains the only unauthenticated first-time authority. It preserves same-origin enforcement, bounded body and rate limit, credential encryption, session issuance, and one-time connect-command issuance. The public UI never adds a privileged unauthenticated endpoint, logs or re-renders a submitted token, or changes session/OTP behavior.

The existing login request and verification APIs remain unchanged. The UI continues email normalization, generic request-code wording, six-digit validation, mutation locks, abort handling, ambiguity handling, focus management, and privacy-first session bootstrap. Its only routing change is `/app/today` replacing `/dashboard`.

## UI boundaries

`PublicEntryExperience` owns the static Landing V2 layout and only links to the canonical routes. It uses existing design tokens and `CalenoteMark`; it claims only implemented behavior.

`OnboardingWizard` remains the client owner for the established onboarding transaction and connection-state recovery. It moves to `/onboarding`, gains an explicit welcome/personalization presentation derived from account fields and existing Preferences capability only after the session exists, and directs its successful completion to `/app/today`.

`LoginPanel` is retained as the security-sensitive interaction owner. Styling may be reconciled to V2 tokens, but no request/response or lock semantics change.

## Evidence

Component tests prove public CTA routes/claims, legacy routing, the OTP redirect, onboarding secret clearing and canonical completion. Axe checks cover populated public forms. The existing isolated local fixture/CDP harness serves only static `out/` plus safe API fixtures and captures eight public-route screenshots at desktop/mobile widths. Artifacts remain untracked.

## Non-goals

No Google OAuth, auth-provider replacement, migration, backend refactor, AI-policy change, live provider call, deployment, staging claim, or Phase 5A work.
