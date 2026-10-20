# Admin release notes

The admin overview renders ReleaseHistory only after the existing admin overview request succeeds. Loading,401,403 and failed requests do not render the history. This adds no permission, backend endpoint, binding, database or deployment operation.

The catalogue in `src/features/admin/release-notes.ts` contains editorial, non-confidential release information. It ships in static web assets; hiding the admin UI does not make its text secret. Never include customer records, identities, credentials, provider payloads, private evidence paths or internal incident secrets.

## Adding a release

After a release has an authoritative production readback, add its full immutable commit, actual promotion time with timezone, short title, user-visible changes and narrowly scoped live verification. Retain material limitations and corrections to earlier notes. Newest verified promotion first; never mark an unshipped candidate as released, infer live success from CI, or call the latest catalogue item the currently active Worker. This is historical editorial content, not a live deployment lookup.

The catalogue is reviewed with application code and reaches the UI on a subsequent authorized web release. A deployment is not automatically followed by a catalogue commit or another production deploy. Pending candidates and unselected concepts are excluded. User approval for a specific release remains required by AGENTS.md.

## Initial evidence

-66eea693115be47500fdb134b2b2ce01174af977: production promotion2026-10-19T14:08:15Z; bot connections/preferences/admin report. Real outbound Zalo acceptance is narrower than human read receipt. Other provider acceptance stayed unverified.
-da44543892e0748b3225d51150c57a3fee7c2415: production promotion2026-10-20T01:04:36Z; Follow-through V1 plus Auth/Settings96aa378 ancestry. Its manual-create response defect is retained as a historical limitation and linked by commit text to48d7890.
-48d7890c5716623d75f9bfca477ba813fc516b37: production promotion2026-10-20T01:39:36Z; owner-session web success/native doubleclick→one reminder/work/run/intent, reload one item, testDone/CANCELLED/no send attempt. No new bot/OTP/automatic-follow-up E2E is claimed.

Verify desktop/mobile overflow, disclosure keyboard operation and links; preserve the existing admin loading/denial boundary. API security remains independently covered by the admin router/service suite.
