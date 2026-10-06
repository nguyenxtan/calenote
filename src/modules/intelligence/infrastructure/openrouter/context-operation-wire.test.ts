// @vitest-environment node
import {it,expect} from "vitest";
import {ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {encodeGoogleLiteEuContextV3,parseGoogleLiteEuContextSectionsV3,googleLiteEuContextWireSchemaV3} from "./context-provider-wire";
const evidence=[{kind:"USER_QUOTE",turn:0,quote:"literal",occurrence:1}];
const tuples=[
 ["CREATE_REMINDER","CURRENT",null],["CREATE_REMINDER","NEW",null],["CREATE_REMINDER","UNRESOLVED",null],
 ["LIST_REMINDERS",null,"LIST"],["CALENDAR_QUERY",null,"CALENDAR_DATE"],["CAPABILITY_QUERY",null,"CAPABILITY"],
 ["HELP",null,null],["UNSUPPORTED",null,null],["AMBIGUOUS",null,null],
 ["AMBIGUOUS","CURRENT",null],["AMBIGUOUS","NEW",null],["AMBIGUOUS","UNRESOLVED",null],
] as const;
function canonical(index:number){
 const [intent,target,queryKind]=tuples[index];
 const query=queryKind==="LIST"?{kind:queryKind,statusScope:"DEFAULT",period:null,evidence}:queryKind==="CALENDAR_DATE"?{kind:queryKind,date:null,outputCalendar:null,evidence}:queryKind==="CAPABILITY"?{kind:queryKind,topic:null,evidence}:null;
 const uncertainties=queryKind?[{field:queryKind==="CAPABILITY"?"intent":"queryRange",reason:"MISSING",alternatives:[]}]:intent==="AMBIGUOUS"&&target?[{field:"operation",reason:"AMBIGUOUS",alternatives:[]}]:[];
 return ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent,requestTarget:target?{kind:target,evidence}:null,query,changes:[],uncertainties,conversationDirective:null,replyProposal:null});
}
it.each(tuples.map((_,index)=>index))("losslessly encodes canonical operation tuple %i once",index=>{
 const value=canonical(index),wire=encodeGoogleLiteEuContextV3(value) as Record<string,unknown>;
 expect(wire.operationCode).toBe(index);expect(wire).not.toHaveProperty("intent");
 if(wire.requestTarget)expect(wire.requestTarget).not.toHaveProperty("kind");
 if(wire.query)expect(wire.query).not.toHaveProperty("kind");
 const {conversationDirective,replyProposal,...semantic}=value;
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3)).toMatchObject({status:"PARSED",value:{semantic,fullSchemaValid:true,directive:{status:"VALID",value:conversationDirective},reply:{status:"VALID",value:replyProposal}}});
});
it.each([-1,12,1.5,"3",null])("rejects invalid operation code %j without repairing",code=>{
 const wire=encodeGoogleLiteEuContextV3(canonical(3)) as Record<string,unknown>;
 expect(parseGoogleLiteEuContextSectionsV3({...wire,operationCode:code},CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("rejects carrier mismatch and duplicated tags instead of discarding them",()=>{
 const list=encodeGoogleLiteEuContextV3(canonical(3)) as Record<string,unknown>,create=encodeGoogleLiteEuContextV3(canonical(1)) as Record<string,unknown>;
 for(const wire of [{...list,requestTarget:create.requestTarget},{...list,query:null},{...create,requestTarget:null},{...create,query:list.query},{...list,intent:"LIST_REMINDERS"},{...list,query:{...(list.query as object),kind:"LIST"}}])expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("provider schema exposes a single finite operation selector",()=>{
 const properties=googleLiteEuContextWireSchemaV3().schema.properties!;
 expect(properties.operationCode).toEqual({type:"integer",enum:[0,1,2,3,4,5,6,7,8,9,10,11]});expect(properties).not.toHaveProperty("intent");
});
it("schema emits the operation selector before its dependent carriers in required prompt order",()=>{
 const schema=googleLiteEuContextWireSchemaV3().schema;
 expect(Object.keys(schema.properties!)).toEqual(schema.required);
 expect(Object.keys(schema.properties!)[0]).toBe("operationCode");
});
it("query schema has one nullable carrier rather than overlapping selectorless object alternatives",()=>{
 const query=googleLiteEuContextWireSchemaV3().schema.properties!.query;
 if(typeof query!=="object")throw Error("query schema is not an object");
 expect(query.anyOf).toHaveLength(2);
 const carrier=query.anyOf![0];
 if(typeof carrier!=="object")throw Error("query carrier is not an object");
 expect(carrier.type).toBe("object");
 expect(carrier.required).toEqual(["period","evidence","date","outputCalendar","topic"]);
 expect(carrier).not.toHaveProperty("anyOf");
});
it.each([[3,"period"],[4,"date"],[5,"topic"]] as const)("query code %i retains strict active %s type validation",(index,key)=>{
 const wire=encodeGoogleLiteEuContextV3(canonical(index)) as {query:Record<string,unknown>};
 wire.query[key]=17;
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("consolidated carrier does not promote inactive query padding into semantic authority",()=>{
 const wire=encodeGoogleLiteEuContextV3(canonical(3)) as {query:Record<string,unknown>};
 wire.query.date='{"kind":"RELATIVE_DAY","offsetDays":1}';
 wire.query.outputCalendar="LUNAR_VN";wire.query.topic="ANNUAL";
 const parsed=parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3);
 expect(parsed.status).toBe("PARSED");
 if(parsed.status!=="PARSED")throw Error("unexpected refusal");
 expect(parsed.value.semantic.query).toEqual(canonical(3).query);
});
it("operation mapping does not bypass canonical conditional uncertainty requirements",()=>{
 const wire=encodeGoogleLiteEuContextV3(canonical(9)) as Record<string,unknown>;
 wire.uncertainties=[];
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("query operation cannot authorize semantic reminder changes",()=>{
 const wire=encodeGoogleLiteEuContextV3(canonical(3)) as Record<string,unknown>;
 const create=encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse({...canonical(1),changes:[{field:"title",operation:"SET",value:"literal",evidence}]})) as Record<string,unknown>;
 wire.changes=create.changes;
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("unsupported-combination still requires unresolved target rather than any mapped target",()=>{
 const wire=encodeGoogleLiteEuContextV3(canonical(9)) as {uncertainties:Array<{reason:string}>};
 wire.uncertainties[0].reason="UNSUPPORTED_COMBINATION";
 expect(parseGoogleLiteEuContextSectionsV3(wire,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
