// @vitest-environment node
import {it,expect,vi} from "vitest";
import {mkdtempSync,mkdirSync,realpathSync,readFileSync,writeFileSync,rmSync,existsSync,unlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {appendCampaignEvent,reserveCampaignCall,markCampaignDispatched,finishCampaignCall} from "./context-contract-live";
import {currentFixtureCandidate} from "./current-candidate.test-support";
import {deriveBoundedPilotManifest} from "./context-bounded-pilot";
import {createDebugLoopLoader,inspectDebugLoop,runDebugLoopExecution,debugProbeSchema,inspectDebugLoopFreshRun} from "./context-debug-loop";
import {candidateValidationProof} from "./context-contract-candidate-validation";
import {googleLiteEuContextWireSchemaV3,encodeGoogleLiteEuContextV3} from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import * as wireModule from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import {parseGoogleLiteEuContextSectionsV3,decodeGoogleLiteEuContextTransportV3} from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import {CONTEXT_PROTOCOL_V3} from "../../src/modules/conversation/context-contract/protocol";
import {ContextInputSchema} from "../../src/modules/conversation/context-contract/contracts";
import {serializeContextRequest} from "../../src/modules/conversation/context-contract/wire";
import * as requestWireModule from "../../src/modules/conversation/context-contract/wire";
import {resolveSingleValidationTarget} from "./context-contract-runner";
import {createContextContractProbe} from "./context-contract-probe";
import {frozenContextProposal,encodeFixtureV3} from "./context-pointer-fixtures";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const candidate=currentFixtureCandidate();
// Immutable structural specimen from accepted application c40, not an oracle
// or production fallback. Historical probe characterization uses only this
// explicit schema seam; current candidate drift tests remain unmocked.
const acceptedWire46T1Schema={"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"operationCode":{"type":"string","enum":["0","1","2","3","4","5","6","7","8","9","10","11"]},"requestTarget":{"anyOf":[{"type":"object","properties":{"evidence":{"$ref":"#/$defs/__e"}},"required":["evidence"],"additionalProperties":false},{"type":"null"}]},"changes":{"type":"array","items":{"$ref":"#/$defs/__schema5"}},"query":{"anyOf":[{"type":"object","properties":{"period":{"anyOf":[{"$ref":"#/$defs/__schema21"},{"type":"null"}]},"evidence":{"$ref":"#/$defs/__e"},"date":{"anyOf":[{"type":"null"},{"$ref":"#/$defs/__d"}]},"outputCalendar":{"anyOf":[{"type":"null"},{"$ref":"#/$defs/__schema10"}]},"topic":{"anyOf":[{"type":"null"},{"type":"string","enum":["LUNAR","FINITE_SERIES","ANNUAL"]}]}},"required":["period","evidence","date","outputCalendar","topic"],"additionalProperties":false},{"type":"null"}]},"uncertainties":{"type":"array","items":{"type":"object","properties":{"fieldCode":{"type":"integer","minimum":0,"maximum":15,"description":"UncertaintyFieldWireCodeV1: 0=title,1=location,2=notes,3=eventDate,4=eventTime,5=reminderDate,6=reminderTime,7=calendar,8=frequency,9=occurrenceCount,10=eventRelation,11=leadOffsetDays,12=endDate,13=intent,14=queryRange,15=operation"},"reason":{"$ref":"#/$defs/__schema23"},"alternatives":{"type":"array","items":{"type":"string","description":"JSON encoding of a canonical alternative object with value and evidence; use the value type corresponding to the uncertainty field."}}},"required":["fieldCode","reason","alternatives"],"additionalProperties":false}},"conversationDirective":{"anyOf":[{"anyOf":[{"type":"object","properties":{"kind":{"type":"string","enum":["ASK_FOR_FIELD"]},"field":{"$ref":"#/$defs/__schema40"},"reason":{"type":"null"},"issue":{"type":"null"},"topic":{"type":"null"}},"required":["kind","field","reason","issue","topic"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["ASK_FOR_DISAMBIGUATION"]},"field":{"$ref":"#/$defs/__schema40"},"reason":{"type":"string","enum":["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"]},"issue":{"type":"null"},"topic":{"type":"null"}},"required":["kind","field","reason","issue","topic"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["EXPLAIN_UNSUPPORTED"]},"field":{"type":"null"},"reason":{"type":"null"},"issue":{"type":"string","enum":["CAPABILITY","REQUEST_COMBINATION","DOMAIN_LIMIT","ASSISTANT_SCOPE"]},"topic":{"type":"null"}},"required":["kind","field","reason","issue","topic"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["HELP"]},"field":{"type":"null"},"reason":{"type":"null"},"issue":{"type":"null"},"topic":{"type":"string","enum":["GENERAL","REMINDERS","LUNAR","FINITE_SERIES"]}},"required":["kind","field","reason","issue","topic"],"additionalProperties":false}]},{"type":"null"}]},"replyProposal":{"anyOf":[{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false},{"type":"null"}]},"titleChange":{"anyOf":[{"type":"object","properties":{"index":{"type":"integer"},"change":{"type":"object","properties":{"field":{"type":"string","enum":["title"]},"operation":{"type":"string","enum":["SET"]},"value":{"$ref":"#/$defs/__schema3"},"evidence":{"$ref":"#/$defs/__e"}},"required":["field","operation","value","evidence"],"additionalProperties":false}},"required":["index","change"],"additionalProperties":false},{"type":"null"}]},"reminderDateChange":{"anyOf":[{"type":"object","properties":{"index":{"type":"integer"},"change":{"anyOf":[{"type":"object","properties":{"field":{"type":"string","enum":["reminderDate"]},"operation":{"type":"string","enum":["SET"]},"value":{"$ref":"#/$defs/__d"},"evidence":{"$ref":"#/$defs/__e"}},"required":["field","operation","value","evidence"],"additionalProperties":false},{"type":"object","properties":{"field":{"type":"string","enum":["reminderDate"]},"operation":{"type":"string","enum":["REPLACE"]},"value":{"$ref":"#/$defs/__d"},"evidence":{"$ref":"#/$defs/__ec"}},"required":["field","operation","value","evidence"],"additionalProperties":false},{"type":"object","properties":{"field":{"type":"string","enum":["reminderDate"]},"operation":{"type":"string","enum":["CLEAR"]},"value":{"type":"null"},"evidence":{"$ref":"#/$defs/__ec"}},"required":["field","operation","value","evidence"],"additionalProperties":false}]}},"required":["index","change"],"additionalProperties":false},{"type":"null"}]},"reminderTimeChange":{"type":"null"},"eventDateChange":{"anyOf":[{"type":"object","properties":{"index":{"type":"integer"},"change":{"anyOf":[{"type":"object","properties":{"field":{"type":"string","enum":["eventDate"]},"operation":{"type":"string","enum":["SET"]},"value":{"$ref":"#/$defs/__d"},"evidence":{"$ref":"#/$defs/__e"}},"required":["field","operation","value","evidence"],"additionalProperties":false},{"type":"object","properties":{"field":{"type":"string","enum":["eventDate"]},"operation":{"type":"string","enum":["REPLACE"]},"value":{"$ref":"#/$defs/__d"},"evidence":{"$ref":"#/$defs/__ec"}},"required":["field","operation","value","evidence"],"additionalProperties":false},{"type":"object","properties":{"field":{"type":"string","enum":["eventDate"]},"operation":{"type":"string","enum":["CLEAR"]},"value":{"type":"null"},"evidence":{"$ref":"#/$defs/__ec"}},"required":["field","operation","value","evidence"],"additionalProperties":false}]}},"required":["index","change"],"additionalProperties":false},{"type":"null"}]},"eventTimeChange":{"type":"null"},"eventRelationChange":{"anyOf":[{"type":"object","properties":{"index":{"type":"integer"},"change":{"anyOf":[{"type":"object","properties":{"field":{"type":"string","enum":["eventRelation"]},"operation":{"type":"string","enum":["SET"]},"value":{"$ref":"#/$defs/__schema20"},"evidence":{"$ref":"#/$defs/__e"}},"required":["field","operation","value","evidence"],"additionalProperties":false},{"type":"object","properties":{"field":{"type":"string","enum":["eventRelation"]},"operation":{"type":"string","enum":["REPLACE"]},"value":{"$ref":"#/$defs/__schema20"},"evidence":{"$ref":"#/$defs/__ec"}},"required":["field","operation","value","evidence"],"additionalProperties":false},{"type":"object","properties":{"field":{"type":"string","enum":["eventRelation"]},"operation":{"type":"string","enum":["CLEAR"]},"value":{"type":"null"},"evidence":{"$ref":"#/$defs/__ec"}},"required":["field","operation","value","evidence"],"additionalProperties":false}]}},"required":["index","change"],"additionalProperties":false},{"type":"null"}]},"frequencyChange":{"type":"null"},"occurrenceCountChange":{"type":"null"}},"required":["operationCode","requestTarget","changes","query","uncertainties","conversationDirective","replyProposal","titleChange","reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange"],"additionalProperties":false,"$defs":{"__schema3":{"type":"string"},"__schema5":{"anyOf":[{"type":"object","properties":{"field":{"type":"string","enum":["location","notes"]},"operation":{"type":"string","enum":["SET"]},"value":{"$ref":"#/$defs/__schema3"},"evidence":{"$ref":"#/$defs/__e"}},"required":["field","operation","value","evidence"],"additionalProperties":false},{"type":"object","properties":{"field":{"type":"string","enum":["location","notes"]},"operation":{"type":"string","enum":["REPLACE"]},"value":{"$ref":"#/$defs/__schema3"},"evidence":{"$ref":"#/$defs/__ec"}},"required":["field","operation","value","evidence"],"additionalProperties":false},{"type":"object","properties":{"field":{"type":"string","enum":["endDate"]},"operation":{"type":"string","enum":["SET"]},"value":{"$ref":"#/$defs/__d"},"evidence":{"$ref":"#/$defs/__e"}},"required":["field","operation","value","evidence"],"additionalProperties":false},{"type":"object","properties":{"field":{"type":"string","enum":["endDate"]},"operation":{"type":"string","enum":["REPLACE"]},"value":{"$ref":"#/$defs/__d"},"evidence":{"$ref":"#/$defs/__ec"}},"required":["field","operation","value","evidence"],"additionalProperties":false},{"type":"object","properties":{"field":{"type":"string","enum":["location","notes","endDate"]},"operation":{"type":"string","enum":["CLEAR"]},"value":{"type":"null"},"evidence":{"$ref":"#/$defs/__ec"}},"required":["field","operation","value","evidence"],"additionalProperties":false}]},"__schema10":{"type":"string","enum":["GREGORIAN","LUNAR_VN"]},"__schema20":{"type":"string","enum":["BEFORE_EVENT","INCLUDING_EVENT","STARTING_ON"]},"__schema21":{"anyOf":[{"type":"object","properties":{"kind":{"type":"string","enum":["DAY"]},"date":{"anyOf":[{"$ref":"#/$defs/__d"},{"type":"null"}]},"offset":{"type":"null"},"from":{"type":"null"},"through":{"type":"null"}},"required":["kind","date","offset","from","through"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["WEEK","MONTH","WEEKEND"]},"date":{"type":"null"},"offset":{"anyOf":[{"type":"number","const":-1},{"type":"number","const":0},{"type":"number","const":1}]},"from":{"type":"null"},"through":{"type":"null"}},"required":["kind","date","offset","from","through"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["REST_OF_MONTH","NEXT_7_DAYS","UPCOMING"]},"date":{"type":"null"},"offset":{"type":"null"},"from":{"type":"null"},"through":{"type":"null"}},"required":["kind","date","offset","from","through"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["DATE_BOUNDS"]},"date":{"type":"null"},"offset":{"type":"null"},"from":{"anyOf":[{"$ref":"#/$defs/__d"},{"type":"null"}]},"through":{"anyOf":[{"$ref":"#/$defs/__d"},{"type":"null"}]}},"required":["kind","date","offset","from","through"],"additionalProperties":false}]},"__schema23":{"type":"string","enum":["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"]},"__schema40":{"type":"string","enum":["title","location","notes","eventDate","eventTime","reminderDate","reminderTime","calendar","frequency","occurrenceCount","eventRelation","leadOffsetDays","endDate","intent","queryRange","operation"]},"__sources":{"type":"string","enum":["{\"kind\":\"USER_TURN\",\"turn\":0}","{\"kind\":\"USER_TURN\",\"turn\":2}","{\"kind\":\"CONTEXT_FACT\",\"ref\":\"f1\"}"]},"__e":{"type":"object","properties":{"primaryEvidence":{"$ref":"#/$defs/__sources"},"additionalEvidenceJson":{"type":"string"}},"required":["primaryEvidence","additionalEvidenceJson"],"additionalProperties":false},"__current":{"type":"string","enum":["{\"kind\":\"USER_TURN\",\"turn\":2}"]},"__ec":{"type":"object","properties":{"primaryEvidence":{"$ref":"#/$defs/__current"},"additionalEvidenceJson":{"type":"string"}},"required":["primaryEvidence","additionalEvidenceJson"],"additionalProperties":false},"__d":{"type":"object","properties":{"kind":{"type":"string","enum":["C","R","W"]},"calendar":{"type":"string","enum":["NONE","GREGORIAN","LUNAR_VN"]},"day":{"type":"integer","minimum":0,"maximum":31},"month":{"type":"integer","minimum":0,"maximum":12},"year":{"type":"integer","minimum":0,"maximum":9999},"leapMonth":{"type":"integer","minimum":-1,"maximum":1},"offsetDays":{"type":"integer","minimum":-366,"maximum":366},"weekday":{"type":"integer","minimum":0,"maximum":7},"qualifier":{"type":"string","enum":["NONE","THIS_WEEK","NEXT_WEEK","UNRESOLVED"]}},"required":["kind","calendar","day","month","year","leapMonth","offsetDays","weekday","qualifier"],"additionalProperties":false}}};
function mockHistoricalSourceRequests(){
 const real=googleLiteEuContextWireSchemaV3;
 const mock=vi.spyOn(wireModule,"googleLiteEuContextWireSchemaV3").mockImplementation((capability,input)=>{
  const result=real(capability,input);if(input)result.schema=structuredClone(acceptedWire46T1Schema) as unknown as typeof result.schema;return result;
 });return ()=>mock.mockRestore();
}
const dateModes=["DATE_STRING_BASELINE","DATE_NO_NULL_UNIONS","DATE_NO_SCALAR_BOUNDS"] as const;
const dateProbeHashes={DATE_STRING_BASELINE:"ffbdc5c267f7e480879196a0d45c5f11b26ea58517a76d4016ff9bd28bd7dab9",DATE_NO_NULL_UNIONS:"f9b6c46d55acef4f22998f90e8fe8826964ebc2f5542f093d9e167ee6600ccab",DATE_NO_SCALAR_BOUNDS:"42dce35a43d7ac0989b30cd6395c48048330d5b5d10296f69e9fd35b6ea171ea"};
// Explicit historical wire45 specimen. The production probe guard must NOT
// silently accept a later representation. Base candidate identity stays real.
type HistoricalDateNode=NonNullable<ReturnType<typeof googleLiteEuContextWireSchemaV3>["schema"]["$defs"]>[string];
function historicalDateDefinition():HistoricalDateNode{
 const nullable=(node:HistoricalDateNode):HistoricalDateNode=>({anyOf:[node,{type:"null"}]}),integer=(minimum:number,maximum:number)=>nullable({type:"integer",minimum,maximum});
 return {type:"object",properties:{kind:{type:"string",enum:["C","R","W"]},calendar:nullable({type:"string",enum:["GREGORIAN","LUNAR_VN"]}),day:integer(1,31),month:integer(1,12),year:integer(1,9999),leapMonth:nullable({type:"boolean"}),offsetDays:integer(-366,366),weekday:integer(1,7),qualifier:nullable({type:"string",enum:["THIS_WEEK","NEXT_WEEK","UNRESOLVED"]})},required:["kind","calendar","day","month","year","leapMonth","offsetDays","weekday","qualifier"],additionalProperties:false};
}
function mockHistoricalDateRequests(){
 const real=googleLiteEuContextWireSchemaV3;
 const mock=vi.spyOn(wireModule,"googleLiteEuContextWireSchemaV3").mockImplementation((capability,input)=>{
  const result=real(capability,input);if(input){result.schema=structuredClone(acceptedWire46T1Schema) as unknown as typeof result.schema;result.schema.$defs!.__sources={type:"string",enum:['{"kind":"USER_TURN","turn":0}']};result.schema.$defs!.__current={type:"string",enum:['{"kind":"USER_TURN","turn":0}']};result.schema.$defs!.__d=historicalDateDefinition();}return result;
 });return ()=>mock.mockRestore();
}
it.each(dateModes)("%s isolates only historical actual R01 wire45 date definition, one request and no Pilot credit",async mode=>{
 const restore=mockHistoricalDateRequests();
 const s=setup();let calls=0,transportError:unknown;
 try{
  const a=s.load(),history=readFileSync(join(s.history,"campaign.jsonl"),"utf8");
  const result=await runDebugLoopExecution(a,candidate,mode as never,async request=>{
   calls++;try{const body=JSON.parse(request.messages[1].content),context={...body};
   delete context.evidenceSources;delete context.numericOwnership;delete context.fieldCapability;
   const original=googleLiteEuContextWireSchemaV3(body.fieldCapability,ContextInputSchema.parse(context)).schema;
   const before=JSON.stringify(original),probe=debugProbeSchema(original,mode as never);
   expect(hash(before)).toBe("136bbd97978fe0bb989de2470bcba73d852cb2f0d7247b40994978d2adca81c0");
   expect(hash(JSON.stringify(request.response_format.json_schema.schema))).toBe(dateProbeHashes[mode]);
   expect(probe).toEqual(request.response_format.json_schema.schema);
   expect({...probe,$defs:{...probe.$defs,__d:original.$defs!.__d}}).toEqual(original);
   expect(JSON.stringify(original)).toBe(before);
   const proposal=encodeFixtureV3(frozenContextProposal(body,"R01",0));
   const response=JSON.stringify({model:request.model,provider:"Google",id:"gen-local-date-probe",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(proposal)}}]});
   return {status:200,body:response,rawResponseBytes:Buffer.byteLength(response)};
   }catch(error){transportError=error;throw error;}
  },{now:()=>100});
  if(transportError)throw transportError;
  expect(result).toMatchObject({providerHttpAttempts:1,applicationLlmCalls:1,terminal:true,pilotCredit:false});
  expect(result.responses[0],JSON.stringify(result.responses[0].canonicalValidationDiagnostics)).toMatchObject({fixtureId:"R01",turnIndex:0,status:"SUCCESS"});
  await expect(runDebugLoopExecution(a,candidate,mode as never,async()=>{calls++;throw Error("FORBIDDEN")})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");
  expect(calls).toBe(1);expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);
  expect(inspectDebugLoop(a)).toMatchObject({prospectiveUnknownCount:1,unknownExposureMicrounits:105472});
 }finally{s.cleanup();restore()}
});
it.each(dateModes)("%s preserves historical wire45 unknown accounting after exactly one failed HTTP request",async mode=>{
 const restore=mockHistoricalDateRequests();
 const s=setup();let calls=0;
 try{const a=s.load(),history=readFileSync(join(s.history,"campaign.jsonl"),"utf8");const result=await runDebugLoopExecution(a,candidate,mode as never,async()=>{calls++;return {status:400,body:"{}"}},{now:()=>100});
 expect(result).toMatchObject({providerHttpAttempts:1,terminal:true,pilotCredit:false});expect(calls).toBe(1);
 expect(inspectDebugLoop(a)).toMatchObject({prospectiveUnknownCount:2,unknownExposureMicrounits:210944});expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);
 }finally{s.cleanup();restore()}
});
it.each(dateModes)("historical %s rejects current sentinel shape before HTTP without Pilot credit",async mode=>{
 const schema=requestBoundSchema(),before=JSON.stringify(schema);
 expect(()=>debugProbeSchema(schema,mode)).toThrow("DEBUG_PROBE_SHAPE");expect(JSON.stringify(schema)).toBe(before);
 const s=setup();let calls=0;
 try{const history=readFileSync(join(s.history,"campaign.jsonl"),"utf8");const result=await runDebugLoopExecution(s.load(),candidate,mode,async()=>{calls++;throw Error("FORBIDDEN")},{now:()=>100});
  expect(result).toMatchObject({providerHttpAttempts:0,applicationLlmCalls:1,terminal:true,pilotCredit:false});expect(calls).toBe(0);expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);
 }finally{s.cleanup()}
});
it.each(["missing","extra","required","open","kind","null-order","bound","external","unresolved","ref-sibling","moved-reference"])("date probes fail closed on %s shape drift",fault=>{
 type DriftNode={type?:string;$ref?:string;maximum?:number;enum?:string[];required?:string[];additionalProperties?:boolean;properties?:Record<string,DriftNode>;$defs?:Record<string,DriftNode>;anyOf?:DriftNode[]};
 const schema=structuredClone(acceptedWire46T1Schema) as unknown as DriftNode,d=schema.$defs!.__d,date=schema.properties!.query.anyOf![0].properties!.date.anyOf!;
 Object.assign(d,historicalDateDefinition());
 if(fault==="missing")delete schema.$defs!.__d;
 if(fault==="extra")d.properties!.secret={type:"string"};
 if(fault==="required")d.required!.pop();
 if(fault==="open")d.additionalProperties=true;
 if(fault==="kind")d.properties!.kind.enum=["C","R"];
 if(fault==="null-order")d.properties!.day.anyOf!.reverse();
 if(fault==="bound")d.properties!.day.anyOf![0].maximum=32;
 if(fault==="external")date[1].$ref="https://private.invalid/date";
 if(fault==="unresolved")date[1].$ref="#/$defs/missing";
 if(fault==="ref-sibling")date[1].type="object";
 if(fault==="moved-reference"){date[1]={type:"string"};schema.properties!.replyProposal={$ref:"#/$defs/__d"};}
 for(const mode of dateModes)expect(()=>debugProbeSchema(schema,mode as never)).toThrow("DEBUG_PROBE_SHAPE");
});
it("historical date diagnostic ablation never changes the current strict DateWire runtime decoder",()=>{
 const schema=structuredClone(acceptedWire46T1Schema) as unknown as ReturnType<typeof googleLiteEuContextWireSchemaV3>["schema"];schema.$defs!.__d=historicalDateDefinition();const before=JSON.stringify(schema);
 for(const mode of dateModes)debugProbeSchema(schema,mode);
 expect(JSON.stringify(schema)).toBe(before);
 const raw=encodeGoogleLiteEuContextV3(frozenContextProposal({turns:[{role:"USER",text:"Ngày 11/10 đi thi ở Quang Trung, nhắc mỗi ngày 2 ngày"}],currentTurn:0,activeRequest:null,pendingQuestion:null,facts:[]} as never,"R02",0) as never) as {eventDateChange:{change:{value:unknown}}};
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).not.toBe("REFUSED");
 raw.eventDateChange.change.value=JSON.stringify(raw.eventDateChange.change.value);
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
function requestBoundSchema(){
 const input=ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text:"Mai 8h nhắc gọi mẹ"}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"v1",supported:["ONCE"],unsupported:["YEARLY"],calendars:["GREGORIAN"],limits:{dailyCount:30,horizonDays:366}}});
 return serializeContextRequest(input).response_format.json_schema.schema;
}
it("diagnostic evidence ablation follows the exact request-only shared evidence definition",()=>{
 const schema=requestBoundSchema(),before=JSON.stringify(schema);
 const probe=debugProbeSchema(schema,"QUERY_ONLY") as unknown as {properties:{requestTarget:{anyOf:Array<{properties:{evidence:unknown}}>};query:unknown};$defs:Record<string,unknown>};
 expect(probe.properties.requestTarget.anyOf[0].properties.evidence).toEqual({type:"array",items:{$ref:"#/$defs/__sources"}});
 expect(probe.properties.query).toEqual((schema as unknown as typeof probe).properties.query);
 expect(probe.$defs.__e).toEqual((schema as unknown as typeof probe).$defs.__e);
 expect(probe.$defs.__sources).toEqual((schema as unknown as typeof probe).$defs.__sources);
 expect(JSON.stringify(schema)).toBe(before);
 const unresolved=structuredClone(schema) as unknown as typeof probe;delete unresolved.$defs.__sources;
 expect(()=>debugProbeSchema(unresolved,"QUERY_ONLY")).toThrow("DEBUG_PROBE_SHAPE");
 const missingCurrent=structuredClone(schema) as unknown as typeof probe;delete missingCurrent.$defs.__current;
 expect(()=>debugProbeSchema(missingCurrent,"QUERY_ONLY")).toThrow("DEBUG_PROBE_SHAPE");
 expect(probe.$defs.__ec).toEqual((schema as unknown as typeof probe).$defs.__ec);
 expect(probe.$defs.__current).toEqual((schema as unknown as typeof probe).$defs.__current);
});
it.each([
 [{ $ref:"https://private.invalid/evidence" },"UNCHANGED"],
 [{ $ref:"#/$defs/other" },"UNCHANGED"],
 [{ $ref:"#/$defs/__e",type:"object" },"UNCHANGED"],
 [{ $ref:"#/$defs/__e" },undefined],
 [{ $ref:"#/$defs/__e" },{type:"object",properties:{primaryEvidence:{type:"string"},additionalEvidenceJson:{type:"string"}},required:["primaryEvidence"],additionalProperties:false}],
 [{ $ref:"#/$defs/__e" },{type:"object",properties:{primaryEvidence:{type:"string"},additionalEvidenceJson:{type:"string"}},required:["primaryEvidence","additionalEvidenceJson"],additionalProperties:true}],
])("diagnostic evidence refs reject unresolved, external or nonexact shapes %#",(evidence,definition)=>{
 const schema=requestBoundSchema() as unknown as {properties:{requestTarget:{anyOf:Array<{properties:{evidence:unknown}}>}};$defs:Record<string,unknown>};
 schema.properties.requestTarget.anyOf[0].properties.evidence=evidence;
 if(definition===undefined)delete schema.$defs.__e;else if(definition!=="UNCHANGED")schema.$defs.__e=definition;
 expect(()=>debugProbeSchema(schema,"QUERY_ONLY")).toThrow("DEBUG_PROBE_SHAPE");
});
it.each(["crossed-source","extra-key","missing-required","open-object","empty-current"])("mutating evidence shared refs reject nonexact %s",fault=>{
 const schema=requestBoundSchema() as unknown as {$defs:Record<string,{properties:Record<string,unknown>;required:string[];additionalProperties:boolean;enum:string[]}>};
 if(fault==="crossed-source")schema.$defs.__ec.properties.primaryEvidence={$ref:"#/$defs/__sources"};
 if(fault==="extra-key")schema.$defs.__ec.properties.secret={type:"string"};
 if(fault==="missing-required")schema.$defs.__ec.required=["primaryEvidence"];
 if(fault==="open-object")schema.$defs.__ec.additionalProperties=true;
 if(fault==="empty-current")schema.$defs.__current.enum=[];
 expect(()=>debugProbeSchema(schema as never,"QUERY_ONLY")).toThrow("DEBUG_PROBE_SHAPE");
});
it("string-selector diagnostic changes only wire enum representation without runtime repair",()=>{
 const original=googleLiteEuContextWireSchemaV3().schema;
 original.properties!.operationCode={type:"integer",enum:Array.from({length:12},(_,i)=>i)};
 const before=JSON.stringify(original);
 const probe=debugProbeSchema(original,"OPERATION_STRING");
 expect(probe.properties!.operationCode).toEqual({type:"string",enum:Array.from({length:12},(_,i)=>String(i))});
 expect({...probe,properties:{...probe.properties,operationCode:original.properties!.operationCode}}).toEqual(original);
 expect(JSON.stringify(original)).toBe(before);
 const raw=encodeFixtureV3(frozenContextProposal({turns:[{role:"USER",text:"Có lịch nào ko?"}],currentTurn:0,activeRequest:null,pendingQuestion:null,facts:[]} as never,"R01",0)) as Record<string,unknown>;
 raw.operationCode=3;
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("historical string-selector probe fails closed when runtime is already string-coded",async()=>{
 const s=setup();let calls=0;
 try{
  const a=s.load(),result=await runDebugLoopExecution(a,candidate,"OPERATION_STRING",async()=>{calls++;throw Error("FORBIDDEN")},{now:()=>100});
  expect(result).toMatchObject({providerHttpAttempts:0,applicationLlmCalls:1,terminal:true,pilotCredit:false});
  expect(result.responses[0].status).toBe("FAILURE");
  await expect(runDebugLoopExecution(a,candidate,"OPERATION_STRING",async()=>{calls++;throw Error("FORBIDDEN")})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");
  expect(calls).toBe(0);
 }finally{s.cleanup()}
});
it("R02 diagnostic is exactly one frozen turn with safe semantic summary and no Pilot credit",async()=>{
 const s=setup();let calls=0;
 try{
  const result=await runDebugLoopExecution(s.load(),candidate,"R02_TURN0",async request=>{
   calls++;const content=encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),"R02",0));
   const body=JSON.stringify({model:request.model,provider:"Google",id:"gen-local-diagnostic",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]});
   return {status:200,body,rawResponseBytes:Buffer.byteLength(body)};
  },{now:()=>100});
  expect(result).toMatchObject({providerHttpAttempts:1,applicationLlmCalls:1,terminal:true,pilotCredit:false});
  expect(result.responses[0]).toMatchObject({fixtureId:"R02",turnIndex:0,semanticState:{intent:"CREATE_REMINDER"}});
  expect(JSON.stringify(result.responses[0].semanticState)).not.toContain("Quang Trung");
  await expect(runDebugLoopExecution(s.load(),candidate,"R02_TURN0",async()=>{calls++;throw Error("FORBIDDEN")})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");
  expect(calls).toBe(1);
 }finally{s.cleanup()}
});
const sourceModes=["DATE_CURRENT_NO_SCALAR_BOUNDS","DATE_CURRENT_STRING_BASELINE","SOURCE_CURRENT_KEY_BASELINE","SOURCE_INTEGER_BASELINE","SOURCE_STRING_BASELINE","SOURCE_SINGLETON_BASELINE","SOURCE_T0_SCHEMA_BASELINE","SOURCE_COMPACT_BASELINE","SOURCE_CURRENT_INLINE_BASELINE"] as const;
const r02Turn1Modes=["R02_TURN1_SCHEMA_CONTROL","R02_TURN1_UNCERTAINTY_UNBOUNDED_BASELINE"] as const;
const r02CurrentKeyMode="R02_TURN1_CURRENT_KEY_BASELINE" as const;
const r02CoalescedMode="R02_TURN1_REPLACE_COALESCED_BASELINE" as const;
const r02GeneralStringMode="R02_TURN1_GENERAL_SOURCE_STRING_BASELINE" as const;
async function r02Turn1Schema(){
 const selected=resolveSingleValidationTarget(process.cwd(),{fixture:"R02",turn:1});
 let schema:ReturnType<typeof googleLiteEuContextWireSchemaV3>["schema"]|undefined;
 const probe=await createContextContractProbe({sourceSha:candidate,referenceNow:Date.parse("2026-10-05T01:00:00Z"),contextSeed:selected.contextSeed.state},input=>{schema=serializeContextRequest(input).response_format.json_schema.schema;return {fixtureFault:"SCHEMA_INVALID"};});
 try{const turn=selected.script.turns[0];await probe.turn(turn.text,turn.receipt,undefined,turn.processingAt);}finally{probe.dispose();}
 expect(schema).toBeDefined();return schema!;
}
it.each(r02Turn1Modes)("%s pins seeded R02 T1 and alters at most the sole uncertainty bound",async mode=>{
 const original=await r02Turn1Schema(),before=JSON.stringify(original);
 expect(hash(before)).toBe("635f4734b667e0827e1975135b1eaae4bfaf43ac4e5b729b6612dba8113b3e48");
 const transformed=debugProbeSchema(original,mode as never);
 expect(hash(JSON.stringify(transformed))).toBe(mode===r02Turn1Modes[0]?hash(before):"ecfc0b1b680d667f5bfa3e4fa7f841dfd6bbd157f67ab5b2e4e3d7575b53f53d");
 expect({...transformed,properties:{...transformed.properties,uncertainties:original.properties!.uncertainties}}).toEqual(original);
 expect(JSON.stringify(original)).toBe(before);
 const restore=structuredClone(transformed);restore.properties!.uncertainties=structuredClone(original.properties!.uncertainties);
 expect(JSON.stringify(restore)).toBe(before);
 expect(original.$defs!.__sources.enum).toHaveLength(7);expect(original.$defs!.__current.enum).toHaveLength(1);
});
it("R02 current key probe changes only the strict shared mutation key with exact restoration",async()=>{
 const original=await r02Turn1Schema(),before=JSON.stringify(original),probe=debugProbeSchema(original,r02CurrentKeyMode as never);
 expect(hash(JSON.stringify(probe))).toBe("6a9790bcaa4f2ef63f458fb87b8ac353c8541ca893f4c925525a192d5882a117");
 const expected=structuredClone(original),ec=expected.$defs!.__ec;
 ec.properties=Object.fromEntries(Object.entries(ec.properties!).map(([key,value])=>[key==="primaryEvidence"?"currentPrimaryEvidence":key,value]));
 ec.required=ec.required!.map(key=>key==="primaryEvidence"?"currentPrimaryEvidence":key);
 expect(probe).toEqual(expected);expect({...probe,$defs:{...probe.$defs,__ec:original.$defs!.__ec}}).toEqual(original);
 const restored=structuredClone(probe),restoreEC=restored.$defs!.__ec;
 restoreEC.properties=Object.fromEntries(Object.entries(restoreEC.properties!).map(([key,value])=>[key==="currentPrimaryEvidence"?"primaryEvidence":key,value]));
 restoreEC.required=restoreEC.required!.map(key=>key==="currentPrimaryEvidence"?"primaryEvidence":key);
 expect(JSON.stringify(restored)).toBe(before);expect(JSON.stringify(original)).toBe(before);
 let consumers=0;const walk=(node:unknown)=>{if(!node||typeof node!=="object")return;if("$ref" in node&&node.$ref==="#/$defs/__ec")consumers++;Object.values(node).forEach(walk)};walk(probe);
 expect(consumers).toBe(17);expect(probe.$defs!.__sources).toEqual(original.$defs!.__sources);expect(probe.$defs!.__current).toEqual(original.$defs!.__current);expect(probe.properties!.uncertainties).toEqual(original.properties!.uncertainties);
});
it("R02 coalesced probe merges only two exact REPLACE shells and preserves both fields",async()=>{
 const original=await r02Turn1Schema(),before=JSON.stringify(original),probe=debugProbeSchema(original,r02CoalescedMode as never);
 const old=original.$defs!.__schema5.anyOf!,merged=probe.$defs!.__schema5.anyOf!;
 expect(old).toHaveLength(4);expect(merged).toHaveLength(3);
 expect(old[1].properties!.field).toEqual({type:"string",enum:["notes"]});expect(old[2].properties!.field).toEqual({type:"string",enum:["title"]});
 expect({...old[1],properties:{...old[1].properties,field:undefined}}).toEqual({...old[2],properties:{...old[2].properties,field:undefined}});
 expect(merged[1]).toEqual({...old[1],properties:{...old[1].properties,field:{type:"string",enum:["notes","title"]}}});
 expect(merged[0]).toEqual(old[0]);expect(merged[2]).toEqual(old[3]);
 const shell=merged[1];expect(shell.required).toEqual(["field","operation","value","evidence"]);expect(shell.additionalProperties).toBe(false);
 expect(shell.properties!.operation).toEqual({type:"string",enum:["REPLACE"]});expect(shell.properties!.value).toEqual({$ref:"#/$defs/__schema3"});expect(shell.properties!.evidence).toEqual({$ref:"#/$defs/__ec"});
 // Independent finite shell membership: all common assertions are unchanged.
 const fieldValues=(branch:typeof shell)=>{const field=branch.properties!.field;if(typeof field==="boolean")throw Error("TEST_FIELD_OBJECT");return field.enum!;};
 const accepts=(fields:unknown[],field:string,operation:string,value:unknown,evidenceRef:string)=>fields.includes(field)&&operation==="REPLACE"&&typeof value==="string"&&evidenceRef==="#/$defs/__ec";
 for(const field of ["notes","title","location"])for(const operation of ["REPLACE","SET","CLEAR"])for(const value of ["structural-example",null,2])for(const evidenceRef of ["#/$defs/__ec","#/$defs/__e"]){
  const originalAccepts=old.slice(1,3).some(branch=>accepts(fieldValues(branch),field,operation,value,evidenceRef));
  expect(accepts(fieldValues(shell),field,operation,value,evidenceRef)).toBe(originalAccepts);
 }
 expect(hash(JSON.stringify(probe))).toBe("2740170b5dd2d4fe9868016766e37ea9b233254be73f7156f72dcd906cfaaafe");
 const restore=structuredClone(probe);restore.$defs!.__schema5=structuredClone(original.$defs!.__schema5);expect(JSON.stringify(restore)).toBe(before);expect(JSON.stringify(original)).toBe(before);
 expect(probe.$defs!.__sources).toEqual(original.$defs!.__sources);expect(probe.$defs!.__current).toEqual(original.$defs!.__current);expect(probe.properties!.uncertainties).toEqual(original.properties!.uncertainties);
 let consumers=0;const walk=(node:unknown)=>{if(!node||typeof node!=="object")return;if("$ref" in node&&node.$ref==="#/$defs/__ec")consumers++;Object.values(node).forEach(walk)};walk(probe);expect(consumers).toBe(16);
});
it("R02 general source probe changes only the enum definition and restores original bytes",async()=>{
 const original=await r02Turn1Schema(),before=JSON.stringify(original),probe=debugProbeSchema(original,r02GeneralStringMode as never);
 expect(hash(JSON.stringify(probe))).toBe("8e1d159043ecdb9a73d3d28a9e4d22c06d773923f95f591dcc66cda6dcd30a9e");expect(probe.$defs!.__sources).toEqual({type:"string"});expect(original.$defs!.__sources.enum).toHaveLength(7);
 const restore=structuredClone(probe);restore.$defs!.__sources=structuredClone(original.$defs!.__sources);expect(JSON.stringify(restore)).toBe(before);expect(JSON.stringify(original)).toBe(before);
 expect(probe.$defs!.__current).toEqual(original.$defs!.__current);expect(probe.$defs!.__current.enum).toHaveLength(1);expect(probe.$defs!.__schema5).toEqual(original.$defs!.__schema5);expect(probe.properties!.uncertainties).toEqual(original.properties!.uncertainties);
 const counts:Record<string,number>={};const walk=(node:unknown)=>{if(!node||typeof node!=="object")return;if("$ref" in node&&typeof node.$ref==="string")counts[node.$ref]=(counts[node.$ref]??0)+1;Object.values(node).forEach(walk)};walk(probe);
 expect(counts["#/$defs/__e"]).toBe(11);expect(counts["#/$defs/__ec"]).toBe(17);expect(counts["#/$defs/__sources"]).toBe(1);expect(counts["#/$defs/__current"]).toBe(1);
});
it.each([{status:200,quote:false},{status:200,quote:true},{status:400,quote:false}])("R02 general source probe HTTP$status quote=$quote preserves strict runtime boundary",async({status,quote})=>{
 const s=setup();let calls=0,transportError:unknown;
 try{const a=s.load(),history=readFileSync(join(s.history,"campaign.jsonl"),"utf8"),before=inspectDebugLoop(a);
 const result=await runDebugLoopExecution(a,candidate,r02GeneralStringMode as never,async request=>{
  calls++;try{
   expect(hash(JSON.stringify(request.response_format.json_schema.schema))).toBe("8e1d159043ecdb9a73d3d28a9e4d22c06d773923f95f591dcc66cda6dcd30a9e");expect(hash(JSON.stringify(request))).toBe("89aa62066b98e240e051007b0c233a03d184efe14385a34c868dbe5aecb810a1");
   const input=JSON.parse(request.messages[1].content),context={...input};delete context.evidenceSources;delete context.numericOwnership;delete context.fieldCapability;
   const content=encodeFixtureV3(frozenContextProposal(input,"R02",1));expect(decodeGoogleLiteEuContextTransportV3(content,CONTEXT_PROTOCOL_V3,undefined,undefined,ContextInputSchema.parse(context)).status).toBe("PARSED");
   if(quote){
    if(!content||typeof content!=="object"||Array.isArray(content)||!("requestTarget" in content))throw Error("TEST_WIRE_OBJECT");
    const target=content.requestTarget;if(!target||typeof target!=="object"||Array.isArray(target)||!("evidence" in target))throw Error("TEST_TARGET_OBJECT");
    const evidence=target.evidence;if(!evidence||typeof evidence!=="object"||Array.isArray(evidence)||!("primaryEvidence" in evidence))throw Error("TEST_EVIDENCE_OBJECT");
    evidence.primaryEvidence=JSON.stringify({kind:"USER_QUOTE",turn:2,quote:"PRIVATE_SOURCE_SECRET",occurrence:1});
    const source=request.response_format.json_schema.schema.$defs!.__sources;expect(source).toEqual({type:"string"});expect(typeof evidence.primaryEvidence).toBe("string");
   }
   return {status,body:status===400?"{}":JSON.stringify({model:request.model,provider:"Google",id:"gen-local-r02-general",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]})};
  }catch(error){transportError=error;throw error}
 },{now:()=>100});
 if(transportError)throw transportError;
 expect(result).toMatchObject({providerHttpAttempts:1,applicationLlmCalls:1,terminal:true,pilotCredit:false,contextSeedProof:{fixture:"R02",turn:1,prerequisiteProviderRequests:0,prerequisiteApplicationLlmDispatches:0}});
 expect(result.responses[0].status).toBe(status===200&&!quote?"SUCCESS":"FAILURE");
 if(quote){expect(result.responses[0]).toMatchObject({category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{path:["requestTarget","evidence","primaryEvidence"],expected:"EVIDENCE_SOURCE_POINTER",evidencePointer:{reason:"STRICT_USER_QUOTE",pointerKind:"USER_QUOTE"}}]}}});expect(result.applicationEvidence[0]).toMatchObject({status:"REJECTED",listStoreReads:0,mutations:0});}
 expect(JSON.stringify(result.responses)).not.toContain("PRIVATE_SOURCE_SECRET");expect(result.applicationEvidence[0]).toMatchObject({listStoreReads:0,mutations:0});expect(existsSync(join(result.directory,"http-1.json"))).toBe(false);
 await expect(runDebugLoopExecution(a,candidate,r02GeneralStringMode as never,async()=>{calls++;throw Error("FORBIDDEN")})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");expect(calls).toBe(1);
 expect(inspectDebugLoop(a).unknownExposureMicrounits).toBe(before.unknownExposureMicrounits+(status===400?105472:0));expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);
 }finally{s.cleanup()}
});
it.each([200,400])("R02 coalesced probe HTTP%i keeps original fixture wire acceptance and one terminal call",async status=>{
 const s=setup();let calls=0,transportError:unknown;
 try{const a=s.load(),history=readFileSync(join(s.history,"campaign.jsonl"),"utf8"),before=inspectDebugLoop(a);
 const result=await runDebugLoopExecution(a,candidate,r02CoalescedMode as never,async request=>{
  calls++;try{
   expect(hash(JSON.stringify(request.response_format.json_schema.schema))).toBe("2740170b5dd2d4fe9868016766e37ea9b233254be73f7156f72dcd906cfaaafe");expect(hash(JSON.stringify(request))).toBe("8cc6e16865e5c685c5e0b65e77262bf03ab13e63da5c26d913733b2f0cdde042");
   const input=JSON.parse(request.messages[1].content),context={...input};delete context.evidenceSources;delete context.numericOwnership;delete context.fieldCapability;
   const content=encodeFixtureV3(frozenContextProposal(input,"R02",1));
   expect(decodeGoogleLiteEuContextTransportV3(content,CONTEXT_PROTOCOL_V3,undefined,undefined,ContextInputSchema.parse(context)).status).toBe("PARSED");
   return {status,body:status===400?"{}":JSON.stringify({model:request.model,provider:"Google",id:"gen-local-r02-coalesced",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]})};
  }catch(error){transportError=error;throw error}
 },{now:()=>100});
 if(transportError)throw transportError;
 expect(result).toMatchObject({providerHttpAttempts:1,applicationLlmCalls:1,terminal:true,pilotCredit:false,contextSeedProof:{fixture:"R02",turn:1,prerequisiteProviderRequests:0,prerequisiteApplicationLlmDispatches:0}});
 expect(result.responses[0].status).toBe(status===200?"SUCCESS":"FAILURE");expect(result.applicationEvidence[0]).toMatchObject({listStoreReads:0,mutations:0}); // No final oracle requirement.
 expect(existsSync(join(result.directory,"http-1.json"))).toBe(false);await expect(runDebugLoopExecution(a,candidate,r02CoalescedMode as never,async()=>{calls++;throw Error("FORBIDDEN")})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");expect(calls).toBe(1);
 expect(inspectDebugLoop(a).unknownExposureMicrounits).toBe(before.unknownExposureMicrounits+(status===400?105472:0));expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);expect(JSON.stringify(result.responses)).not.toContain("Quang Trung");
 }finally{s.cleanup()}
});
it.each([200,400])("R02 current key probe HTTP%i authors reachable CLEAR yet unchanged runtime refuses new key",async status=>{
 const s=setup();let calls=0,transportError:unknown;
 try{const a=s.load(),history=readFileSync(join(s.history,"campaign.jsonl"),"utf8"),before=inspectDebugLoop(a);
 const result=await runDebugLoopExecution(a,candidate,r02CurrentKeyMode as never,async request=>{
  calls++;try{
   const schema=request.response_format.json_schema.schema;
   expect(hash(JSON.stringify(schema))).toBe("6a9790bcaa4f2ef63f458fb87b8ac353c8541ca893f4c925525a192d5882a117");
   expect(hash(JSON.stringify(request))).toBe("80eb1e580c911d7589cc070585c156f930df6c7a51144ecad34033cfd0f7fff8");
   const input=JSON.parse(request.messages[1].content),context={...input};delete context.evidenceSources;delete context.numericOwnership;delete context.fieldCapability;
   const original=googleLiteEuContextWireSchemaV3(input.fieldCapability,ContextInputSchema.parse(context)).schema;
   const carrier=original.properties!.eventDateChange;if(typeof carrier==="boolean")throw Error("TEST_CARRIER_OBJECT");
   const option=carrier.anyOf![0];if(typeof option==="boolean")throw Error("TEST_CARRIER_OPTION_OBJECT");
   const change=option.properties!.change;if(typeof change==="boolean")throw Error("TEST_CHANGE_OBJECT");
   const branch=change.anyOf![2];if(typeof branch==="boolean")throw Error("TEST_CHANGE_BRANCH_OBJECT");
   expect(branch.properties!.field).toEqual({type:"string",enum:["eventDate"]});expect(branch.properties!.operation).toEqual({type:"string",enum:["CLEAR"]});expect(branch.properties!.value).toEqual({type:"null"});expect(branch.properties!.evidence).toEqual({$ref:"#/$defs/__ec"});
   const current=schema.$defs!.__current;if(typeof current==="boolean")throw Error("TEST_CURRENT_DOMAIN_OBJECT");
   const pointer=current.enum![0];expect(typeof pointer).toBe("string");
   const content=encodeFixtureV3(frozenContextProposal(input,"R02",1));
   if(!content||typeof content!=="object"||Array.isArray(content)||!("changes" in content)||!("eventDateChange" in content)||!Array.isArray(content.changes))throw Error("TEST_WIRE_OBJECT");
   expect(content.eventDateChange).toBeNull();
   const index=content.changes.length+Object.entries(content).filter(([key,value])=>key.endsWith("Change")&&value!==null).length;
   const evidence={currentPrimaryEvidence:pointer,additionalEvidenceJson:"[]"};
   expect(Object.keys(evidence)).toEqual(["currentPrimaryEvidence","additionalEvidenceJson"]);
   const shared=schema.$defs!.__ec;if(typeof shared==="boolean")throw Error("TEST_EVIDENCE_OBJECT");expect(shared.required).toEqual(Object.keys(evidence));expect(shared.additionalProperties).toBe(false);
   content.eventDateChange={index,change:{field:"eventDate",operation:"CLEAR",value:null,evidence}};
   const old=structuredClone(content);old.eventDateChange={index,change:{field:"eventDate",operation:"CLEAR",value:null,evidence:{primaryEvidence:pointer,additionalEvidenceJson:"[]"}}};
   let oldWireRefusal=false;decodeGoogleLiteEuContextTransportV3(old,CONTEXT_PROTOCOL_V3,undefined,()=>{oldWireRefusal=true},ContextInputSchema.parse(context));
   expect(oldWireRefusal).toBe(false); // No claim of final semantic/oracle acceptance.
   return {status,body:status===400?"{}":JSON.stringify({model:request.model,provider:"Google",id:"gen-local-r02-key",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]})};
  }catch(error){transportError=error;throw error}
 },{now:()=>100});
 if(transportError)throw transportError;
 expect(result).toMatchObject({providerHttpAttempts:1,applicationLlmCalls:1,terminal:true,pilotCredit:false,contextSeedProof:{fixture:"R02",turn:1,prerequisiteProviderRequests:0,prerequisiteApplicationLlmDispatches:0}});
 if(status===200){expect(result.responses[0]).toMatchObject({category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{path:["eventDateChange","change"],expected:"FIELD_CHANGE"}]}}});expect(result.applicationEvidence[0]).toMatchObject({status:"REJECTED",listStoreReads:0,mutations:0});}
 expect(existsSync(join(result.directory,"http-1.json"))).toBe(false);await expect(runDebugLoopExecution(a,candidate,r02CurrentKeyMode as never,async()=>{calls++;throw Error("FORBIDDEN")})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");expect(calls).toBe(1);
 expect(inspectDebugLoop(a).unknownExposureMicrounits).toBe(before.unknownExposureMicrounits+(status===400?105472:0));expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);
 expect(JSON.stringify(result.responses)).not.toContain("Quang Trung");
 }finally{s.cleanup()}
});
it.each(r02Turn1Modes.flatMap(mode=>[200,400].map(status=>({mode,status}))))("$mode HTTP$status is one seeded terminal request with unchanged max4 decoder",async({mode,status})=>{
 const s=setup();let calls=0,transportError:unknown;
 try{const a=s.load(),history=readFileSync(join(s.history,"campaign.jsonl"),"utf8"),before=inspectDebugLoop(a);
 const result=await runDebugLoopExecution(a,candidate,mode as never,async request=>{
  calls++;try{
   const input=JSON.parse(request.messages[1].content),context={...input};delete context.evidenceSources;delete context.numericOwnership;delete context.fieldCapability;
   expect(hash(JSON.stringify(context))).toBe("560569f4bc260b7921602f5e5a892b87f5a384e856ea2b845e5b473df3af2c08");
   const uncertaintySchema=request.response_format.json_schema.schema.properties!.uncertainties;
   if(typeof uncertaintySchema==="boolean")throw Error("TEST_UNCERTAINTY_SCHEMA_OBJECT");
   expect(uncertaintySchema.maxItems).toBe(mode===r02Turn1Modes[0]?4:undefined);
   const content=encodeFixtureV3(frozenContextProposal(input,"R02",1));
   if(!content||typeof content!=="object"||Array.isArray(content)||!("uncertainties" in content))throw Error("TEST_WIRE_OBJECT");
   content.uncertainties=Array.from({length:5},()=>({fieldCode:6,reason:"MISSING",alternatives:[]}));
   return {status,body:status===400?"{}":JSON.stringify({model:request.model,provider:"Google",id:"gen-local-r02-bound",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]})};
  }catch(error){transportError=error;throw error}
 },{now:()=>100});
 if(transportError)throw transportError;
 expect(result).toMatchObject({providerHttpAttempts:1,applicationLlmCalls:1,terminal:true,pilotCredit:false,contextSeedProof:{fixture:"R02",turn:1,prerequisiteProviderRequests:0,prerequisiteApplicationLlmDispatches:0}});
 expect(result.responses[0]).toMatchObject({fixtureId:"R02",turnIndex:1,status:"FAILURE"});
 if(status===200){expect(result.responses[0]).toMatchObject({category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{path:["uncertainties"],code:"WIRE_SHAPE_INVALID",actualCount:5,maxItems:4}]}}});expect(result.applicationEvidence[0]).toMatchObject({status:"REJECTED",listStoreReads:0,mutations:0});}
 expect(existsSync(join(result.directory,"http-1.json"))).toBe(false);
 await expect(runDebugLoopExecution(a,candidate,mode as never,async()=>{calls++;throw Error("FORBIDDEN")})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");
 expect(calls).toBe(1);expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);
 expect(inspectDebugLoop(a).unknownExposureMicrounits).toBe(before.unknownExposureMicrounits+(status===400?105472:0));
 expect(JSON.stringify(result.responses)).not.toContain("Quang Trung");
 }finally{s.cleanup()}
});
it.each([...r02Turn1Modes,r02CurrentKeyMode,r02CoalescedMode,r02GeneralStringMode].flatMap(mode=>["schema","context"].map(fault=>({mode,fault}))))("$mode refuses seeded $fault drift before physical HTTP",async({mode,fault})=>{
 const real=serializeContextRequest;
 const spy=vi.spyOn(requestWireModule,"serializeContextRequest").mockImplementation(input=>{
  const request=real(input);
  if(fault==="schema"){const uncertainty=request.response_format.json_schema.schema.properties!.uncertainties;if(typeof uncertainty==="boolean")throw Error("TEST_UNCERTAINTY_SCHEMA_OBJECT");uncertainty.maxItems=3;}
  else{const context=JSON.parse(request.messages[1].content);context.reference.instant="2026-10-05T01:00:01Z";request.messages[1].content=JSON.stringify(context);}
  return request;
 });
 const s=setup();let calls=0;
 try{const history=readFileSync(join(s.history,"campaign.jsonl"),"utf8"),result=await runDebugLoopExecution(s.load(),candidate,mode as never,async()=>{calls++;throw Error("FORBIDDEN")},{now:()=>100});
 expect(result).toMatchObject({providerHttpAttempts:0,applicationLlmCalls:1,terminal:true,pilotCredit:false});expect(calls).toBe(0);expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);
 }finally{spy.mockRestore();s.cleanup()}
});
it.each([...r02Turn1Modes,r02CurrentKeyMode,r02CoalescedMode,r02GeneralStringMode])("%s rejects schema source/ref/bound drift and does not mutate caller",async mode=>{
 const original=await r02Turn1Schema();
 for(const fault of ["source","ref","bound"]){const drift=structuredClone(original);
  if(fault==="source")drift.$defs!.__sources.enum=["PRIVATE_SECRET"];
  else if(fault==="ref")drift.$defs!.__ec.properties!.primaryEvidence={$ref:"https://PRIVATE_SECRET.invalid"};
  else{const uncertainty=drift.properties!.uncertainties;if(typeof uncertainty==="boolean")throw Error("TEST_UNCERTAINTY_SCHEMA_OBJECT");uncertainty.maxItems=5;}
  const before=JSON.stringify(drift);expect(()=>debugProbeSchema(drift,mode as never)).toThrow("DEBUG_PROBE_SHAPE");expect(JSON.stringify(drift)).toBe(before);
 }
});
it.each(sourceModes)("%s rejects unmodified real wire47 candidate before HTTP",async mode=>{
 expect(hash(JSON.stringify(acceptedWire46T1Schema))).toBe("d30093b5ce25aed6f05ba17a4ae8018c196adc29acc0412328f217f917451a24");
 const s=setup();let calls=0;
 try{const history=readFileSync(join(s.history,"campaign.jsonl"),"utf8");const result=await runDebugLoopExecution(s.load(),candidate,mode,async()=>{calls++;throw Error("FORBIDDEN")},{now:()=>100});
  expect(result).toMatchObject({providerHttpAttempts:0,applicationLlmCalls:1,terminal:true,pilotCredit:false});expect(calls).toBe(0);expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);
 }finally{s.cleanup()}
});
it.each(sourceModes.flatMap(mode=>[200,400].map(status=>({mode,status}))))("$mode seeded R01 TURN1 HTTP$status is one terminal request without Pilot credit",async({mode,status})=>{
 const restoreHistoricalSchema=mockHistoricalSourceRequests();
 const s=setup();let calls=0,transportError:unknown;
 try{const a=s.load(),history=readFileSync(join(s.history,"campaign.jsonl"),"utf8");
 const result=await runDebugLoopExecution(a,candidate,mode as never,async request=>{
  calls++;try{const input=JSON.parse(request.messages[1].content);delete input.numericOwnership;delete input.fieldCapability;delete input.evidenceSources;
  expect(hash(JSON.stringify(ContextInputSchema.parse(input)))).toBe("fc84b34e2d9c9490b37ffbf0e3f2674fd7c357a84bc0b997311e06a39d775142");
  const original=serializeContextRequest(ContextInputSchema.parse(input)).response_format.json_schema.schema;
  expect(hash(JSON.stringify(original))).toBe("d30093b5ce25aed6f05ba17a4ae8018c196adc29acc0412328f217f917451a24");
  const before=JSON.stringify(original);
  for(const fault of ["sources","current","date","external","missing"]){
   const drift=structuredClone(original);
   if(fault==="sources")drift.$defs!.__sources={type:"string",enum:["PRIVATE_SOURCE_SECRET"]};
   if(fault==="current")drift.$defs!.__current={type:"string",enum:["PRIVATE_CURRENT_SECRET"]};
   if(fault==="date")drift.$defs!.__d={type:"string"};
   if(fault==="external")drift.$defs!.__e={$ref:"https://private.invalid/secret"};
   if(fault==="missing")delete drift.$defs!.__sources;
   try{debugProbeSchema(drift,mode as never);throw Error("DID_NOT_REFUSE")}catch(error){expect(String(error)).toBe("Error: DEBUG_PROBE_SHAPE");}
  }
  expect(JSON.stringify(original)).toBe(before);
  const actual=request.response_format.json_schema.schema;
  if(mode==="DATE_CURRENT_NO_SCALAR_BOUNDS"){
   const expectedDate=structuredClone(original.$defs!.__d);
   for(const slot of Object.values(expectedDate.properties!))if(typeof slot==="object"&&slot.type==="integer"){delete slot.minimum;delete slot.maximum;}
   expect(actual.$defs!.__d).toEqual(expectedDate);expect(Buffer.byteLength(JSON.stringify(actual))).toBe(11460);
  }else
  if(mode==="DATE_CURRENT_STRING_BASELINE"){
   expect(actual.$defs!.__d).toEqual({type:"string"});expect(Buffer.byteLength(JSON.stringify(actual))).toBe(10950);
  }else if(mode==="SOURCE_CURRENT_KEY_BASELINE"){
   expect(actual.$defs!.__sources).toEqual(original.$defs!.__sources);expect(actual.$defs!.__current).toEqual(original.$defs!.__current);
   expect(actual.$defs!.__ec).toEqual({type:"object",properties:{currentPrimaryEvidence:{$ref:"#/$defs/__current"},additionalEvidenceJson:{type:"string"}},required:["currentPrimaryEvidence","additionalEvidenceJson"],additionalProperties:false});
   expect(Buffer.byteLength(JSON.stringify(actual))).toBe(11629);
  }else if(mode==="SOURCE_INTEGER_BASELINE"){
   expect(actual.$defs!.__sources).toEqual({type:"integer",minimum:0,maximum:2});
   expect(actual.$defs!.__current).toEqual({type:"integer",minimum:1,maximum:1});
   expect(Buffer.byteLength(JSON.stringify(actual))).toBe(11488);
  }else{
  expect(actual.$defs!.__sources).toEqual(mode==="SOURCE_CURRENT_INLINE_BASELINE"?original.$defs!.__sources:mode==="SOURCE_COMPACT_BASELINE"?{type:"string",enum:["p0","p1","p2"]}:mode==="SOURCE_STRING_BASELINE"?{type:"string"}:{type:"string",enum:['{"kind":"USER_TURN","turn":0}']});
  expect(actual.$defs!.__current).toEqual(mode==="SOURCE_CURRENT_INLINE_BASELINE"?undefined:mode==="SOURCE_COMPACT_BASELINE"?{type:"string",enum:["p1"]}:mode==="SOURCE_T0_SCHEMA_BASELINE"?{type:"string",enum:['{"kind":"USER_TURN","turn":0}']}:original.$defs!.__current);
  }
  if(mode==="SOURCE_CURRENT_INLINE_BASELINE"){
   expect(actual.$defs!.__ec.properties!.primaryEvidence).toEqual(original.$defs!.__current);
   expect(Buffer.byteLength(JSON.stringify(actual))).toBe(11574);
   expect(before.split('"$ref":"#/$defs/__current"').length-1).toBe(1);
   expect(JSON.stringify(actual)).not.toContain('"$ref":"#/$defs/__current"');
  }
  expect({...actual,$defs:{...actual.$defs,...((mode==="DATE_CURRENT_STRING_BASELINE"||mode==="DATE_CURRENT_NO_SCALAR_BOUNDS")?{__d:original.$defs!.__d}:{}),__sources:original.$defs!.__sources,__current:original.$defs!.__current,...(mode==="SOURCE_CURRENT_INLINE_BASELINE"||mode==="SOURCE_CURRENT_KEY_BASELINE"?{__ec:original.$defs!.__ec}:{})}}).toEqual(original);
expect(hash(JSON.stringify(actual))).toBe(({DATE_CURRENT_NO_SCALAR_BOUNDS:"2391f41bbdfd87bf57d8e742a559464ace84850b3cfae5cfda2854e7673ec679",DATE_CURRENT_STRING_BASELINE:"1781ee604f3b9014059c649cede4d7429c8cba729342c22f4875ddc68b3f7c52",SOURCE_CURRENT_KEY_BASELINE:"f5f44a4a12451fd3e13355e7aa3f03dac31d84b949878bbcedb3a02837965779",SOURCE_INTEGER_BASELINE:"637e8368ebdc70b5672eb06ba939058b563049815092d1eafa03a3faeb4e8611",SOURCE_CURRENT_INLINE_BASELINE:"30634b9033dc0ca036320c41062e1707bda62f8e8a438db5304b033d6b87528f",SOURCE_COMPACT_BASELINE:"3ae3b2fe8ed22d1283e44996c0f56acdb3486789e5cff36bf3a9d2a366324579",SOURCE_STRING_BASELINE:"2856d278ef3bf80bc16800e980200425da346295fab155da2ec2363e9d76c145",SOURCE_SINGLETON_BASELINE:"af84ca46d1cecf819e041c8fd77051f48b229db7502cb62ba385288c56155a8a",SOURCE_T0_SCHEMA_BASELINE:"dc1bf84c3102747748df9951acd99219e85ef31127a1d344c136261b3932b05e"})[mode]);
  const content=encodeFixtureV3(frozenContextProposal(input,"R01",1),input);
  if(mode==="DATE_CURRENT_NO_SCALAR_BOUNDS"){
   const date={kind:"C",calendar:"GREGORIAN",day:32,month:1,year:0,leapMonth:-1,offsetDays:0,weekday:0,qualifier:"NONE"};
   const dateContent=content as {query:{period:unknown}};dateContent.query.period={kind:"DAY",date,offset:null,from:null,through:null};
   expect(actual.$defs!.__d.properties!.day).toEqual({type:"integer"});expect(Number.isInteger(date.day)).toBe(true);
  }
  if(mode==="DATE_CURRENT_STRING_BASELINE"){
   const dateContent=content as {query:{period:unknown}};dateContent.query.period={kind:"DAY",date:"INVALID_DATE_SECRET",offset:null,from:null,through:null};
   expect(actual.$defs!.__d).toEqual({type:"string"});
   const diagnostics:unknown[]=[];
   expect(decodeGoogleLiteEuContextTransportV3(content,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d),ContextInputSchema.parse(input)).status).toBe("REFUSED");
   expect(diagnostics).toMatchObject([{issues:[{path:["query","period","date"],code:"WIRE_SHAPE_INVALID"}]}]);
   expect(JSON.stringify(diagnostics)).not.toContain("INVALID_DATE_SECRET");
  }
  if(mode==="SOURCE_CURRENT_KEY_BASELINE"){
   type CarrierNode={anyOf?:CarrierNode[];properties?:Record<string,CarrierNode>;enum?:unknown[]};
   const root=actual.properties!.eventDateChange as unknown as CarrierNode;
   const clear=root.anyOf![0].properties!.change.anyOf!.find(branch=>branch.properties?.operation.enum?.includes("CLEAR"))!;
   expect(clear.properties).toMatchObject({field:{enum:["eventDate"]},operation:{enum:["CLEAR"]},value:{type:"null"},evidence:{$ref:"#/$defs/__ec"}});
   expect(root.anyOf![0].properties!.index).toEqual({type:"integer"});
   const pointer=JSON.stringify({kind:"USER_TURN",turn:input.currentTurn});expect(actual.$defs!.__current.enum).toContain(pointer);
   const carrier={index:0,change:{field:"eventDate",operation:"CLEAR",value:null,evidence:{currentPrimaryEvidence:pointer,additionalEvidenceJson:"[]"}}};
   expect(Object.keys(carrier.change.evidence)).toEqual(actual.$defs!.__ec.required);
   Object.assign(content as object,{eventDateChange:carrier});
   expect((content as {changes:unknown[]}).changes).toEqual([]);
   expect(Object.entries(content as object).filter(([key,value])=>key.endsWith("Change")&&value!==null)).toHaveLength(1);expect(carrier.index).toBe(0);
   const oldKey=structuredClone(content) as {eventDateChange:typeof carrier};
   Object.assign(oldKey.eventDateChange.change,{evidence:{primaryEvidence:pointer,additionalEvidenceJson:"[]"}});
   const oldKeyDiagnostics:unknown[]=[];
   const oldKeyResult=decodeGoogleLiteEuContextTransportV3(oldKey,CONTEXT_PROTOCOL_V3,d=>oldKeyDiagnostics.push(d),d=>oldKeyDiagnostics.push(d),ContextInputSchema.parse(input));
   expect(oldKeyResult.status).toBe("REFUSED");
   expect(oldKeyDiagnostics).toMatchObject([{issues:[{constraintId:"QUERY_INTENT_OWNERSHIP",expectedCategory:"MATCHING_QUERY_BRANCH_WITHOUT_CHANGES",ownershipState:{changeCount:1,intent:"LIST_REMINDERS"}}]}]);
  }
  if(mode==="SOURCE_INTEGER_BASELINE"){
   const integerContent=content as {query:{evidence:{primaryEvidence:unknown}}};
   integerContent.query.evidence.primaryEvidence=1;
   expect(Number.isInteger(integerContent.query.evidence.primaryEvidence)).toBe(true);
   expect(1).toBeGreaterThanOrEqual(Number(actual.$defs!.__sources.minimum));expect(1).toBeLessThanOrEqual(Number(actual.$defs!.__sources.maximum));
   expect(actual.$defs!.__current.minimum).toBe(1);expect(actual.$defs!.__current.maximum).toBe(1);
  }
  if(mode==="SOURCE_COMPACT_BASELINE"){
   const aliasContent=content as {query:{evidence:{primaryEvidence:string;additionalEvidenceJson:string}}};
   aliasContent.query.evidence.primaryEvidence="p1";
   expect(actual.$defs!.__sources.enum).toContain(aliasContent.query.evidence.primaryEvidence);
   expect(actual.$defs!.__current.enum).toContain(aliasContent.query.evidence.primaryEvidence);
   expect(Object.keys(aliasContent.query.evidence).sort()).toEqual(["additionalEvidenceJson","primaryEvidence"]);
   expect(aliasContent.query.evidence.additionalEvidenceJson).toBe("[]");
  }
  return {status,body:status===400?"{}":JSON.stringify({model:request.model,provider:"Google",id:"gen-local-source-probe",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]})};
  }catch(error){transportError=error;throw error}
 },{now:()=>100});
 if(transportError)throw transportError;
 expect(result,JSON.stringify({calls,responses:result.responses,applicationEvidence:result.applicationEvidence})).toMatchObject({providerHttpAttempts:1,applicationLlmCalls:1,terminal:true,pilotCredit:false,contextSeedProof:{fixture:"R01",turn:1,prerequisiteProviderRequests:0,prerequisiteApplicationLlmDispatches:0}});
 expect(JSON.parse(readFileSync(join(result.directory,"terminal.json"),"utf8"))).toMatchObject({attempts:1,mode,pilotCredit:false});
 expect(existsSync(join(result.directory,"http-1.json"))).toBe(false);
 expect(result.responses[0],JSON.stringify(result.responses[0])).toMatchObject({fixtureId:"R01",turnIndex:1,status:status===200&&mode!=="DATE_CURRENT_NO_SCALAR_BOUNDS"&&mode!=="DATE_CURRENT_STRING_BASELINE"&&mode!=="SOURCE_COMPACT_BASELINE"&&mode!=="SOURCE_INTEGER_BASELINE"&&mode!=="SOURCE_CURRENT_KEY_BASELINE"?"SUCCESS":"FAILURE"});
 if(status===200&&mode==="SOURCE_CURRENT_KEY_BASELINE"){
  expect(result.responses[0]).toMatchObject({category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{path:["eventDateChange","change"],code:"WIRE_SHAPE_INVALID",expected:"FIELD_CHANGE"}]}}});
  expect(result.applicationEvidence[0]).toMatchObject({status:"REJECTED",listStoreReads:0,mutations:0});
 }
 if(status===200&&mode==="DATE_CURRENT_STRING_BASELINE"){
  expect(result.responses[0]).toMatchObject({category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{path:["query","period","date"],code:"WIRE_SHAPE_INVALID"}]}}});
  expect(result.applicationEvidence[0]).toMatchObject({status:"REJECTED",listStoreReads:0,mutations:0});
 }
 if(status===200&&mode==="DATE_CURRENT_NO_SCALAR_BOUNDS"){
  // Historical diagnostic schema permits an object; current wire47 runtime
  // rejects its obsolete representation before reaching any numeric slot.
  expect(result.responses[0]).toMatchObject({category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{path:["query","period","date"],code:"WIRE_SHAPE_INVALID",expected:"DATE_OPERAND_JSON"}]}}});
  expect(result.applicationEvidence[0]).toMatchObject({status:"REJECTED",listStoreReads:0,mutations:0});
 }
 if(status===200&&mode==="SOURCE_INTEGER_BASELINE"){
  expect(result.responses[0]).toMatchObject({category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{path:["query","evidence","primaryEvidence"],actualType:"number",expected:"BOUNDED_JSON_OBJECT"}]}}});
  expect(result.applicationEvidence[0]).toMatchObject({status:"REJECTED",listStoreReads:0,mutations:0});
 }
 if(status===200&&mode==="SOURCE_COMPACT_BASELINE"){
  expect(result.responses[0]).toMatchObject({category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{path:["query","evidence","primaryEvidence"],expected:"JSON_OBJECT"}]}}});
  expect(result.applicationEvidence[0]).toMatchObject({status:"REJECTED",listStoreReads:0,mutations:0});
 }
 await expect(runDebugLoopExecution(a,candidate,mode as never,async()=>{calls++;throw Error("FORBIDDEN")})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");
 expect(calls).toBe(1);expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);
 expect(inspectDebugLoop(a)).toMatchObject({prospectiveUnknownCount:status===200?1:2,unknownExposureMicrounits:status===200?105472:210944});
 }finally{s.cleanup();restoreHistoricalSchema()}
});
it.each(sourceModes.flatMap(mode=>["schema","context"].map(fault=>({mode,fault}))))("$mode refuses actual $fault drift before physical HTTP",async({mode,fault})=>{
 const s=setup();let calls=0;const history=readFileSync(join(s.history,"campaign.jsonl"),"utf8");
 const realSchema=googleLiteEuContextWireSchemaV3,realRequest=serializeContextRequest;
 const mock=fault==="schema"?vi.spyOn(wireModule,"googleLiteEuContextWireSchemaV3").mockImplementation((cap,input)=>{const result=realSchema(cap,input);if(input)result.schema.$defs!.__sources={type:"string",enum:["PRIVATE_SOURCE_SECRET"]};return result}):vi.spyOn(requestWireModule,"serializeContextRequest").mockImplementation(input=>{const result=realRequest(input);const body=JSON.parse(result.messages[1].content);body.reference.instant="2026-10-05T01:00:01.000Z";result.messages[1].content=JSON.stringify(body);return result});
 try{const result=await runDebugLoopExecution(s.load(),candidate,mode as never,async()=>{calls++;throw Error("FORBIDDEN")},{now:()=>100});
 expect(result).toMatchObject({providerHttpAttempts:0,applicationLlmCalls:1,terminal:true,pilotCredit:false});expect(calls).toBe(0);expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(history);expect(JSON.stringify(result.responses)).not.toContain("PRIVATE_SOURCE_SECRET");
 }finally{mock.mockRestore();s.cleanup()}
});
it.each(["SOURCE_CURRENT_KEY_BASELINE","DATE_CURRENT_STRING_BASELINE","DATE_CURRENT_NO_SCALAR_BOUNDS"] as const)("%s query-only original key remains accepted without Pilot credit",async mode=>{
 const restoreHistoricalSchema=mockHistoricalSourceRequests();
 const s=setup();let calls=0;
 try{const result=await runDebugLoopExecution(s.load(),candidate,mode as never,async request=>{
  calls++;const body=JSON.parse(request.messages[1].content);delete body.numericOwnership;delete body.fieldCapability;delete body.evidenceSources;
  const content=encodeFixtureV3(frozenContextProposal(body,"R01",1),body);
  return {status:200,body:JSON.stringify({model:request.model,provider:"Google",id:"gen-local-key-query",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]})};
 },{now:()=>100});expect(result).toMatchObject({providerHttpAttempts:1,applicationLlmCalls:1,terminal:true,pilotCredit:false});expect(result.responses[0]).toMatchObject({fixtureId:"R01",turnIndex:1,status:"SUCCESS"});expect(calls).toBe(1);
 }finally{s.cleanup();restoreHistoricalSchema()}
});
function setup(){
 const root=process.cwd(),accountRoot=realpathSync(mkdtempSync(join(tmpdir(),"debug-loop-"))),campaignRoot=join(accountRoot,"existing"),history=join(campaignRoot,"PILOT");mkdirSync(history,{recursive:true});
 appendCampaignEvent(history,{event:"BEGIN",runId:"old",sourceSha:"a".repeat(40),profile:"PILOT",provenanceDigest:"b".repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1,executionKind:"R01_REPLAY",accountingPolicy:"CONFIRMED_COST_V1",requestExposureBoundMicrounits:105472});
 reserveCampaignCall(history,{runId:"old",profile:"PILOT",provenanceDigest:"b".repeat(64),reservationId:"old",maximumMicrounits:0,now:1,startedAt:1});markCampaignDispatched(history,{runId:"old",reservationId:"old",at:1});finishCampaignCall(history,{runId:"old",reservationId:"old",observedMicrounits:null,at:1});
 const ownerMessagePath=join(accountRoot,"owner.txt"),path=join(accountRoot,"grant.json");writeFileSync(ownerMessagePath,"Owner approved repeated debug under $5 including conservative UNKNOWN.");
 const record={version:"t11-debug-loop-authority-1",operation:"T11_SCHEMA_DEBUG_THROUGH_FORMAL_PILOT",accountRoot,campaignRoot,hardCapMicrounits:5000000,accountingPolicy:"CONSERVATIVE_DEBUG_V1",model:"google/gemini-2.5-flash-lite",provider:"google-vertex/eu",retry:0,fallback:"none",stream:false,manifestSha256:deriveBoundedPilotManifest(root).manifestSha256,ownerMessagePath,ownerMessageSha256:hash(readFileSync(ownerMessagePath,"utf8"))};
 const load=(patch:Record<string,unknown>={},freshRun?:Parameters<typeof createDebugLoopLoader>[0]["freshRun"])=>{const text=JSON.stringify({...record,...patch});writeFileSync(path,text);return createDebugLoopLoader({accountRoot,campaignRoot,reviewedRecordSha256:hash(text),reviewedOwnerMessageSha256:record.ownerMessageSha256,freshRun})(path,root)};
 return {root,accountRoot,campaignRoot,history,load,record,cleanup:()=>rmSync(accountRoot,{recursive:true,force:true})};
}
it("new reviewed debug authority admits conservative UNKNOWN without rewriting stopped history",()=>{const s=setup();try{const before=readFileSync(join(s.history,"campaign.jsonl"),"utf8");expect(inspectDebugLoop(s.load())).toMatchObject({unknownExposureMicrounits:105472,remainingConservativeMicrounits:4894528});expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(before);}finally{s.cleanup()}});
it.each([{hardCapMicrounits:5000001},{model:"other"},{provider:"other"},{retry:1},{fallback:"other"},{accountingPolicy:"CONFIRMED_COST_V1"}])("rejects broadened debug policy %j",patch=>{const s=setup();try{expect(()=>s.load(patch)).toThrow()}finally{s.cleanup()}});
it("no authority, even with a transport, cannot dispatch",async()=>{let calls=0;await expect(runDebugLoopExecution(undefined,candidate,"QUERY_ONLY",async()=>{calls++;return {status:400,body:"{}"}})).rejects.toThrow("DEBUG_AUTHORITY_REQUIRED");expect(calls).toBe(0)});
it("probe performs one durable application-path request; terminal duplicate cannot dispatch again",async()=>{const s=setup();let calls=0;try{const a=s.load(),before=readFileSync(join(s.history,"campaign.jsonl"),"utf8");const result=await runDebugLoopExecution(a,candidate,"QUERY_ONLY",async request=>{calls++;expect(request.stream).toBe(false);expect(request.provider.allow_fallbacks).toBe(false);return {status:400,body:"{}"}},{now:()=>100});expect(result).toMatchObject({providerHttpAttempts:1,terminal:true,pilotCredit:false});await expect(runDebugLoopExecution(a,candidate,"QUERY_ONLY",async()=>{calls++;return {status:400,body:"{}"}})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");expect(calls).toBe(1);expect(inspectDebugLoop(a)).toMatchObject({prospectiveUnknownCount:2,unknownExposureMicrounits:210944});expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(before);}finally{s.cleanup()}});
it("schema probes alter only selected evidence representation and never mutate runtime schema",()=>{
 const schema=googleLiteEuContextWireSchemaV3().schema,before=JSON.stringify(schema),probe=debugProbeSchema(schema,"QUERY_ONLY") as typeof schema;
 expect(probe.properties!.requestTarget).not.toEqual(schema.properties!.requestTarget);
 expect(probe.properties!.query).toEqual(schema.properties!.query);
 expect(JSON.stringify(schema)).toBe(before);
 expect(debugProbeSchema(schema,"V14")).toEqual(schema);
});
it("tampered authority after loading fails before dispatch",async()=>{const s=setup();let calls=0;try{const a=s.load();writeFileSync(join(s.accountRoot,"grant.json"),"{}");await expect(runDebugLoopExecution(a,candidate,"V14",async()=>{calls++;return {status:400,body:"{}"}})).rejects.toThrow("DEBUG_RECORD_BINDING");expect(calls).toBe(0)}finally{s.cleanup()}});
it.each(["CHANGE_TEXT_ONLY","CHANGE_DATE_ONLY","CHANGE_TIME_ONLY","CHANGE_SCALAR_ONLY","CHANGE_CLEAR_ONLY"] as const)("%s preserves only its semantic evidence group despite coalesced branches",mode=>{
 type ProbeNode={type?:string;enum?:unknown[];const?:unknown;$ref?:string;properties?:Record<string,ProbeNode>;items?:ProbeNode;$defs?:Record<string,ProbeNode>;anyOf?:ProbeNode[]};
 const schema=googleLiteEuContextWireSchemaV3().schema,probe=debugProbeSchema(schema,mode) as ProbeNode;
 const ref=probe.properties!.changes.items!.$ref!,branches=probe.$defs![ref.split("/").at(-1)!].anyOf!;
 const group=mode==="CHANGE_TEXT_ONLY"?["title","location","notes"]:mode==="CHANGE_DATE_ONLY"?["eventDate","reminderDate","endDate"]:mode==="CHANGE_TIME_ONLY"?["eventTime","reminderTime"]:["calendar","frequency","occurrenceCount","leadOffsetDays","eventRelation"];
 for(const branch of branches){
  const properties=branch.properties!,fields=properties.field.enum??[properties.field.const],clear=properties.operation.const==="CLEAR";
  for(const field of fields){const retained=mode==="CHANGE_CLEAR_ONLY"?clear:!clear&&group.includes(String(field));expect(properties.evidence.type,`${field}/${clear}`).toBe(retained?"object":"array");}
 }
 expect(probe.properties!.query).toEqual(schema.properties!.query);
});
it("wrong candidate fails before durable execution or provider",async()=>{const s=setup();let calls=0;try{await expect(runDebugLoopExecution(s.load(),"a".repeat(40),"V14",async()=>{calls++;return {status:400,body:"{}"}})).rejects.toThrow();expect(calls).toBe(0)}finally{s.cleanup()}});
it("concurrent duplicate probe cannot dispatch twice",async()=>{const s=setup();let calls=0;try{const a=s.load(),transport=async()=>{calls++;return {status:400,body:"{}"}};const outcomes=await Promise.allSettled([runDebugLoopExecution(a,candidate,"V14",transport,{now:()=>100}),runDebugLoopExecution(a,candidate,"V14",transport,{now:()=>100})]);expect(calls).toBe(1);expect(outcomes.filter(o=>o.status==="rejected")).toHaveLength(1)}finally{s.cleanup()}});
it("transport exception retains UNKNOWN and a terminal execution cannot redispatch",async()=>{const s=setup();let calls=0;try{const a=s.load();await runDebugLoopExecution(a,candidate,"V14",async()=>{calls++;throw Error("fake timeout")},{now:()=>100});expect(inspectDebugLoop(a).prospectiveUnknownCount).toBe(2);await expect(runDebugLoopExecution(a,candidate,"V14",async()=>{calls++;return {status:200,body:"{}"}})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");expect(calls).toBe(1)}finally{s.cleanup()}});
it("debug cap blocks another probe despite a new mode and available credential transport",async()=>{const s=setup();let calls=0;try{const a=s.load({hardCapMicrounits:210944});await runDebugLoopExecution(a,candidate,"V14",async()=>{calls++;return {status:400,body:"{}"}},{now:()=>100});await expect(runDebugLoopExecution(a,candidate,"QUERY_ONLY",async()=>{calls++;return {status:400,body:"{}"}})).rejects.toThrow("DEBUG_COST_HARD_CAP");expect(calls).toBe(1)}finally{s.cleanup()}});
it("formal debug execution retains the frozen oracle and all 76 requests without Full",async()=>{const s=setup();let calls=0;try{const targets=deriveBoundedPilotManifest(s.root).targets,result=await runDebugLoopExecution(s.load(),candidate,"FORMAL_PILOT",async request=>{const target=targets[calls++],content=encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),target.fixtureId,target.turnIndex));const body=JSON.stringify({model:request.model,provider:"Google",id:"gen-local-debug",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]});return {status:200,body,rawResponseBytes:Buffer.byteLength(body)}},{now:()=>100});expect(result).toMatchObject({pilotCredit:true,providerHttpAttempts:76,applicationLlmCalls:76});expect(result.score).toMatchObject({passedScripts:32,passedTurns:84,safetyFailures:0});expect(result.accounting.prospectiveUnknownCount).toBe(1)}finally{s.cleanup()}},120000);

// These exercise real ledgers/application acceptance; only external HTTP is fake.
// Removing parent/evidence gates must expose dispatch, and removing successor
// tombstones must allow a duplicate: both are observable security failures.
function providerError200(){const body=JSON.stringify({model:"google/gemini-2.5-flash-lite",provider:"Google",id:"gen-local-throttle",usage:{cost:0,prompt_tokens:100,completion_tokens:0},choices:[{finish_reason:"error",message:{content:""}}]});return {status:200,body,rawResponseBytes:Buffer.byteLength(body)}}
async function stoppedFormal(s:ReturnType<typeof setup>){return runDebugLoopExecution(s.load(),candidate,"FORMAL_PILOT",async()=>providerError200(),{now:()=>100})}
function google429Envelope(){const raw=JSON.parse(providerError200().body);raw.choices[0].error={code:429};const body=JSON.stringify(raw);return {status:200,body,rawResponseBytes:Buffer.byteLength(body)}}
const applicationEnvelopeEvidence={kind:"REVIEWED_APPLICATION_ENVELOPE",projection:undefined};
it("inserted Google429 sidecar labels cannot replace a missing captured choice error",async()=>{const s=setup();try{const parent=await stoppedFormal(s);expect(()=>freshAuthority(s,parent.directory,{},applicationEnvelopeEvidence)).toThrow("DEBUG_THROTTLE_APPLICATION_ENVELOPE_BINDING")}finally{s.cleanup()}});
it("reviewed application sidecar cannot substitute an incorrect response artifact digest",async()=>{const s=setup();try{const parent=await runDebugLoopExecution(s.load(),candidate,"FORMAL_PILOT",async()=>google429Envelope(),{now:()=>100}),artifactSha256=Object.fromEntries(["execution.json","terminal.json","campaign.jsonl","report.json","responses.json"].map(name=>[name,name==="responses.json"?"a".repeat(64):hash(readFileSync(join(parent.directory,name),"utf8"))]));expect(()=>freshAuthority(s,parent.directory,{}, {...applicationEnvelopeEvidence,artifactSha256})).toThrow("DEBUG_THROTTLE_ARTIFACT_BINDING")}finally{s.cleanup()}});
it("hashed application envelope admits Google429 without generation metadata and consumes its successor",async()=>{const s=setup();try{let calls=0;const targets=deriveBoundedPilotManifest(s.root).targets,parent=await runDebugLoopExecution(s.load(),candidate,"FORMAL_PILOT",async request=>{const target=targets[calls++];if(calls===11)return google429Envelope();const content=encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),target.fixtureId,target.turnIndex)),body=JSON.stringify({model:request.model,provider:"Google",id:"gen-local-success",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]});return {status:200,body,rawResponseBytes:Buffer.byteLength(body)}},{now:()=>100});expect(parent.responses.at(-1)).toMatchObject({call:11,fixtureId:"R04",turnIndex:3,canonicalValidationDiagnostics:{providerEnvelope:{firstChoice:{choiceErrorCode:429}}}});const before=readFileSync(join(parent.directory,"responses.json"),"utf8"),fresh=freshAuthority(s,parent.directory,{},applicationEnvelopeEvidence);expect(()=>inspectDebugLoopFreshRun(fresh.authority,candidate,{now:()=>60099})).toThrow("DEBUG_FRESH_COOLDOWN");expect(inspectDebugLoopFreshRun(fresh.authority,candidate,{now:()=>60100}).parentDirectory).toBe(parent.directory);await runDebugLoopExecution(fresh.authority,candidate,"FORMAL_PILOT",async()=>google429Envelope(),{now:()=>60100});expect(()=>inspectDebugLoopFreshRun(fresh.authority,candidate,{now:()=>60100})).toThrow("DEBUG_SUCCESSOR_CONSUMED");expect(readFileSync(join(parent.directory,"responses.json"),"utf8")).toBe(before)}finally{s.cleanup()}},120000);
it.each(["code","provider","finish","missing envelope","nonterminal","fake metadata"])("application evidence rejects %s even with reviewed artifact hashes",async(which)=>{const s=setup();try{const parent=await runDebugLoopExecution(s.load(),candidate,"FORMAL_PILOT",async()=>google429Envelope(),{now:()=>100});const responses=JSON.parse(readFileSync(join(parent.directory,"responses.json"),"utf8")),final=responses.at(-1);if(which==="code")final.canonicalValidationDiagnostics.providerEnvelope.firstChoice.choiceErrorCode=400;if(which==="provider")final.provider.provider="other";if(which==="finish")final.canonicalValidationDiagnostics.providerEnvelope.firstChoice.finishReason.token="stop";if(which==="missing envelope")delete final.canonicalValidationDiagnostics.providerEnvelope;if(which==="nonterminal"){const terminal=JSON.parse(readFileSync(join(parent.directory,"terminal.json"),"utf8"));terminal.status="PASS";writeFileSync(join(parent.directory,"terminal.json"),JSON.stringify(terminal))}writeFileSync(join(parent.directory,"responses.json"),JSON.stringify(responses));const report=JSON.parse(readFileSync(join(parent.directory,"report.json"),"utf8"));report.responses=responses;writeFileSync(join(parent.directory,"report.json"),JSON.stringify(report));expect(()=>freshAuthority(s,parent.directory,{}, {...applicationEnvelopeEvidence,...(which==="fake metadata"?{projection:{errorMetadataSanitized:{status:429,provider_name:"Google"}}}:{})})).toThrow()}finally{s.cleanup()}});
it("application evidence rechecks pinned response bytes before dispatch",async()=>{const s=setup();let calls=0;try{const parent=await runDebugLoopExecution(s.load(),candidate,"FORMAL_PILOT",async()=>google429Envelope(),{now:()=>100}),fresh=freshAuthority(s,parent.directory,{},applicationEnvelopeEvidence);writeFileSync(join(parent.directory,"responses.json"),"[]");await expect(runDebugLoopExecution(fresh.authority,candidate,"FORMAL_PILOT",async()=>{calls++;return google429Envelope()},{now:()=>60100})).rejects.toThrow("DEBUG_THROTTLE_ARTIFACT_BINDING");expect(calls).toBe(0)}finally{s.cleanup()}});
function freshAuthority(s:ReturnType<typeof setup>,parent:string,patch:Record<string,unknown>={},evidencePatch:Record<string,unknown>={}){
 const ownerMessagePath=join(s.accountRoot,"lifecycle-owner.txt");writeFileSync(ownerMessagePath,"Owner authorizes same-candidate fresh Formal Pilot after proven Google 429 cooldown under existing $5, retry 0 fallback none.");
 const evidencePath=join(s.accountRoot,`evidence-${hash(parent)}.json`),recordPath=join(s.accountRoot,`lifecycle-${hash(parent)}.json`);
 const artifactSha256=Object.fromEntries(["execution.json","terminal.json","campaign.jsonl","report.json","responses.json"].map(name=>[name,hash(readFileSync(join(parent,name),"utf8"))]));
 const evidence={version:"debug-throttle-evidence-1",kind:"REVIEWED_GENERATION_METADATA",parentDirectory:parent,artifactSha256,generationId:"gen-local-throttle",model:"google/gemini-2.5-flash-lite",provider:"Google",upstreamHttpStatus:429,finishReason:"error",reportedCostUsd:0,verifiedAt:100,projection:{version:"provider-failure-1",httpStatus:200,responseBytes:212,contentType:"application/json",bodyState:"JSON",bodyDigest:"c".repeat(64),errorMetadataSanitized:{status:429,provider_name:"Google"}},...evidencePatch};
 const evidenceText=JSON.stringify(evidence);writeFileSync(evidencePath,evidenceText);
 const proof=candidateValidationProof(s.root,candidate),record={version:"debug-fresh-run-authority-1",operation:"FRESH_FORMAL_PILOT_AFTER_GOOGLE_429",accountRoot:s.accountRoot,campaignRoot:s.campaignRoot,evaluationCandidateSha:candidate,candidateProofSha256:proof.candidateProofSha256,mode:"FORMAL_PILOT",manifestSha256:s.record.manifestSha256,budgetAuthoritySha256:hash(readFileSync(join(s.accountRoot,"grant.json"),"utf8")),parentDirectory:parent,evidencePath,evidenceSha256:hash(evidenceText),ownerMessagePath,ownerMessageSha256:hash(readFileSync(ownerMessagePath,"utf8")),cooldownMs:60000,retry:0,fallback:"none",...patch};
 const text=JSON.stringify(record);writeFileSync(recordPath,text);
 const pins={recordPath,reviewedRecordSha256:hash(text),reviewedOwnerMessageSha256:hash(readFileSync(ownerMessagePath,"utf8")),reviewedEvidenceSha256:hash(evidenceText),expectedCandidateSha:candidate,parentDirectory:parent};
 return {authority:s.load({},pins),recordPath,evidencePath,pins};
}
it("reviewed Google429 creates an independent full-manifest successor after cooldown with unchanged budget/history",async()=>{
 const s=setup();try{
  const parent=await stoppedFormal(s),old=Object.fromEntries(["execution.json","terminal.json","campaign.jsonl","report.json","responses.json"].map(n=>[n,readFileSync(join(parent.directory,n),"utf8")])),a=freshAuthority(s,parent.directory).authority;
  const before=inspectDebugLoop(a),ready=inspectDebugLoopFreshRun(a,candidate,{now:()=>60100});expect(ready).toMatchObject({parentDirectory:parent.directory,mode:"FORMAL_PILOT",cooldownUntil:60100});
  let calls=0;const targets=deriveBoundedPilotManifest(s.root).targets,result=await runDebugLoopExecution(a,candidate,"FORMAL_PILOT",async request=>{const target=targets[calls++],content=encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),target.fixtureId,target.turnIndex)),body=JSON.stringify({model:request.model,provider:"Google",id:"gen-local-fresh",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]});return {status:200,body,rawResponseBytes:Buffer.byteLength(body)}},{now:()=>60100});
  expect(result.directory).not.toBe(parent.directory);expect(result).toMatchObject({pilotCredit:true,providerHttpAttempts:76,applicationLlmCalls:76,score:{passedScripts:32,passedTurns:84,safetyFailures:0}});
  expect(result.accounting).toMatchObject({capMicrounits:5000000,confirmedMicrounits:before.confirmedMicrounits+7600,unknownExposureMicrounits:before.unknownExposureMicrounits});
  for(const [n,text] of Object.entries(old))expect(readFileSync(join(parent.directory,n),"utf8")).toBe(text);
  await expect(runDebugLoopExecution(a,candidate,"FORMAL_PILOT",async()=>{throw Error("FORBIDDEN")} ,{now:()=>60100})).rejects.toThrow("DEBUG_SUCCESSOR_CONSUMED");
 }finally{s.cleanup()}
},120000);
it.each([
 ["cooldown",{}, {},60099], ["candidate",{evaluationCandidateSha:"a".repeat(40)}, {},60100], ["mode",{mode:"V14"}, {},60100], ["short cooldown",{cooldownMs:59999}, {},60100], ["source",{candidateProofSha256:"a".repeat(64)}, {},60100],
 ["non429",{}, {upstreamHttpStatus:400},60100], ["wrong generation",{}, {generationId:"gen-other"},60100], ["wrong provider",{}, {provider:"other"},60100], ["late observation",{}, {verifiedAt:1000},60100], ["altered terminal pin",{}, {artifactSha256:{}},60100],
] as const)("fresh-run gate rejects %s before HTTP",async(_name,patch,evidencePatch,now)=>{const s=setup();let calls=0;try{const parent=await stoppedFormal(s);try{const a=freshAuthority(s,parent.directory,patch,evidencePatch).authority;await runDebugLoopExecution(a,candidate,"FORMAL_PILOT",async()=>{calls++;return providerError200()},{now:()=>now});throw Error("UNSAFE_ADMISSION")}catch(e){expect(String(e)).not.toContain("UNSAFE_ADMISSION")}expect(calls).toBe(0)}finally{s.cleanup()}});
it.each(["record","evidence","owner","terminal","ledger","report","responses"])("fresh-run rechecks tampered %s bytes after load",async(which)=>{const s=setup();let calls=0;try{const parent=await stoppedFormal(s),fresh=freshAuthority(s,parent.directory),path=which==="record"?fresh.recordPath:which==="evidence"?fresh.evidencePath:which==="owner"?join(s.accountRoot,"lifecycle-owner.txt"):join(parent.directory,which==="ledger"?"campaign.jsonl":`${which}.json`);writeFileSync(path,"{}");await expect(runDebugLoopExecution(fresh.authority,candidate,"FORMAL_PILOT",async()=>{calls++;return providerError200()},{now:()=>60100})).rejects.toThrow();expect(calls).toBe(0)}finally{s.cleanup()}});
it("terminal or settled-ledger absence cannot be replaced by reviewed evidence",async()=>{const s=setup();try{const parent=await stoppedFormal(s);unlinkSync(join(parent.directory,"terminal.json"));expect(()=>freshAuthority(s,parent.directory)).toThrow()}finally{s.cleanup()}});
it("fresh parent successor consumption fences overlap and crash before child creation",async()=>{const s=setup();try{const parent=await stoppedFormal(s),a=freshAuthority(s,parent.directory).authority;let calls=0;const outcomes=await Promise.allSettled([runDebugLoopExecution(a,candidate,"FORMAL_PILOT",async()=>{calls++;return providerError200()},{now:()=>60100}),runDebugLoopExecution(a,candidate,"FORMAL_PILOT",async()=>{calls++;return providerError200()},{now:()=>60100})]);expect(calls).toBe(1);expect(outcomes.filter(o=>o.status==="rejected")).toHaveLength(1);const fulfilled=outcomes.find(o=>o.status==="fulfilled");expect(fulfilled?.status).toBe("fulfilled");if(fulfilled?.status!=="fulfilled")throw Error("MISSING_CHILD");rmSync(join(fulfilled.value.directory,".."),{recursive:true,force:true});if(existsSync(join(s.accountRoot,"account.lock")))unlinkSync(join(s.accountRoot,"account.lock"));await expect(runDebugLoopExecution(a,candidate,"FORMAL_PILOT",async()=>{calls++;return providerError200()},{now:()=>60100})).rejects.toThrow("DEBUG_SUCCESSOR_CONSUMED");expect(calls).toBe(1)}finally{s.cleanup()}});
it("a semantic failure cannot qualify even when a reviewed sidecar claims Google429",async()=>{const s=setup();let calls=0;try{const parent=await runDebugLoopExecution(s.load(),candidate,"FORMAL_PILOT",async request=>{const body=JSON.stringify({model:request.model,provider:"Google",id:"gen-local-throttle",usage:{cost:0,prompt_tokens:100,completion_tokens:1},choices:[{finish_reason:"stop",message:{content:"{}"}}]});return {status:200,body,rawResponseBytes:Buffer.byteLength(body)}},{now:()=>100});try{const a=freshAuthority(s,parent.directory).authority;await runDebugLoopExecution(a,candidate,"FORMAL_PILOT",async()=>{calls++;return providerError200()},{now:()=>60100});throw Error("UNSAFE_ADMISSION")}catch(e){expect(String(e)).not.toContain("UNSAFE_ADMISSION")}expect(calls).toBe(0)}finally{s.cleanup()}});
it("same lifecycle owner can authorize a linear chain of newly proven429 parents without branching",async()=>{const s=setup();try{const parent=await stoppedFormal(s),first=freshAuthority(s,parent.directory),child=await runDebugLoopExecution(first.authority,candidate,"FORMAL_PILOT",async()=>providerError200(),{now:()=>60100}),second=freshAuthority(s,child.directory);expect(first.pins.reviewedOwnerMessageSha256).toBe(second.pins.reviewedOwnerMessageSha256);expect(inspectDebugLoopFreshRun(second.authority,candidate,{now:()=>120100})).toMatchObject({parentDirectory:child.directory,cooldownUntil:120100});const third=await runDebugLoopExecution(second.authority,candidate,"FORMAL_PILOT",async()=>providerError200(),{now:()=>120100});expect(third.providerHttpAttempts).toBe(1);expect(new Set([parent.directory,child.directory,third.directory]).size).toBe(3);await expect(runDebugLoopExecution(first.authority,candidate,"FORMAL_PILOT",async()=>{throw Error("FORBIDDEN")},{now:()=>120100})).rejects.toThrow("DEBUG_SUCCESSOR_CONSUMED")}finally{s.cleanup()}});
it("unsettled claims elsewhere in the account block a fresh successor despite proven parent429",async()=>{const s=setup();try{const parent=await stoppedFormal(s),fresh=freshAuthority(s,parent.directory),pending=join(s.accountRoot,"crashed","PILOT");mkdirSync(pending,{recursive:true});appendCampaignEvent(pending,{event:"BEGIN",runId:"crash",sourceSha:candidate,profile:"PILOT",provenanceDigest:"b".repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1,executionKind:"R01_REPLAY",accountingPolicy:"CONFIRMED_COST_V1",requestExposureBoundMicrounits:105472});reserveCampaignCall(pending,{runId:"crash",profile:"PILOT",provenanceDigest:"b".repeat(64),reservationId:"call-1",maximumMicrounits:0,now:1,startedAt:1});expect(()=>inspectDebugLoopFreshRun(fresh.authority,candidate,{now:()=>60100})).toThrow("DEBUG_FRESH_UNSETTLED_ACCOUNT")}finally{s.cleanup()}});
it("historical six-attempt provider-error diagnostics admit only an independent fresh Pilot",async()=>{const s=setup();try{let calls=0;const targets=deriveBoundedPilotManifest(s.root).targets,parent=await runDebugLoopExecution(s.load(),candidate,"FORMAL_PILOT",async request=>{const target=targets[calls++];if(calls===6){const raw=JSON.parse(providerError200().body);raw.choices[0].message.content="x".repeat(507);raw.usage={cost:0,prompt_tokens:0,completion_tokens:0};const body=JSON.stringify(raw);return {status:200,body,rawResponseBytes:Buffer.byteLength(body)}}const content=encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),target.fixtureId,target.turnIndex)),body=JSON.stringify({model:request.model,provider:"Google",id:"gen-local-success",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]});return {status:200,body,rawResponseBytes:Buffer.byteLength(body)}},{now:()=>100});expect(parent.providerHttpAttempts).toBe(6);const final=parent.responses.at(-1);expect(final).toMatchObject({fixtureId:"R03",turnIndex:0,category:"PROVIDER_FAILURE",canonicalValidationDiagnostics:{state:"PROVIDER_ENVELOPE_FAILED",providerEnvelope:{choicesCount:1,firstChoice:{finishReason:{token:"error"},contentByteCount:507}}}});const before=readFileSync(join(parent.directory,"responses.json"),"utf8"),fresh=freshAuthority(s,parent.directory);expect(inspectDebugLoopFreshRun(fresh.authority,candidate,{now:()=>60100})).toMatchObject({parentDirectory:parent.directory});expect(readFileSync(join(parent.directory,"responses.json"),"utf8")).toBe(before)}finally{s.cleanup()}});
