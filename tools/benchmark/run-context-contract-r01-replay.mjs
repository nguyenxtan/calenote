import { runAuthorizedR01Replay } from "./context-contract-runner.ts";

try {
  const args = process.argv.slice(2);
  if (args.length !== 8 || args[0] !== "--replay-r01" || args[1] !== "--enable-live" || args[2] !== "--profile" || args[3] !== "PILOT"
    || args[4] !== "--run-id" || args[6] !== "--authorization") throw new Error("EXPLICIT_REPLAY_AUTHORITY_REQUIRED");
  const result = await runAuthorizedR01Replay({ root: process.cwd(), enableLive: true, profile: "PILOT", runId: args[5], authorizationPath: args[7], now: Date.now() },
    () => process.env.OPENROUTER_API_KEY ?? "");
  console.log(JSON.stringify(result)); if (result.status !== "PASS") process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ status: "BLOCKED", replayOnly: true, counters: "SEE_DURABLE_REPLAY_ARTIFACT_IF_STARTED" })); process.exitCode = 1;
}
