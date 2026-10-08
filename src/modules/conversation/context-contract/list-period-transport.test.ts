// @vitest-environment node
import {expect, it} from "vitest";
import * as wire from "../../intelligence/infrastructure/openrouter/context-provider-wire";
import {createHash} from "node:crypto";
import {ConversationInterpretationV3Schema} from "./contracts";
import {CONTEXT_PROTOCOL_V3} from "./protocol";
const canonical = () => ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"LIST_REMINDERS",requestTarget:null,changes:[],query:{kind:"LIST",period:{kind:"MONTH",offset:0},statusScope:"DEFAULT",evidence:[{kind:"USER_QUOTE",turn:0,quote:"tháng này",occurrence:1}]},uncertainties:[],conversationDirective:null,replyProposal:null});
const encoded = () => wire.encodeGoogleLiteEuContextV3(canonical()) as {query:{period:Record<string,unknown>;evidence:unknown}};
it("quarantines unsupported DATE without granting a canonical period",async()=>{
 const raw=encoded();raw.query.period.kind="DATE";
 expect(wire.parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
 const result=wire.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3);
 expect(result.status).toBe("PARSED");if(result.status!=="PARSED")throw Error(result.reason);
 const transport=await import("./list-period-transport");
 expect(transport.isUnreconciledListInterpretation(result.value)).toBe(true);
 expect(transport.readListTransport(result.value)).toMatchObject({period:{status:"UNSUPPORTED"}});
 expect(JSON.stringify(result.value)).not.toContain("DATE");
 expect(transport.isUnreconciledListInterpretation({...result.value})).toBe(false);
});
it.each(["MONTH","REST_OF_MONTH","NEXT_7_DAYS"])("retains known %s classification",async kind=>{
 const raw=encoded();raw.query.period.kind=kind;
 const result=wire.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3);
 expect(result.status).toBe("PARSED");if(result.status!=="PARSED")throw Error(result.reason);
 const transport=await import("./list-period-transport");
 expect(transport.readListTransport(result.value)).toMatchObject({period:{status:"KNOWN",value:{kind}}});
});
it.each([4,{},"private words","x".repeat(49),"DATE\n",""])("rejects unsafe discriminator %j",kind=>{
 const raw=encoded();raw.query.period.kind=kind;
 expect(wire.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("rejects structural corruption and mandatory evidence absence despite unknown token",()=>{
 for(const mutate of [(raw:ReturnType<typeof encoded>)=>{delete raw.query.period.date;},(raw:ReturnType<typeof encoded>)=>{raw.query.period.extra=true;},(raw:ReturnType<typeof encoded>)=>{raw.query.evidence=null;}]){
  const raw=encoded();raw.query.period.kind="DATE";mutate(raw);
  expect(wire.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
 }
});
it("unsupported token diagnostics retain only structure and digest, not the token",async()=>{
 const raw=encoded();raw.query.period.kind="PRIVATE_SENTINEL";
 const decoded=wire.decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3);expect(decoded.status).toBe("PARSED");if(decoded.status!=="PARSED")throw Error(decoded.reason);
 const {readListTransport}=await import("./list-period-transport");
 expect(JSON.stringify(readListTransport(decoded.value))).not.toContain("PRIVATE_SENTINEL");
});
it("emitted provider schema binds the selected semantic evidence representation",()=>{
 expect(createHash("sha256").update(JSON.stringify(wire.googleLiteEuContextWireSchemaV3().schema)).digest("hex")).toBe("01b123b1c366deaf4bc2d706e5e3d4419c9f4caf42e2d4322e55e145a4822282");
});
