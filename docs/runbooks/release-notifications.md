# Release history and member notifications

## Source and runtime

`src/modules/releases/catalog.json` is the single reviewed catalogue for both admin history and member bell. There is no second static list to maintain. The first entry is the content of this application bundle (no invented self-referential commit or live verification timestamp). Older entries record verified release commits, timestamps and actual qualification limits. Do not list intermediate commits as standalone deployments when their changes shipped together later.

Authenticated GET `/api/product-updates` returns the currently serving Worker's catalogue and the caller's own opaque reader ID, with `Cache-Control: no-store` and `Vary: Cookie`. It does not grant admin access, write account state, call providers or disclose another reader's acknowledgement. The admin page still requires the existing admin gate. Neither UI invents notes from local bundled assets when the runtime API is unavailable.

The member bell and admin history refresh on mount, focus, visibility return and every 60 seconds while visible. A tab opened before a release can therefore discover new notes without reloading. Newly deployed notification code must first be loaded once; a page running older code without polling cannot be upgraded retroactively. New notes produce an unread badge and an accessible status announcement; the dialog is not forced open. Acknowledgement is scoped by the authenticated reader ID on that browser, with cross-tab synchronization; it is not a cross-device acknowledgement service. No email/bot broadcast is added.

## Release gate

`pnpm check` starts with `pnpm check:release-notes`. For product changes against `origin/master` (or the explicit RELEASE_BASE_REF), the gate requires a changed catalogue, a new latest release ID, nonempty admin/member wording, and retention of previous release IDs. Tests/docs alone do not require a release bump. CI uses its complete Git history and checks the exact candidate. The gate also runs on master pushes using the previous production ref. Do not bypass this gate or deploy a failed CI candidate.

For each release:

1. Add a new current-bundle entry with simple member changes and admin scope/limits. Archive the previous current entry only with the confirmed deployment commit/time and actual readback evidence. Keep feature-source commits distinct from production deployment identity.
2. Run tests, build, types, lint, the release-note gate and Worker dry-run; obtain exact-SHA authorization and preserve the existing immutable-version production lane.
3. After promotion/readback, GET the authenticated update endpoint and confirm latestId matches the frozen catalogue. Check both admin history and a member bell, including an old acknowledgement becoming unread. Check anonymous 401/no-store, mobile/keyboard behavior and stale API failure messaging.
4. Record live evidence separately. Updating this catalogue, passing CI, or a member opening its dialog does not prove production promotion, email receipt or Pilot AI qualification.

The notification fix adds no migration or binding. The combined pending email/category candidate still requires migration 0018 and its own exact-SHA release approval.
