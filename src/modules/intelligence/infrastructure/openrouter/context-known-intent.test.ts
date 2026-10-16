// @vitest-environment node
import {expect,it} from "vitest";
import {z} from "zod";
import {ContextInputSchema,type ContextInput} from "../../../conversation/context-contract/contracts";
import * as capability from "../../../conversation/context-contract/field-capability";
import {deriveGenerationFieldCapability} from "../../../conversation/context-contract/field-capability";
import {wire88RequestFixture,wire93RequestFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {googleLiteEuContextWireSchemaV3} from "./context-provider-wire";
const input=(text:string)=>ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"v1",supported:["ONCE","FINITE_DAILY"],unsupported:["YEARLY"],calendars:["GREGORIAN","LUNAR_VN"],limits:{dailyCount:30,horizonDays:366}}});
const known=(value:ContextInput)=>(capability as unknown as {isInitialExplicitReminderIntentKnown?:(input:ContextInput)=>boolean}).isInitialExplicitReminderIntentKnown?.(value);
function inline(root:unknown,node:unknown,seen:string[]=[]):unknown {if(!node||typeof node!=="object")return node;if(Array.isArray(node))return node.map(value=>inline(root,value,seen));const object=node as Record<string,unknown>;if(typeof object.$ref==="string"){if(Object.keys(object).length!==1||!object.$ref.startsWith("#/")||seen.includes(object.$ref))throw Error("TEST_REFERENCE_BINDING");const ref=object.$ref,target=ref.slice(2).split("/").reduce<unknown>((value,key)=>(value as Record<string,unknown>)?.[key.replaceAll("~1","/").replaceAll("~0","~")],root);if(!target)throw Error("TEST_REFERENCE_MISSING");return inline(root,target,[...seen,ref]);}return Object.fromEntries(Object.entries(object).filter(([key])=>key!=="$defs").map(([key,value])=>[key,inline(root,value,seen)]));}
function admits(value:ContextInput,fieldCode:number,reason:string){const schema=googleLiteEuContextWireSchemaV3(deriveGenerationFieldCapability(value),value).schema;return z.fromJSONSchema(inline(schema,schema.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]).safeParse([{fieldCode,reason,alternatives:[]}]).success;}

const positives=["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.","Ngày 12/11 đi thi ở Quang Trung, nhắc ba ngày liên tiếp lúc 9:30.","Mai đi thi, nhắc trước hai ngày.","Nhắc tôi đi thi.","Đi thi, nhắc lúc 7h."];
it.each(positives)("wire89 explicit whole reminder has known intent without extracting operands: %s",text=>{const value=input(text),before=JSON.stringify(value);expect(known(value)).toBe(true);expect(JSON.stringify(value)).toBe(before);expect(admits(value,13,"MISSING")).toBe(false);for(const reason of ["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])expect(admits(value,13,reason)).toBe(true);});
it.each(["Ngày 11/10 đi thi ở Nhắc.","Ngày 11/10 đi thi ở Nhắc-nhắc.","Ngày 11/10 đi thi.","Tôi thi ngày 11/10 lúc 8h.","xem lịch đi thi","Nếu đi thi, nhắc lúc 8h.","Không đi thi, nhắc lúc 8h.",'"đi thi", nhắc lúc 8h.',"Đi thi [CONTROL], nhắc lúc 8h.","Đi thi, nhắc chuẩn bị giấy tờ.","Đi thi rồi nhắc đi khám.","Đi thi, nhắc khoảng 8h."])("wire89 unknown or non-reminder scope retains missing intent: %s",text=>{const value=input(text);expect(known(value)).toBe(false);expect(admits(value,13,"MISSING")).toBe(true);});
it("wire89 history or unresolved context never becomes initial reminder authority",()=>{const base=input(positives[0]);for(const change of [{turns:[{role:"USER",text:"history"},...base.turns],currentTurn:1},{ambiguities:[{field:"intent",reason:"MISSING",alternatives:[]}]},{pendingQuestion:{scope:"REMINDER",field:"intent",reason:"MISSING",text:"which?",decisionKind:null}}]){const value=ContextInputSchema.parse({...base,...change});expect(known(value)).toBe(false);expect(admits(value,13,"MISSING")).toBe(true);}});

it.each(positives)("wire89 entire field/reason/alternative domain differs only at known intent missing: %s",text=>{
 // Compare the historical wire89 language through the scoped pre-wire94
 // constructor. Current wire94's independent marker pairs are tested raw.
 const value=input(text),current=wire93RequestFixture(value).response_format.json_schema.schema,prior=wire88RequestFixture(value).response_format.json_schema.schema;
 expect(known(value)).toBe(true);const next=z.fromJSONSchema(inline(current,current.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]),old=z.fromJSONSchema(inline(prior,prior.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);
 for(let fieldCode=0;fieldCode<16;fieldCode++)for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(const count of [0,1,2]){const raw=[{fieldCode,reason,alternatives:Array(count).fill("{}")}];expect(next.safeParse(raw).success,`${fieldCode}/${reason}/${count}`).toBe(fieldCode===13&&reason==="MISSING"?false:old.safeParse(raw).success);}
});
it("wire89 source condition inverse restores the exact earlier request schema without leaking fixture state",()=>{
 const value=input("Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi."),before=JSON.stringify(value),current=googleLiteEuContextWireSchemaV3(deriveGenerationFieldCapability(value),value).schema,prior=wire88RequestFixture(value).response_format.json_schema.schema;
 expect(known(value)).toBe(true);expect(JSON.stringify(value)).toBe(before);expect(JSON.stringify(googleLiteEuContextWireSchemaV3(deriveGenerationFieldCapability(value),value).schema)).toBe(JSON.stringify(current));
 expect(prior).not.toEqual(current);
});
it("wire89 unknown data is never inferred as an empty initial context",()=>{const base=input(positives[0]);for(const change of [{facts:[{}]},{activeRequest:{}},{facts:undefined},{pendingQuestion:undefined},{ambiguities:undefined},{turns:[{role:"ASSISTANT",text:positives[0]}]}])expect(known({...base,...change} as unknown as ContextInput)).toBe(false);});
