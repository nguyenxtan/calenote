// @vitest-environment node
import {it,expect} from "vitest";
import {ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {encodeGoogleLiteEuContextV3,parseGoogleLiteEuContextSectionsV3,googleLiteEuContextWireSchemaV3} from "./context-provider-wire";
import {contextWireComplexity} from "../../../../../tools/benchmark/context-wire-complexity";
const evidence={kind:"USER_QUOTE",turn:0,quote:"Có lịch nào ko?",occurrence:1};
const canonical=(count:number)=>ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"LIST_REMINDERS",requestTarget:null,changes:[],query:{kind:"LIST",period:null,statusScope:"DEFAULT",evidence:Array.from({length:count},()=>evidence)},uncertainties:[{field:"queryRange",reason:"MISSING",alternatives:[]}],conversationDirective:{kind:"ASK_FOR_FIELD",field:"queryRange"},replyProposal:null});
function wire(){return encodeGoogleLiteEuContextV3(canonical(1)) as {query:{evidence:Record<string,unknown>}};}
it.each([1,2,3])("compact primary plus scalar extras preserves %i canonical evidence",count=>{
 const raw=encodeGoogleLiteEuContextV3(canonical(count)) as ReturnType<typeof wire>;
 expect(Object.keys(raw.query.evidence)).toEqual(["primaryEvidence","additionalEvidenceJson"]);
 expect(typeof raw.query.evidence.additionalEvidenceJson).toBe("string");
 expect(JSON.parse(raw.query.evidence.additionalEvidenceJson as string)).toHaveLength(count-1);
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{query:{evidence:Array.from({length:count},()=>evidence)}}}});
});
it.each(["[]","null","{}","not-json",JSON.stringify([{}, {}, {}])," ".repeat(32769)])("rejects malformed or excessive extras without repair %#",extras=>{
 const raw=wire(); raw.query.evidence.additionalEvidenceJson=extras;
 if(extras==="[]")delete raw.query.evidence.primaryEvidence;
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("provider schema never duplicates nullable evidence slots",()=>{
 const text=JSON.stringify(googleLiteEuContextWireSchemaV3().schema);
 expect(text).not.toContain("secondaryEvidence");expect(text).not.toContain("tertiaryEvidence");expect(text).toContain("additionalEvidenceJson");
});
it("historical fanout bounds remain for the unchanged remainder; wire31 carrier costs are explicit, not live admission",()=>{
 const schema=googleLiteEuContextWireSchemaV3().schema;
 const remainder=structuredClone(schema) as unknown as {properties:Record<string,unknown>;required:string[]};
 for(const root of ["reminderDateChange","reminderTimeChange","eventDateChange"]){delete remainder.properties[root];remainder.required=remainder.required.filter(key=>key!==root);}
 const baseline=contextWireComplexity(remainder),metrics=contextWireComplexity(schema);
 // Preserve historical bounds; do not claim the amended schema was admitted
 // merely because its unchanged remainder satisfies a previous envelope.
 expect(baseline.nullableUnions).toBeLessThanOrEqual(12);
 expect(baseline.unions).toBeLessThanOrEqual(19);
 expect(baseline.branches).toBeLessThanOrEqual(51);
 expect(baseline.references).toBeLessThanOrEqual(42);
 expect(metrics).toMatchObject({nullableUnions:15,unions:22,branches:55,references:24});
 // Three nullable roots, each with strict non-null versus CLEAR change branches.
 // Merging operation/value branches would incorrectly permit SET/null.
 expect(metrics.nullableUnions-baseline.nullableUnions).toBe(3);
 expect(metrics.unions-baseline.unions).toBe(6);
 expect(metrics.branches-baseline.branches).toBe(12);
});
it("bad extras diagnostics expose structure, never serialized sensitive values",()=>{
 const raw=wire(),diagnostics:unknown[]=[];
 raw.query.evidence.additionalEvidenceJson=JSON.stringify([{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_SENTINEL",occurrence:1,ref:null,extra:"PRIVATE_SENTINEL"}]);
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
 expect(diagnostics.length).toBeGreaterThan(0);expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_SENTINEL");
});
