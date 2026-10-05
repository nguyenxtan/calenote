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
it("emitted union/reference fanout stays at the measured live-admitted v10 baseline",()=>{
 const metrics=contextWireComplexity(googleLiteEuContextWireSchemaV3().schema);
 expect(metrics.nullableUnions).toBeLessThanOrEqual(12);
 expect(metrics.unions).toBeLessThanOrEqual(19);
 expect(metrics.branches).toBeLessThanOrEqual(51);
 expect(metrics.references).toBeLessThanOrEqual(42);
});
it("bad extras diagnostics expose structure, never serialized sensitive values",()=>{
 const raw=wire(),diagnostics:unknown[]=[];
 raw.query.evidence.additionalEvidenceJson=JSON.stringify([{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_SENTINEL",occurrence:1,ref:null,extra:"PRIVATE_SENTINEL"}]);
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
 expect(diagnostics.length).toBeGreaterThan(0);expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_SENTINEL");
});
