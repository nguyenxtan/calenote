// @vitest-environment node
import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {z} from "zod";
import {decodeAuthoredChangeRank} from "../../../conversation/context-contract/output-authority";
import {ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {encodeGoogleLiteEuContextV3,googleLiteEuContextWireSchemaV3,parseGoogleLiteEuContextSectionsV3} from "./context-provider-wire";

it("wire88 accepts only thirteen authored numeric ordinals with no string fallback",()=>{
 for(let rank=0;rank<13;rank++)expect(decodeAuthoredChangeRank(rank)).toBe(rank);
 for(const invalid of ["0","10","01",-0,-1,13,.5,NaN,Infinity,null,undefined,{},true,Object(0)])expect(decodeAuthoredChangeRank(invalid)).toBeUndefined();
});
it("wire88 numeric producer scalar preserves every other generic schema byte",()=>{
 const schema=googleLiteEuContextWireSchemaV3().schema;
 expect(schema.$defs!.r).toEqual({type:"integer",minimum:0,maximum:12});
 const domain=z.fromJSONSchema(schema.$defs!.r as Parameters<typeof z.fromJSONSchema>[0]);
 for(let rank=0;rank<13;rank++)expect(domain.safeParse(rank).success).toBe(true);
 for(const invalid of ["0","10",-1,13,.5,null,{},true])expect(domain.safeParse(invalid).success).toBe(false);
 const inverse=structuredClone(schema);inverse.$defs!.r={type:"string",enum:Array.from({length:13},(_,rank)=>String(rank))};
 expect(createHash("sha256").update(JSON.stringify(inverse)).digest("hex")).toBe("8caaf79b26bcd1d45cfb1d96632766edf7b2666345509cc435b3b7aa01fea698");
});
it("wire88 preserves literal sparse authored order and atomically refuses numeric collisions and legacy strings",()=>{
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:"synthetic",occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"literal title",evidence},{field:"notes",operation:"SET",value:"literal notes",evidence},{field:"eventRelation",operation:"CLEAR",value:null,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const raw=encodeGoogleLiteEuContextV3(canonical) as Record<string,unknown>;
 expect(raw.titleChange).toMatchObject({rank:0});expect(raw.changes).toMatchObject([{rank:1}]);expect(raw.eventRelationChange).toMatchObject({rank:2});
 const before=JSON.stringify(raw);expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});expect(JSON.stringify(raw)).toBe(before);
 for(let rank=2;rank<13;rank++){const sparse=structuredClone(raw);(sparse.eventRelationChange as {rank:unknown}).rank=rank;expect(parseGoogleLiteEuContextSectionsV3(sparse,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic:{changes:canonical.changes}}});}
 for(const rank of [0,1,"2","02",13,.5,null]){const bad=structuredClone(raw);(bad.eventRelationChange as {rank:unknown}).rank=rank;expect(parseGoogleLiteEuContextSectionsV3(bad,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");}
});
