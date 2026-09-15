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

## Zalo webhook Browser Integrity Check exception

**PROVEN_IN_PRODUCTION:** Zalo webhook verification previously received an edge
403 before Worker execution. The narrowly scoped production Configuration Rule
is:

```text
hostname = calenote.iconiclogs.com
method = POST
path starts with /webhooks/zalo/
Browser Integrity Check = OFF
```

**Never disable Browser Integrity Check globally for this integration.** This
exception applies only to the Zalo webhook ingress shape above. Any dashboard
emergency change must be recorded and reconciled to reviewed Git configuration
or runbook evidence according to the deployment model.

## Provider webhook diagnostic decision tree

```text
provider 403 + no Worker event
  -> inspect Cloudflare edge security first

Worker event observed
  -> inspect webhook route match, path/header authentication, and parser

testWebhook success + no real message event
  -> do not treat webhook E2E as healthy
```

The current Zalo real-message path is an **OPEN_INCIDENT**. `testWebhook`
success proves verification/reachability only; it does not prove provider event
dispatch, Worker receipt, D1 inbound persistence, Queue processing, or private
chat binding. Do not change WAF, Bot Fight Mode, Access, rate limiting, or
webhook authentication from a hypothesis alone.
