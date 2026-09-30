import { admitFutureLiveIntent, preflightContextCampaign } from "./context-contract-live.ts";
import { runAuthorizedContextCampaign } from "./context-contract-runner.ts";

try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.length === 1 && args[0] === "--preflight") {
    console.log(JSON.stringify(preflightContextCampaign({ root: process.cwd() })));
  } else if (args.length === 8 && args[0] === "--run" && args[1] === "--enable-live"
    && args[2] === "--profile" && args[4] === "--run-id" && args[6] === "--authorization") {
    const intent = { root: process.cwd(), enableLive: true, profile: args[3], runId: args[5], authorizationPath: args[7], now: Date.now() };
    admitFutureLiveIntent(intent);
    const result = await runAuthorizedContextCampaign(intent, () => process.env.OPENROUTER_API_KEY ?? "");
    console.log(JSON.stringify(result)); if (result.status !== "PASS") process.exitCode = 1;
  } else {
    throw new Error("EXPLICIT_LIVE_AUTHORIZATION_REQUIRED");
  }
} catch {
  console.error(JSON.stringify({ status: "BLOCKED", routeAdmission: "NOT_ADMITTED", counters: "SEE_DURABLE_CAMPAIGN_ARTIFACT_IF_STARTED" }));
  process.exitCode = 1;
}
