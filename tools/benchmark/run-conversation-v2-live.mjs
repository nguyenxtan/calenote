import { preflightConversationLive, runConversationLive, liveDirectory } from "./conversation-v2-live.ts";

try {
  const root=process.cwd();
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==="--preflight")console.log(JSON.stringify(preflightConversationLive(root)));
  else if((args.length===2||args.length===3)&&args[0]==="--live") {
    const slot=args[2]??"legacy";
    const key=process.env.OPENROUTER_API_KEY;
    if(!key)throw new Error("CREDENTIAL_UNAVAILABLE");
    const report=await runConversationLive({root,directory:liveDirectory(root,slot),slot,runId:args[1],mode:"LIVE",apiKey:key,
      onProgress:safe=>console.log(JSON.stringify(safe))});
    console.log(JSON.stringify(report));
    if(!report.liveAccepted)process.exitCode=1;
  } else throw new Error("INVALID_ARGUMENTS");
} catch {
  // Never serialize arbitrary provider/runtime errors or credential-bearing headers.
  console.error(JSON.stringify({status:"FAILED_CLOSED",deploymentAuthorized:false}));
  process.exitCode=1;
}
