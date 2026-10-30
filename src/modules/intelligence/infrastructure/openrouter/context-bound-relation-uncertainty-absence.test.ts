// @vitest-environment node
import {beforeAll,expect,it,vi} from "vitest";
import {z} from "zod";
import {type ContextInput,ContextInputSchema,ConversationInterpretationV3Schema} from "../../../conversation/context-contract/contracts";
import * as capability from "../../../conversation/context-contract/field-capability";
import {createContextContractProbe} from "../../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../../tools/benchmark/context-contract-fixtures";
import {googleLiteEuContextWireSchemaV3,decodeGoogleLiteEuContextTransportV3} from "./context-provider-wire";
import {wire100RequestFixture,wire88RequestFixture,typedSingletonSchemaFixture} from "../../../../../tools/benchmark/context-singleton-json.test-support";
import {encodeFixtureWire107Reference as encodeFixtureV3} from "../../../../../tools/benchmark/context-pointer-fixtures";
import {CONTEXT_PROTOCOL_V3} from "../../../conversation/context-contract/protocol";
import {isInitialEventDateOnlySource,isInitialIsolatedExamNotesFree} from "../../../conversation/context-contract/semantic-completeness";
import {extractTemporalEvidence} from "../../../semantic/temporal-evidence";
import {supportsEventRelation,hasEventRelationSourceCue} from "../../../conversation/context-contract/event-relation-evidence";
import {supportsCadenceOperand} from "../../../conversation/context-contract/cadence-count-evidence";
import {supportsLeadOffset} from "../../../conversation/context-contract/lead-offset-evidence";
import type {SourceEvidence} from "../../../conversation/context-contract/state";
import {execFileSync} from "node:child_process";
import ts from "typescript";
const sourceSha="a55defb7540161d0712fa5831072009a58569fc3";
type SourceCase={id:string;first:string;current:string;fixture?:"R03";venue?:string;relation?:"BEFORE_EVENT"|"INCLUDING_EVENT";reminderDate?:number};
const sourceCases:SourceCase[]=[
 {id:'R02_NO_RELATION',first:'Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp.',current:'Nhắc trước 2 ngày.'},
 {id:'R03_NO_RELATION',fixture:'R03',first:'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.',current:'Nhắc trước 2 ngày.'},
 {id:'RETAINED_INCLUDING_CONFLICT',first:'Ngày 11/10 đi thi tại Bao Gồm Ngày Thi, nhắc 2 ngày liên tiếp.',current:'Nhắc trước 2 ngày.',venue:'Bao Gồm Ngày Thi',relation:'INCLUDING_EVENT'},
 {id:'RETAINED_BEFORE_UNSUPPORTED_HISTORY',first:'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc trước 500 ngày.',current:'Nhắc trước 2 ngày.',relation:'BEFORE_EVENT'},
 {id:'NO_FACT_UNSUPPORTED_HISTORY',first:'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc trước 500 ngày.',current:'Nhắc trước 2 ngày.'},
 {id:'NO_FACT_FLEXIBLE_HISTORY',first:'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, nhắc trước  500 ngày.',current:'Nhắc trước 2 ngày.'},
 {id:'NO_FACT_INDEPENDENT_DATE_HISTORY',first:'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, ngày 10/10.',current:'Nhắc trước 2 ngày.'},
 {id:'OCCUPIED_REMINDER_DATE',first:'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp, ngày 10/10.',current:'Nhắc trước 2 ngày.',reminderDate:10},
 {id:'CURRENT_CORRECTION',first:'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.',current:'Đổi thành nhắc trước 2 ngày.'},
 {id:'CURRENT_INDEPENDENT_OFFSET',first:'Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.',current:'Nhắc trước 5 ngày.'},
];
let bound:ContextInput;
const rows:Array<{id:string;input:ContextInput;initialInput:ContextInput}>=[];
beforeAll(async()=>{
 for(const c of sourceCases){let input:ContextInput|undefined,initialInput:ContextInput|undefined;
  const h=await createContextContractProbe({sourceSha,referenceNow:Date.parse("2026-09-28T03:00:00Z")},(current,index)=>{
   const p=ConversationInterpretationV3Schema.parse(frozenContextProposal(current,c.fixture??"R02",index-1));
   const evidence=[{kind:"USER_QUOTE" as const,turn:current.currentTurn,quote:current.turns[current.currentTurn].text,occurrence:1}];
   if(index===1){initialInput=structuredClone(current);
    p.changes=p.changes.filter(change=>change.field!=="location"||c.first.includes("Quang Trung")||c.venue).map(change=>change.field==="location"&&change.operation!=="CLEAR"&&c.venue?{...change,value:c.venue}:change.field==="eventDate"?{...change,evidence:[{...evidence[0],quote:"Ngày 11/10"}]}:change);
    if(c.relation)p.changes.push({field:"eventRelation",operation:"SET",value:c.relation,evidence});
    if(c.reminderDate)p.changes.push({field:"reminderDate",operation:"SET",value:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:c.reminderDate,month:10,year:null,leapMonth:null},evidence:[{...evidence[0],quote:"ngày 10/10"}]});
   }else input=structuredClone(current);
   return p;
  });
  try{const initial=await h.turn(c.first,"2026-09-28T03:00:00Z"),second=await h.turn(c.current,"2026-09-28T03:01:00Z");expect(initial.fullSchemaValid).toBe(true);expect(second).toMatchObject({fullSchemaValid:true,listStoreReads:0,mutations:0});
   if(!input||!initialInput)throw Error("TEST_CONTEXT_MISSING");rows.push({id:c.id,input,initialInput});
   if(c.id==="RETAINED_INCLUDING_CONFLICT"){expect(input.activeRequest!.slots.eventRelation).toMatchObject({state:"RESOLVED",value:"INCLUDING_EVENT"});expect(capability.isBoundSeriesDistanceRelationMissingExcluded(input)).toBe(true);expect(second.pendingField).toBe("eventRelation");}
  }finally{h.dispose();}
 }
 bound=rows[0].input;
});
function inline(root:unknown,node:unknown,seen:string[]=[]):unknown{
 if(!node||typeof node!=="object")return node;if(Array.isArray(node))return node.map(n=>inline(root,n,seen));const o=node as Record<string,unknown>;
 if(typeof o.$ref==="string"){const ref=o.$ref;if(!ref.startsWith("#/")||seen.includes(ref))throw Error("TEST_REF");return inline(root,ref.slice(2).split("/").reduce<unknown>((v,k)=>(v as Record<string,unknown>)[k],root),[...seen,ref]);}
 return Object.fromEntries(Object.entries(o).filter(([k])=>k!=="$defs").map(([k,v])=>[k,inline(root,v,seen)]));
}
const schema=(input:ContextInput)=>googleLiteEuContextWireSchemaV3(capability.deriveGenerationFieldCapability(input),input).schema;
const validator=(input:ContextInput)=>{const s=schema(input);return z.fromJSONSchema(inline(s,s.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);};
it.each(["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])("certified no-slot source excludes outgoing relation %s",reason=>{
 expect(bound.activeRequest!.slots.eventRelation).toEqual({state:"MISSING",value:null,fact:null});
 expect(capability.isBoundSeriesDistanceRelationMissingExcluded(bound)).toBe(true);
 expect(validator(bound).safeParse([{fieldCode:10,reason,alternatives:[]}]).success).toBe(false);
});
it.each(["Nhắc trước 2 ngày.","Nhắc tôi trước hai ngày.","2 ngày trước."])("all existing matched-count spellings preserve the certified bound: %s",text=>{
 const input=structuredClone(bound);input.turns[input.currentTurn].text=text;expect(capability.isBoundRelationUncertaintyAbsent(input)).toBe(true);
 for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(let n=0;n<=2;n++)expect(validator(input).safeParse([{fieldCode:10,reason,alternatives:Array(n).fill("{}")}]).success).toBe(false);
});
it("occupied relation retains genuine conflict language",()=>{
 const input=structuredClone(bound);input.activeRequest!.slots.eventRelation={state:"RESOLVED",value:"INCLUDING_EVENT",fact:"f999"};input.facts.push({...structuredClone(input.facts[0]),scope:"REMINDER",alias:"f999",field:"eventRelation",value:"INCLUDING_EVENT"});
 expect(capability.isBoundSeriesDistanceRelationMissingExcluded(input)).toBe(true);
 expect(validator(input).safeParse([{fieldCode:10,reason:"CONFLICT",alternatives:[]}]).success).toBe(true);
});

it.each(sourceCases)("actual $id source/fact language changes only when certified",({id})=>{
 const input=rows.find(row=>row.id===id)!.input,before=JSON.stringify(input),certified=id==="R02_NO_RELATION";
 expect(capability.isBoundRelationUncertaintyAbsent(input)).toBe(certified);
 const current=schema(input),old=wire100RequestFixture(input).response_format.json_schema.schema;
 const a=validator(input),b=z.fromJSONSchema(inline(old,old.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);
 for(let fieldCode=0;fieldCode<16;fieldCode++)for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(let n=0;n<=2;n++){const raw=[{fieldCode,reason,alternatives:Array(n).fill("{}")}];expect(a.safeParse(raw).success,`${id}/${fieldCode}/${reason}/${n}`).toBe((certified&&fieldCode===10||capability.isBoundOperationMissingExcluded(input)&&fieldCode===15&&reason==="MISSING")?false:b.safeParse(raw).success);}
 if(!certified)expect(current).toEqual(old);const ac=structuredClone(current),bc=structuredClone(old);delete ac.properties!.uncertainties;delete bc.properties!.uncertainties;expect(ac).toEqual(bc);expect(JSON.stringify(input)).toBe(before);
});

function negativeControls(){
 const controls:Array<{id:string;input:ContextInput}>=[],control=(id:string,mutate:(input:ContextInput)=>void)=>{const input=structuredClone(bound);mutate(input);controls.push({id,input});};
 for(const state of ["PROPOSED","RESOLVED","CONFLICT"])for(const value of ["BEFORE_EVENT","INCLUDING_EVENT","STARTING_ON"])control(`relation_${state}_${value}`,i=>{Object.assign(i.activeRequest!.slots.eventRelation,{state,value,fact:null});});
 for(const field of ["eventRelation","reminderDate","endDate","leadOffsetDays","reminderTime","eventTime","calendar"] as const)control(`occupied_${field}`,i=>{Object.assign(i.activeRequest!.slots[field],{state:"RESOLVED",value:field==="eventRelation"?"BEFORE_EVENT":field==="calendar"?"GREGORIAN":field==="leadOffsetDays"?2:field.includes("Time")?{hour:8,minute:0,qualifier:"H24"}:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:10,month:10,year:null,leapMonth:null},fact:null});});
 for(const field of ["frequency","occurrenceCount","eventDate"] as const){
  control(`missing_fact_${field}`,i=>{i.facts=i.facts.filter(f=>f.field!==field);});
  control(`duplicate_fact_${field}`,i=>{i.facts.push({...structuredClone(i.facts.find(f=>f.field===field)!),alias:"f999"});});
  control(`mismatched_fact_${field}`,i=>{Object.assign(i.facts.find(f=>f.field===field)!,{value:field==="frequency"?"ONCE":field==="occurrenceCount"?3:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:12,month:10,year:null,leapMonth:null}});});
  control(`unknown_provenance_${field}`,i=>{Object.assign(i.facts.find(f=>f.field===field)!,{provenance:{kind:"DERIVED_POLICY",policyVersion:"synthetic-control",dependencies:[],referenceTime:i.reference.instant}});});
  control(`wrong_source_reference_${field}`,i=>{i.facts.find(f=>f.field===field)!.sourceReferenceTime="2026-09-28T03:01:00Z";});
  control(`wrong_scope_${field}`,i=>{Object.assign(i.facts.find(f=>f.field===field)!,{scope:"QUERY"});});
  control(`proposed_dependency_${field}`,i=>{i.activeRequest!.slots[field].state="PROPOSED";});
 }
 control("missing_clock_stale_pending",i=>{Object.assign(i.activeRequest!.slots.reminderTime,{state:"RESOLVED",value:{hour:8,minute:0,qualifier:"H24"},fact:null});});
 control("bound_relation_fact_orphan",i=>{i.facts.push({...structuredClone(i.facts[0]),scope:"REMINDER",alias:"f999",field:"eventRelation",value:"BEFORE_EVENT"});});
 control("unknown_history",i=>{i.turns.splice(1,0,{role:"USER",text:"Có thể khác."});i.currentTurn++;});
 control("relation_ambiguity_history",i=>{i.ambiguities=[{field:"eventRelation",reason:"AMBIGUOUS",alternatives:[]}];});
 control("no_gregorian_capability",i=>{i.capabilities.calendars=[];});
 control("invalid_reference",i=>{i.reference.instant="invalid";});
 for(const [id,text] of [["count_source_mismatch","Ngày 11/10 đi thi ở Quang Trung, nhắc 3 ngày liên tiếp."],["date_source_mismatch","Ngày 12/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp."],["explicit_year_source","Ngày 11/10/2026 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp."],["source_unknown_layout","Ngày 11/10 đi thi ở Quang Trung, nhắc 2  ngày liên tiếp."],["conflicting_venue_cues_without_fact","Ngày 11/10 đi thi tại Bao Gồm Ngày Thi Bắt Đầu Từ Mai, nhắc 2 ngày liên tiếp."]])control(id,i=>{i.turns[0].text=text;});
 control("current_unknown_layout",i=>{i.turns[i.currentTurn].text="Nhắc\ttrước 2 ngày.";});
 return controls;
}
it("all49 negative ownership controls retain exact prior language or refusal",()=>{
 const controls=negativeControls();expect(controls).toHaveLength(49);
 for(const {id,input} of controls){const before=JSON.stringify(input);expect(capability.isBoundRelationUncertaintyAbsent(input),id).toBe(false);
  if(ContextInputSchema.safeParse(input).success){const current=schema(input),old=wire100RequestFixture(input).response_format.json_schema.schema;expect(current,id).toEqual(old);const a=validator(input),b=z.fromJSONSchema(inline(old,old.properties!.uncertainties) as Parameters<typeof z.fromJSONSchema>[0]);for(let fieldCode=0;fieldCode<16;fieldCode++)for(const reason of ["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])for(let n=0;n<=2;n++){const raw=[{fieldCode,reason,alternatives:Array(n).fill("{}")}];expect(a.safeParse(raw).success,`${id}/${fieldCode}/${reason}/${n}`).toBe(b.safeParse(raw).success);}}
  else {let prior:unknown,current:unknown;try{wire100RequestFixture(input);}catch(e){prior=e;}try{schema(input);}catch(e){current=e;}expect(prior).toBeInstanceOf(Error);expect((current as Error).constructor).toBe((prior as Error).constructor);expect((current as Error).message).toBe((prior as Error).message);}
  expect(JSON.stringify(input)).toBe(before);
 }
});
it.each(["provenance","dependencies"])("missing factual %s does not establish ownership",property=>{
 const input=structuredClone(bound);Reflect.deleteProperty(input.facts.find(f=>f.field==="frequency")!,property);
 expect(capability.isBoundRelationUncertaintyAbsent(input)).toBe(false);
 expect(()=>schema(input)).toThrow("EVIDENCE_SOURCE_CONTEXT_INVALID");expect(()=>wire100RequestFixture(input)).toThrow("EVIDENCE_SOURCE_CONTEXT_INVALID");
});

it.each(["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"] as const)("consumer preserves relation %s with0/1/2 candidates",reason=>{
 for(let n=0;n<=2;n++){const p=ConversationInterpretationV3Schema.parse(frozenContextProposal(bound,"R02",1)),evidence=[{kind:"USER_QUOTE" as const,turn:bound.currentTurn,quote:bound.turns[bound.currentTurn].text,occurrence:1}];p.uncertainties=[{field:"eventRelation",reason,alternatives:Array.from({length:n},()=>({value:"BEFORE_EVENT" as const,evidence}))}];const raw=encodeFixtureV3(p,bound),before=JSON.stringify(raw);expect(decodeGoogleLiteEuContextTransportV3(raw,CONTEXT_PROTOCOL_V3,undefined,undefined,bound)).toMatchObject({status:"PARSED",value:{semantic:{uncertainties:p.uncertainties}}});expect(JSON.stringify(raw)).toBe(before);}
});

it.each(["R02","R03"].flatMap(id=>([null,"MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"] as const).map(reason=>({id,reason}))))("whole $id bound reason=$reason preserves backend authority",async({id,reason})=>{
 const first=id==="R02"?"Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp.":"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.";
 const h=await createContextContractProbe({sourceSha,referenceNow:Date.parse("2026-09-28T03:00:00Z")},(input,index)=>{const p=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,id,index-1));if(index===2&&reason)p.uncertainties=[{field:"eventRelation",reason,alternatives:reason==="MISSING"?[]:[{value:"BEFORE_EVENT",evidence:[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]}]}];return p;});
 try{const turns=id==="R02"?[first,"Nhắc trước 2 ngày.","8h."]:[first,"Nhắc trước 2 ngày."],outcomes=[];for(let n=0;n<turns.length;n++){const result=await h.turn(turns[n],`2026-09-28T03:0${n}:00Z`);expect(result).toMatchObject({fullSchemaValid:true,listStoreReads:0,mutations:0});outcomes.push(result);}if(!reason)expect(outcomes.at(-1)!.status).toBe("DRAFT_CREATED");else if(reason==="MISSING")expect(outcomes[1].status).toBe("REJECTED");else expect(outcomes.at(-1)!.pendingField).toBe("eventRelation");}finally{h.dispose();}
});

function oldModule(path:string){return execFileSync("git",["show",`${sourceSha}:${path}`],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});}
function compileSpecimen<T>(source:string,name:string,bindings:Record<string,unknown>):T{
 const body=ts.transpileModule(source.replaceAll("export ",""),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return Function(...Object.keys(bindings),body+`;return ${name};`)(...Object.values(bindings)) as T;
}
it("source/date and private cadence extraction preserve58 old wrapper decisions",()=>{
 const original=oldModule("src/modules/conversation/context-contract/semantic-completeness.ts"),a=original.indexOf("export function isInitialEventDateOnlySource("),b=original.indexOf("export function reminderDateCoverageComplete(",a);
 const oldDate=compileSpecimen<(input:ContextInput)=>boolean>(original.slice(a,b),"isInitialEventDateOnlySource",{isInitialIsolatedExamNotesFree,extractTemporalEvidence});
 const field=oldModule("src/modules/conversation/context-contract/field-capability.ts"),c=field.indexOf("function initialCadenceCountProbes("),d=field.indexOf("/** Numeric/clock generation upper bounds",c);
 const cadence=field.slice(c,d),bindings={isInitialIsolatedExamNotesFree,supportsCadenceOperand,supportsLeadOffset};
 const oldUnique=compileSpecimen<(input:ContextInput)=>boolean>(cadence,"isInitialUniqueCadenceCountRequired",bindings),oldSupported=compileSpecimen<(input:ContextInput)=>boolean>(cadence,"isInitialSupportedCadenceCount",bindings);
 const inputs=rows.map(row=>structuredClone(row.initialInput));
 for(const text of ["Ngày 11/10 đi thi.","Ngày 11/10/2026 đi thi, nhắc 2 ngày liên tiếp.","Ngày 29/2/2025 đi thi.","Ngày 31/13 đi thi.","Ngày 11/10 đi thi, gọi mẹ.","Ngày 11/10 âm đi thi.","Mai đi thi.","Ngày 11/10 đi thi, ngày 11/10.","Ngày 11/10 đi thi, nhắc tôi ngày 10/10.","Ngày 11/10 đi thi?","Nếu ngày 11/10 đi thi.","Ngày 11/10 đi thi [CONTROL]"])for(const instant of ["2025-01-01T00:00:00Z","2026-09-28T03:00:00Z","2027-01-01T00:00:00Z","invalid"]){const initial=structuredClone(rows[0].initialInput);initial.turns[0].text=text;initial.reference.instant=instant;inputs.push(initial);}
 expect(inputs).toHaveLength(58);for(const input of inputs){const before=JSON.stringify(input);expect(isInitialEventDateOnlySource(input)).toBe(oldDate(input));expect(capability.isInitialUniqueCadenceCountRequired(input)).toBe(oldUnique(input));expect(capability.isInitialSupportedCadenceCount(input)).toBe(oldSupported(input));expect(JSON.stringify(input)).toBe(before);}
});
it("shared relation catalogue/casefold preserves old unique licensing and declines conflicting cues",()=>{
 const original=oldModule("src/modules/conversation/context-contract/event-relation-evidence.ts"),start=original.indexOf("export function supportsEventRelation(");
 const old=compileSpecimen<typeof supportsEventRelation>(original.slice(start),"supportsEventRelation",{});
 const texts=[...sourceCases.map(c=>c.first),...sourceCases.map(c=>c.current),"Bao Gồm Ngày Thi Bắt Đầu Từ Mai","Nếu nhắc trước 2 ngày.","Không nhắc trước 2 ngày.",'"Nhắc trước 2 ngày."',"Nhắc trước  500 ngày.","Nhắc trước\t500 ngày.","xtrước 2 ngàyz","Nhắc cùng ngày.","Bắt đầu từ mai."];
 for(const text of texts){const turn={id:"public-source",role:"USER" as const,semanticView:text},length=[...text].length,source:SourceEvidence={kind:"USER_QUOTE",sourceTurnId:turn.id,sourceMapTurnId:turn.id,quote:text,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:"nfc-codepoint-v1"};
  for(const value of ["BEFORE_EVENT","INCLUDING_EVENT","STARTING_ON"] as const)for(const retained of [false,true]){const expected=old(value,[source],[turn],retained);expect(supportsEventRelation(value,[source],[turn],retained)).toBe(expected);hasEventRelationSourceCue(text);expect(supportsEventRelation(value,[source],[turn],retained)).toBe(expected);}
 }
 expect(hasEventRelationSourceCue("Bao Gồm Ngày Thi Bắt Đầu Từ Mai")).toBe(true);
});
it("historical bound inverse leaves current input and schema immutable",()=>{const before=JSON.stringify(bound),current=schema(bound);wire100RequestFixture(bound);expect(schema(bound)).toEqual(current);expect(JSON.stringify(bound)).toBe(before);});

it("wire107 certified factual continuation excludes only operation MISSING language",()=>{
 expect(validator(bound).safeParse([{fieldCode:15,reason:"MISSING",alternatives:[]}]).success).toBe(false);
 expect(validator(bound).safeParse([{fieldCode:6,reason:"MISSING",alternatives:[]}]).success).toBe(true);
 for(const reason of ["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"])
  expect(validator(bound).safeParse([{fieldCode:15,reason,alternatives:[]}]).success).toBe(true);
});
it("wire107 incomplete title or source ownership retains operation MISSING language",()=>{
 const mutations:((input:ContextInput)=>void)[]=[
  input=>{input.activeRequest!.slots.title={state:"MISSING",value:null,fact:null};},
  input=>{input.activeRequest!.slots.title.state="PROPOSED";},
  input=>{input.activeRequest!.slots.title.state="CONFLICT";},
  input=>{input.activeRequest!.slots.title.fact="f999";},
  input=>{input.facts.find(f=>f.field==="title")!.value="other subject";},
  input=>{input.facts.push({...input.facts.find(f=>f.field==="title")!,alias:"f999"});},
  input=>{input.facts=input.facts.filter(f=>f.field!=="title");},
  input=>{input.facts.find(f=>f.field==="title")!.provenance={kind:"DERIVED_POLICY",policyVersion:"control",dependencies:["f1"],referenceTime:input.reference.instant};},
  input=>{input.facts.find(f=>f.field==="title")!.dependencies=["f1"];},
  input=>{input.facts.find(f=>f.field==="title")!.sourceReferenceTime="2026-09-27T03:00:00Z";},
  input=>{input.pendingQuestion!.field="operation";},
  input=>{input.pendingQuestion!.scope="QUERY";input.pendingQuestion!.field="queryRange";},
  input=>{input.turns[input.currentTurn].text="Tạo việc mới, nhắc trước 2 ngày.";},
  input=>{input.turns[input.currentTurn].text="Nhắc trước 3 ngày.";},
 ];
 for(const mutate of mutations){const current=structuredClone(bound);mutate(current);
  expect(validator(current).safeParse([{fieldCode:15,reason:"MISSING",alternatives:[]}]).success).toBe(true);
 }
});

it.each([{day:15,month:11,count:3},{day:21,month:12,count:5}])("wire107 source proof generalizes across date/count $day/$month/$count",({day,month,count})=>{
 const input=structuredClone(bound);
 input.turns[0].text=`Ngày ${day}/${month} đi thi ở Quang Trung, nhắc ${count} ngày liên tiếp.`;
 input.turns[input.currentTurn].text=`Nhắc trước ${count} ngày.`;
 const date={kind:"CIVIL_DATE" as const,calendar:"GREGORIAN" as const,day,month,year:null,leapMonth:null};
 input.activeRequest!.slots.eventDate.value=date;input.activeRequest!.slots.occurrenceCount.value=count;
 input.facts.find(f=>f.field==="eventDate")!.value=date;input.facts.find(f=>f.field==="occurrenceCount")!.value=count;
 ContextInputSchema.parse(input);expect(capability.isBoundOperationMissingExcluded(input)).toBe(true);
 expect(validator(input).safeParse([{fieldCode:15,reason:"MISSING",alternatives:[]}]).success).toBe(false);
 expect(validator(input).safeParse([{fieldCode:15,reason:"AMBIGUOUS",alternatives:[]}]).success).toBe(true);
 const mismatch=structuredClone(input);mismatch.turns[input.currentTurn].text=`Nhắc trước ${count+1} ngày.`;
 expect(capability.isBoundOperationMissingExcluded(mismatch)).toBe(false);
 expect(validator(mismatch).safeParse([{fieldCode:15,reason:"MISSING",alternatives:[]}]).success).toBe(true);
});

it("wire107 historical helpers restore current producer guard on success and exception",()=>{
 const original=capability.isBoundOperationMissingExcluded;
 const check=()=>{expect(capability.isBoundOperationMissingExcluded).toBe(original);expect(vi.isMockFunction(capability.isBoundOperationMissingExcluded)).toBe(false);expect(capability.isBoundOperationMissingExcluded(bound)).toBe(true);expect(validator(bound).safeParse([{fieldCode:15,reason:"MISSING",alternatives:[]}]).success).toBe(false);};
 for(const helper of [wire88RequestFixture,(input:ContextInput)=>typedSingletonSchemaFixture(capability.deriveGenerationFieldCapability(input),input)]){
  check();helper(bound);check();
  const invalid=structuredClone(bound);invalid.turns=[];
  expect(()=>helper(invalid)).toThrow();check();
 }
});
