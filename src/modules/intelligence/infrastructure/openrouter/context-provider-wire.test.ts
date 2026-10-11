// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ContextInputSchema, ConversationInterpretationSchema, ConversationInterpretationV3Schema, parseInterpretationSections, parseInterpretationSectionsV3 } from "../../../conversation/context-contract/contracts";
import { CONTEXT_PROTOCOL_V3 } from "../../../conversation/context-contract/protocol";
import { createContextContractGateway, createContextHttpTransport, type SemanticJsonRequest } from "./semantic-gateway";
import { encodeGoogleLiteEuContextV3, googleLiteEuContextWireSchemaV3 as googleLiteEuContextWireSchema, parseGoogleLiteEuContextSectionsV3 } from "./context-provider-wire";
import * as wireModule from "./context-provider-wire";
import { serializeContextRequest } from "../../../conversation/context-contract/wire";
import { encodeFixtureV3 } from "../../../../../tools/benchmark/context-pointer-fixtures";
import { z } from "zod";
import { projectWireValidation } from "../../../conversation/context-contract/validation-diagnostics";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import regressions from "../../../conversation/context-contract/benchmark/regressions.json";
import {deriveGenerationFieldCapability} from "../../../conversation/context-contract/field-capability";
function ordinarySchema(schema:ReturnType<typeof googleLiteEuContextWireSchema>["schema"]){const node=schema.properties!.changes;if(typeof node==="boolean")throw Error("TEST_SCHEMA_OBJECT");return node;}
function restoreGeneralSourceDefinition(schema:ReturnType<typeof googleLiteEuContextWireSchema>["schema"]){
 const names:Record<string,string>={s:"__sources",c:"__ec",e:"__e"};if(schema.$defs){schema.$defs=Object.fromEntries(Object.entries(schema.$defs).map(([key,value])=>[names[key]??key,value]));const walk=(value:unknown)=>{if(!value||typeof value!=="object")return;const node=value as Record<string,unknown>;for(const [before,after]of Object.entries(names))if(node.$ref===`#/$defs/${before}`)node.$ref=`#/$defs/${after}`;Object.values(node).forEach(walk);};walk(schema);}
}
it("wire73 actual R03 ordinary cardinality follows distinct fields not operation branches",async()=>{
 const script=regressions.cases.find(c=>c.id==="R03")!,hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
 const probe=await createContextContractProbe({sourceSha:"2833a66fbb84a5df84afc2fa9186c4c895b3e8ca",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{const schema=googleLiteEuContextWireSchema(deriveGenerationFieldCapability(input),input).schema;if(index===2){const restored=structuredClone(schema);delete ordinarySchema(restored).maxItems;restoreGeneralSourceDefinition(restored);expect(hash(restored)).toBe("84dc7214f88a236f08034e4de7a9713f673c6fe44ee5661f4642fb97b446fb49");expect(ordinarySchema(schema).maxItems).toBe(1);}else expect(ordinarySchema(schema).maxItems).toBe(0);const proposal=frozenContextProposal(input,"R03",index-1) as {uncertainties:unknown[]};if(index===1)proposal.uncertainties=[{field:"queryRange",reason:"MISSING",alternatives:[]}];return proposal;});try{for(const turn of script.turns)await probe.turn(turn.text,turn.receipt);}finally{probe.dispose();}
});
it("wire73 ordinary field cardinality preserves all operations and excludes singleton roots",()=>{
 const base=googleLiteEuContextWireSchema().schema;expect(ordinarySchema(base).maxItems).toBe(3);
 for(const notes of [false,true])for(const calendar of [false,true])for(const lead of [false,true]){const capability={version:"generation-field-capability-15" as const,allowedNumericFields:lead?["leadOffsetDays" as const]:[],allowedClockFields:[],titlePresenceRequired:false,titleCorrectionAllowed:false,calendarProposalAllowed:calendar,notesProposalAllowed:notes,reminderDateProposalAllowed:true,eventDateYearNullRequired:false};const schema=googleLiteEuContextWireSchema(capability).schema;expect(ordinarySchema(schema).maxItems).toBe(Number(notes)+Number(calendar)+Number(lead));expect(schema.properties!.locationChange).not.toEqual({type:"null"});}
});
it("wire73 unknown ordinary field shapes and source definition collisions fail closed",()=>{
 const clone=structuredClone;
 for(const fault of ["missing-change","unknown-field","s","c","e"]){const spy=vi.spyOn(globalThis,"structuredClone").mockImplementationOnce(value=>{const result=clone(value) as ReturnType<typeof googleLiteEuContextWireSchema>["schema"],items=ordinarySchema(result).items;if(Array.isArray(items)||typeof items==="boolean"||!items?.properties)throw Error("TEST_SCHEMA_SHAPE");if(fault==="missing-change")delete items.properties.change;else if(fault==="unknown-field"){const change=items.properties.change;if(typeof change==="boolean")throw Error("TEST_SCHEMA_SHAPE");const branch=change.anyOf![0];branch.properties!.field={type:"string",enum:["PRIVATE_UNKNOWN"]};}else {result.$defs![fault]={type:"integer",minimum:0,maximum:12};items.properties.rank={$ref:`#/$defs/${fault}`};}return result;});try{expect(()=>googleLiteEuContextWireSchema()).toThrow("CONTEXT_PROVIDER_WIRE_INVALID");}finally{spy.mockRestore();}}
});
it("wire73 one ordinary operation stays representable while repeated field ownership refuses",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];for(const operation of ["SET","REPLACE","CLEAR"] as const){const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation,value:operation==="CLEAR"?null:"synthetic",evidence}]}),wire=wireFixture(canonical) as Record<string,unknown>;expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");const changes=wire.changes as Array<{rank:number;change:unknown}>;changes.push({...structuredClone(changes[0]),rank:1});expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");}
});
it("one global rank space preserves mixed order and rejects per-container restart",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation:"SET",value:"synthetic",evidence},{field:"calendar",operation:"SET",value:"GREGORIAN",evidence},{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}]}),raw=wireFixture(canonical) as Record<string,unknown>;
 const ordinary=raw.changes as Array<{rank:number}>;ordinary[0].rank=1;ordinary[1].rank=2;(raw.eventRelationChange as {rank:number}).rank=0;
 const parsed=parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3);expect(parsed.status).toBe("PARSED");if(parsed.status==="PARSED")expect(parsed.value.semantic.changes.map(change=>change.field)).toEqual(["eventRelation","notes","calendar"]);
 ordinary[0].rank=0;ordinary[1].rank=1;const diagnostics:unknown[]=[];expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");expect(diagnostics).toMatchObject([{issues:[{rankControl:{reason:"COLLISION",actualRank:0,collisionLocations:[{root:"changes",index:0}]}}]}]);
});
it("rank diagnostics distinguish scalar collision and ordinary ordering while preserving hard refusal",async()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation:"SET",value:"synthetic",evidence},{field:"calendar",operation:"SET",value:"GREGORIAN",evidence},{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}]}),wire=wireFixture(canonical) as Record<string,unknown>;
 const cases:[unknown,string,number|undefined][]=[[.5,"NON_INTEGER",undefined],[-1,"NEGATIVE",-1],[13,"OUT_OF_RANGE",13],[Number.MAX_SAFE_INTEGER+1,"NON_INTEGER",undefined],[1000001,"OUT_OF_RANGE",undefined],[0,"COLLISION",0]];
 for(const [rank,reason,actualRank] of cases){const raw=structuredClone(wire);(raw.eventRelationChange as {rank:unknown}).rank=rank;const diagnostics:unknown[]=[];expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d))).toEqual({status:"REFUSED",reason:"SEMANTIC_PATCH_INVALID"});const projected=projectWireValidation(raw,["eventRelationChange","rank"],"CHANGE_RANK",undefined,"calenote-context-3");expect(projected.issues[0]).toMatchObject({expected:"CHANGE_RANK",rankControl:{reason,minRank:0,maxRank:12,ordinaryCount:2,carrierCount:1}});expect(projected.issues[0].rankControl?.actualRank).toBe(actualRank);expect(diagnostics).toEqual([projected]);expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,()=>{throw Error("PRIVATE_OBSERVER")})).toEqual({status:"REFUSED",reason:"SEMANTIC_PATCH_INVALID"});}
 const descending=structuredClone(wire);(descending.changes as Array<{rank:number}>)[0].rank=5;(descending.changes as Array<{rank:number}>)[1].rank=3;const diagnostics:unknown[]=[];expect(parseGoogleLiteEuContextSectionsV3(descending,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");expect(diagnostics).toMatchObject([{issues:[{path:["changes",1,"rank"],rankControl:{reason:"NON_INCREASING",actualRank:3,previousOrdinaryRank:5}}]}]);
 expect(await dispatch({...wire,eventRelationChange:{...(wire.eventRelationChange as object),rank:13}})).toMatchObject({status:"FAILURE",category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{rankControl:{reason:"OUT_OF_RANGE",actualRank:13}}]}}});
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");
});
it("wire68 sparse authored ranks declare membership only on actual entries",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}]});
 const encoded=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;expect(encoded).not.toHaveProperty("changeOrder");expect(encoded.eventRelationChange).toMatchObject({rank:0});
 const authored={...encoded,eventRelationChange:{rank:10,change:(encoded.eventRelationChange as {change:unknown}).change}};
 expect(parseGoogleLiteEuContextSectionsV3(authored,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
 const schema=googleLiteEuContextWireSchema().schema;expect(schema.properties).not.toHaveProperty("changeOrder");const carrier=schema.properties!.eventRelationChange;if(typeof carrier==="boolean"||typeof carrier.anyOf![0]==="boolean")throw Error("carrier schema missing");expect(carrier.anyOf![0].properties!.rank).toEqual({$ref:"#/$defs/r"});expect(schema.$defs!.r).toEqual({type:"integer",minimum:0,maximum:12});
});
it("wire68 ranks preserve all13 fields and refuses contradictory ordinary order",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const fields=["title","location","notes","eventDate","eventTime","reminderDate","reminderTime","calendar","frequency","occurrenceCount","eventRelation","leadOffsetDays","endDate"];
 for(const kind of ["CURRENT","NEW"])for(const operation of ["SET","REPLACE","CLEAR"])for(let rotation=0;rotation<13;rotation++){
  const ordered=[...fields.slice(rotation),...fields.slice(0,rotation)];
  const values:Record<string,unknown>={title:"literal",location:"literal",notes:"literal",eventDate:{kind:"RELATIVE_DAY",offsetDays:2},eventTime:{hour:8,minute:0,qualifier:"H24"},reminderDate:{kind:"RELATIVE_DAY",offsetDays:3},reminderTime:{hour:9,minute:0,qualifier:"H24"},calendar:"GREGORIAN",frequency:"DAILY",occurrenceCount:2,eventRelation:"BEFORE_EVENT",leadOffsetDays:2,endDate:{kind:"RELATIVE_DAY",offsetDays:4}};
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind,evidence},changes:ordered.map(field=>({field,operation,value:operation==="CLEAR"?null:values[field],evidence}))});
  const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;
  expect(wire).not.toHaveProperty("changeOrder");expect(wire.changes).toHaveLength(3);
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
  expect(wire).toEqual(wireFixture(canonical));
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
  const reversed={...wire,changes:[...(wire.changes as unknown[])].reverse()};
  expect(parseGoogleLiteEuContextSectionsV3(reversed,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
 }
 const empty=encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(minimal)) as Record<string,unknown>;
 expect(empty).not.toHaveProperty("changeOrder");expect(parseGoogleLiteEuContextSectionsV3(empty,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");
});
it("wire68 exact rank schema admits sparse13-field controls while decoder rejects every collision pair",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],fields=["title","location","notes","eventDate","eventTime","reminderDate","reminderTime","calendar","frequency","occurrenceCount","eventRelation","leadOffsetDays","endDate"];
 const values:Record<string,unknown>={title:"literal",location:"literal",notes:"literal",eventDate:{kind:"RELATIVE_DAY",offsetDays:2},eventTime:{hour:8,minute:0,qualifier:"H24"},reminderDate:{kind:"RELATIVE_DAY",offsetDays:3},reminderTime:{hour:9,minute:0,qualifier:"H24"},calendar:"GREGORIAN",frequency:"DAILY",occurrenceCount:2,eventRelation:"BEFORE_EVENT",leadOffsetDays:2,endDate:{kind:"RELATIVE_DAY",offsetDays:4}};
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:fields.map(field=>({field,operation:"SET",value:values[field],evidence}))}),wire=wireFixture(canonical) as Record<string,unknown>;
 const outgoing=googleLiteEuContextWireSchema().schema,inline=(value:unknown):unknown=>{if(Array.isArray(value))return value.map(inline);if(!value||typeof value!=="object")return value;const node=value as Record<string,unknown>;if(typeof node.$ref==="string")return inline(node.$ref.slice(2).split("/").reduce((parent,key)=>(parent as Record<string,unknown>)[key],outgoing as unknown));return Object.fromEntries(Object.entries(node).filter(([key])=>key!=="$defs").map(([key,child])=>[key,inline(child)]));};const schema=z.fromJSONSchema(inline(outgoing) as Parameters<typeof z.fromJSONSchema>[0]);expect(schema.safeParse(wire).success).toBe(true);
 const entries=(raw:Record<string,unknown>)=>[...(raw.changes as Array<{rank:number;change:unknown}>),...fields.flatMap(field=>raw[field+"Change"]?[raw[field+"Change"] as {rank:number;change:unknown}]:[])];
 for(let left=0;left<13;left++)for(let right=left+1;right<13;right++){const bad=structuredClone(wire),all=entries(bad);all[right].rank=all[left].rank;const diagnostics:unknown[]=[];expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");expect(diagnostics).toMatchObject([{issues:[{rankControl:{reason:"COLLISION",unavailable:false}}]}]);}
 const sparse=wireFixture(ConversationInterpretationV3Schema.parse({...canonical,changes:[canonical.changes[10]]})) as Record<string,unknown>;(sparse.eventRelationChange as {rank:number}).rank=10;expect(schema.safeParse(sparse).success).toBe(true);expect(parseGoogleLiteEuContextSectionsV3(sparse,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:[canonical.changes[10]]}}});
 for(const rank of [-1,13,.5,"10",null]){const bad=structuredClone(sparse);(bad.eventRelationChange as {rank:unknown}).rank=rank;expect(schema.safeParse(bad).success).toBe(false);expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");}
});
it("wire68 root wrapper and nested controls refuse accessors without invoking get traps",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence},{field:"notes",operation:"SET",value:"literal",evidence}]}),baseline=wireFixture(canonical) as Record<string,unknown>;
 let reads=0;const diagnostics:unknown[]=[];
 for(const root of ["eventRelationChange","changeOrder","changes"]){const bad=structuredClone(baseline);Object.defineProperty(bad,root,{enumerable:true,get(){reads++;throw Error("PRIVATE_RANK_GETTER");}});expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");}
 for(const container of ["eventRelationChange","ordinary"])for(const key of ["rank","change","field","operation","value","evidence"]){const bad=structuredClone(baseline),wrapper=(container==="ordinary"?(bad.changes as object[])[0]:bad.eventRelationChange) as {change:Record<string,unknown>};Object.defineProperty(key==="rank"||key==="change"?wrapper:wrapper.change,key,{enumerable:true,get(){reads++;throw Error("PRIVATE_RANK_GETTER");}});expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");}
 for(const target of ["root","carrier","ordinary","change"]){const bad=structuredClone(baseline),trap={get(){reads++;throw Error("PRIVATE_PROXY_GET");}};(bad.eventRelationChange as {rank:number}).rank=13;((bad.changes as Array<{rank:number}>)[0]).rank=13;let raw:Record<string,unknown>=bad;if(target==="root")raw=new Proxy(bad,trap);else if(target==="carrier")bad.eventRelationChange=new Proxy(bad.eventRelationChange as object,trap);else if(target==="ordinary")(bad.changes as object[])[0]=new Proxy((bad.changes as object[])[0],trap);else(bad.eventRelationChange as {change:object}).change=new Proxy((bad.eventRelationChange as {change:object}).change,trap);expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");}
 expect(reads).toBe(0);expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_RANK_GETTER|PRIVATE_PROXY_GET/);
});
it("wire68 active wrappers exclude null roots and include CLEAR without duplicated membership",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation:"SET",value:"synthetic",evidence}]}),wire=wireFixture(canonical) as Record<string,unknown>;
 expect(wire.eventTimeChange).toBeNull();expect(wire.changes).toMatchObject([{rank:0,change:{field:"notes"}}]);expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");
 const authored={...wire,locationChange:{rank:10,change:{field:"location",operation:"CLEAR",value:null,evidence:{primaryEvidence:JSON.stringify(evidence[0]),additionalEvidenceJson:"[]"}}}};
 expect(parseGoogleLiteEuContextSectionsV3(authored,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:[canonical.changes[0],{field:"location",operation:"CLEAR",value:null,evidence}]}}});
 expect(parseGoogleLiteEuContextSectionsV3({...authored,locationChange:{...authored.locationChange,rank:0}},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
 for(const changeOrder of [[],[2],[2,4]])expect(parseGoogleLiteEuContextSectionsV3({...wire,changeOrder},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("wire68 sparse ordinary ranks preserve independent array order and reject collisions",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation:"SET",value:"synthetic",evidence},{field:"calendar",operation:"SET",value:"GREGORIAN",evidence},{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}]}),wire=wireFixture(canonical) as Record<string,unknown>;
 const ordinary=wire.changes as Array<{rank:number;change:unknown}>;ordinary[0].rank=2;ordinary[1].rank=12;(wire.eventRelationChange as {rank:number}).rank=7;
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:[canonical.changes[0],canonical.changes[2],canonical.changes[1]]}}});
 expect(parseGoogleLiteEuContextSectionsV3({...wire,changes:[ordinary[1],ordinary[0]]},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
 expect(parseGoogleLiteEuContextSectionsV3({...wire,eventRelationChange:{...(wire.eventRelationChange as object),rank:12}},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("wire68 rank controls refuse invalid types legacy keys and getters without repair",async()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}]}),wire=wireFixture(canonical) as Record<string,unknown>,carrier=wire.eventRelationChange as {rank:number;change:unknown},before=JSON.stringify(wire);
 for(const rank of ["10","eventRelation","PRIVATE_RANK_SENTINEL",null,undefined,-1,13,.5,NaN,Infinity,{},true]){const diagnostics:unknown[]=[];expect(parseGoogleLiteEuContextSectionsV3({...wire,eventRelationChange:{...carrier,rank}},CONTEXT_PROTOCOL_V3,undefined,v=>diagnostics.push(v)).status).toBe("REFUSED");expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_RANK_SENTINEL");}
 let getters=0;const accessor={...carrier};Object.defineProperty(accessor,"rank",{enumerable:true,get(){getters++;throw Error("private");}});expect(parseGoogleLiteEuContextSectionsV3({...wire,eventRelationChange:accessor},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");const root={...wire};Object.defineProperty(root,"eventRelationChange",{enumerable:true,get(){getters++;throw Error("private");}});expect(parseGoogleLiteEuContextSectionsV3(root,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(getters).toBe(0);
 expect(parseGoogleLiteEuContextSectionsV3({...wire,eventRelationChange:{change:carrier.change}},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(parseGoogleLiteEuContextSectionsV3({...wire,eventRelationChange:{...carrier,index:0}},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(JSON.stringify(wire)).toBe(before);
 expect(await dispatch({...wire,eventRelationChange:{...carrier,rank:13}})).toMatchObject({status:"FAILURE",category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{path:["eventRelationChange","rank"],expected:"CHANGE_RANK"}]}}});
});
it("wire64 seven authored carriers preserve chosen order and reject index10 without repair",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const fields=[{field:"title",operation:"SET",value:"synthetic",evidence},{field:"location",operation:"SET",value:"synthetic",evidence},{field:"eventDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence},{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence},{field:"frequency",operation:"SET",value:"DAILY",evidence},{field:"occurrenceCount",operation:"SET",value:2,evidence},{field:"reminderTime",operation:"SET",value:{hour:8,minute:0,qualifier:"H24"},evidence}];
 for(let rotation=0;rotation<7;rotation++){const changes=[...fields.slice(rotation),...fields.slice(0,rotation)],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes}),wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;expect(wire.changes).toEqual([]);expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});for(const index of [10,-1,0.5,"0",null]){const bad=structuredClone(wire);(bad.titleChange as {index:unknown}).index=index;expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");}const bad=structuredClone(wire);(bad.titleChange as {index:unknown}).index=(bad.locationChange as {index:unknown}).index;expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");}
});
it.each(["outside","numeric","clock"])("wire64 integer uncertainty domains preserve exact %s language",context=>{
 const text=context==="outside"?"Nhắc gọi mẹ.":context==="numeric"?"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.":"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.";
 const bound=ContextInputSchema.parse({...input,capabilities:{...input.capabilities,supported:["ONCE","FINITE_DAILY"]},turns:[{role:"USER",text}]});
 const schema=serializeContextRequest(bound).response_format.json_schema.schema as unknown as {properties:{uncertainties:{items:Record<string,unknown>}}};
 const item=schema.properties.uncertainties.items;const check=z.fromJSONSchema({...item,$defs:(schema as unknown as {$defs:Record<string,unknown>}).$defs} as Parameters<typeof z.fromJSONSchema>[0]);
 const visit=(value:unknown):void=>{if(!value||typeof value!=="object")return;const n=value as Record<string,unknown>;if(n.properties&&typeof n.properties==="object"&&"fieldCode" in n.properties){const field=(n.properties as Record<string,Record<string,unknown>>).fieldCode;expect(field.enum).toBeUndefined();expect(field.type).toBe("integer");}Object.values(n).forEach(visit);};visit(item);
 for(let fieldCode=0;fieldCode<16;fieldCode++)for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"]){const expected=context==="outside"||(![8,9].includes(fieldCode)&&!(context==="clock"&&fieldCode===6&&reason==="MISSING"));expect(check.safeParse({fieldCode,reason,alternatives:[]}).success).toBe(expected);}
 for(const fieldCode of [-1,16,0.5,"0",null,true,{},[]])expect(check.safeParse({fieldCode,reason:"MISSING",alternatives:[]}).success).toBe(false);
 for(const value of [{},{fieldCode:0,reason:"MISSING"},{fieldCode:0,reason:"MISSING",alternatives:[],secret:1}])expect(check.safeParse(value).success).toBe(false);
});
it.each([
 [2,true,false,false],[30,true,false,false],[1,true,false,true],[31,true,false,true],[2,false,false,true],[2,true,true,true]
] as const)("wire61 bound schema preserves genuine numeric unsupported: count%s capability%s lead%s",(count,finiteDaily,lead,allowed)=>{
 const bound=ContextInputSchema.parse({...input,capabilities:{...input.capabilities,supported:finiteDaily?["ONCE","FINITE_DAILY"]:["ONCE"]},turns:[{role:"USER",text:`Ngày 11/10 đi thi, nhắc ${count} ngày liên tiếp${lead?", nhắc trước 3 ngày":""}.`}]});
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:bound.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},conversationDirective:null,changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"frequency",operation:"SET",value:"DAILY",evidence},{field:"occurrenceCount",operation:"SET",value:count,evidence}]});
 const schema=serializeContextRequest(bound).response_format.json_schema.schema;
 const inline=(v:unknown):unknown=>{if(Array.isArray(v))return v.map(inline);if(!v||typeof v!=="object")return v;const n=v as Record<string,unknown>;if(typeof n.$ref==="string")return inline(n.$ref.slice(2).split("/").reduce((p,k)=>(p as Record<string,unknown>)[k],schema as unknown));return Object.fromEntries(Object.entries(n).filter(([k])=>k!=="$defs").map(([k,c])=>[k,inline(c)]));};
 const check=z.fromJSONSchema(inline(schema) as Parameters<typeof z.fromJSONSchema>[0]);
 expect(check.safeParse(encodeFixtureV3(canonical,bound)).success).toBe(true);
 for(const field of ["frequency","occurrenceCount"]){
  const value=field==="frequency"?"DAILY":count;
  const authored={...canonical,uncertainties:[{field,reason:"UNSUPPORTED_COMBINATION",alternatives:[{value,evidence}]}]};
  const raw=encodeFixtureV3(authored,bound);
  expect(check.safeParse(raw).success).toBe(allowed);
  // The unchanged canonical/source transport still decodes these alternatives;
  // request generation membership is not output deletion or validator repair.
  expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,bound).status).toBe("PARSED");
 }
 for(const field of ["reminderTime","location","operation"]){
  const raw=encodeFixtureV3({...canonical,uncertainties:[]},bound) as Record<string,unknown>;
  const fieldCode=field==="reminderTime"?6:field==="location"?1:15;
  expect(check.safeParse({...raw,uncertainties:[{fieldCode,reason:"UNSUPPORTED_COMBINATION",alternatives:[]}]}).success).toBe(true);
 }
});
it("wire63 folds only equivalent uncertainty reason shells and preserves clock domains",()=>{
 for(const clock of [false,true]){
  const bound=ContextInputSchema.parse({...input,capabilities:{...input.capabilities,supported:["ONCE","FINITE_DAILY"]},turns:[{role:"USER",text:clock?"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.":"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp."}]});
  const schema=serializeContextRequest(bound).response_format.json_schema.schema as unknown as {properties:{uncertainties:{items:Record<string,unknown>}}};
  const item=schema.properties.uncertainties.items;
  if(clock)expect(item).toHaveProperty("anyOf");else{expect(item).not.toHaveProperty("anyOf");expect(item).toMatchObject({type:"object",required:["fieldCode","reason","alternatives"],additionalProperties:false});}
  const check=z.fromJSONSchema(item as Parameters<typeof z.fromJSONSchema>[0]);
  for(let code=0;code<16;code++)for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"]){
   const value={fieldCode:code,reason,alternatives:[]};expect(check.safeParse(value).success).toBe(code!==8&&code!==9&&!(clock&&code===6&&reason==="MISSING"));
   for(const malformed of [{...value,fieldCode:null},{...value,reason:"UNKNOWN"},{...value,alternatives:[null]},{...value,extra:0}])expect(check.safeParse(malformed).success).toBe(false);
  }
  for(const value of [{},{field:"reminderTime",reason:"MISSING",alternatives:[]},{fieldCode:6,reason:"MISSING"},null,[]])expect(check.safeParse(value).success).toBe(false);
 }
});
it("wire60 title carrier preserves correction availability and required SET without ordinary bypass",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const capability={version:"generation-field-capability-15" as const,allowedNumericFields:[],allowedClockFields:[],titlePresenceRequired:false,titleCorrectionAllowed:false,calendarProposalAllowed:true,notesProposalAllowed:true,reminderDateProposalAllowed:true,eventDateYearNullRequired:false};
 for(const titlePresenceRequired of [false,true])for(const titleCorrectionAllowed of [false,true]){
  const schema=googleLiteEuContextWireSchema({...capability,titlePresenceRequired,titleCorrectionAllowed}).schema;
  const inline=(v:unknown):unknown=>{if(Array.isArray(v))return v.map(inline);if(!v||typeof v!=="object")return v;const n=v as Record<string,unknown>;if(typeof n.$ref==="string")return inline(n.$ref.slice(2).split("/").reduce((p,k)=>(p as Record<string,unknown>)[k],schema as unknown));return Object.fromEntries(Object.entries(n).filter(([k])=>k!=="$defs").map(([k,c])=>[k,inline(c)]));};
  const check=z.fromJSONSchema(inline(schema) as Parameters<typeof z.fromJSONSchema>[0]);
  for(const operation of ["SET","REPLACE","CLEAR"] as const){
   const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"title",operation,value:operation==="CLEAR"?null:"synthetic",evidence}]});
   const raw=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:unknown};changes:unknown[]};
   expect(check.safeParse(raw).success,`${titlePresenceRequired}/${titleCorrectionAllowed}/${operation}`).toBe(operation==="SET"||(!titlePresenceRequired&&titleCorrectionAllowed));
   expect(check.safeParse({...raw,titleChange:null,changes:[raw.titleChange.change]}).success).toBe(false);
   expect(parseGoogleLiteEuContextSectionsV3({...raw,titleChange:null,changes:[raw.titleChange.change]},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  }
 }
});
it("wire60 live structural class stays a hard private refusal rather than correction repair",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_QUOTE",occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"PRIVATE_TITLE",evidence}]});
 const raw=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:Record<string,unknown>};changes:unknown[]};
 raw.changes=Array.from({length:3},(_,index)=>({rank:index+1,change:{...raw.titleChange.change,operation:"REPLACE"}}));
 const before=JSON.stringify(raw),diagnostics:unknown[]=[];
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,v=>diagnostics.push(v)).status).toBe("REFUSED");
 expect(diagnostics).toMatchObject([{issues:[{expected:"UNIQUE_TITLE_OWNER",titleOwnership:{ordinaryCount:3,carrierOperation:{actualSafeToken:"SET"},ordinaryOperations:[{index:0,actualSafeToken:"REPLACE"},{index:1,actualSafeToken:"REPLACE"},{index:2,actualSafeToken:"REPLACE"}]}}]}]);
 expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE");expect(JSON.stringify(raw)).toBe(before);
});
it("wire60 bound title presence decoder requires authored SET even if generic carrier admits corrections",()=>{
 const {bound,canonical}=wire55Example();
 const raw=encodeFixtureV3(canonical,bound) as Record<string,unknown>;
 const carrier=raw.titleChange as {index:number;change:Record<string,unknown>};
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,bound).status).toBe("PARSED");
 for(const operation of ["REPLACE","CLEAR"]){
  const bad={...raw,titleChange:{...carrier,change:{...carrier.change,operation,value:operation==="CLEAR"?null:carrier.change.value}}},diagnostics:unknown[]=[];
  expect(wireModule.decodeGoogleLiteEuContextTransportV3(bad,CONTEXT_PROTOCOL_V3,undefined,v=>diagnostics.push(v),bound).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["titleChange","change","operation"],code:"WIRE_SHAPE_INVALID",expected:"CONTROL_ENUM"}]}]);
 }
 expect(wireModule.decodeGoogleLiteEuContextTransportV3({...raw,titleChange:null},CONTEXT_PROTOCOL_V3,undefined,undefined,bound).status).toBe("REFUSED");
});
it("wire59 bound alternative carrier restores canonical evidence without traversing its value",()=>{
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,uncertainties:[{field:"title",reason:"UNSUPPORTED_COMBINATION",alternatives:[{value:"U0",evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]}]}]});
 const raw=encodeGoogleLiteEuContextV3(canonical) as {uncertainties:Array<{alternatives:string[]}>};
 raw.uncertainties[0].alternatives=[JSON.stringify({value:"U0",evidence:{primaryEvidence:"U0",additionalEvidenceJson:"[]"}})];
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,input).status).toBe("PARSED");
 expect(parseGoogleLiteEuContextSectionsV3(encodeGoogleLiteEuContextV3(canonical),CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
 const encoded=JSON.parse((encodeGoogleLiteEuContextV3(canonical) as typeof raw).uncertainties[0].alternatives[0]);
 expect(encoded.evidence).toEqual({primaryEvidence:JSON.stringify({kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}),additionalEvidenceJson:"[]"});
 raw.uncertainties[0].alternatives=[JSON.stringify(canonical.uncertainties[0].alternatives[0])];
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
});
function wire55Example(operation:"SET"|"REPLACE"|"CLEAR"="SET"){
 const bound=ContextInputSchema.parse({...input,turns:[{role:"USER",text:"Ngày 11/10 đi thi."}]});
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:bound.turns[0].text,occurrence:1}],value={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},conversationDirective:null,changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"eventDate",operation,value:operation==="CLEAR"?null:value,evidence}]});
 const schema=serializeContextRequest(bound).response_format.json_schema.schema;
 const inline=(v:unknown):unknown=>{if(Array.isArray(v))return v.map(inline);if(!v||typeof v!=="object")return v;const n=v as Record<string,unknown>;if(typeof n.$ref==="string")return inline(n.$ref.slice(2).split("/").reduce((p,k)=>(p as Record<string,unknown>)[k],schema as unknown));return Object.fromEntries(Object.entries(n).filter(([k])=>k!=="$defs").map(([k,c])=>[k,inline(c)]));};
 return {bound,canonical,value,check:z.fromJSONSchema(inline(schema) as Parameters<typeof z.fromJSONSchema>[0]),raw:encodeFixtureV3(canonical,bound) as {eventDateChange:{change:{value:unknown}}}};
}
it.each([false,true])("wire61 supported unique numeric source restricts only its reasons with requiredClock=%s",requiredClock=>{
 const bound=ContextInputSchema.parse({...input,capabilities:{...input.capabilities,supported:["ONCE","FINITE_DAILY"]},turns:[{role:"USER",text:requiredClock?"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.":"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi."}]});
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:bound.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},conversationDirective:null,changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"frequency",operation:"SET",value:"DAILY",evidence},{field:"occurrenceCount",operation:"SET",value:2,evidence},...(requiredClock?[{field:"reminderTime",operation:"SET",value:{hour:8,minute:0,qualifier:"H24"},evidence}]:[])]});
 const schema=serializeContextRequest(bound).response_format.json_schema.schema;
 const inline=(v:unknown):unknown=>{if(Array.isArray(v))return v.map(inline);if(!v||typeof v!=="object")return v;const n=v as Record<string,unknown>;if(typeof n.$ref==="string")return inline(n.$ref.slice(2).split("/").reduce((p,k)=>(p as Record<string,unknown>)[k],schema as unknown));return Object.fromEntries(Object.entries(n).filter(([k])=>k!=="$defs").map(([k,c])=>[k,inline(c)]));};
 const check=z.fromJSONSchema(inline(schema) as Parameters<typeof z.fromJSONSchema>[0]),raw=encodeFixtureV3(canonical,bound) as Record<string,unknown>;
 expect(check.safeParse(raw).success).toBe(true);
 for(const fieldCode of [8,9])for(const reason of ["MISSING","AMBIGUOUS","CONFLICT"]){expect(check.safeParse({...raw,uncertainties:[{fieldCode,reason,alternatives:[]}]}).success,`${fieldCode}/${reason}`).toBe(false);}
 for(const fieldCode of [8,9])expect(check.safeParse({...raw,uncertainties:[{fieldCode,reason:"UNSUPPORTED_COMBINATION",alternatives:[]}]}).success).toBe(false);
 for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])expect(check.safeParse({...raw,uncertainties:[{fieldCode:6,reason,alternatives:[]}]}).success).toBe(reason!=="MISSING"||!requiredClock);
 for(const fieldCode of [0,1,2,3,4,5,7,10,11,12,13,14,15])for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])expect(check.safeParse({...raw,uncertainties:[{fieldCode,reason,alternatives:[]}]}).success).toBe(true);
});
it.each(["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc 3 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp mỗi tuần.","Nhắc 2 ngày liên tiếp.","Nếu đi thi, nhắc 2 ngày liên tiếp.","Sửa nhắc 2 ngày liên tiếp.","Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp [CONTROL]"])("wire58 outside unique-source subset retains numeric uncertainty item domains: %s",text=>{
 const bound=ContextInputSchema.parse({...input,turns:[{role:"USER",text}]}),schema=serializeContextRequest(bound).response_format.json_schema.schema;
 const inline=(v:unknown):unknown=>{if(Array.isArray(v))return v.map(inline);if(!v||typeof v!=="object")return v;const n=v as Record<string,unknown>;if(typeof n.$ref==="string")return inline(n.$ref.slice(2).split("/").reduce((p,k)=>(p as Record<string,unknown>)[k],schema as unknown));return Object.fromEntries(Object.entries(n).filter(([k])=>k!=="$defs").map(([k,c])=>[k,inline(c)]));};
 const item=(schema as unknown as {properties:{uncertainties:{items:unknown}}}).properties.uncertainties.items,check=z.fromJSONSchema(inline(item) as Parameters<typeof z.fromJSONSchema>[0]);
 for(const fieldCode of [8,9])for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])expect(check.safeParse({fieldCode,reason,alternatives:[]}).success).toBe(true);
});
it.each(["SET","REPLACE"] as const)("wire55 scoped %s requires six authored civil keys with year null",operation=>{
 const {bound,raw,value,check,canonical}=wire55Example(operation);raw.eventDateChange.change.value=value;
 expect(check.safeParse(raw).success).toBe(true);
 const diagnostics:unknown[]=[];
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,d=>diagnostics.push(d),d=>diagnostics.push(d),bound).status,JSON.stringify(diagnostics)).toBe("PARSED");
 const encoded=Reflect.apply(encodeGoogleLiteEuContextV3,undefined,[canonical,bound]) as typeof raw;
 expect(encoded.eventDateChange.change.value).toEqual(value);
 for(const bad of [{...value,year:2026},JSON.stringify(value),Object.fromEntries(Object.entries(value).filter(([k])=>k!=="year"))]){raw.eventDateChange.change.value=bad;expect(check.safeParse(raw).success).toBe(false);expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,bound).status).toBe("REFUSED");}
});
it("wire55 CLEAR retains null while unflagged and no-input dates remain JSON only",()=>{
 const {bound,raw,check}=wire55Example("CLEAR");expect(raw.eventDateChange.change.value).toBeNull();expect(check.safeParse(raw).success).toBe(true);expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,bound).status).toBe("PARSED");
 const ex=wire55Example();ex.raw.eventDateChange.change.value=ex.value;
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(ex.raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
 const explicit=ContextInputSchema.parse({...ex.bound,turns:[{role:"USER",text:"Ngày 11/10/2026 đi thi."}]});
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(ex.raw,CONTEXT_PROTOCOL_V3,undefined,undefined,explicit).status).toBe("REFUSED");
});
it("wire55 typed civil rejects invalid authored slots and private/getter values without leaks",()=>{
 const {bound,raw,value}=wire55Example();
 const malformed=[null,[],{}, {...value,year:0},{...value,day:0},{...value,day:32},{...value,month:13},{...value,day:1.5},{...value,year:NaN},{...value,kind:"RELATIVE_DAY"},{...value,leapMonth:true},{...value,calendar:"PRIVATE_CALENDAR"},{...value,PRIVATE_KEY:"PRIVATE_VALUE"},...Object.keys(value).map(key=>Object.fromEntries(Object.entries(value).filter(([k])=>k!==key)))];
 for(const invalid of malformed){raw.eventDateChange.change.value=invalid;const diagnostic:unknown[]=[];expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,d=>diagnostic.push(d),d=>diagnostic.push(d),bound).status).toBe("REFUSED");expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE_KEY|PRIVATE_VALUE|PRIVATE_CALENDAR/);}
 let accesses=0;const accessor={...value};Object.defineProperty(accessor,"year",{enumerable:true,get(){accesses++;throw Error("PRIVATE_GETTER")}});raw.eventDateChange.change.value=accessor;const diagnostic:unknown[]=[];
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostic.push(d),bound).status).toBe("REFUSED");expect(accesses).toBe(0);expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE_GETTER");
 const numeric=ConversationInterpretationV3Schema.parse({...wire55Example().canonical,changes:wire55Example().canonical.changes.map(change=>change.field==="eventDate"?{...change,value:{...value,year:2026}}:change)});
 expect(()=>encodeGoogleLiteEuContextV3(numeric,bound)).toThrow();expect((encodeGoogleLiteEuContextV3(numeric) as typeof raw).eventDateChange.change.value).toEqual(JSON.stringify({...value,year:2026}));
});
it.each(["valid","numeric"] as const)("wire55 actual gateway consumes typed authored date: %s",async mode=>{
 const {bound,raw,value}=wire55Example();raw.eventDateChange.change.value=mode==="numeric"?{...value,year:2026}:value;
 let calls=0;const transport=createContextHttpTransport("fixture",async()=>{calls++;return new Response(JSON.stringify({model:config.primary.model,provider:"Google",choices:[{finish_reason:"stop",message:{content:JSON.stringify(raw)}}],usage:{cost:.0001,prompt_tokens:100,completion_tokens:100}}),{headers:{"content-type":"application/json"}})});
 const attempt=createContextContractGateway(config,transport,{status:"OBSERVABLE_CANARY",advertisedContextTokens:1048576}).prepare("PRIMARY",bound);if(attempt.status!=="READY")throw Error("Expected ready");
 const result=await attempt.dispatch();expect(result.status).toBe(mode==="valid"?"SUCCESS":"FAILURE");expect(calls).toBe(1);expect(raw.eventDateChange.change.value).toEqual(mode==="numeric"?{...value,year:2026}:value);
});
it("wire53 bound schema and decoder use codes, never legacy primary JSON",()=>{
 const bound=ContextInputSchema.parse({...input,turns:[{role:"USER",text:"synthetic"}],currentTurn:0});
 const schema=googleLiteEuContextWireSchema(undefined,bound).schema as unknown as {$defs:Record<string,{enum?:string[]}>};
 expect(schema.$defs.s.enum).toEqual(["U0"]);expect(schema.$defs.__current.enum).toEqual(["U0"]);
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"LIST_REMINDERS",query:{kind:"LIST",period:{kind:"UPCOMING"},statusScope:"DEFAULT",evidence}});
 const raw=encodeGoogleLiteEuContextV3(canonical) as {query:{evidence:{primaryEvidence:string}}};
 raw.query.evidence.primaryEvidence="U0";
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,bound).status).toBe("PARSED");
 raw.query.evidence.primaryEvidence='{"kind":"USER_TURN","turn":0}';
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,bound).status).toBe("REFUSED");
});
it.each([5,64])("wire52 root uncertainty refusal records count %s without content",count=>{
 const raw=encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(minimal)) as Record<string,unknown>;raw.uncertainties=Array.from({length:count},()=>({PRIVATE_UNCERTAINTY_KEY:"PRIVATE_UNCERTAINTY_VALUE"}));const diagnostics:unknown[]=[];
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
 expect(diagnostics).toMatchObject([{issues:[{path:["uncertainties"],actualType:"array",constraint:"ARRAY_CARDINALITY",actualCount:count,maxItems:4}]}]);expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_UNCERTAINTY/);
});
it.each([null,"PRIVATE_UNCERTAINTY_VALUE",{}])("wire52 nonarray uncertainty refusal stays type only (%#)",value=>{
 const raw=encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(minimal)) as Record<string,unknown>;raw.uncertainties=value;const diagnostics:unknown[]=[];
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
 const issue=(diagnostics[0] as {issues:Record<string,unknown>[]}).issues[0];expect(issue.path).toEqual(["uncertainties"]);expect(issue).not.toHaveProperty("constraint");expect(issue).not.toHaveProperty("actualCount");expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_UNCERTAINTY_VALUE");
});
it("wire52 restores only the outgoing root max4 and leaves uncertainty items and all other schema nodes unchanged",()=>{
 const schema=structuredClone(googleLiteEuContextWireSchema().schema) as unknown as {properties:{uncertainties:{maxItems?:number};changes:{maxItems?:number}}};expect(schema.properties.uncertainties.maxItems).toBe(4);delete schema.properties.uncertainties.maxItems;delete schema.properties.changes.maxItems;
 expect(createHash("sha256").update(JSON.stringify(schema)).digest("hex")).toBe("640d01c118a9c180f16b1a52885f723a098db1f2007939b5ccc7a58ed66e61e4");
});
it("wire52 valid zero/four uncertainty operands keep decoding while nested failures keep their exact item path",()=>{
 const raw=encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(minimal)) as Record<string,unknown>;
 for(const count of [0,4]){raw.uncertainties=Array.from({length:count},()=>({fieldCode:2,reason:"MISSING",alternatives:[]}));expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");}
 raw.uncertainties=[{fieldCode:2,reason:"MISSING",alternatives:[],PRIVATE_UNCERTAINTY_KEY:"PRIVATE_UNCERTAINTY_VALUE"}];const diagnostics:unknown[]=[];expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");expect(diagnostics).toMatchObject([{issues:[{path:["uncertainties",0],classification:"extra",extraKeyCount:1}]}]);expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_UNCERTAINTY/);
});
it("wire51 source-bound fixture traverses endDate and location carriers without changing values or order",()=>{
 const bound=ContextInputSchema.parse({...input,turns:[{role:"USER",text:"synthetic"}],currentTurn:0}),evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"location",operation:"SET",value:"PRIVATE_LOCATION_SENTINEL",evidence},{field:"endDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence}]});
 const before=JSON.stringify(canonical),wire=encodeFixtureV3(canonical,bound) as Record<string,{rank:number;change:{value:unknown;evidence:{primaryEvidence:string}}}>;
 for(const [root,rank] of [["locationChange",0],["endDateChange",1]] as const){expect((wire[root] as {rank:number}).rank).toBe(rank);expect(wire[root]).not.toHaveProperty("index");expect(wire[root].change.evidence.primaryEvidence).toBe("U0");expect(wire[root].change.evidence.primaryEvidence).not.toContain("synthetic");}
 expect(wire.locationChange.change.value).toBe("PRIVATE_LOCATION_SENTINEL");expect(wire.endDateChange.change.value).toBe(JSON.stringify({kind:"RELATIVE_DAY",offsetDays:2}));expect(JSON.stringify(canonical)).toBe(before);
});
it.each([{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},{kind:"RELATIVE_DAY",offsetDays:0},{kind:"WEEKDAY",weekday:1,qualifier:"UNRESOLVED"}])("wire48 canonical-only date JSON roundtrip (%#)",date=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CALENDAR_QUERY",query:{kind:"CALENDAR_DATE",date,outputCalendar:"GREGORIAN",evidence}});
 const raw=encodeGoogleLiteEuContextV3(canonical) as {query:{date:string}};
 expect(JSON.parse(raw.query.date)).toEqual(date);
 raw.query.date=JSON.stringify(date);
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
 raw.query.date=JSON.stringify({kind:"R",calendar:"NONE",day:0,month:0,year:0,leapMonth:-1,offsetDays:0,weekday:0,qualifier:"NONE"});
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("date representation preserves canonical relative negative zero without changing alternative JSON",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CALENDAR_QUERY",query:{kind:"CALENDAR_DATE",date:{kind:"RELATIVE_DAY",offsetDays:-0},outputCalendar:"GREGORIAN",evidence}});
 expect(parseGoogleLiteEuContextSectionsV3(encodeGoogleLiteEuContextV3(canonical),CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
});

it("wire48 dates are exact canonical JSON strings and reject duplicate decoded keys",()=>{
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]},changes:[{field:"eventDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:0},evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]}]});
 const raw=encodeGoogleLiteEuContextV3(canonical) as {eventDateChange:{change:{value:unknown}}};
 expect(typeof raw.eventDateChange.change.value).toBe("string");
 expect(JSON.parse(raw.eventDateChange.change.value as string)).toEqual({kind:"RELATIVE_DAY",offsetDays:0});
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
 for(const prefix of ['"kind":"RELATIVE_DAY",','"\\u006bind":"RELATIVE_DAY",']){
  const duplicate=structuredClone(raw);duplicate.eventDateChange.change.value=(raw.eventDateChange.change.value as string).replace("{","{"+prefix);
  expect(parseGoogleLiteEuContextSectionsV3(duplicate,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
 }
 const duplicateAfter=structuredClone(raw);duplicateAfter.eventDateChange.change.value=(raw.eventDateChange.change.value as string).replace(/}$/,',"kind":"RELATIVE_DAY"}');
 expect(parseGoogleLiteEuContextSectionsV3(duplicateAfter,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
 const lexical=structuredClone(raw);lexical.eventDateChange.change.value=" \n\t"+(raw.eventDateChange.change.value as string).replace('"kind"','"\\u006bind"').replace('"NONE"','"N\\u004fNE"')+"\r ";
 expect(parseGoogleLiteEuContextSectionsV3(lexical,CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
 for(const scalar of ["1e999","0.5","null","[]","{}",'"PRIVATE_DATE_SECRET"']){
  const bad=structuredClone(raw);bad.eventDateChange.change.value=(raw.eventDateChange.change.value as string).replace('"offsetDays":0',`"offsetDays":${scalar}`);
  const diagnostics:unknown[]=[];expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_DATE_SECRET");
 }
});
it.each([["{","JSON_PARSE","INVALID_JSON"],[" ".repeat(32769),"WIRE_VALUE","OVERSIZED"],['{"kind":"R","kind":"R"}',"WIRE_VALUE","INVALID_OPERAND"],['{"kind":{"private_secret":"PRIVATE_DATE_SECRET"}}',"WIRE_VALUE","INVALID_OPERAND"]])("date failure boundary retains finite stage/reason and field (%#)",(value,stage,reason)=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"endDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:0},evidence}]});
 const raw=encodeGoogleLiteEuContextV3(canonical) as {endDateChange:{change:{value:unknown}}};raw.endDateChange.change.value=value;const diagnostics:unknown[]=[];
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
 expect(diagnostics).toMatchObject([{issues:[{dateOperand:{stage,reason,field:"endDate"}}]}]);
 expect(JSON.stringify(diagnostics)).not.toMatch(/private_secret|PRIVATE_DATE_SECRET/);
});
it.each(["{", "[]", "null", '"PRIVATE_DATE_SECRET"', "true", "0", " ".repeat(32769), '{"kind":"R","offsetDays":1e999}', '{"kind":"R","kind":"W"}', '{"kind":"R","\\u006bind":"R"}', '{"kind":{"secret":"PRIVATE_DATE_SECRET"}}', '{"kind":"R","private_secret_key":[]}'])("wire47 flat date JSON failures retain no contents (%#)",value=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CALENDAR_QUERY",query:{kind:"CALENDAR_DATE",date:{kind:"RELATIVE_DAY",offsetDays:0},outputCalendar:"GREGORIAN",evidence}});
 const raw=encodeGoogleLiteEuContextV3(canonical) as {query:{date:unknown}};raw.query.date=value;const diagnostics:unknown[]=[];
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
 expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_DATE_SECRET|private_secret_key|1e999/);
});

it.each([undefined, {version:"generation-field-capability-15" as const,allowedNumericFields:[],allowedClockFields:["eventTime" as const,"reminderTime" as const],titlePresenceRequired:false,titleCorrectionAllowed:false,calendarProposalAllowed:true,notesProposalAllowed:true,reminderDateProposalAllowed:true,eventDateYearNullRequired:false}, {version:"generation-field-capability-15" as const,allowedNumericFields:[],allowedClockFields:[],titlePresenceRequired:true,titleCorrectionAllowed:false,calendarProposalAllowed:true,notesProposalAllowed:true,reminderDateProposalAllowed:true,eventDateYearNullRequired:false}])("outgoing string controls use supported enums without exposing encoded date tags (%#)", capability => {
  const schema=googleLiteEuContextWireSchema(capability).schema;
  let constants=0;const singletonValues:string[]=[];
  const walk=(value:unknown)=>{if(!value||typeof value!=="object")return;
    if(Array.isArray(value)){value.forEach(walk);return;}
    const node=value as Record<string,unknown>;
    if(typeof node.const==="string")constants++;
    if(Array.isArray(node.enum)&&node.enum.length===1&&typeof node.enum[0]==="string")singletonValues.push(node.enum[0]);
    Object.values(node).forEach(walk);
  };walk(schema);
  expect(constants).toBe(0);
  expect(singletonValues).toEqual(expect.arrayContaining(["title", "CLEAR"]));
  expect(JSON.stringify(schema)).toContain('"SET"');
  if (!capability) expect(JSON.stringify(schema)).toContain('"SET","REPLACE"');
  for (const tag of ["CIVIL_DATE", "RELATIVE_DAY", "WEEKDAY"]) expect(singletonValues).not.toContain(tag);
});
it.each([
  ["{","JSON_PARSE","INVALID_JSON"],
  ["x".repeat(32769),"WIRE_VALUE","OVERSIZED"],
  ['"PRIVATE_DATE_SENTINEL"',"CANONICAL_OPERAND","INVALID_OPERAND"],
  ['{"kind":"PRIVATE_KIND_SENTINEL","private_secret_key":1}',"CANONICAL_OPERAND","UNKNOWN_KIND"],
  ['{"kind":"RELATIVE_DAY"}',"CANONICAL_OPERAND","INVALID_OPERAND"],
  ['{"kind":"RELATIVE_DAY","offsetDays":"PRIVATE_DATE_SENTINEL"}',"CANONICAL_OPERAND","INVALID_OPERAND"],
  [JSON.stringify({kind:"RELATIVE_DAY",offsetDays:2,...Object.fromEntries(Array.from({length:70},(_,i)=>[`private_secret_key_${i}`,"PRIVATE_DATE_SENTINEL"]))}),"CANONICAL_OPERAND","INVALID_OPERAND"],
  ['{"kind":"RELATIVE_DAY","offsetDays":9999}',"CANONICAL_OPERAND","INVALID_OPERAND"],
  ['{"kind":"RELATIVE_DAY","offsetDays":2,"private_secret_key":1}',"CANONICAL_OPERAND","INVALID_OPERAND"],
])("obsolete opaque date strings reject without operand content (%#)",(value)=>{
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]},changes:[{field:"eventDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]}]});
  const raw=encodeGoogleLiteEuContextV3(canonical) as {eventDateChange:{change:{value:unknown}}};raw.eventDateChange.change.value=value;
  const diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
  expect((diagnostics[0] as {issues:Array<{path:unknown[]}>}).issues[0].path.slice(0,3)).toEqual(["changes",0,"value"]);
  const serialized=JSON.stringify(diagnostics);expect(serialized).not.toContain("PRIVATE_DATE_SENTINEL");expect(serialized).not.toContain("PRIVATE_KIND_SENTINEL");expect(serialized).not.toContain("private_secret_key");expect(serialized).not.toContain("9999");
});
it("non-string indexed date values still reject at the earlier carrier shape boundary",()=>{
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]},changes:[{field:"eventDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]}]});
  const raw=encodeGoogleLiteEuContextV3(canonical) as {eventDateChange:{change:{value:unknown}}};raw.eventDateChange.change.value={kind:"RELATIVE_DAY",offsetDays:2};
  const diagnostics:unknown[]=[];expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{expected:"FIELD_CHANGE",path:["eventDateChange","change"]}]}]);
});
it("structured date carrier has exact typed slots and rejects inactive semantic operands",()=>{
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]},changes:[{field:"eventDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]}]});
  const raw=encodeGoogleLiteEuContextV3(canonical) as {eventDateChange:{change:{value:string}}};
  const date=JSON.parse(raw.eventDateChange.change.value) as Record<string,unknown>;
 expect(date).toEqual({kind:"RELATIVE_DAY",offsetDays:2});
  expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");
  for(const value of [{...date,day:2},{...date,kind:"R"},{...date,offsetDays:null},"{"]){
    const mutated=structuredClone(raw);mutated.eventDateChange.change.value=typeof value==="string"?value:JSON.stringify(value);
    expect(parseGoogleLiteEuContextSectionsV3(mutated,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  }
});
it("encoded canonical date round trip preserves strict active payload authority", () => {
  const canonical = ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]},changes:[{field:"reminderDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]}]});
  const encoded=encodeGoogleLiteEuContextV3(canonical) as {reminderDateChange:{change:{value:unknown}}};
  expect(JSON.parse(encoded.reminderDateChange.change.value as unknown as string)).toEqual({kind:"RELATIVE_DAY",offsetDays:2});
  expect(parseGoogleLiteEuContextSectionsV3(encoded,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");
  for(const value of ['{"kind":"RELATIVE_DAY","offsetDays":null}','{"kind":"INVALID","offsetDays":2}','{"kind":"RELATIVE_DAY","offsetDays":2,"day":2}',"{",{kind:"RELATIVE_DAY",offsetDays:2}]) {
    const raw=structuredClone(encoded);raw.reminderDateChange.change.value=value;
    expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  }
  const decoded=parseGoogleLiteEuContextSectionsV3(encoded,CONTEXT_PROTOCOL_V3);
  expect(decoded).toMatchObject({status:"PARSED",value:{semantic:{changes:[{value:{kind:"RELATIVE_DAY",offsetDays:2}}]}}});
});
it.each([
 {kind:"CIVIL_DATE",calendar:"GREGORIAN",day:31,month:12,year:null,leapMonth:null},
 {kind:"CIVIL_DATE",calendar:"GREGORIAN",day:1,month:1,year:1,leapMonth:null},
 {kind:"CIVIL_DATE",calendar:"GREGORIAN",day:31,month:12,year:9999,leapMonth:null},
 {kind:"CIVIL_DATE",calendar:"LUNAR_VN",day:1,month:1,year:2027,leapMonth:true},
 {kind:"CIVIL_DATE",calendar:"LUNAR_VN",day:1,month:1,year:null,leapMonth:false},
 {kind:"CIVIL_DATE",calendar:"LUNAR_VN",day:31,month:12,year:null,leapMonth:null},
 {kind:"RELATIVE_DAY",offsetDays:-366},{kind:"RELATIVE_DAY",offsetDays:366},
 {kind:"RELATIVE_DAY",offsetDays:0},
 {kind:"WEEKDAY",weekday:1,qualifier:"THIS_WEEK"},{kind:"WEEKDAY",weekday:7,qualifier:"UNRESOLVED"},
 {kind:"WEEKDAY",weekday:4,qualifier:"NEXT_WEEK"},
])("structured date families preserve every change/query/alternative position (%#)",value=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 for(const field of ["eventDate","reminderDate","endDate"])for(const operation of ["SET","REPLACE","CLEAR"]){
   const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field,operation,value:operation==="CLEAR"?null:value,evidence}],uncertainties:[{field:"eventDate",reason:"AMBIGUOUS",alternatives:[{value,evidence}]}]});
   const wire=encodeGoogleLiteEuContextV3(canonical) as {uncertainties:Array<{alternatives:string[]}>};
   expect(JSON.parse(wire.uncertainties[0].alternatives[0])).toEqual({value,evidence:{primaryEvidence:JSON.stringify(evidence[0]),additionalEvidenceJson:"[]"}});
   expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
 }
 for(const query of [{kind:"CALENDAR_DATE",date:value,outputCalendar:"GREGORIAN",evidence},{kind:"LIST",period:{kind:"DAY",date:value},statusScope:"DEFAULT",evidence},{kind:"LIST",period:{kind:"DATE_BOUNDS",from:value,through:value},statusScope:"DEFAULT",evidence},{kind:"LIST",period:{kind:"DATE_BOUNDS",from:null,through:value},statusScope:"DEFAULT",evidence}]){
   const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:query.kind==="LIST"?"LIST_REMINDERS":"CALENDAR_QUERY",query,...("period" in query&&query.period?.kind==="DATE_BOUNDS"&&query.period.from===null?{uncertainties:[{field:"queryRange",reason:"MISSING",alternatives:[]}]}:{})});
   expect(parseGoogleLiteEuContextSectionsV3(encodeGoogleLiteEuContextV3(canonical),CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
 }
});
it("base and actual request share strict non-null date slots without eight nullable branches",()=>{
 for(const schema of [googleLiteEuContextWireSchema().schema,serializeContextRequest(input).response_format.json_schema.schema]){
  type DateNode={$ref?:string;anyOf?:DateNode[];properties?:Record<string,DateNode>};
  const root=schema.properties!.eventDateChange as unknown as DateNode;
  const d=root.anyOf![0].properties!.change.anyOf![0].properties!.value;
  expect(d.$ref?schema.$defs![d.$ref.slice(8)]:d).toEqual({type:"string"});
 }
});
it.each([
 [{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:1,month:1,year:null,leapMonth:null},{kind:"C",calendar:"GREGORIAN",day:1,month:1,year:0,leapMonth:-1,offsetDays:0,weekday:0,qualifier:"NONE"}],
 [{kind:"CIVIL_DATE",calendar:"LUNAR_VN",day:1,month:1,year:9999,leapMonth:false},{kind:"C",calendar:"LUNAR_VN",day:1,month:1,year:9999,leapMonth:0,offsetDays:0,weekday:0,qualifier:"NONE"}],
 [{kind:"CIVIL_DATE",calendar:"LUNAR_VN",day:31,month:12,year:null,leapMonth:true},{kind:"C",calendar:"LUNAR_VN",day:31,month:12,year:0,leapMonth:1,offsetDays:0,weekday:0,qualifier:"NONE"}],
 [{kind:"RELATIVE_DAY",offsetDays:0},{kind:"R",calendar:"NONE",day:0,month:0,year:0,leapMonth:-1,offsetDays:0,weekday:0,qualifier:"NONE"}],
 [{kind:"WEEKDAY",weekday:7,qualifier:"UNRESOLVED"},{kind:"W",calendar:"NONE",day:0,month:0,year:0,leapMonth:-1,offsetDays:0,weekday:7,qualifier:"UNRESOLVED"}],
])("canonical representation is bijective and old sentinel format refuses (%#)",(value,representation)=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventDate",operation:"SET",value,evidence}]});
 const wire=encodeGoogleLiteEuContextV3(canonical) as {eventDateChange:{change:{value:Record<string,unknown>}}};
 expect(JSON.parse(wire.eventDateChange.change.value as unknown as string)).toEqual(value);
 const parsed=parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3);expect(parsed).toEqual(parseInterpretationSectionsV3(canonical));
 if(parsed.status!=="PARSED")throw Error("EXPECTED_PARSED");
 expect(encodeGoogleLiteEuContextV3({...canonical,...parsed.value.semantic})).toEqual(wire);
 const forbidden=[representation,...Object.keys(value).filter(key=>!["year","leapMonth"].includes(key)).map(key=>({...value,[key]:null})),...Object.keys(value).map(key=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key))),{...value,day:0.5},{...value,leapMonth:2},{...value,year:10000},{...value,month:13},{...value,weekday:8},...(value.kind==="CIVIL_DATE"?[{...value,calendar:"NONE"},{...value,day:0},{...value,month:0},{...value,offsetDays:1},{...value,year:0},{...value,leapMonth:-1},...("calendar" in value&&value.calendar==="GREGORIAN"?[{...value,leapMonth:false},{...value,leapMonth:true}]:[])]:value.kind==="WEEKDAY"?[{...value,weekday:0},{...value,qualifier:"NONE"}]:[{...value,offsetDays:367},{...value,offsetDays:-367}])];
 for(const operand of forbidden){const bad=structuredClone(wire);bad.eventDateChange.change.value=JSON.stringify(operand).replace(/"(year|leapMonth)":0/g,(match,key)=>Object.is((operand as Record<string,unknown>)[key],-0)?`"${key}":-0`:match) as unknown as Record<string,unknown>;const before=JSON.stringify(bad);expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(JSON.stringify(bad)).toBe(before);}
});
it("all existing active date positions reject wrong sentinel values without erasure or private diagnostics",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],value={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 const specimens=[...["eventDate","reminderDate","endDate"].map(field=>ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field,operation:"REPLACE",value,evidence}]})),...[{kind:"CALENDAR_DATE",date:value,outputCalendar:"GREGORIAN",evidence},{kind:"LIST",period:{kind:"DAY",date:value},statusScope:"DEFAULT",evidence},{kind:"LIST",period:{kind:"DATE_BOUNDS",from:value,through:value},statusScope:"DEFAULT",evidence}].map(query=>ConversationInterpretationV3Schema.parse({...minimal,intent:query.kind==="LIST"?"LIST_REMINDERS":"CALENDAR_QUERY",query}))];
 for(const canonical of specimens){
  const wire=encodeGoogleLiteEuContextV3(canonical),encoded=JSON.stringify(wire);expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
  for(const replacement of ["NONE","PRIVATE_CALENDAR_SENTINEL"]){
   const mutated=JSON.parse(encoded.replaceAll('\\"calendar\\":\\"GREGORIAN\\"',`\\\"calendar\\\":\\\"${replacement}\\\"`)),before=JSON.stringify(mutated),diagnostics:unknown[]=[];
   expect(parseGoogleLiteEuContextSectionsV3(mutated,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");expect(JSON.stringify(mutated)).toBe(before);expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_CALENDAR_SENTINEL");
  }
 }
});
it.each([
 {kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},
 {kind:"RELATIVE_DAY",offsetDays:2}, {kind:"WEEKDAY",weekday:2,qualifier:"NEXT_WEEK"},
])("structured date inactive slots, unknown codes and private keys never become semantics (%#)",value=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventDate",operation:"SET",value,evidence}]});
 const wire=encodeGoogleLiteEuContextV3(canonical) as {eventDateChange:{change:{value:Record<string,unknown>}}},date=JSON.parse(wire.eventDateChange.change.value as unknown as string);
 const active=value.kind==="CIVIL_DATE"?["kind","calendar","day","month","year","leapMonth"]:value.kind==="RELATIVE_DAY"?["kind","offsetDays"]:["kind","weekday","qualifier"];
 const mutations=[...Object.keys(date).filter(key=>!active.includes(key)).map(key=>({...date,[key]:1})),{...date,kind:"PRIVATE_DATE_KIND_SENTINEL"},{...date,private_date_key:"PRIVATE_DATE_VALUE_SENTINEL"},Object.fromEntries(Object.entries(date).filter(([key])=>key!=="kind")),...(value.kind==="CIVIL_DATE"?[{...date,leapMonth:true}]:[])];
 for(const operand of mutations){const changed=structuredClone(wire);changed.eventDateChange.change.value=JSON.stringify(operand) as unknown as Record<string,unknown>;const diagnostics:unknown[]=[];
   expect(parseGoogleLiteEuContextSectionsV3(changed,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
   const text=JSON.stringify(diagnostics);for(const secret of ["PRIVATE_DATE_KIND_SENTINEL","PRIVATE_DATE_VALUE_SENTINEL","private_date_key"])expect(text).not.toContain(secret);
 }
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
});
it("compact date mapping never inspects inactive query date padding", () => {
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"LIST_REMINDERS",requestTarget:null,changes:[],query:{kind:"LIST",period:{kind:"MONTH",offset:0},statusScope:"DEFAULT",evidence:[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}]}});
  const raw=encodeGoogleLiteEuContextV3(canonical) as {query:{date:unknown;period:Record<string,unknown>}};
  raw.query.date={kind:"PRIVATE_PADDING",payload:"PRIVATE_SENTINEL"};raw.query.period.date={kind:"PRIVATE_PADDING"};raw.query.period.from={kind:"PRIVATE_PADDING"};raw.query.period.through={kind:"PRIVATE_PADDING"};
  const parsed=parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3);
  expect(parsed).toMatchObject({status:"PARSED",value:{semantic:{query:{kind:"LIST",period:{kind:"MONTH",offset:0}}}}});
  expect(JSON.stringify(parsed)).not.toContain("PRIVATE_");
});
import {isUnreconciledListInterpretation,readListTransport} from "../../../conversation/context-contract/list-period-transport";

