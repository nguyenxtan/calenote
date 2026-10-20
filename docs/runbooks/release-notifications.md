# Release history and member notifications

## Source and runtime

`src/modules/releases/catalog.json` is the single reviewed catalogue for both admin history and member bell. There is no second static list to maintain. The first entry is the content of this application bundle (no invented self-referential commit or live verification timestamp). Older entries record verified release commits, timestamps and actual qualification limits. Do not list intermediate commits as standalone deployments when their changes shipped together later.

Authenticated GET `/api/product-updates` returns the currently serving Worker's catalogue and the caller's own opaque reader ID, with `Cache-Control: no-store` and `Vary: Cookie`. It does not grant admin access, write account state, call providers or disclose another reader's acknowledgement. The admin page still requires the existing admin gate. Neither UI invents notes from local bundled assets when the runtime API is unavailable.

Admin history requests the opt-in `/api/product-updates/runtime` endpoint with the same session boundary. It adds `runtime`: `SERVING` with responding Worker version ID and an optional full-SHA tag, `NON_PRODUCTION` for local/preview requests, or `UNKNOWN` when metadata is absent/invalid. The original endpoint remains byte-shape compatible for strict older clients and the member bell. Runtime identity comes only from the read-only Cloudflare `CF_VERSION_METADATA` binding, never a header, bundled Git SHA or fabricated timestamp. Existing production-origin policy must match the request. No Cloudflare API credential or network request is used to read this metadata.

The status identifies the production Worker answering this request, not fleet-wide allocation. During traffic splitting, successive responses may identify different versions. Rollback naturally returns the older ID/catalogue. Version creation/upload time is deliberately not exposed as promotion time. On refresh failure the UI retains catalogue text but removes any claim that the cached version is currently serving. Live test qualification remains separate.

The member bell and admin history refresh on mount, focus, visibility return and every 60 seconds while visible. A tab opened before a release can therefore discover new notes without reloading. Newly deployed notification code must first be loaded once; a page running older code without polling cannot be upgraded retroactively. New notes produce an unread badge and an accessible status announcement; the dialog is not forced open. Acknowledgement is scoped by the authenticated reader ID on that browser, with cross-tab synchronization; it is not a cross-device acknowledgement service. No email/bot broadcast is added.

## Release gate

`pnpm check` starts with `pnpm check:release-notes`. For product changes against `origin/master` (or the explicit RELEASE_BASE_REF), the gate requires a changed catalogue, a new latest release ID, nonempty admin/member wording, and retention of previous release IDs. Tests/docs alone do not require a release bump. CI uses its complete Git history and checks the exact candidate. The gate also runs on master pushes using the previous production ref. Do not bypass this gate or deploy a failed CI candidate.

For each release:

1. Add a new current-bundle entry with simple member changes and stable admin test scope/limits. Do not write transient phrases such as “chưa phát hành”, “đã triển khai” or “đang kiểm tra” in current verification prose; the release gate rejects them. Archive the previous current entry only with the confirmed deployment commit/time and actual readback evidence. Keep feature-source commits distinct from production deployment identity.
2. Run tests, build, types, lint, the release-note gate and Worker dry-run; obtain exact-SHA authorization and preserve the existing immutable-version production lane.
3. Upload one immutable version, preferably tagged with the full authorized source SHA (`wrangler versions upload --tag <full-SHA>`). Preserve the read-only version metadata binding when preparing upload configuration. After promotion/readback, GET the authenticated runtime update endpoint and confirm latestId matches the frozen catalogue, status is SERVING and versionId equals the authoritative responding Worker version. A missing/short tag leaves the commit link absent rather than guessing. Check both admin history and a member bell, including an old acknowledgement becoming unread. Check anonymous 401/no-store, mobile/keyboard behavior and stale API failure messaging.
4. Record live evidence separately. Updating this catalogue, passing CI, or a member opening its dialog does not prove production promotion, email receipt or Pilot AI qualification.

This runtime-status correction adds only a read-only version metadata binding; regenerate/check Worker types. It needs no migration, new resource, secret, privileged grant or provider call. Exact-SHA production release approval remains required. The email/category migration0018 belongs to its earlier release lineage, not this correction.
