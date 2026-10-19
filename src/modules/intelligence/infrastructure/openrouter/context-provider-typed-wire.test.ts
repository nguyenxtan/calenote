// @vitest-environment node
import {readListTransport} from "../../../conversation/context-contract/list-period-transport";
import {deriveGenerationFieldCapability} from "../../../conversation/context-contract/field-capability";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {z} from "zod";
import {expect,it} from "vitest";
import {ContextInputSchema,ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_TYPED_PROTOCOL_V3} from "../../../conversation/context-contract/typed-protocol";
import {googleLiteEuTypedContextWireSchemaV3,googleLiteEuTypedContextValidationSchemaV3,encodeGoogleLiteEuTypedContextV3,decodeGoogleLiteEuTypedContextTransportV3} from "./context-provider-typed-wire";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
const input=ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00.000Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text:"synthetic"}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"context-capabilities-1",supported:["ONCE"],unsupported:["YEARLY"],calendars:["GREGORIAN"],limits:{dailyCount:30,horizonDays:366}}});
const minimal={schemaVersion:"calenote-context-3",intent:"HELP",requestTarget:null,changes:[],query:null,uncertainties:[],conversationDirective:{kind:"HELP",topic:"GENERAL"},replyProposal:null};
it("typed105 selects an input-bound schema and refuses the historical protocol",()=>{
 const value=ConversationInterpretationV3Schema.parse(minimal),raw=encodeGoogleLiteEuTypedContextV3(value,input);
 expect(googleLiteEuTypedContextWireSchemaV3(input).version).toBe(CONTEXT_TYPED_PROTOCOL_V3.wireVersion);
 expect(decodeGoogleLiteEuTypedContextTransportV3(raw,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input).status).toBe("PARSED");
 expect(decodeGoogleLiteEuTypedContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
});
it("typed105 carries changes, dates, alternatives and extra evidence as objects/arrays",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const value=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:1},evidence}],uncertainties:[{field:"eventRelation",reason:"AMBIGUOUS",alternatives:[{value:"BEFORE_EVENT",evidence}]}]});
 const raw=encodeGoogleLiteEuTypedContextV3(value,input) as {eventDateChange:{change:{value:unknown;evidence:unknown}};uncertainties:Array<{alternatives:unknown[]}>};
 expect(raw.eventDateChange.change.value).toEqual({kind:"RELATIVE_DAY",offsetDays:1});
 expect(raw.eventDateChange.change.evidence).toEqual({primaryEvidence:"U0",additionalEvidence:[]});
 expect(raw.uncertainties[0].alternatives[0]).toEqual({value:"BEFORE_EVENT",evidence:{primaryEvidence:"U0",additionalEvidence:[]}});
 expect(decodeGoogleLiteEuTypedContextTransportV3(raw,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input)).toMatchObject({status:"PARSED",value:{semantic:{changes:value.changes,uncertainties:value.uncertainties}}});
 for(const location of ["change","date","evidence","alternative"]){const broken=structuredClone(raw);if(location==="change")(broken.eventDateChange as {change:unknown}).change=JSON.stringify(broken.eventDateChange.change);if(location==="date")broken.eventDateChange.change.value=JSON.stringify(broken.eventDateChange.change.value);if(location==="evidence")(broken.eventDateChange.change.evidence as Record<string,unknown>).additionalEvidence="[]";if(location==="alternative")broken.uncertainties[0].alternatives[0]=JSON.stringify(broken.uncertainties[0].alternatives[0]);expect(decodeGoogleLiteEuTypedContextTransportV3(broken,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");}
});
it("typed105 quarantines invalid optional guidance without rejecting the core",()=>{
 const raw=encodeGoogleLiteEuTypedContextV3(ConversationInterpretationV3Schema.parse(minimal),input) as Record<string,unknown>;
 raw.conversationDirective={kind:"PRIVATE_INVALID"};raw.replyProposal={invalid:true};
 expect(decodeGoogleLiteEuTypedContextTransportV3(raw,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input)).toMatchObject({status:"PARSED",value:{directive:{status:"INVALID"},reply:{status:"INVALID"}}});
});
it("typed105 carries query dates as objects and stages unsupported LIST periods",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],date={kind:"RELATIVE_DAY",offsetDays:1};
 const calendar=ConversationInterpretationV3Schema.parse({...minimal,intent:"CALENDAR_QUERY",query:{kind:"CALENDAR_DATE",date,outputCalendar:"LUNAR_VN",evidence}});
 const raw=encodeGoogleLiteEuTypedContextV3(calendar,input) as Record<string,unknown>;
 expect((raw.query as Record<string,unknown>).date).toEqual(date);
 expect(decodeGoogleLiteEuTypedContextTransportV3(raw,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input).status).toBe("PARSED");
 const list=ConversationInterpretationV3Schema.parse({...minimal,intent:"LIST_REMINDERS",query:{kind:"LIST",period:{kind:"DAY",date},statusScope:"DEFAULT",evidence}});
 const wire=encodeGoogleLiteEuTypedContextV3(list,input) as Record<string,unknown>;
 const query=wire.query as Record<string,unknown>,period=query.period as Record<string,unknown>;
 expect(period.date).toEqual(date);period.kind="FUTURE_KIND";
 const result=decodeGoogleLiteEuTypedContextTransportV3(wire,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input);
 expect(result.status).toBe("PARSED");
 if(result.status==="PARSED")expect(readListTransport(result.value).period.status).toBe("UNSUPPORTED");
 period.date="{\"kind\":\"RELATIVE_DAY\",\"offsetDays\":1}";
 expect(decodeGoogleLiteEuTypedContextTransportV3(wire,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
});
it("typed105 keeps rank ownership, source availability and numeric alternative types strict",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const proposal=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:1},evidence}],uncertainties:[{field:"leadOffsetDays",reason:"AMBIGUOUS",alternatives:[{value:2,evidence}]}]});
 const original=encodeGoogleLiteEuTypedContextV3(proposal,input) as Record<string,unknown>;
 for(const variant of ["source","extras","numeric","rank","field"]){
  const raw=structuredClone(original),wrapper=raw.eventDateChange as {rank:unknown;change:Record<string,unknown>},carrier=wrapper.change.evidence as Record<string,unknown>;
  if(variant==="source")carrier.primaryEvidence="U99";
  if(variant==="extras")carrier.additionalEvidence=[{kind:"USER_TURN",turn:11}];
  if(variant==="numeric"){const issue=(raw.uncertainties as Array<{alternatives:Array<{value:unknown}>}>)[0];issue.alternatives[0].value="2";}
  if(variant==="rank")wrapper.rank="0";
  if(variant==="field")wrapper.change.field="reminderDate";
  expect(decodeGoogleLiteEuTypedContextTransportV3(raw,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
 }
});
it("typed105 queryRange alternatives retain typed canonical periods without padding",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],value={kind:"DAY",date:{kind:"RELATIVE_DAY",offsetDays:1}};
 const proposal=ConversationInterpretationV3Schema.parse({...minimal,uncertainties:[{field:"queryRange",reason:"AMBIGUOUS",alternatives:[{value,evidence}]}]});
 const raw=encodeGoogleLiteEuTypedContextV3(proposal,input) as {uncertainties:Array<{alternatives:Array<{value:unknown}>}>};
 expect(raw.uncertainties[0].alternatives[0].value).toEqual(value);
 expect(decodeGoogleLiteEuTypedContextTransportV3(raw,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input).status).toBe("PARSED");
});
it("typed105 shares schema definitions within the offline admission preparation bound",()=>{
 const r02=ContextInputSchema.parse({...input,turns:[{role:"USER",text:"Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi."}],capabilities:{...input.capabilities,supported:["ONCE","FINITE_DAILY"]}});
 for(const selected of [input,r02])expect(new TextEncoder().encode(JSON.stringify(googleLiteEuTypedContextWireSchemaV3(selected).schema)).length).toBeLessThanOrEqual(20000);
});
it("typed105 preserves selected year-null and cross-carrier rank restrictions",()=>{
 const selected=ContextInputSchema.parse({...input,turns:[{role:"USER",text:"Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi."}],capabilities:{...input.capabilities,supported:["ONCE","FINITE_DAILY"]}});
 expect(deriveGenerationFieldCapability(selected).eventDateYearNullRequired).toBe(true);
 const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(selected,"R02",0)),wire=encodeGoogleLiteEuTypedContextV3(proposal,selected) as Record<string,unknown>;
 expect(decodeGoogleLiteEuTypedContextTransportV3(wire,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,selected).status).toBe("PARSED");
 const dated=structuredClone(wire),carrier=dated.eventDateChange as {rank:number;change:{value:Record<string,unknown>}};
 carrier.change.value.year=2026;
 expect(decodeGoogleLiteEuTypedContextTransportV3(dated,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,selected).status).toBe("REFUSED");
 const ranked=structuredClone(wire);(ranked.eventDateChange as {rank:number}).rank=(ranked.titleChange as {rank:number}).rank;
 expect(decodeGoogleLiteEuTypedContextTransportV3(ranked,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,selected).status).toBe("REFUSED");
});