const config = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
const input = ContextInputSchema.parse({ schemaVersion: "calenote-context-input-2", reference: { instant: "2026-09-28T03:00:00.000Z", localDate: "2026-09-28", timezone: "Asia/Ho_Chi_Minh" }, turns: [{ role: "USER", text: "synthetic" }], currentTurn: 0, activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [], capabilities: { version: "context-capabilities-1", supported: ["ONCE"], unsupported: ["YEARLY"], calendars: ["GREGORIAN"], limits: { dailyCount: 30, horizonDays: 366 } } });
const minimal = { schemaVersion: "calenote-context-3", intent: "HELP", requestTarget: null, changes: [], query: null, uncertainties: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
it("checkpoint62 distinguishes missing and obsolete uncertainty keys without changing refusal",()=>{
 const encoded=z.record(z.string(),z.unknown()).parse(encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(minimal)));
 for(const [item,keys] of [[{},[]],[{field:"reminderTime",reason:"MISSING",alternatives:[]},["reason","alternatives","field"]]] as const){
  const raw={...encoded,uncertainties:[item]};let diagnostic:unknown;
  expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,value=>{diagnostic=value;}).status).toBe("REFUSED");
  expect(diagnostic).toMatchObject({issues:[{path:["uncertainties",0,"fieldCode"],expected:"REQUIRED_PROPERTY",uncertaintyShape:{index:0,itemType:"object",keys,requiredKeys:{fieldCode:"MISSING"}}}]});
 }
 const valid={...encoded,uncertainties:[{fieldCode:6,reason:"MISSING",alternatives:[]}]};
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(valid,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");
 expect(()=>wireModule.decodeGoogleLiteEuContextTransportV3({...valid,uncertainties:[{}]},CONTEXT_PROTOCOL_V3,undefined,()=>{throw Error("PRIVATE_OBSERVER");})).not.toThrow();
});
it("checkpoint62 actual invalid controls and extras remain strict private refusals",()=>{
 const encoded=z.record(z.string(),z.unknown()).parse(encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(minimal)));
 for(const code of [null,"PRIVATE_CODE",0.5,16]){let diagnostic:unknown;expect(wireModule.decodeGoogleLiteEuContextTransportV3({...encoded,uncertainties:[{fieldCode:code,reason:"MISSING",alternatives:[]}]},CONTEXT_PROTOCOL_V3,undefined,value=>{diagnostic=value;}).status).toBe("REFUSED");expect(diagnostic).toMatchObject({issues:[{expected:"CONTROL_ENUM",uncertaintyShape:{index:0}}]});expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE_CODE");}
 let diagnostic:unknown;expect(wireModule.decodeGoogleLiteEuContextTransportV3({...encoded,uncertainties:[{fieldCode:6,reason:"MISSING",alternatives:[],PRIVATE_KEY:"PRIVATE_VALUE"}]},CONTEXT_PROTOCOL_V3,undefined,value=>{diagnostic=value;}).status).toBe("REFUSED");expect(diagnostic).toMatchObject({issues:[{classification:"extra",uncertaintyShape:{fieldCode:6,reason:"MISSING",unknownKeyCount:1}}]});expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE_KEY");expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE_VALUE");
});
it("wire59 carrier failures stay private and canonical alternative observers still distinguish malformed objects",()=>{
 const secret="PRIVATE_ALT_VALUE_DO_NOT_RETAIN",evidence=[{kind:"USER_QUOTE",turn:0,quote:secret,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,uncertainties:[{field:"frequency",reason:"AMBIGUOUS",alternatives:[{value:"DAILY",evidence}]}]});
 const raw=encodeGoogleLiteEuContextV3(canonical) as {uncertainties:Array<{alternatives:string[]}>};
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("PARSED");
 raw.uncertainties[0].alternatives[0]=JSON.stringify({value:"DAILY",evidence:{primaryEvidence:secret,additionalEvidenceJson:secret}});
 const diagnostics:unknown[]=[];
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,value=>{diagnostics.push(value);}).status).toBe("REFUSED");
 expect(JSON.stringify(diagnostics)).not.toContain(secret);
 diagnostics.length=0;
 const malformed={...canonical,uncertainties:[{field:"frequency",reason:"AMBIGUOUS",alternatives:[{value:"DAILY",evidence:{primaryEvidence:secret,additionalEvidenceJson:secret}}]}]};
 expect(parseInterpretationSectionsV3(malformed,value=>diagnostics.push(value)).status).toBe("REFUSED");
 expect(diagnostics[0]).toMatchObject({uncertaintyAlternatives:[{field:"frequency",fieldCode:8,reason:"AMBIGUOUS",valueType:"string",evidenceType:"object",evidenceKeys:["primaryEvidence","additionalEvidenceJson"]}]});
 expect(JSON.stringify(diagnostics)).not.toContain(secret);
 expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,()=>{throw Error(secret);}).status).toBe("REFUSED");
});
it("pointer throw metadata survives indexed restoration without inferring shifted raw operands",()=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_QUOTE_SENTINEL",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"notes",operation:"SET",value:"PRIVATE_VALUE_SENTINEL",evidence},{field:"reminderTime",operation:"REPLACE",value:{hour:9,minute:0,qualifier:"H24"},evidence}]});
  const raw=encodeGoogleLiteEuContextV3(canonical) as {requestTarget:{evidence:{primaryEvidence:string}};changes:Array<{change:{evidence:{primaryEvidence:string}}}>};
  raw.requestTarget.evidence.primaryEvidence="U0";raw.changes[0].change.evidence.primaryEvidence="U0";
  const diagnostics:unknown[]=[],before=JSON.stringify(raw);
  expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value),input).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["changes",1,"evidence","primaryEvidence"],expected:"EVIDENCE_SOURCE_POINTER",evidencePointer:{reason:"SOURCE_CODE_INVALID"}}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");expect(JSON.stringify(raw)).toBe(before);
});
it.each([
  [{kind:"USER_TURN",turn:0},"EVIDENCE_SOURCE_POINTER"],
  ["{PRIVATE_EVIDENCE_SENTINEL", "EVIDENCE_SOURCE_POINTER"],
  [JSON.stringify({kind:"USER_TURN",turn:11}),"EVIDENCE_SOURCE_POINTER"]
] as const)("actual evidence decode distinguishes finite primary failure %#",(primaryEvidence,expected)=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation:"SET",value:"PRIVATE_VALUE_SENTINEL",evidence}]});
  const raw=encodeGoogleLiteEuContextV3(canonical) as {requestTarget:{evidence:{primaryEvidence:string}};changes:Array<{change:{evidence:{primaryEvidence:unknown}}}>};
  raw.requestTarget.evidence.primaryEvidence="U0";
  raw.changes[0].change.evidence.primaryEvidence=primaryEvidence;
  const diagnostics:unknown[]=[],before=JSON.stringify(raw);
  expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value),input).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["changes",0,"evidence","primaryEvidence"],expected}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");expect(JSON.stringify(raw)).toBe(before);
});
it.each(["SET","REPLACE","CLEAR"])("wire51 location singleton preserves authored %s and strictly rejects bypass",operation=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"notes",operation:"SET",value:"literal",evidence},{field:"location",operation,value:operation==="CLEAR"?null:"PRIVATE_LOCATION_SENTINEL",evidence}]});
 const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>,carrier=wire.locationChange as {index:number;change:unknown};
 expect(carrier).toMatchObject({change:{field:"location",operation}});expect(wire.changes).toHaveLength(1);
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
 const missing={...wire};delete missing.locationChange;
 for(const raw of [missing,{...wire,locationChange:null,changes:[carrier.change]},{...wire,changes:[carrier.change]},...([null,-1,0.5,2] as const).map(index=>({...wire,locationChange:{...carrier,index}}))]){const before=JSON.stringify(raw);expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(JSON.stringify(raw)).toBe(before);}
});
it.each(["SET","REPLACE","CLEAR"])("endDate singleton preserves authored %s and rejects duplicate/bypass/invalid position",operation=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"notes",operation:"SET",value:"literal",evidence},{field:"endDate",operation,value:operation==="CLEAR"?null:{kind:"RELATIVE_DAY",offsetDays:2},evidence}]});
 const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>,carrier=wire.endDateChange as {index:number;change:unknown};
 expect(carrier).toMatchObject({change:{field:"endDate",operation}});expect(wire.changes).toHaveLength(1);
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
 const missing={...wire};delete missing.endDateChange;
 for(const raw of [missing,{...wire,endDateChange:null,changes:[carrier.change]},{...wire,changes:[carrier.change]},...([null,-1,0.5,2] as const).map(index=>({...wire,endDateChange:{...carrier,index}}))]){const before=JSON.stringify(raw);expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(JSON.stringify(raw)).toBe(before);}
});
it("endDate singleton malformed value fails carrier boundary and collisions retain privacy",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"title",operation:"SET",value:"literal",evidence},{field:"endDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence}]});
 const raw=encodeGoogleLiteEuContextV3(canonical) as {endDateChange:{index:number;change:{value:unknown}}};
 const malformed=structuredClone(raw);malformed.endDateChange.change.value=42;
 const diagnostics:unknown[]=[];expect(parseGoogleLiteEuContextSectionsV3(malformed,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
 expect(diagnostics).toMatchObject([{issues:[{path:["endDateChange","change"],expected:"FIELD_CHANGE"}]}]);
 const collision=structuredClone(raw);collision.endDateChange.index=0;expect(parseGoogleLiteEuContextSectionsV3(collision,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it.each(["SET","REPLACE","CLEAR"])("eventDate singleton preserves authored %s and rejects duplicate/bypass/invalid position",operation=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"notes",operation:"SET",value:"literal",evidence},{field:"eventDate",operation,value:operation==="CLEAR"?null:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},evidence}]});
 const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>,carrier=wire.eventDateChange as {index:number;change:unknown};
 expect(carrier).toMatchObject({change:{field:"eventDate",operation}});expect(wire.changes).toHaveLength(1);
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
 const missing={...wire};delete missing.eventDateChange;
 for(const raw of [missing,{...wire,eventDateChange:null,changes:[carrier.change]},{...wire,changes:[carrier.change]},...([null,-1,0.5,2] as const).map(index=>({...wire,eventDateChange:{...carrier,index}}))]){const before=JSON.stringify(raw);expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(JSON.stringify(raw)).toBe(before);}
});
it.each([
 {kind:"CIVIL_DATE",calendar:"LUNAR_VN",day:15,month:8,year:2026,leapMonth:false},
 {kind:"WEEKDAY",weekday:2,qualifier:"NEXT_WEEK"},
 {kind:"RELATIVE_DAY",offsetDays:-2}
])("eventDate singleton preserves date variant %# for SET and REPLACE",value=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 for(const kind of ["NEW","CURRENT"])for(const operation of ["SET","REPLACE"]){const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind,evidence},changes:[{field:"eventDate",operation,value,evidence}]});const raw=encodeGoogleLiteEuContextV3(canonical);expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});}
});
it.each(["frequency","occurrenceCount"])("numeric %s singleton preserves ALL operations and rejects bypass",field=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 for(const operation of ["SET","REPLACE","CLEAR"]){const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field,operation,value:operation==="CLEAR"?null:field==="frequency"?"DAILY":3,evidence}]});
 const raw=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>,root=field+"Change",carrier=raw[root] as {change:unknown};expect(carrier).toMatchObject({change:{field,operation}});expect(raw.changes).toEqual([]);
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
 const missing={...raw};delete missing[root];for(const bad of [missing,{...raw,[root]:null,changes:[carrier.change]},{...raw,changes:[carrier.change]},...[null,-1,0.5,1].map(index=>({...raw,[root]:{...carrier,index}}))]){const before=JSON.stringify(bad);expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(JSON.stringify(bad)).toBe(before);}
 }
});
it.each(["SET","REPLACE","CLEAR"])("eventRelation singleton preserves authored %s and rejects bypass",operation=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"eventRelation",operation,value:operation==="CLEAR"?null:"INCLUDING_EVENT",evidence}]});
 const raw=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;expect(raw.eventRelationChange).toMatchObject({change:{field:"eventRelation",operation}});expect(raw.changes).toEqual([]);
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
 const carrier=raw.eventRelationChange as {change:unknown},missing={...raw};delete missing.eventRelationChange;
 for(const bad of [missing,{...raw,eventRelationChange:null,changes:[carrier.change]},{...raw,changes:[carrier.change]},...[null,-1,0.5,1].map(index=>({...raw,eventRelationChange:{...carrier,index}}))]){const before=JSON.stringify(bad);expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(JSON.stringify(bad)).toBe(before);}
});
it.each(["SET","REPLACE","CLEAR"])("eventTime singleton preserves %s and rejects ordinary bypass",operation=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"eventTime",operation,value:operation==="CLEAR"?null:{hour:8,minute:30,qualifier:"H24"},evidence}]});
 const raw=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;expect(raw.eventTimeChange).toMatchObject({change:{field:"eventTime",operation}});expect(raw.changes).toEqual([]);
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
 const carrier=raw.eventTimeChange as {change:unknown},missing={...raw};delete missing.eventTimeChange;
 for(const bad of [missing,{...raw,eventTimeChange:null,changes:[carrier.change]},{...raw,changes:[carrier.change]},...[null,-1,0.5,1].map(index=>({...raw,eventTimeChange:{...carrier,index}}))]){const before=JSON.stringify(bad);expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(JSON.stringify(bad)).toBe(before);}
});
it("eventDate is required nullable root and unavailable in all ordinary branches",()=>{
 const schema=googleLiteEuContextWireSchema().schema as unknown as {required:string[];properties:Record<string,unknown>;$defs:Record<string,unknown>};
 expect(schema.required).toContain("eventDateChange");expect(schema.properties.eventDateChange).toHaveProperty("anyOf");
 const changes=schema.properties.changes as {items:{properties:{change:{$ref?:string}}}};const inner=changes.items.properties.change,item=inner.$ref?schema.$defs[inner.$ref.split("/").at(-1)!]:inner;
 const fields:string[]=[];const walk=(value:unknown)=>{if(!value||typeof value!=="object")return;const node=value as {properties?:{field?:{enum?:string[];const?:string}}};fields.push(...(node.properties?.field?.enum??(node.properties?.field?.const?[node.properties.field.const]:[])));Object.values(value).forEach(walk);};walk(item);expect(fields).not.toContain("eventDate");
});
it.each(["NEW","CURRENT"].flatMap(kind=>["SET","REPLACE","CLEAR"].map(operation=>({kind,operation}))))("ten carrier restoration preserves global order for $kind/title $operation",({kind,operation})=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const fields=[{field:"eventDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence},{field:"reminderTime",operation:"SET",value:{hour:8,minute:0,qualifier:"H24"},evidence},{field:"eventTime",operation:"REPLACE",value:{hour:9,minute:30,qualifier:"H24"},evidence},{field:"frequency",operation:"REPLACE",value:"DAILY",evidence},{field:"eventRelation",operation:"REPLACE",value:"STARTING_ON",evidence},{field:"endDate",operation:"SET",value:{kind:"WEEKDAY",weekday:1,qualifier:"THIS_WEEK"},evidence},{field:"notes",operation:"SET",value:"literal",evidence},{field:"location",operation:"REPLACE",value:"literal venue",evidence},{field:"title",operation:"SET",value:"literal",evidence},{field:"occurrenceCount",operation:"CLEAR",value:null,evidence},{field:"reminderDate",operation:"CLEAR",value:null,evidence}];
 const title=fields.find(change=>change.field==="title")!;title.operation=operation;title.value=operation==="CLEAR"?null:"literal";
 for(let rotation=0;rotation<fields.length;rotation++){const changes=[...fields.slice(rotation),...fields.slice(0,rotation)],canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind,evidence},changes}),wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;expect(wire.eventDateChange).toBeTruthy();expect(wire.changes).toHaveLength(1);expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});}
});
it.each(["NEW","CURRENT"])("three indexed carriers restore original global positions for %s",kind=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind,evidence},changes:[
    {field:"reminderTime",operation:"SET",value:{hour:8,minute:30,qualifier:"H24"},evidence},
    {field:"notes",operation:"SET",value:"literal",evidence},
    {field:"title",operation:"SET",value:"literal",evidence},
    {field:"reminderDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence}
  ]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {reminderTimeChange:unknown;titleChange:{index:number};reminderDateChange:{index:number};changes:unknown[]};
  expect(wire.reminderTimeChange).toMatchObject({change:{field:"reminderTime",operation:"SET"}});
  expect(wire.reminderTimeChange).toMatchObject({rank:0});expect(wire.changes).toMatchObject([{rank:1}]);expect(wire.titleChange).toMatchObject({rank:2});expect(wire.reminderDateChange).toMatchObject({rank:3});
  expect(wire.changes).toHaveLength(1);
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
});
it.each(["SET","REPLACE","CLEAR"])("reminder singleton %s preserves literal values and rejects carrier bypass without mutation",operation=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[
    {field:"reminderDate",operation,value:operation==="CLEAR"?null:{kind:"RELATIVE_DAY",offsetDays:2},evidence},
    {field:"reminderTime",operation,value:operation==="CLEAR"?null:{hour:8,minute:30,qualifier:"H24"},evidence}
  ]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
  for(const root of ["reminderDateChange","reminderTimeChange"]){
    const carrier=wire[root] as {index:number;change:unknown};
    const variants=[{...wire,[root]:null,changes:[carrier.change]}, {...wire,changes:[carrier.change]}, {...wire,[root]:{...carrier,index:null}}, {...wire,[root]:{...carrier,index:2}}, {...wire,[root]:{...carrier,index:0.5}}, {...wire,[root]:{...carrier,index:-1}}];
    const missing={...wire};delete missing[root];variants.push(missing);
    for(const raw of variants){const before=JSON.stringify(raw);expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");expect(JSON.stringify(raw)).toBe(before);}
  }
  const collision={...wire,reminderTimeChange:{...(wire.reminderTimeChange as object),index:0}};
  expect(parseGoogleLiteEuContextSectionsV3(collision,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("reminder singleton roots exclude every ordinary reminder field branch",()=>{
  type Node={required:string[];properties:Record<string,Node>;anyOf:Node[];enum:string[];$ref:string;$defs:Record<string,Node>;items:Node};
  const schema=googleLiteEuContextWireSchema().schema as unknown as Node;
  expect(schema.required).toEqual(expect.arrayContaining(["reminderDateChange","reminderTimeChange"]));
  for(const field of ["reminderDate","reminderTime"]){
    expect(schema.properties[field+"Change"].anyOf).toHaveLength(2);
    const walk=(value:unknown):string[]=>{if(!value||typeof value!=="object")return [];const node=value as Node;return [...(node.properties?.field?.enum??[]),...Object.values(value).flatMap(walk)];};
    const item=schema.properties.changes.items;
    expect(walk(item.$ref?schema.$defs[item.$ref.split("/").pop()!]:item)).not.toContain(field);
  }
});
it.each([[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]])("global original positions preserve carrier permutation %j and nullable combinations",(...order)=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
  const carriers=[{field:"title",operation:"SET",value:"literal",evidence},{field:"reminderDate",operation:"SET",value:{kind:"RELATIVE_DAY",offsetDays:2},evidence},{field:"reminderTime",operation:"SET",value:{hour:8,minute:30,qualifier:"H24"},evidence}];
  for(let mask=0;mask<8;mask++){
    const changes=[{field:"notes",operation:"SET",value:"first",evidence},...order.filter(index=>mask&(1<<index)).map(index=>carriers[index]),{field:"location",operation:"SET",value:"last",evidence}];
    const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes});
    const wire=encodeGoogleLiteEuContextV3(canonical);
    expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
  }
});
it("reminder clock carrier is null-only when no clock capability exists",()=>{
  const schema=googleLiteEuContextWireSchema({version:"generation-field-capability-15",allowedNumericFields:[],allowedClockFields:[],titlePresenceRequired:false,titleCorrectionAllowed:false,calendarProposalAllowed:true,notesProposalAllowed:true,reminderDateProposalAllowed:true,eventDateYearNullRequired:false}).schema as unknown as {properties:{reminderTimeChange:unknown;reminderDateChange:unknown}};
  expect(schema.properties.reminderTimeChange).toEqual({type:"null"});
  expect(schema.properties.reminderDateChange).toHaveProperty("anyOf");
});
it.each([[0,"COLLISION"],[2,"OUT_OF_RANGE"]] as const)("actual decoder preserves refusal and projects carrier %s/%s structure",(index,reason)=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_EVIDENCE",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"reminderDate",operation:"CLEAR",value:null,evidence},{field:"reminderTime",operation:"CLEAR",value:null,evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;
  wire.reminderTimeChange={...(wire.reminderTimeChange as object),index};
  const before=JSON.stringify(wire),diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");
  expect(reason).toMatch(/COLLISION|OUT_OF_RANGE/);expect(diagnostics).toMatchObject([{issues:[{path:["reminderTimeChange"],classification:"extra",extraKeyCount:1}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");expect(JSON.stringify(wire)).toBe(before);
});
it.each(["reminderDate","reminderTime","eventDate","eventTime","eventRelation","frequency","occurrenceCount"])("malformed %s carrier diagnostics expose known paths, not private authored values",field=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field,operation:"CLEAR",value:null,evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>,root=field+"Change";
  wire[root]={...(wire[root] as object),change:{field:"PRIVATE_FIELD_SENTINEL",operation:"PRIVATE_OPERATION_SENTINEL",value:"PRIVATE_VALUE_SENTINEL",evidence:"PRIVATE_EVIDENCE_SENTINEL"}};
  const diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:[root,"change","field"],classification:"value",unknownPathSegments:0}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
});
it("indexed title carrier preserves literal evidence and original change order",()=>{
  const ref={kind:"USER_QUOTE",turn:0,quote:"đi thi",occurrence:1};
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[ref]},changes:[{field:"notes",operation:"SET",value:"literal",evidence:[ref]},{field:"title",operation:"SET",value:"đi thi",evidence:[ref]}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{index:number;change:unknown};changes:unknown[]};
  expect(wire.titleChange).toMatchObject({change:{field:"title",operation:"SET",value:"đi thi"}});
  expect(wire.changes).toHaveLength(1);
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
  for(const index of [-1,3,0.5]) expect(parseGoogleLiteEuContextSectionsV3({...wire,titleChange:{...wire.titleChange,index}},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  expect(parseGoogleLiteEuContextSectionsV3({...wire,changes:[...wire.changes,wire.titleChange.change]},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  const absent:Partial<typeof wire>={...wire};delete absent.titleChange;
  expect(parseGoogleLiteEuContextSectionsV3(absent,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("duplicate title ownership reproduces the sanitized live root-object failure without repair",()=>{
  const ref={kind:"USER_QUOTE",turn:0,quote:"đi thi",occurrence:1};
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[ref]},changes:[{field:"title",operation:"SET",value:"đi thi",evidence:[ref]}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:unknown};changes:unknown[]};
  wire.changes.push({rank:1,change:wire.titleChange.change});
  const before=JSON.stringify(wire),diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["titleChange"],code:"WIRE_SHAPE_INVALID",actualType:"object",classification:"value",unknownPathSegments:0}]}]);
  expect(JSON.stringify(wire)).toBe(before);
});
it("title SET cannot bypass its carrier on a non-obligated turn",()=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"literal",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"literal",evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:unknown}|null;changes:unknown[]};
  const authored=wire.titleChange!.change;wire.titleChange=null;wire.changes=[authored];
  const before=JSON.stringify(wire);
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  expect(JSON.stringify(wire)).toBe(before);
});
it.each(["SET","REPLACE","CLEAR",undefined,"PRIVATE_OPERATION_SENTINEL"])("duplicate-title diagnostics preserve safe independent operation metadata: %s",operation=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_EVIDENCE_SENTINEL",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"PRIVATE_VALUE_SENTINEL",evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:Record<string,unknown>};changes:unknown[]};
  wire.changes.push({rank:1,change:{...wire.titleChange.change,operation}});
  const before=JSON.stringify(wire),diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{expected:"UNIQUE_TITLE_OWNER",titleOwnership:{ordinaryCount:1,carrierOperation:{actualSafeToken:"SET"},ordinaryOperations:[{index:0,actualType:operation===undefined?"undefined":"string",...(operation&&["SET","REPLACE","CLEAR"].includes(operation)?{actualSafeToken:operation}:{})}],truncated:false}}]}]);
  if(operation==="PRIVATE_OPERATION_SENTINEL")expect(diagnostics).toMatchObject([{issues:[{titleOwnership:{ordinaryOperations:[{actualDigest:createHash("sha256").update(operation).digest("hex"),actualLength:operation.length}]}}]}]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
  expect(JSON.stringify(wire)).toBe(before);
});
it("duplicate title metadata is bounded independently of hostile ordinary change cardinality",()=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_EVIDENCE_SENTINEL",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"PRIVATE_VALUE_SENTINEL",evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:{change:unknown};changes:unknown[]};
  wire.changes=Array.from({length:20},(_,index)=>({rank:index+1,change:wire.titleChange.change}));
  const diagnostics:unknown[]=[];
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,value=>diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["changes"],expected:"array"}]}]);
  // Historical bounded ownership projection stays available; current rank wire
  // rejects impossible >13 membership before reaching duplicate-title checks.
  expect(projectWireValidation(wire,["titleChange"],"UNIQUE_TITLE_OWNER",undefined,"calenote-context-3")).toMatchObject({issues:[{titleOwnership:{ordinaryCount:20,ordinaryOperations:Array.from({length:8},(_,index)=>({index,actualSafeToken:"SET"})),truncated:true}}]});
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
});
it.each(["REPLACE","CLEAR"] as const)("non-obligated title %s remains exactly reversible",operation=>{
  const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:"sửa tiêu đề",occurrence:1}];
  const canonical=ConversationInterpretationV3Schema.parse({...minimal,intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"title",operation,value:operation==="CLEAR"?null:"khác",evidence}]});
  const wire=encodeGoogleLiteEuContextV3(canonical) as {titleChange:unknown};
  expect(wire.titleChange).toMatchObject({change:{field:"title",operation,value:operation==="CLEAR"?null:"khác"}});
  expect((wire as {changes?:unknown[]}).changes).toEqual([]);
  expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});
});
it.each([
  [JSON.stringify({ evidence: { ref: "PRIVATE_TARGET" } }), "object"],
  ["PRIVATE_TARGET", "INVALID_JSON"],
  ["null", "null"],
] as const)("rejects string requestTarget without materializing it while retaining safe type (%#)", (target, embeddedJsonType) => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", conversationDirective: null, requestTarget: { kind: "CURRENT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as Record<string, unknown>;
  const diagnostics: unknown[] = [];
  wire.requestTarget = target;
  expect(parseGoogleLiteEuContextSectionsV3(wire, CONTEXT_PROTOCOL_V3, undefined, value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" });
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["requestTarget"], expected: "object", actualType: "string", embeddedJsonType }] }]);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_TARGET");
});
it.each(["CURRENT", "NEW", "UNRESOLVED"])("misplaced finite target %s is diagnosed but never accepted", target => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", conversationDirective: null, requestTarget: { kind: "CURRENT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as Record<string, unknown>;
  wire.requestTarget = target;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, CONTEXT_PROTOCOL_V3, undefined, value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" });
  expect(diagnostics).toMatchObject([{ issues: [{ expected: "object", actualType: "string", actualSafeToken: target }] }]);
});
it("a properly encoded CURRENT evidence carrier round-trips without a target string", () => {
  const canonical = ConversationInterpretationV3Schema.parse({ ...minimal, intent: "CREATE_REMINDER", conversationDirective: null, requestTarget: { kind: "CURRENT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 }] } });
  const wire = encodeGoogleLiteEuContextV3(canonical) as Record<string, unknown>;
  expect(wire.requestTarget).toEqual({ evidence: { primaryEvidence: '{"kind":"USER_QUOTE","turn":0,"quote":"synthetic","occurrence":1}', additionalEvidenceJson: "[]" } });
  expect(wire.operationCode).toBe("0");
  expect(parseGoogleLiteEuContextSectionsV3(wire, CONTEXT_PROTOCOL_V3)).toMatchObject({ status: "PARSED", value: { semantic: { requestTarget: canonical.requestTarget } } });
});
const successorWire = wireModule;
const selectedV3 = CONTEXT_PROTOCOL_V3;
const v3Help = { schemaVersion: "calenote-context-3", intent: "HELP", requestTarget: null, changes: [], query: null, uncertainties: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
it.each([["reason", "MISSING"], ["field", "INVALID_FIELD"]])("diagnoses invalid %s in the selected valid directive branch, not its valid kind", (key, token) => {
  const wire = encodeGoogleLiteEuContextV3({ ...v3Help, conversationDirective: {kind:"ASK_FOR_DISAMBIGUATION",field:"title",reason:"AMBIGUOUS"} } as never) as {conversationDirective:Record<string,unknown>};
  wire.conversationDirective[key] = token;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value=>diagnostics.push(value)).status).toBe("PARSED");
  expect(diagnostics).toMatchObject([{issues:[{path:["conversationDirective",key],constraint:"CONTROL_ENUM",actualDigest:createHash("sha256").update(token).digest("hex") }]}]);
});
it.each(["THIS_MONTH", "private title location secret", "A".repeat(1000)])("retains only safe finite-control diagnostics (%#)", token => {
  const canonical = { ...v3Help, intent: "LIST_REMINDERS", conversationDirective: null, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "private", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as { query: { period: { kind: string } } };
  wire.query.period.kind = token;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["query", "period", "kind"], constraint: "CONTROL_ENUM", acceptedDomainId: expect.stringMatching(/^CONTROL_DOMAIN_SHA256:/), acceptedValueCount: 8, actualType: "string", actualLength: token.length, actualDigest: createHash("sha256").update(token).digest("hex") }] }]);
  if (token === "THIS_MONTH") expect(diagnostics).toMatchObject([{ issues: [{ actualSafeToken: token }] }]);
  else { expect(JSON.stringify(diagnostics)).not.toContain(token); expect(diagnostics).toMatchObject([{ issues: [expect.not.objectContaining({ actualSafeToken: expect.anything() })] }]); }
});
it("diagnoses another finite control domain without changing valid decoding", () => {
  const wire = encodeGoogleLiteEuContextV3(v3Help as never) as Record<string, unknown>;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("PARSED");
  expect(diagnostics).toEqual([]);
  wire.operationCode = 12;
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["operationCode"], constraint: "CONTROL_ENUM", acceptedValueCount: 12 }] }]);
});
it("accepts valid MONTH without diagnostic capture", () => {
  const canonical = { ...v3Help, intent: "LIST_REMINDERS", conversationDirective: null, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "private", occurrence: 1 }] } };
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(encodeGoogleLiteEuContextV3(canonical as never), selectedV3, undefined, value => diagnostics.push(value)).status).toBe("PARSED");
  expect(diagnostics).toEqual([]);
});
it.each(["SECRET VALUE", "SECRET\nVALUE", "âm_lịch", "TOKEN@EMAIL.COM", "x".repeat(49)])("does not retain unsafe control strings in scalar enums (%#)", token => {
  const wire = encodeGoogleLiteEuContextV3(v3Help as never) as Record<string, unknown>;
  wire.operationCode = token;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(JSON.stringify(diagnostics)).not.toContain(token);
  expect(diagnostics).toMatchObject([{ issues: [{ constraint: "CONTROL_ENUM", actualLength: token.length, actualDigest: createHash("sha256").update(token).digest("hex") }] }]);
});
it("diagnoses invalid compact control code without retaining arbitrary values", () => {
  const wire = encodeGoogleLiteEuContextV3(v3Help as never) as Record<string, unknown>;
  wire.uncertainties = [{ fieldCode: "BAD_CODE", reason: "private reason", alternatives: [] }];
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["uncertainties", 0, "fieldCode"], constraint: "CONTROL_ENUM", actualType:"string", acceptedValueCount: 16 }] }]);
  expect(JSON.stringify(diagnostics)).not.toContain("BAD_CODE");
  expect(JSON.stringify(diagnostics)).not.toContain("private reason");
});
it.each(["primaryEvidence", "additionalEvidenceJson"] as const)("retains decoded control type and structural path inside %s", slot => {
  const canonical = { ...v3Help, intent: "LIST_REMINDERS", conversationDirective: null, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "private", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as { query: { evidence: { primaryEvidence: string; additionalEvidenceJson: string } } };
  if (slot === "primaryEvidence") wire.query.evidence.primaryEvidence = JSON.stringify({...JSON.parse(wire.query.evidence.primaryEvidence),kind:"BAD_EVIDENCE_KIND"});
  else wire.query.evidence.additionalEvidenceJson = JSON.stringify([{ kind: "BAD_EVIDENCE_KIND", turn: 0, quote: "private", occurrence: 1, ref: null }]);
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["query", "evidence", slot, ...(slot === "additionalEvidenceJson" ? [0] : []), "kind"], classification: "value", actualType: "string", actualSafeToken: "BAD_EVIDENCE_KIND" }] }]);
  expect(JSON.stringify(diagnostics)).not.toContain("private");
});
it("observes decoded canonical target before a conditional constraint rejects the envelope", () => {
  const canonical = { ...v3Help, intent: "AMBIGUOUS", requestTarget:{kind:"CURRENT",evidence:[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_QUERY",occurrence:1}]},conversationDirective:null,uncertainties:[{field:"operation",reason:"AMBIGUOUS",alternatives:[]}] };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as Record<string, unknown>;
  wire.uncertainties = [];
  let observed: unknown;
  const parse = parseGoogleLiteEuContextSectionsV3 as unknown as (raw: unknown, protocol: typeof CONTEXT_PROTOCOL_V3, invalid: undefined, wireInvalid: undefined, decoded: (value: unknown) => void) => { status: string };
  expect(parse(wire, CONTEXT_PROTOCOL_V3, undefined, undefined, value => { observed = value; }).status).toBe("REFUSED");
  expect(observed).toMatchObject({ intent: "AMBIGUOUS", requestTarget: {kind:"CURRENT"},uncertainties:[] });
  expect(parse(wire, CONTEXT_PROTOCOL_V3, undefined, undefined, () => { throw Error("diagnostic observer failure"); }).status).toBe("REFUSED");
  expect(parse(wire, CONTEXT_PROTOCOL_V3, undefined, undefined, value => { (value as { intent: string }).intent = "CREATE_REMINDER"; }).status).toBe("REFUSED");
});
it.each([
  [42, "number"], [null, "null"], [["SENSITIVE_PRIVATE_VALUE"], "array"], ["SENSITIVE_PRIVATE_VALUE".repeat(10000), "string"], [false, "boolean"],
] as const)("selected primitive envelope diagnostics remain bounded and private (case %#)", (raw, actualType) => {
  const diagnostics: unknown[] = [], canonical: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(raw, CONTEXT_PROTOCOL_V3, value => canonical.push(value), value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "ENVELOPE_INVALID" });
  expect(canonical).toEqual([]);
  expect(diagnostics).toEqual([{ schemaVersion: "calenote-context-3", issues: [{ path: [], code: "WIRE_SHAPE_INVALID", expected: "object", actualType, classification: "value", unknownPathSegments: 0 }], topLevelKeys: [], unknownTopLevelKeyCount: 0, truncated: false }]);
  expect(JSON.stringify(diagnostics)).not.toContain("SENSITIVE_PRIVATE_VALUE");
  expect(JSON.stringify(diagnostics).length).toBeLessThan(400);
});
it("invalid application protocol selection does not produce raw-envelope diagnostics", () => {
  const diagnostics: unknown[] = [];
  const wrong = { ...CONTEXT_PROTOCOL_V3, canonicalVersion: "calenote-context-2" } as unknown as typeof CONTEXT_PROTOCOL_V3;
  expect(parseGoogleLiteEuContextSectionsV3(42, wrong, value => diagnostics.push(value), value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "ENVELOPE_INVALID" });
  expect(diagnostics).toEqual([]);
});
function v3Wire() { expect(successorWire.googleLiteEuContextWireSchemaV3).toBeDefined(); return successorWire.googleLiteEuContextWireSchemaV3(); }
it("new_wire_has_no_dialogue_or_owned_metadata", () => {
  const schema = v3Wire().schema;
  const text = JSON.stringify(schema);
  for (const key of ["dialogueAct", "continuation", "controlEvidence", "schemaVersion", "PRESENT_PREVIEW", "ANSWER_QUERY"]) expect(text).not.toContain(`\"${key}\"`);
  expect(schema.properties).toHaveProperty("requestTarget");
});
it("invalid_active_discriminator_rejects", () => {
  v3Wire();
  const wire = successorWire.encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(v3Help)) as Record<string, unknown>;
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, intent: "INVALID" }, selectedV3)).toMatchObject({ status: "REFUSED" });
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, { ...selectedV3, canonicalVersion: "calenote-context-2" } as unknown as typeof selectedV3)).toMatchObject({ status: "REFUSED" });
});
it("encoded_date_contains_only_canonical_active_keys", () => {
  v3Wire();
  const value = { ...v3Help, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "new", occurrence: 1 }] }, changes: [{ field: "eventDate", operation: "SET", value: { kind: "RELATIVE_DAY", offsetDays: 1 }, evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "new", occurrence: 1 }] }] };
  const wire = successorWire.encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(value)) as { eventDateChange: {change:{ value: string }} };
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, selectedV3)).toMatchObject({ status: "PARSED", value: { semantic: { changes: value.changes } } });
  wire.eventDateChange.change.value=JSON.stringify({...value.changes[0].value,year:{malicious:true}});
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, selectedV3)).toMatchObject({ status: "REFUSED" });
  wire.eventDateChange.change.value=JSON.stringify({...value.changes[0].value,unknown:true});
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, selectedV3)).toMatchObject({ status: "REFUSED" });
});
it("isolated_wire_guidance_failure_keeps_core_and_reports_full_failure", () => {
  const wire = successorWire.encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(v3Help)) as Record<string, unknown>;
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, conversationDirective: { kind: "HELP", topic: "GENERAL" } }, selectedV3)).toMatchObject({ status: "PARSED", value: { directive: { status: "INVALID" }, fullSchemaValid: false } });
  const withoutGuidance = Object.fromEntries(Object.entries(wire).filter(([key]) => !["conversationDirective", "replyProposal"].includes(key)));
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(withoutGuidance, selectedV3)).toMatchObject({ status: "PARSED", value: { directive: { status: "INVALID" }, reply: { status: "INVALID" }, fullSchemaValid: false } });
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, conversationDirective: { kind: "INVALID" }, replyProposal: { text: "valid independent wording" } }, selectedV3)).toMatchObject({ status: "PARSED", value: { directive: { status: "INVALID" }, reply: { status: "VALID" }, fullSchemaValid: false } });
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, extra: true }, selectedV3)).toMatchObject({ status: "REFUSED" });
});
const quote = { kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 };
const evidence = [quote, { kind: "CONTEXT_FACT", ref: "f1" }, quote];
const civil = { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 31, month: 12, year: 9999, leapMonth: null };
const clock = { hour: 23, minute: 59, qualifier: "H24" };
const values = { title: "t".repeat(1800), location: "l".repeat(300), notes: "n".repeat(2000), eventDate: civil, eventTime: clock, reminderDate: { kind: "RELATIVE_DAY", offsetDays: -366 }, reminderTime: clock, calendar: "LUNAR_VN", frequency: "DAILY", occurrenceCount: Number.MAX_SAFE_INTEGER, eventRelation: "BEFORE_EVENT", leadOffsetDays: Number.MAX_SAFE_INTEGER, endDate: { kind: "WEEKDAY", weekday: 7, qualifier: "NEXT_WEEK" } };
it.each(Object.entries({...values,intent:"HELP",operation:"CURRENT",queryRange:{kind:"DATE_BOUNDS",from:civil,through:civil}}))("wire59 carrier preserves canonical alternative value family %s",(field,value)=>{
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,...(field==="operation"?{intent:"AMBIGUOUS",requestTarget:{kind:"UNRESOLVED",evidence:[quote]}}:{}),uncertainties:[{field,reason:"UNSUPPORTED_COMBINATION",alternatives:[{value,evidence:[quote,quote,quote]}]}]});
 const raw=encodeFixtureV3(canonical,input);
 const result=wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,input);
 expect(result).toMatchObject({status:"PARSED",value:{semantic:{uncertainties:canonical.uncertainties}}});
 expect(parseGoogleLiteEuContextSectionsV3(encodeGoogleLiteEuContextV3(canonical),CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
});
it("wire59 alternative strict carrier rejects old syntax, malformed counts and private controls atomically",()=>{
 const canonical=ConversationInterpretationV3Schema.parse({...minimal,uncertainties:[{field:"title",reason:"UNSUPPORTED_COMBINATION",alternatives:[{value:"synthetic",evidence:[quote]}]}]});
 const base=encodeFixtureV3(canonical,input) as {uncertainties:Array<{alternatives:string[]}>};
 const valid={primaryEvidence:"U0",additionalEvidenceJson:"[]"};
 for(const invalid of [[quote],null,{},"U0",{...valid,primaryEvidence:JSON.stringify({kind:"USER_TURN",turn:0})},{...valid,primaryEvidence:"U00"},{...valid,primaryEvidence:"u0"},{...valid,primaryEvidence:" U0"},{...valid,primaryEvidence:0},{...valid,primaryEvidence:null},{...valid,primaryEvidence:"U1"},{...valid,primaryEvidence:"S0.0"},{...valid,primaryEvidence:"Ff999"},{...valid,primaryEvidence:"PRIVATE_CODE"},{...valid,additionalEvidenceJson:JSON.stringify([quote,quote,quote])},{...valid,additionalEvidenceJson:"{}"},{...valid,additionalEvidenceJson:"["},{...valid,additionalEvidenceJson:"x".repeat(32769)},{primaryEvidence:"U0"},{...valid,PRIVATE_KEY:"PRIVATE_VALUE"}]){
  const raw=structuredClone(base);raw.uncertainties[0].alternatives=[JSON.stringify({value:"synthetic",evidence:invalid})];const diagnostics:unknown[]=[];
  expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,d=>diagnostics.push(d),d=>diagnostics.push(d),input).status).toBe("REFUSED");
  expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_CODE|PRIVATE_KEY|PRIVATE_VALUE/);
 }
 for(const text of ["{","null","[]",JSON.stringify({value:"synthetic",evidence:valid,PRIVATE_KEY:"PRIVATE_VALUE"}),JSON.stringify({evidence:valid}),"x".repeat(32769)]){
  const raw=structuredClone(base);raw.uncertainties[0].alternatives=[text];expect(wireModule.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,input).status).toBe("REFUSED");
 }
});
// Independent, hand-specified wire layout; never calls a production encoder.
const pads: Record<string, string[]> = { USER_QUOTE: ["ref"], CONTEXT_FACT: ["turn", "quote", "occurrence"], CIVIL_DATE: ["offsetDays", "weekday", "qualifier"], RELATIVE_DAY: ["calendar", "day", "month", "year", "leapMonth", "weekday", "qualifier"], WEEKDAY: ["calendar", "day", "month", "year", "leapMonth", "offsetDays"], DAY: ["offset", "from", "through"], WEEK: ["date", "from", "through"], MONTH: ["date", "from", "through"], WEEKEND: ["date", "from", "through"], UPCOMING: ["date", "offset", "from", "through"], DATE_BOUNDS: ["date", "offset"], LIST: ["date", "outputCalendar", "topic"], CALENDAR_DATE: ["period", "topic"], CAPABILITY: ["period", "date", "outputCalendar"], HELP: ["field", "reason", "issue"], ASK_FOR_FIELD: ["reason", "issue", "topic"], ASK_FOR_DISAMBIGUATION: ["issue", "topic"], EXPLAIN_UNSUPPORTED: ["field", "reason", "topic"], PRESENT_PREVIEW: ["field", "reason", "issue", "topic"], ANSWER_QUERY: ["field", "reason", "issue", "topic"] };
function wireFixture(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireFixture);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>, result = Object.fromEntries(Object.entries(object).map(([key, child]) => [key, key === "uncertainties" && Array.isArray(child)
    ? child.map((item: { field: unknown; reason: unknown; alternatives: Array<{value:unknown;evidence:unknown[]}> }) => ({ fieldCode: ["title", "location", "notes", "eventDate", "eventTime", "reminderDate", "reminderTime", "calendar", "frequency", "occurrenceCount", "eventRelation", "leadOffsetDays", "endDate", "intent", "queryRange", "operation"].indexOf(String(item.field)), reason: item.reason, alternatives: item.alternatives.map(alternative => JSON.stringify({value:alternative.value,evidence:{primaryEvidence:JSON.stringify(alternative.evidence[0]),additionalEvidenceJson:JSON.stringify(alternative.evidence.slice(1))}})) }))
    : wireFixture(child)]));
  if (Object.hasOwn(object, "schemaVersion")) {
    delete result.schemaVersion;
    const target=object.requestTarget as Record<string,unknown>|null;
    const query=object.query as Record<string,unknown>|null;
    const tuples=[["CREATE_REMINDER","CURRENT",null],["CREATE_REMINDER","NEW",null],["CREATE_REMINDER","UNRESOLVED",null],["LIST_REMINDERS",null,"LIST"],["CALENDAR_QUERY",null,"CALENDAR_DATE"],["CAPABILITY_QUERY",null,"CAPABILITY"],["HELP",null,null],["UNSUPPORTED",null,null],["AMBIGUOUS",null,null],["AMBIGUOUS","CURRENT",null],["AMBIGUOUS","NEW",null],["AMBIGUOUS","UNRESOLVED",null]];
    result.operationCode=String(tuples.findIndex(([intent,targetKind,queryKind])=>intent===object.intent&&targetKind===(target?.kind??null)&&queryKind===(query?.kind??null)));
    delete result.intent;
    for(const key of ["requestTarget","query"])if(result[key])delete (result[key] as Record<string,unknown>).kind;
    const changes=result.changes as Array<Record<string,unknown>>;
    const removed=new Set<number>();
    for(const field of ["title","reminderDate","reminderTime","eventDate","eventTime","eventRelation","frequency","occurrenceCount","endDate","location"]){
      const index=changes.findIndex(change=>change.field===field);
      result[field+"Change"]=index<0?null:{rank:index,change:changes[index]};
      if(index>=0)removed.add(index);
    }
    result.changes=changes.flatMap((change,rank)=>removed.has(rank)?[]:[{rank,change}]);
  }
  if (Array.isArray(object.evidence)) {
    result.evidence = { primaryEvidence: JSON.stringify(object.evidence[0]), additionalEvidenceJson: JSON.stringify(object.evidence.slice(1)) };
  }
  if (object.kind === "LIST") delete result.statusScope;
  if (typeof object.kind === "string") for (const key of pads[object.kind] ?? []) result[key] = null;
  if (["CIVIL_DATE","RELATIVE_DAY","WEEKDAY"].includes(String(object.kind))) return JSON.stringify(object);
  return result;
}
async function dispatch(payload: unknown, requests: SemanticJsonRequest[] = []) {
  // Current provider specimens select sources; the historical encoder parity
  // specimens above remain literal quotes and use the context-free parser.
  const pointer=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(pointer);
    if(!value||typeof value!=="object")return value;
    const v=value as Record<string,unknown>;
    if(v.kind==="USER_QUOTE"&&v.quote==="synthetic"&&v.turn===0&&v.occurrence===1&&Object.keys(v).length===4)return {kind:"USER_TURN",turn:0};
    return Object.fromEntries(Object.entries(v).map(([key,child])=>[key,key==="primaryEvidence"&&typeof child==="string"?JSON.stringify(pointer(JSON.parse(child)))==='{"kind":"USER_TURN","turn":0}'?"U0":child:key==="additionalEvidenceJson"&&typeof child==="string"?JSON.stringify(pointer(JSON.parse(child))):key==="alternatives"&&Array.isArray(child)?child.map(text=>typeof text==="string"?JSON.stringify(pointer(JSON.parse(text))):text):pointer(child)]));
  };
  payload=pointer(payload);
  const transport = createContextHttpTransport("SYNTHETIC_CREDENTIAL", async (_url, init) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ model: "google/gemini-2.5-flash-lite", provider: "Google", id: "gen-wire-test", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }], usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 } }), { headers: { "content-type": "application/json" } });
  });
  const attempt = createContextContractGateway(config, transport, { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 }).prepare("PRIMARY", input);
  if (attempt.status !== "READY") throw new Error("Expected ready");
  const result = await attempt.dispatch();
  expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE" });
  expect(requests).toHaveLength(1);
  return result;
}
it("checkpoint62 actual HTTP gateway retains uncertainty shape on unchanged atomic refusal",async()=>{
 const raw=z.record(z.string(),z.unknown()).parse(encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(minimal)));
 const result=await dispatch({...raw,uncertainties:[{field:"reminderTime",reason:"MISSING",alternatives:[]}]});
 expect(result).toMatchObject({status:"FAILURE",category:"SCHEMA_INVALID",canonicalValidationDiagnostics:{state:"WIRE_DECODE_FAILED",validation:{issues:[{path:["uncertainties",0,"fieldCode"],uncertaintyShape:{field:"reminderTime",requiredKeys:{fieldCode:"MISSING"}}}]}}});
});
it("emits the reviewed scalar-normalized schema through the actual HTTP boundary", async () => {
  const requests: SemanticJsonRequest[] = [];
  await dispatch(wireFixture(minimal), requests);
  expect(requests[0].response_format).toEqual(serializeContextRequest(input).response_format);
  expect(requests[0].provider).toEqual({ only: ["google-vertex/eu"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true, max_price: { prompt: .1, completion: .4 } });
  expect(requests[0].stream).toBe(false);
});
it("reconstructs the exact minimal canonical fixture from required inactive null padding", async () => {
  expect(await dispatch(wireFixture(minimal))).toMatchObject({ status: "SUCCESS", interpretation: { fullSchemaValid: true, directive: { status: "VALID", value: minimal.conversationDirective } } });
});
it.each(Object.entries(values).flatMap(([field, value]) => ["SET", "CLEAR"].map(operation => ({ field, operation, value: operation === "SET" ? value : null, evidence }))))("preserves typed SET/CLEAR and evidence order for $field/$operation", async change => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [change] };
  expect(ConversationInterpretationSchema.safeParse(canonical).success).toBe(true);
  const result=await dispatch(wireFixture(canonical));
  expect(result,JSON.stringify(result)).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { changes: [change] }, fullSchemaValid: true } });
});
it("preserves full changes/uncertainties/evidence capacities and ordered alternatives", async () => {
  const changes = Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence }));
  const uncertainties = Array.from({ length: 4 }, () => ({ field: "title", reason: "AMBIGUOUS", alternatives: [{ value: "first", evidence }, { value: "second", evidence: [...evidence].reverse() }] }));
  expect(await dispatch(wireFixture({ ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes, uncertainties }))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { changes, uncertainties }, fullSchemaValid: true } });
});
it.each(Object.entries({ ...values, intent: "HELP", operation: "CURRENT", queryRange: { kind: "DATE_BOUNDS", from: civil, through: civil } }))("preserves uncertainty field association for %s", async (field, value) => {
  const uncertainties = [{ field, reason: "AMBIGUOUS", alternatives: [{ value, evidence }, { value, evidence }] }];
  expect(await dispatch(wireFixture({ ...minimal, uncertainties }))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { uncertainties }, fullSchemaValid: true } });
});
it.each([
  ["LIST_REMINDERS", { kind: "LIST", period: { kind: "DATE_BOUNDS", from: civil, through: civil }, statusScope: "DEFAULT", evidence }],
  ["CALENDAR_QUERY", { kind: "CALENDAR_DATE", date: civil, outputCalendar: "LUNAR_VN", evidence }],
  ["CAPABILITY_QUERY", { kind: "CAPABILITY", topic: "LUNAR", evidence }],
])("reconstructs query ownership for %s", async (intent, query) => {
  const result=await dispatch(wireFixture({ ...minimal, intent, query }));
  if(intent==="LIST_REMINDERS") {
    if(!("period" in query))throw Error("fixture query ownership");
    expect(result.status).toBe("SUCCESS");if(result.status!=="SUCCESS")throw Error(result.category);
    expect(isUnreconciledListInterpretation(result.interpretation)).toBe(true);
    const staged=readListTransport(result.interpretation);
    expect(staged.core).toMatchObject({intent,query:{kind:"LIST",statusScope:query.statusScope,evidence:query.evidence}});
    expect(staged.period).toEqual({status:"KNOWN",value:query.period});
  } else expect(result).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { intent, query }, fullSchemaValid: true } });
});
it("versioned encoder matches independent fixtures and reconstructs every typed canonical field", () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence })) };
  const before = JSON.stringify(canonical), encoded = encodeGoogleLiteEuContext(canonical);
  expect(encoded).toEqual(wireFixture(canonical));
  expect(parseGoogleLiteEuContextSections(encoded)).toEqual(parseInterpretationSections(canonical));
  expect(JSON.stringify(canonical)).toBe(before);
  for (const directive of [{ kind: "ASK_FOR_FIELD", field: "title" }, { kind: "ASK_FOR_DISAMBIGUATION", field: "title", reason: "AMBIGUOUS" }, { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" }, { kind: "HELP", topic: "GENERAL" }, null]) {
    const fixture = { ...minimal, conversationDirective: directive, replyProposal: { text: "x".repeat(400) } };
    expect(encodeGoogleLiteEuContext(fixture)).toEqual(wireFixture(fixture));
    expect(parseGoogleLiteEuContextSections(encodeGoogleLiteEuContext(fixture))).toEqual(parseInterpretationSections(fixture));
  }
  expect(() => encodeGoogleLiteEuContext({ ...canonical, changes: [...canonical.changes, canonical.changes[0]] })).toThrow();
  const schema = googleLiteEuContextWireSchema();
  expect(schema.version).toBe("google-gemini-2.5-flash-lite-vertex-eu-context-title-presence-75");
  expect(createHash("sha256").update(JSON.stringify(schema.schema)).digest("hex")).toBe("485549cd902ac78c65ff606cc2f75f7cb5a6416b61b4ec2eeadafe93e2e23d62");
  schema.schema.required = [];
  expect(googleLiteEuContextWireSchema().schema.required).not.toEqual([]);
});
it.each([
  ["numeric safe integer", { field: "occurrenceCount", operation: "SET", value: Number.MAX_SAFE_INTEGER + 1, evidence }],
  ["positive numeric minimum", { field: "leadOffsetDays", operation: "SET", value: 0, evidence }],
  ["Gregorian leap refinement", { field: "eventDate", operation: "SET", value: { ...civil, leapMonth: false }, evidence }],
  ["civil range", { field: "eventDate", operation: "SET", value: { ...civil, day: 32 }, evidence }],
  ["clock refinement", { field: "eventTime", operation: "SET", value: { hour: 0, minute: 0, qualifier: "AM" }, evidence }],
  ["non-NFC text", { field: "title", operation: "SET", value: "e\u0301", evidence }],
  ["blank text", { field: "title", operation: "SET", value: " ", evidence }],
  ["quote safe integer", { field: "title", operation: "SET", value: "synthetic", evidence: [{ ...quote, occurrence: Number.MAX_SAFE_INTEGER + 1 }] }],
  ["evidence string cap", { field: "title", operation: "SET", value: "synthetic", evidence: [{ ...quote, quote: "x".repeat(2001) }] }],
  ["fact reference pattern", { field: "title", operation: "SET", value: "synthetic", evidence: [{ kind: "CONTEXT_FACT", ref: "f0" }] }],
])("retains canonical omitted-bound/refinement authority: %s", async (_label, change) => {
  expect(await dispatch(wireFixture({ ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [change] }))).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it.each([
  { ...minimal, uncertainties: Array.from({ length: 5 }, () => ({ field: "title", reason: "MISSING", alternatives: [] })) },
  { ...minimal, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: Array.from({ length: 3 }, () => ({ value: "synthetic", evidence })) }] },
  { ...minimal, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: [{ value: "synthetic", evidence }, { value: 2, evidence }] }] },
  { ...minimal, requestTarget: { kind: "NEW", evidence: [...evidence, quote] } },
  { ...minimal, query: { kind: "CAPABILITY", topic: "LUNAR", evidence } },
])("rejects array caps, mixed field alternatives and query/intent mismatch %#", async canonical => {
  expect(await dispatch(wireFixture(canonical))).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it("retains active nullable date values and rejects missing envelope/core keys", () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [{ field: "eventDate", operation: "SET", value: { ...civil, year: null }, evidence }] };
  expect(parseGoogleLiteEuContextSections(encodeGoogleLiteEuContext(canonical))).toEqual(parseInterpretationSections(canonical));
  for (const raw of [null, [], "invalid", {}, { ...wireFixture(minimal) as object, extra: null }]) expect(parseGoogleLiteEuContextSections(raw).status).toBe("REFUSED");
});
it.each([
  ["unknown directive", (raw: Record<string, unknown>) => { raw.conversationDirective = { kind: "SAVE" }; }, { directive: { status: "INVALID" }, reply: { status: "VALID", value: null } }],
  ["missing directive padding", (raw: Record<string, unknown>) => { delete (raw.conversationDirective as Record<string, unknown>).field; }, { directive: { status: "INVALID" }, reply: { status: "VALID", value: null } }],
  ["overlong reply", (raw: Record<string, unknown>) => { raw.replyProposal = { text: "x".repeat(401) }; }, { directive: { status: "VALID" }, reply: { status: "INVALID", reason: "REPLY_TOO_LONG" } }],
  ["missing guidance", (raw: Record<string, unknown>) => { delete raw.conversationDirective; delete raw.replyProposal; }, { directive: { status: "INVALID" }, reply: { status: "INVALID", reason: "REPLY_INVALID" } }],
] as const)("quarantines %s independently without losing valid core", async (_label, mutate, expected) => {
  const raw = wireFixture(minimal) as Record<string, unknown>; mutate(raw);
  expect(await dispatch(raw)).toMatchObject({ status: "SUCCESS", interpretation: { ...expected, semantic: { changes: [] }, fullSchemaValid: false } });
});
it.each([
  ["wrong field value", (raw: Record<string, unknown>) => { (raw.titleChange as {change:Record<string,unknown>}).change.value = 2; }],
  ["overlong title", (raw: Record<string, unknown>) => { (raw.titleChange as {change:Record<string,unknown>}).change.value = "x".repeat(1801); }],
  ["empty evidence", (raw: Record<string, unknown>) => { (raw.titleChange as {change:Record<string,unknown>}).change.evidence = []; }],
  ["four evidence", (raw: Record<string, unknown>) => { ((raw.titleChange as {change:Record<string,unknown>}).change.evidence as Record<string, unknown>).additionalEvidenceJson = JSON.stringify([wireFixture(quote), wireFixture(quote), wireFixture(quote)]); }],
  ["duplicate field", (raw: Record<string, unknown>) => { (raw.changes as unknown[]).push(structuredClone((raw.titleChange as {change:unknown}).change)); }],
  ["unknown root", (raw: Record<string, unknown>) => { raw.extra = null; }],
  ["missing core", (raw: Record<string, unknown>) => { delete raw.operationCode; }],
] as const)("rejects invalid core atomically: %s", async (_label, mutate) => {
  const raw = wireFixture({ ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [{ field: "title", operation: "SET", value: "synthetic", evidence }] }) as Record<string, unknown>; mutate(raw);
  expect(await dispatch(raw)).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it("current pointer transport rejects quote-authored evidence padding at the HTTP boundary", async () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [{ field: "title", operation: "SET", value: "synthetic", evidence }] };
  const raw = wireFixture(canonical) as Record<string, unknown>;
  (raw.conversationDirective as Record<string, unknown>).field = "title";
  const changedEvidence=(raw.titleChange as {change:{evidence:{primaryEvidence:string}}}).change.evidence;
  changedEvidence.primaryEvidence=JSON.stringify({...JSON.parse(changedEvidence.primaryEvidence),ref:"f999"});
  expect(await dispatch(raw)).toMatchObject({ status: "FAILURE",category:"SCHEMA_INVALID" });
});

function encodeGoogleLiteEuContext(value: unknown) { return encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(value)); }
function parseGoogleLiteEuContextSections(value: unknown) { return parseGoogleLiteEuContextSectionsV3(value, CONTEXT_PROTOCOL_V3); }
