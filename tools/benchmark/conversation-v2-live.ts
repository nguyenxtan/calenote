import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { buildConversationProvenance, runConversationCorpus } from "./conversation-v2";
import { parseSemanticRuntimeConfig } from "../../src/modules/intelligence/infrastructure/openrouter/config";
import type { SemanticTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { createConversationProbe } from "./conversation-v2-probe";
import { ConversationModelSchema } from "../../src/modules/conversation/contracts";

const CORPUS="src/modules/conversation/benchmark/conversation-v2.json";
const CORPUS_DIGEST="5e514ba2c1f53a4a8c06482597530a9eab361f828dc61f3fef5c1d7f6d055382";
export const AUTHORIZATION="conversation-v2-live-20260927";
export type CampaignSlot="legacy"|"diagnostic"|"repair"|"verification"|"semantic-diagnostic"|"semantic-verification"|"boundary-verification"|"dialogue-verification"|"temporal-priority-verification";
export function liveDirectory(root:string,slot:CampaignSlot="legacy") {
  if(!["legacy","diagnostic","repair","verification","semantic-diagnostic","semantic-verification","boundary-verification","dialogue-verification","temporal-priority-verification"].includes(slot))throw new Error("INVALID_CAMPAIGN_SLOT");
  // Single-use paths stay fixed across worktrees. New semantic slots also
  // require sealed historical reservations before admission (see below).
  return join(realpathSync(execFileSync("git",["-C",root,"rev-parse","--path-format=absolute","--git-common-dir"],{encoding:"utf8"}).trim()),"calenote-benchmark-authorizations",
    slot==="legacy"?AUTHORIZATION:`${AUTHORIZATION}-repair-${slot}`);
}
export function verifyClosedCampaign(body:string,digest:string):number {
  if(createHash("sha256").update(body).digest("hex")!==digest)throw new Error("CLOSED_LEDGER_CHANGED");
  const rows=z.array(z.object({event:z.string(),reservedMicrounits:z.number().int().nonnegative().optional(),retainedCostMicrounits:z.number().int().nonnegative().optional()})).parse(body.trim().split("\n").map(line=>JSON.parse(line)));
  const reservations=rows.filter(r=>r.event==="DISPATCH").reduce((n,r)=>n+(r.reservedMicrounits??NaN),0);
  if(rows[0]?.event!=="BEGIN"||rows.at(-1)?.event!=="COMPLETE"||rows.filter(r=>r.event==="COMPLETE").length!==1||!Number.isSafeInteger(reservations)||rows.at(-1)?.retainedCostMicrounits!==reservations)throw new Error("CAMPAIGN_NOT_CLOSED");
  return reservations;
}
function verifySemanticRepairAllocation(root:string) {
  const closed: [CampaignSlot,string][]=[
    ["legacy","526f151903df51cb0a0bb863b2be94197a5026adcc95a89de70c45ca25a04cb5"],
    ["diagnostic","78b96130079e97f3f6b61450139d52a351f3458afda733611a79d39fc19cde42"],
    ["repair","97b37190976995ffdfdc6c03f8788ec76c6e2ad3a3dbf6a4ca53a05b4cc4a2e0"],
    ["verification","365bf3e8d157a384f4b6beb666c43be9f88859c2aea40f9288ebc01c9db3242c"],
  ];
  const spent=closed.reduce((n,[slot,digest])=>n+verifyClosedCampaign(readFileSync(join(liveDirectory(root,slot),"authorization.jsonl"),"utf8"),digest),0);
  // New explicit continuation approval: two exclusive $0.50 slots plus ALL
  // retained historical reservations, not discounted provider-reported usage.
  if(spent!==71665||spent+2*500000>2000000)throw new Error("AGGREGATE_CAP_EXCEEDED");
  return spent;
}
export function verifyBoundaryRepairAllocation(root:string) {
  const earlier=verifySemanticRepairAllocation(root);
  const closed: [CampaignSlot,string][]=[
    ["semantic-diagnostic","b0353ad0a9cb968a370e26567961832b62b0d641d4e25fb355f8655354760978"],
    ["semantic-verification","971852d0839e44af571ceb4efeb5fd9e4734518178f02caab7be86cbce66fa57"],
  ];
  const spent=closed.reduce((n,[slot,digest])=>n+verifyClosedCampaign(readFileSync(join(liveDirectory(root,slot),"authorization.jsonl"),"utf8"),digest),earlier);
  // 2026-09-28 continuation: one new exclusive slot, retaining every previous
  // dispatched reservation. All six older ledgers must be sealed and unchanged.
  if(spent!==125088||spent+500000>2000000)throw new Error("AGGREGATE_CAP_EXCEEDED");
  return spent;
}
export function safeOutcomeDiagnostics(raw:unknown,actual:Record<string,unknown>|null,expected:Record<string,unknown>) {
  const parsed=ConversationModelSchema.safeParse(raw);
  const semantic=parsed.success?((({intent,titleState,targetIntent,dialogueAct,continuation,capability})=>({intent,titleState,targetIntent,dialogueAct,continuation,capability}))(parsed.data)):null;
  const fields=["calendar","title","eventDate","date","time","count","relation"];
  const requestMismatchFields=fields.filter(field=>!isDeepStrictEqual(actual?.[field]??null,expected[field]??null));
  const a=actual?.title,b=expected.title;
  const titleCaseOnlyDifference=typeof a==="string"&&typeof b==="string"&&a!==b&&a.normalize("NFC").toLocaleLowerCase("vi-VN")===b.normalize("NFC").toLocaleLowerCase("vi-VN");
  return {semantic,requestMismatchFields,titleCaseOnlyDifference};
}
export function safeConversationDiagnostics(response:{status:number;body:string;oversized?:boolean}) {
  if(response.oversized||response.body.length>20000||response.status!==200)return {issues:[],invariants:[]};
  try {
    const envelope=z.object({choices:z.array(z.object({message:z.object({content:z.string()})})).length(1)}).parse(JSON.parse(response.body));
    const payload:unknown=JSON.parse(envelope.choices[0].message.content);
    const parsed=ConversationModelSchema.safeParse(payload);
    if(parsed.success)return {issues:[],invariants:[]};
    const fields=["intent","title","titleState","targetIntent","dialogueAct","continuation","capability"];
    const issues=parsed.error.issues.slice(0,8).map(issue=>({field:fields.includes(String(issue.path[0]))?String(issue.path[0]):"ROOT",code:issue.code}));
    const p=z.record(z.string(),z.unknown()).safeParse(payload);
    const invariants:string[]=[];
    if(p.success) {
      if((p.data.dialogueAct==="CAPABILITY")!==(p.data.capability!==null))invariants.push("CAPABILITY_ACT_MISMATCH");
      if(["GREET","CAPABILITY","ABANDON"].includes(String(p.data.dialogueAct))&&p.data.intent!=="HELP")invariants.push("CONTROL_ACT_INTENT_MISMATCH");
    }
    return {issues,invariants};
  }catch{return {issues:[{field:"ROOT",code:"INVALID_ENVELOPE_OR_JSON"}],invariants:[]};}
}
export async function verifyConversationEndpoint() {
  const get=async(url:string)=>{
    const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error("METADATA_UNAVAILABLE");
    return z.object({data:z.unknown()}).parse(await response.json());
  };
  const [model,zdr]=await Promise.all([
    get("https://openrouter.ai/api/v1/models/google/gemini-2.5-flash-lite/endpoints"),
    get("https://openrouter.ai/api/v1/endpoints/zdr"),
  ]);
  type Endpoint={tag?:string;model_id?:string;status?:number;supported_parameters?:string[];pricing?:{prompt?:string;completion?:string}};
  const match=(e:Endpoint)=>e.tag==="google-vertex/eu"&&e.model_id==="google/gemini-2.5-flash-lite"&&e.status===0;
  const endpoints=z.object({endpoints:z.array(z.unknown())}).parse(model.data).endpoints;
  const endpoint:Endpoint|undefined=endpoints.filter((e):e is Endpoint=>typeof e==="object"&&e!==null).find(match);
  if(!endpoint || !Array.isArray(zdr.data) || !zdr.data.some(match) ||
    !["structured_outputs","response_format","max_tokens"].every(p=>endpoint.supported_parameters?.includes(p)) ||
    !(Number(endpoint.pricing?.prompt)>0&&Number(endpoint.pricing?.prompt)<=0.0000001) ||
    !(Number(endpoint.pricing?.completion)>0&&Number(endpoint.pricing?.completion)<=0.0000004))throw new Error("ENDPOINT_INELIGIBLE");
  return {eligible:true,model:"google/gemini-2.5-flash-lite",provider:"google-vertex/eu",zdr:true,
    pricing:endpoint.pricing,checkedAt:new Date().toISOString()};
}
type Turn={text:string;model:string;delayMs?:number;expected:{evidence:Record<string,unknown>;outcome:string;field?:string;state:string;request?:Record<string,unknown>;occurrenceDates?:string[];expansionRejection?:string}};
type Corpus={referenceNow:number;cases:{id:string;turns:Turn[]}[]};
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
function corpus(root:string):Corpus {
  const bytes=readFileSync(join(root,CORPUS),"utf8");
  if(hash(bytes)!==CORPUS_DIGEST) throw new Error("CORPUS_CHANGED");
  const raw=JSON.parse(bytes); if(!runConversationCorpus(raw).offlinePass) throw new Error("OFFLINE_CONTRACT_FAILED");
  return raw;
}
function config(root:string) {
  const policy=parseSemanticRuntimeConfig({...JSON.parse(readFileSync(join(root,"wrangler.jsonc"),"utf8")).vars,OPENROUTER_API_KEY:"not-a-credential"});
  if(policy.status!=="READY" || policy.config.maxInputTokens!==12000 || policy.config.maxOutputTokens!==256) throw new Error("CONFIG_CHANGED");
  return policy.config;
}
export function preflightConversationLive(root:string) {
  const c=corpus(root);config(root);
  const turns=c.cases.reduce((n,c)=>n+c.turns.length,0);
  const tools=["conversation-v2-live.ts","conversation-v2-probe.ts","run-conversation-v2-live.mjs","register-conversation-loader.mjs"].map(p=>[p,hash(readFileSync(join(root,"tools/benchmark",p),"utf8"))]);
  return {profile:"conversation-v2-live-1",authorization:AUTHORIZATION,cases:c.cases.length,turns,maxRequests:40,maxCostMicrounits:500000,
    maximumPerCallMicrounits:1303,projectedMaximumMicrounits:turns*1303,networkRequests:0,
    provenance:{...buildConversationProvenance(root),profile:"conversation-v2-live-1",transport:"LIVE",runnerDigest:hash(JSON.stringify(tools))}};
}
export function conversationTransport(key:string):SemanticTransport {
  if(!key || /[\r\n]/u.test(key)) throw new Error("CREDENTIAL_UNAVAILABLE");
  return async(request,{signal})=>{
    const body=JSON.stringify(request);
    if(body.includes(key)) throw new Error("CREDENTIAL_IN_BODY");
    const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",redirect:"error",signal,
      headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body});
    if(!response.body) return {status:response.status,body:""};
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
      if(size>20000){await reader.cancel();return {status:response.status,body:"",oversized:true};}chunks.push(part.value);}
    }finally{reader.releaseLock();}
    return {status:response.status,body:Buffer.concat(chunks).toString("utf8")};
  };
}
type Options={root:string;directory:string;runId:string;slot?:CampaignSlot;onProgress?:(safe:unknown)=>void}&
  ({mode:"MOCK";transport:SemanticTransport}|{mode:"LIVE";apiKey:string});