it("typed105 factors identical uncertainty shells without widening field/value/reason correlations",()=>{
 const frozen=JSON.parse(readFileSync(new URL("./__fixtures__/typed105-r01-before.json",import.meta.url),"utf8"));
 const selected=ContextInputSchema.parse(frozen.input),before=z.fromJSONSchema(frozen.schema),schema=googleLiteEuTypedContextValidationSchemaV3(selected).schema;
 const after=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
 const root=schema as unknown as {$defs:Record<string,Record<string,unknown>>;properties:Record<string,Record<string,unknown>>};
 const resolve=(v:Record<string,unknown>):Record<string,unknown>=>v.$ref?resolve(root.$defs[String(v.$ref).slice(8)]):v;
 const uncertainties=resolve(root.properties.uncertainties),items=resolve(uncertainties.items as Record<string,unknown>);
 expect((items.anyOf as unknown[]).length).toBe(12);
 const wire=encodeGoogleLiteEuTypedContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(selected,"R01",0)),selected) as Record<string,unknown>;
 const values=[null,0,1,2,-1,30,31,366,367,"CURRENT","NEW","ONCE","FINITE_DAILY","BEFORE_EVENT","AFTER_EVENT","GREGORIAN","LUNAR_VN","sample",true,{kind:"RELATIVE_DAY",offsetDays:1},{kind:"DAY",date:{kind:"RELATIVE_DAY",offsetDays:1}}];
 const reasons=new Set<string>(["UNKNOWN"]);
 const collectReasons=(node:unknown):void=>{if(!node||typeof node!=="object")return;if(Array.isArray(node)){node.forEach(collectReasons);return;}const value=node as Record<string,unknown>,properties=value.properties as Record<string,{enum?:string[];const?:string}>|undefined;if(properties?.reason){for(const reason of properties.reason.enum??[])reasons.add(reason);if(properties.reason.const)reasons.add(properties.reason.const);}Object.values(value).forEach(collectReasons);};
 collectReasons(frozen.schema);let accepted=0,rejected=0;
 for(let fieldCode=0;fieldCode<=18;fieldCode++)for(const reason of reasons)for(const value of values){
  const candidate={...wire,uncertainties:[{fieldCode,reason,alternatives:[{value,evidence:{primaryEvidence:"U0",additionalEvidence:[]}}]}]};
  const valid=before.safeParse(candidate).success;if(valid)accepted++;else rejected++;
  expect(after.safeParse(candidate).success,JSON.stringify({fieldCode,reason,value})).toBe(valid);
 }
 expect(accepted).toBeGreaterThan(10);expect(rejected).toBeGreaterThan(10);
 expect(JSON.stringify(schema).length).toBeLessThan(JSON.stringify(frozen.schema).length);
});

