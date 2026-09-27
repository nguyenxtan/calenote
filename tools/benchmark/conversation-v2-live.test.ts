// @vitest-environment node
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { preflightConversationLive, runConversationLive, conversationTransport, verifyConversationEndpoint, liveDirectory, safeConversationDiagnostics } from "./conversation-v2-live";
import { D1ReminderCommandStore } from "../../src/modules/reminders/infrastructure/d1/command-store";
import { CONVERSATION_PROMPT } from "../../src/modules/conversation/prompt";
import { ConversationModelJsonSchema } from "../../src/modules/conversation/contracts";

describe("bounded Conversation V2 live evaluation", () => {
  it("reports schema reasons without leaking payload values or attacker-controlled field names",()=>{
    const payload={intent:"CREATE_REMINDER",title:"private-sentinel-title",titleState:"RESOLVED",targetIntent:null,dialogueAct:"NEW_REQUEST",continuation:"NO",capability:"LUNAR"};
    const response={status:200,body:JSON.stringify({choices:[{message:{content:JSON.stringify(payload)},finish_reason:"stop"}]})};
    expect(safeConversationDiagnostics(response)).toEqual({issues:[{field:"dialogueAct",code:"custom"}],invariants:["CAPABILITY_ACT_MISMATCH"]});
    const leak={...payload,"private-sentinel-key":"private-sentinel-value"};
    const diagnostics=safeConversationDiagnostics({...response,body:JSON.stringify({choices:[{message:{content:JSON.stringify(leak)},finish_reason:"stop"}]})});
    expect(JSON.stringify(diagnostics)).not.toContain("private-sentinel");
  });
  it("partitions the increased aggregate authorization into three fixed new slots without changing the legacy fence",()=>{
    const root=process.cwd();
    expect(liveDirectory(root,"diagnostic")).not.toBe(liveDirectory(root));
    expect(new Set([liveDirectory(root),liveDirectory(root,"diagnostic"),liveDirectory(root,"repair"),liveDirectory(root,"verification")]).size).toBe(4);
    expect(()=>liveDirectory(root,"unbounded" as never)).toThrow("INVALID_CAMPAIGN_SLOT");
  });
  it("uses the same authorization ledger across linked worktrees",()=>{
    const common=execFileSync("git",["rev-parse","--path-format=absolute","--git-common-dir"],{encoding:"utf8"}).trim();
    expect(liveDirectory(process.cwd())).toBe(liveDirectory(join(common,"..")));
  });
  it("detects a wrong persisted draft timestamp even when the context and result are correct",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"calenote-v2-mutant-"));
    const raw=JSON.parse(await readFile("src/modules/conversation/benchmark/conversation-v2.json","utf8"));
    let calls=0;
    const transport=vi.fn(async()=>++calls===1?{status:200,body:JSON.stringify({choices:[{message:{content:JSON.stringify(raw.models.create)},finish_reason:"stop"}]})}:{status:503,body:""});
    const original=D1ReminderCommandStore.prototype.createDraft;
    vi.spyOn(D1ReminderCommandStore.prototype,"createDraft").mockImplementation(function(this:D1ReminderCommandStore,input){return original.call(this,{...input,scheduledAt:input.scheduledAt+86400000});});
    const result=await runConversationLive({root:process.cwd(),directory,transport,mode:"MOCK",runId:"mutant"});
    expect(result.failures[0]).toMatchObject({caseId:"complete-one-off",categories:expect.arrayContaining(["DRAFT_PERSISTENCE"])});
    expect(result.safetyFailures).toBeGreaterThan(0);
  },20000);
  it("runs CLI preflight without a key or HTTP through the real TypeScript loader",()=>{
    const output=execFileSync(process.execPath,["--import","data:text/javascript,globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')}","--import","./tools/benchmark/register-conversation-loader.mjs","tools/benchmark/run-conversation-v2-live.mjs","--preflight"],
      {encoding:"utf8",env:{...process.env,OPENROUTER_API_KEY:""}});
    expect(JSON.parse(output)).toMatchObject({cases:22,turns:37,networkRequests:0});
  });
  it("bounds response bodies and refuses credentials embedded in a request",async()=>{
    const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("x".repeat(20001)));
    const transport=conversationTransport("sentinel-key");
    await expect(transport({messages:[]} as never,{signal:new AbortController().signal})).resolves.toMatchObject({oversized:true});
    await expect(transport({messages:["sentinel-key"]} as never,{signal:new AbortController().signal})).rejects.toThrow("CREDENTIAL_IN_BODY");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires current exact-route ZDR metadata and capped pricing before live inference", async () => {
    const endpoint = {model_id:"google/gemini-2.5-flash-lite",tag:"google-vertex/eu",status:0,
      supported_parameters:["structured_outputs","response_format","max_tokens"],pricing:{prompt:"0.0000001",completion:"0.0000004"}};
    const fetcher=vi.spyOn(globalThis,"fetch").mockImplementation(async url=>new Response(JSON.stringify({data:String(url).endsWith("/zdr")?[endpoint]:{endpoints:[endpoint]}})));
    await expect(verifyConversationEndpoint()).resolves.toMatchObject({eligible:true});
    endpoint.pricing.completion="0.0000005";
    await expect(verifyConversationEndpoint()).rejects.toThrow("ENDPOINT_INELIGIBLE");
    expect(fetcher.mock.calls.every(([,init])=>!init?.headers)).toBe(true);
  });
  it("refuses caller-selected LIVE campaign directories before any request", async()=>{
    const fetcher=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("NETWORK_FORBIDDEN"));
    await expect(runConversationLive({root:process.cwd(),directory:"/tmp/arbitrary-campaign",mode:"LIVE",apiKey:"sentinel",runId:"test"})).rejects.toThrow("LIVE_DIRECTORY_FIXED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preflights the exact 22/37 corpus without credentials or network", () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_FORBIDDEN"));
    const report = preflightConversationLive(process.cwd());
    expect(report).toMatchObject({ cases: 22, turns: 37, maxRequests: 40, maxCostMicrounits: 500000, maximumPerCallMicrounits: 1303 });
    expect(report.provenance.digests.corpus).toBe("5e514ba2c1f53a4a8c06482597530a9eab361f828dc61f3fef5c1d7f6d055382");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("exercises the actual service with mock semantic outputs but never labels that live acceptance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "calenote-v2-eval-"));
    const raw = JSON.parse(await readFile("src/modules/conversation/benchmark/conversation-v2.json", "utf8"));
    const queue = raw.cases.flatMap((c: { turns: {text:string;model:string}[] }) => c.turns.filter(t => t.text !== "xin chào").map(t => raw.models[t.model]));
    const transport = vi.fn(async request => {
      expect(request.messages[0].content).toBe(CONVERSATION_PROMPT);
      expect(request.response_format.json_schema.schema).toEqual(ConversationModelJsonSchema);
      expect(request.provider).toMatchObject({ only: ["google-vertex/eu"], zdr: true, allow_fallbacks: false, data_collection: "deny", require_parameters: true });
      expect(request).not.toHaveProperty("reasoning");
      return {status:200,body:JSON.stringify({choices:[{message:{content:JSON.stringify(queue.shift())},finish_reason:"stop"}],usage:{cost:0.0001}})};
    });
    const report = await runConversationLive({ root: process.cwd(), directory, transport, mode:"MOCK", runId:"test-golden" });
    expect(report.total).toBe(37);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(37);
    expect(report.requests).toBe(36);
    expect(report.liveAccepted).toBe(false);
    expect(report.safetyFailures).toBe(0);
    const ledger = await readFile(join(directory,"authorization.jsonl"),"utf8");
    expect(ledger).not.toContain("gọi mẹ");
    expect(ledger).not.toContain("thi hết môn");
    await expect(runConversationLive({ root:process.cwd(),directory,transport,mode:"MOCK",runId:"other" })).rejects.toThrow("AUTHORIZATION_ALREADY_USED");
    expect(transport).toHaveBeenCalledTimes(36);
  }, 120000);
  it("refuses simultaneous use of one authorization and records a dispatched failure without retry", async () => {
    const directory = await mkdtemp(join(tmpdir(),"calenote-v2-fence-"));
    const transport = vi.fn(async () => { throw new Error("private-provider-sentinel"); });
    const args = {root:process.cwd(),directory,transport,mode:"MOCK" as const,runId:"test-failure"};
    const results = await Promise.allSettled([runConversationLive(args),runConversationLive(args)]);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const result = results.find(r => r.status === "fulfilled");
    if (result?.status !== "fulfilled") throw new Error("missing report");
    expect(result.value.liveAccepted).toBe(false);
    expect(result.value.total).toBe(37);
    expect(result.value.requests).toBe(1);
    expect(result.value.passed).toBe(0);
    expect(JSON.stringify(result.value)).not.toContain("private-provider-sentinel");
    expect(transport).toHaveBeenCalledTimes(1);
    const ledger = await readFile(join(directory,"authorization.jsonl"),"utf8");
    expect(ledger).toContain('"event":"DISPATCH"');
    expect(ledger).not.toContain("private-provider-sentinel");
  }, 20000);
  it("keeps credentials in the Authorization header and refuses redirects", async () => {
    const fetcher = vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response('{}'));
    const send = conversationTransport("sentinel-key-not-in-body");
    await send({messages:[]} as never,{signal:new AbortController().signal});
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init?.headers).toMatchObject({Authorization:"Bearer sentinel-key-not-in-body"});
    expect(init?.body).not.toContain("sentinel-key-not-in-body");
    expect(init?.redirect).toBe("error");
  });
});
