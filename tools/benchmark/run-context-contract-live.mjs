import { loadTrustedContextBootstrap, preflightTrustedContextCampaign, runTrustedContextCampaign } from "./context-contract-orchestration.ts";

try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.length === 1 && args[0] === "--preflight") {
    console.log(JSON.stringify(await preflightTrustedContextCampaign(process.cwd(), await loadTrustedContextBootstrap(process.cwd()), Date.now())));
  } else if (args.length === 2 && args[0] === "--run" && args[1] === "--enable-live") {
    const result = await runTrustedContextCampaign(process.cwd(), await loadTrustedContextBootstrap(process.cwd()), () => process.env.OPENROUTER_API_KEY ?? "");
    console.log(JSON.stringify(result)); if (result.status !== "PASS") process.exitCode = 1;
  } else {
    throw new Error("EXPLICIT_LIVE_AUTHORIZATION_REQUIRED");
  }
} catch {
  console.error(JSON.stringify({ status: "BLOCKED", routeAdmission: "NOT_ADMITTED", counters: "SEE_DURABLE_CAMPAIGN_ARTIFACT_IF_STARTED" }));
  process.exitCode = 1;
}