it("typed105 separates low-state generation constraints from strict input-bound acceptance",()=>{
 const frozen=JSON.parse(readFileSync(new URL("./__fixtures__/typed105-r01-before.json",import.meta.url),"utf8"));
 const selected=ContextInputSchema.parse(frozen.input),generation=googleLiteEuTypedContextWireSchemaV3(selected).schema,strict=googleLiteEuTypedContextValidationSchemaV3(selected).schema;
 expect(createHash("sha256").update(JSON.stringify(strict)).digest("hex")).toBe("0363d0b00e38f19c6cedc652eb97a2906b0129af7fce38e1ccd620adb5081f14");
 const json=JSON.stringify(generation);expect(json).not.toMatch(/"(?:maxLength|minLength|pattern|minItems)":/u);
 const schemas=(node:unknown):void=>{if(!node||typeof node!=="object")return;if(Array.isArray(node)){node.forEach(schemas);return;}const raw=node as Record<string,unknown>;if(raw.maximum!==undefined||raw.minimum!==undefined)expect(raw.minimum).toBe(raw.maximum);if(raw.maxItems!==undefined)expect(raw.maxItems).toBe(0);Object.values(raw).forEach(schemas);};schemas(generation);
 const broad=z.fromJSONSchema(generation as Parameters<typeof z.fromJSONSchema>[0]),strictValidator=z.fromJSONSchema(strict as Parameters<typeof z.fromJSONSchema>[0]);
 const good=encodeGoogleLiteEuTypedContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(selected,"R01",0)),selected) as Record<string,unknown>;
 expect(broad.safeParse(good).success).toBe(true);expect(strictValidator.safeParse(good).success).toBe(true);
 const evidenceRefs=[{kind:"USER_QUOTE",turn:0,quote:selected.turns[0].text,occurrence:1}];
 const titled=encodeGoogleLiteEuTypedContextV3(ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:evidenceRefs},changes:[{field:"title",operation:"SET",value:"synthetic",evidence:evidenceRefs}]}),selected) as Record<string,unknown>;
 expect(strictValidator.safeParse(titled).success).toBe(true);expect(broad.safeParse(titled).success).toBe(true);
 const invalid=structuredClone(titled),carrier=invalid.titleChange as {rank:number;change:{value:unknown;evidence:{primaryEvidence:string;additionalEvidence:unknown[]}}};
 carrier.change.value="x".repeat(2001);
 expect(broad.safeParse(invalid).success).toBe(true);
 // The historical wire already leaves title length to the canonical validator.
 expect(strictValidator.safeParse(invalid).success).toBe(true);
 expect(decodeGoogleLiteEuTypedContextTransportV3(invalid,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,selected).status).toBe("REFUSED");
 const extra=structuredClone(titled),evidence=(extra.titleChange as typeof carrier).change.evidence;evidence.additionalEvidence=Array.from({length:3},()=>({kind:"USER_TURN",turn:0}));
 expect(broad.safeParse(extra).success).toBe(true);expect(strictValidator.safeParse(extra).success).toBe(false);
 expect(decodeGoogleLiteEuTypedContextTransportV3(extra,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,selected).status).toBe("REFUSED");
 const dated=encodeGoogleLiteEuTypedContextV3(ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:evidenceRefs},changes:[{field:"eventDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:1},evidence:evidenceRefs}]}),selected) as Record<string,unknown>;
 expect(strictValidator.safeParse(dated).success).toBe(true);
 ((dated.eventDateChange as {change:{value:{offsetDays:number}}}).change.value).offsetDays=367;
 expect(broad.safeParse(dated).success).toBe(true);expect(strictValidator.safeParse(dated).success).toBe(false);
 expect(decodeGoogleLiteEuTypedContextTransportV3(dated,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,selected).status).toBe("REFUSED");
 expect(JSON.stringify(generation).length).toBeLessThan(JSON.stringify(strict).length);
});

