# Calenote Cloudflare incident response

Use read-only GitHub Actions and Cloudflare evidence first. Do not expose
secrets, bot tokens, encrypted values, session material, raw chat content, or
AI prompts while investigating.

| Incident | Initial response | Recovery |
| --- | --- | --- |
| Worker outage or bad version | Identify target, active deployment, and recorded known-good version | Promote that exact known-good Worker version; run safe HTTP smoke/read-back |
| Failed promotion | Inspect build/config/action evidence | Correct the reviewed source and retry through CI; do not blindly retry an ambiguous mutation |
| D1 migration issue | Stop application changes and inspect migration/evidence | Use a reviewed forward-only remediation; never automatically reverse an applied migration |
| Provider/AI side-effect risk | Disable the triggering path where possible and preserve redacted evidence | Restore only after scoped review; smoke tests stay provider-free |
| Emergency Dashboard change | Record actor, time, target, and reason | Reconcile the equivalent change into Git and deployment evidence immediately |

Every incident record includes the commit, Worker version ID, target,
timestamp, observed impact, safe read-back result, root cause, and any
Dashboard emergency action. Production recovery still requires explicit human
authorization.
