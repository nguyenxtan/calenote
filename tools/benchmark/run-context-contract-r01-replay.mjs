import { loadTrustedSingleReplay, inspectSingleReplay, runSingleReplay } from "./context-contract-single-replay.ts";
import { createContextHttpTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway.ts";

try {
  const args = process.argv.slice(2);
  const preflightOnly = args.length === 0 || (args.length === 1 && args[0] === "--preflight");
  if (!preflightOnly && (args.length !== 2 || args[0] !== "--replay-r01-turn0" || args[1] !== "--enable-live")) throw new Error("EXPLICIT_REPLAY_AUTHORITY_REQUIRED");
  const authority = loadTrustedSingleReplay(process.cwd());
  if (preflightOnly) {
    console.log(JSON.stringify({ status: "READY", replayTarget: "R01_TURN_0", ...inspectSingleReplay(authority), realLlmCalls: 0, providerHttpRequests: 0 }));
  } else {
  let transport;
  const result = await runSingleReplay(authority, (request, options) => {
    // Lazy read is after durable reservation/dispatch, never admission authority.
    const key = process.env.OPENROUTER_API_KEY;
    if (!key || /[\r\n]/u.test(key)) throw new Error("CREDENTIAL_MISSING_OR_INVALID");
    transport ??= createContextHttpTransport(key);
    return transport(request, options);
  });
  console.log(JSON.stringify(result));
  if (result.applicationEvidence[0]?.oracle !== "PASS") process.exitCode = 1;
  }
} catch {
  console.error(JSON.stringify({ status: "BLOCKED", replayOnly: true, counters: "SEE_DURABLE_REPLAY_ARTIFACT_IF_STARTED" })); process.exitCode = 1;
}