it("typed105 factors object/array union shells without weakening strict field-value correlation",()=>{
 const generation=googleLiteEuTypedContextWireSchemaV3(input).schema as unknown as {$defs:Record<string,Record<string,unknown>>;properties:Record<string,Record<string,unknown>>};
 const resolve=(node:Record<string,unknown>):Record<string,unknown>=>node.$ref?resolve(generation.$defs[String(node.$ref).slice(8)]):node;
 const items=resolve(resolve(generation.properties.uncertainties).items as Record<string,unknown>);
 expect(items.type).toBe("object");expect(items.anyOf).toBeUndefined();
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,uncertainties:[{field:"leadOffsetDays",reason:"AMBIGUOUS",alternatives:[{value:2,evidence}]}]});
 const wire=encodeGoogleLiteEuTypedContextV3(canonical,input) as {uncertainties:Array<{alternatives:Array<{value:unknown}>}>};
 const validator=z.fromJSONSchema(generation as Parameters<typeof z.fromJSONSchema>[0]);
 expect(validator.safeParse(wire).success).toBe(true);
 wire.uncertainties[0].alternatives[0].value="text-for-a-numeric-field";
 expect(validator.safeParse(wire).success).toBe(true);
 expect(decodeGoogleLiteEuTypedContextTransportV3(wire,CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
 const structural=(node:unknown):void=>{if(!node||typeof node!=="object")return;if(Array.isArray(node)){node.forEach(structural);return;}const value=node as Record<string,unknown>;expect(value.oneOf).toBeUndefined();if(value.type==="object"){expect(value.additionalProperties).toBe(false);expect(new Set(value.required as string[])).toEqual(new Set(Object.keys(value.properties as object)));}Object.values(value).forEach(structural);};structural(generation);
});