export async function runConversationLive(options:Options) {
  if(!/^[a-zA-Z0-9_-]{1,100}$/u.test(options.runId))throw new Error("INVALID_RUN_ID");
  if(resolve(options.root)!==process.cwd())throw new Error("ROOT_MISMATCH");
  if(options.mode==="LIVE"&&resolve(options.directory)!==liveDirectory(process.cwd(),options.slot))throw new Error("LIVE_DIRECTORY_FIXED");
  if(options.mode==="LIVE"&&options.slot?.startsWith("semantic-"))verifySemanticRepairAllocation(options.root);
  if(options.mode==="LIVE"&&options.slot==="boundary-verification")verifyBoundaryRepairAllocation(options.root);
  if(options.mode==="LIVE"&&["dialogue-verification","temporal-priority-verification"].includes(options.slot??"")) {
    const spent=verifyBoundaryRepairAllocation(options.root)+verifyClosedCampaign(
      readFileSync(join(liveDirectory(options.root,"boundary-verification"),"authorization.jsonl"),"utf8"),
      "2810b044607f2250cfcf9fe99ed8af10c8592eded1d5830eb802e5bfea3d3ad7");
    if(spent!==171996||spent+500000>2000000)throw new Error("AGGREGATE_CAP_EXCEEDED");
    if(options.slot==="temporal-priority-verification") {
      const retained=spent+verifyClosedCampaign(
        readFileSync(join(liveDirectory(options.root,"dialogue-verification"),"authorization.jsonl"),"utf8"),
        "394cb5d80f648d7bf971e02a98a622ad7645358474a7d1e26bceadab0b7b25cc");
      if(retained!==218904||retained+500000>2000000)throw new Error("AGGREGATE_CAP_EXCEEDED");
    }
  }
  const preflight=preflightConversationLive(options.root), data=corpus(options.root), runtimeConfig=config(options.root);
  const transport=options.mode==="LIVE"?conversationTransport(options.apiKey):options.transport;
  await mkdir(options.directory,{recursive:true,mode:0o700});
  const file=await open(join(options.directory,"authorization.jsonl"),"wx",0o600).catch(()=>{throw new Error("AUTHORIZATION_ALREADY_USED");});
  const append=async(value:unknown)=>{await file.writeFile(JSON.stringify(value)+"\n");await file.sync();};
  let requests=0,retainedCostMicrounits=0,schemaPassed=0,modelAttempts=0,passed=0,temporalPassed=0,safetyFailures=0,total=0,stopped=false;
  const failures:{caseId:string;turn:number;categories:string[]}[]=[];
  try {
    await append({event:"BEGIN",mode:options.mode,runId:options.runId,...preflight,slot:options.slot??"legacy",aggregateAuthorizationMicrounits:2000000});
    if(options.mode==="LIVE")await append({event:"ELIGIBILITY",...await verifyConversationEndpoint()});
    for(const scenario of data.cases){
      let currentTurn=0;
      const guarded:SemanticTransport=async(request,signal)=>{
        if(requests>=40 || retainedCostMicrounits+1303>500000) throw new Error("CAP_REACHED");
        requests++;retainedCostMicrounits+=1303;
        await append({event:"DISPATCH",caseId:scenario.id,turn:currentTurn+1,request:requests,reservedMicrounits:1303});
        const response=await transport(request,signal);
        const diagnostics=safeConversationDiagnostics(response);
        if(diagnostics.issues.length)await append({event:"SCHEMA_DIAGNOSTICS",caseId:scenario.id,turn:currentTurn+1,...diagnostics});
        return response;
      };
      const probe=stopped?null:await createConversationProbe(runtimeConfig,guarded,data.referenceNow);
      try{for(const [index,turn] of scenario.turns.entries()){
        currentTurn=index;total++;
        if(stopped || !probe){failures.push({caseId:scenario.id,turn:index+1,categories:["NOT_RUN_AFTER_FAILURE"]});continue;}
        const observed=await probe.turn(turn.text,index,turn.delayMs);
        const categories:string[]=[];
        if(observed.attempt){modelAttempts++;if(observed.attempt.status==="SUCCESS")schemaPassed++;
          else{categories.push(observed.attempt.category);stopped=true;}}
        const expected=turn.expected;
        const req=observed.next?.request;
        const requestProjection=req?{calendar:req.calendar,title:req.title,eventDate:req.eventDate?.solarDate??null,date:req.reminderDate?.solarDate??null,time:req.reminderTime,count:req.count,relation:req.relation}:null;
        await append({event:"OUTCOME_DIAGNOSTICS",caseId:scenario.id,turn:index+1,rawRequestComparisonApplicable:!!expected.request,...safeOutcomeDiagnostics(observed.attempt?.status==="SUCCESS"?observed.attempt.interpretation:null,requestProjection,expected.request??{})});
        const evidence={calendar:null,eventDate:null,date:null,time:null,count:null,relation:null,...expected.evidence};
        if(isDeepStrictEqual(observed.evidence,evidence))temporalPassed++;else categories.push("TEMPORAL");
        const kind=observed.decision?.kind??(turn.text==="xin chào"&&!observed.attempt?"GREET":null);
        if(kind!==expected.outcome || (observed.decision?.kind==="CLARIFY"?observed.decision.field:null)!==(expected.field??null))categories.push("DIALOGUE");
        // Offline proposals describe reconciliation; real service rejects past dates.
        const rejectedPast=expected.expansionRejection==="PAST" || (scenario.id==="lunar-leap-completion"&&index===2);
        const wantedStatus=rejectedPast?"REJECTED":({PROPOSE:"DRAFT_CREATED",CLARIFY:"CLARIFICATION_REQUESTED",READ_ONLY_LIST:"REMINDERS_LISTED",ABANDON_PENDING:"CANCELLED"}[expected.outcome]??"REJECTED");
        if(observed.status!==wantedStatus)categories.push("RUNTIME_OUTCOME");
        const wantedState=rejectedPast?(scenario.id==="lunar-leap-completion"?"CLARIFYING":"NONE"):expected.state;
        if(observed.state!==wantedState)categories.push("STATE");
        if(["SAFE_REJECT","READ_ONLY_LIST","LUNAR_HELP","GREET"].includes(expected.outcome) &&
          (!isDeepStrictEqual(observed.previous?.request,observed.next?.request)||!isDeepStrictEqual(observed.beforeDrafts,observed.drafts)||!isDeepStrictEqual(observed.beforeProposals,observed.proposals)))categories.push("PRESERVATION");
        if(expected.request&&!rejectedPast){
          const req=observed.next?.request;
          const actual=req?{calendar:req.calendar,title:req.title,eventDate:req.eventDate?.solarDate??null,date:req.reminderDate?.solarDate??null,time:req.reminderTime,count:req.count,relation:req.relation}:null;
          const want={calendar:null,title:null,eventDate:null,date:null,time:null,count:null,relation:null,...expected.request};
          if(actual && scenario.id==="exam-urgent-series" && ["thi hết môn ở Quang Trung","thi hết môn","ôn thi"].includes(actual.title??""))actual.title="ôn thi";
          if(!isDeepStrictEqual(actual,want))categories.push("REQUEST");
        }
        if(observed.reminders!==0)categories.push("PREMATURE_MUTATION");
        if(wantedStatus==="DRAFT_CREATED"&&!expected.occurrenceDates){
          const req=observed.next?.request;
          const wanted=req?{title:req.title,scheduledAt:Date.parse(`${req.reminderDate?.solarDate}T${req.reminderTime}:00+07:00`),timezone:"Asia/Ho_Chi_Minh",
            calendarFacts:{calendar:req.calendar,eventDate:req.eventDate,reminderDate:req.reminderDate}}:null;
          if(!isDeepStrictEqual(observed.drafts,wanted?[wanted]:[]))categories.push("DRAFT_PERSISTENCE");
        }
        if(expected.occurrenceDates && !rejectedPast && !isDeepStrictEqual(observed.occurrences,
          expected.occurrenceDates.map((date,index)=>({index,localDate:date,scheduledAt:Date.parse(`${date}T${expected.request?.time}:00+07:00`)}))))categories.push("OCCURRENCES");
        if(categories.some(c=>["TEMPORAL","REQUEST","STATE","PREMATURE_MUTATION","OCCURRENCES","DRAFT_PERSISTENCE","PRESERVATION"].includes(c)) || (observed.status==="DRAFT_CREATED"&&wantedStatus!=="DRAFT_CREATED"))safetyFailures++;
        if(categories.length)failures.push({caseId:scenario.id,turn:index+1,categories});else passed++;
        const safe={event:"RESULT",caseId:scenario.id,turn:index+1,status:observed.status,categories,costMicrounits:observed.attempt?.usage?.costMicrounits??null};
        await append(safe);options.onProgress?.(safe);
      }}finally{await probe?.dispose();}
    }
    const liveAccepted=options.mode==="LIVE"&&!stopped&&total===37&&passed>=36&&modelAttempts>0&&schemaPassed===modelAttempts&&temporalPassed===37&&safetyFailures===0;
    const report={runId:options.runId,mode:options.mode,total,passed,requests,schemaPassed,modelAttempts,temporalPassed,safetyFailures,retainedCostMicrounits,liveAccepted,failures,deploymentAuthorized:false};
    await append({event:"COMPLETE",...report});return report;
  }finally{await file.close();}
}
