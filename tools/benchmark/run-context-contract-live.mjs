import { admitFutureLiveIntent, preflightContextCampaign } from "./context-contract-live.ts";

try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.length === 1 && args[0] === "--preflight") {
    console.log(JSON.stringify(preflightContextCampaign({ root: process.cwd() })));
  } else if (args.length === 8 && args[0] === "--run" && args[1] === "--enable-live"
    && args[2] === "--profile" && args[4] === "--run-id" && args[6] === "--authorization") {
    admitFutureLiveIntent({ root: process.cwd(), enableLive: true, profile: args[3], runId: args[5], authorizationPath: args[7], now: Date.now() });
  } else {
    throw new Error("EXPLICIT_LIVE_AUTHORIZATION_REQUIRED");
  }
} catch {
  console.error(JSON.stringify({ status: "BLOCKED", routeAdmission: "UNVERIFIED", networkRequests: 0, secretReads: 0 }));
  process.exitCode = 1;
}
