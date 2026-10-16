// @vitest-environment node
import {createHash} from "node:crypto";
import {wire95PromptFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {expect,it} from "vitest";
import {CONTEXT_CONTRACT_PROMPT} from "../../../conversation/context-contract/prompt";
import {ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {encodeGoogleLiteEuContextV3,googleLiteEuContextWireSchemaV3,parseGoogleLiteEuContextSectionsV3} from "./context-provider-wire";

it("syntax specimen omits rank and joint assembly preserves sparse model-authored ordering",()=>{
 const match=/^Serialization example \(syntax only\): (.+)$/m.exec(CONTEXT_CONTRACT_PROMPT)!;
 const fragment=JSON.parse(match[1]);expect(fragment.eventRelationChange).not.toHaveProperty("rank");
 expect(JSON.parse(fragment.eventRelationChange.change).field).toBe("eventRelation");
 expect(CONTEXT_CONTRACT_PROMPT).toContain("deliberately omits rank");
 expect(CONTEXT_CONTRACT_PROMPT).toContain("one rank-to-owner map");
 expect(CONTEXT_CONTRACT_PROMPT).toContain("Check the union, not each root or array separately");
 expect(CONTEXT_CONTRACT_PROMPT).toContain("Gaps/sole10 legal");
});
const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation:"SET",value:"synthetic note",evidence},{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
const sample=()=>encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;
it("observed structural equal10 axis refuses atomically without changing payload",()=>{
 const raw=sample();(raw.changes as Array<{rank:number}>)[0].rank=10;(raw.eventRelationChange as {rank:number}).rank=10;
 const before=JSON.stringify(raw),diagnostics:unknown[]=[];
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3,undefined,d=>diagnostics.push(d)).status).toBe("REFUSED");
 expect(diagnostics).toMatchObject([{issues:[{path:["eventRelationChange","rank"],rankControl:{reason:"COLLISION",actualRank:10,collisionLocations:[{root:"changes",index:0}]}}]}]);
 expect(JSON.stringify(raw)).toBe(before);
});
it("every distinct sparse rank pair preserves authored order and every equal pair refuses",()=>{
 for(let ordinary=0;ordinary<13;ordinary++)for(let singleton=0;singleton<13;singleton++){
  const raw=sample();(raw.changes as Array<{rank:number}>)[0].rank=ordinary;(raw.eventRelationChange as {rank:number}).rank=singleton;
  const before=JSON.stringify(raw),result=parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3);
  if(ordinary===singleton)expect(result.status).toBe("REFUSED");else expect(result).toMatchObject({status:"PARSED",value:{semantic:{changes:ordinary<singleton?canonical.changes:[...canonical.changes].reverse()}}});
  expect(JSON.stringify(raw)).toBe(before);
 }
});
it("omitted rank stays refused rather than defaulted",()=>{
 const raw=sample();delete (raw.eventRelationChange as {rank?:number}).rank;
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});

it("prompt-only inverse preserves every byte of wire95 and generic schema identity",()=>{
 expect(createHash("sha256").update(JSON.stringify(googleLiteEuContextWireSchemaV3().schema)).digest("hex")).toBe("5aaf9dcab9cc54dad77a60da14f31f986547ba9e4b8ae484bd79b574ca867421");
 expect(createHash("sha256").update(wire95PromptFixture(CONTEXT_CONTRACT_PROMPT)).digest("hex")).toBe("c6fe46f96a8afb3405e8094697a459e5af00a02831b27c7921dba00710838304");
});
