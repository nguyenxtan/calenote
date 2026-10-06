// @vitest-environment node
import {it,expect} from "vitest";
import {encodeGoogleLiteEuContextV3,parseGoogleLiteEuContextSectionsV3,googleLiteEuContextWireSchemaV3} from "./context-provider-wire";
import {ConversationInterpretationV3Schema,parseInterpretationSectionsV3} from "../../../conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
const refs=[{kind:"USER_QUOTE",turn:0,quote:"literal quote",occurrence:1},{kind:"USER_QUOTE",turn:0,quote:"second quote",occurrence:1},{kind:"USER_QUOTE",turn:0,quote:"third quote",occurrence:1}];
it.each([1,2,3])("required primary JSON reconstructs exactly %i canonical refs without nested provider evidence unions",count=>{
 const evidence=refs.slice(0,count),canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"title",operation:"SET",value:"literal quote",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(canonical) as {requestTarget:{evidence:{primaryEvidence:string}},changes:Array<{evidence:{primaryEvidence:string}}>};
 expect(typeof wire.requestTarget.evidence.primaryEvidence).toBe("string");expect(typeof wire.changes[0].evidence.primaryEvidence).toBe("string");
 expect(JSON.parse(wire.requestTarget.evidence.primaryEvidence)).toMatchObject(refs[0]);
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
 const schema=googleLiteEuContextWireSchemaV3().schema;
 expect(JSON.stringify(schema)).not.toContain('"const":"USER_QUOTE"');expect(JSON.stringify(schema)).not.toContain('"const":"CONTEXT_FACT"');
});
it.each(["", "[", "[]", "null", JSON.stringify({kind:"USER_QUOTE",turn:0,quote:"PRIVATE_SENTINEL",occurrence:0,ref:null}), "x".repeat(32769), "ầ".repeat(12000)])("malformed or oversized primary never supplies partial evidence (%#)",primary=>{
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"LIST_REMINDERS",requestTarget:null,changes:[],query:{kind:"LIST",period:{kind:"MONTH",offset:0},statusScope:"DEFAULT",evidence:[refs[0]]},uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeGoogleLiteEuContextV3(canonical) as {query:{evidence:{primaryEvidence:unknown}}};wire.query.evidence.primaryEvidence=primary;
 const diagnostics:unknown[]=[];expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
 expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_SENTINEL");
});
