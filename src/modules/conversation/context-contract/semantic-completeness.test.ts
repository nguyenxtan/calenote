// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildContextInputV2 } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { SemanticPatchProposalV3Schema, FieldChangeV3Schema, UncertaintyV3Schema, SLOT_NAMES } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { locationCoverageComplete, titleCoverageComplete, isInitialIsolatedExamNotesFree, isInitialEventDateOnlySource, reminderDateCoverageComplete } from "./semantic-completeness";
import { turn } from "./context-test-fixtures";
import { TranscriptEntrySchema } from "./state";
import { harness, proposal as scriptedProposal, complete } from "./service-test-support";
import { DownstreamDiagnosticSchema, type DownstreamDiagnostic } from "./downstream";
import * as completenessModule from "./semantic-completeness";
import {createContextContractProbe} from "../../../../tools/benchmark/context-contract-probe";
import {frozenContextProposal} from "../../../../tools/benchmark/context-contract-fixtures";
import regressions from "./benchmark/regressions.json";
import {deriveGenerationFieldCapability} from "./field-capability";
import {googleLiteEuContextWireSchemaV3} from "../../intelligence/infrastructure/openrouter/context-provider-wire";
it.each(["query-only","bound-clock"])("wire76 actual projected clock excludes notes atomically: %s",async marker=>{
 const script=regressions.cases.find(c=>c.id==="R02")!;
 for(const mode of ["correct","SET","REPLACE","CLEAR","alternative","missing"]){
  let lastControls:{notesFree:boolean;notesAllowed:boolean;ordinary:string}|undefined;
  const probe=await createContextContractProbe({sourceSha:"06f0a2ebde0427be6b310fabeb951518972a69b7",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{
   const proposed=frozenContextProposal(input,"R02",index-1) as {changes:unknown[];uncertainties:unknown[]};
   if(index===1)proposed.uncertainties=[{field:"queryRange",reason:"MISSING",alternatives:[]}];
   if(index===2&&marker==="bound-clock")proposed.uncertainties=[{field:"reminderTime",reason:"MISSING",alternatives:[]}];
   if(index===3){
    const schema=googleLiteEuContextWireSchemaV3(deriveGenerationFieldCapability(input),input).schema;lastControls={notesFree:completenessModule.isBoundRetainedSeriesNotesFree(input),notesAllowed:deriveGenerationFieldCapability(input).notesProposalAllowed,ordinary:JSON.stringify(schema.properties!.changes)};
    const evidence=[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
    if(["SET","REPLACE","CLEAR"].includes(mode))proposed.changes.push({field:"notes",operation:mode,value:mode==="CLEAR"?null:input.turns[input.currentTurn].text,evidence});
    if(mode==="alternative"||mode==="missing")proposed.uncertainties=[{field:"notes",reason:mode==="alternative"?"AMBIGUOUS":"MISSING",alternatives:mode==="alternative"?[{value:input.turns[input.currentTurn].text,evidence}]:[]}];
   }return proposed;
  });
  try{await probe.turn(script.turns[0].text,script.turns[0].receipt);await probe.turn(script.turns[1].text,script.turns[1].receipt);const result=await probe.turn(script.turns[2].text,script.turns[2].receipt);expect(lastControls).toMatchObject({notesFree:true,notesAllowed:false});expect(lastControls!.ordinary).not.toContain('"notes"');expect(result.fields.notes).toBeNull();expect(result.mutations).toBe(0);const refusal=probe.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_NOTES_UNOWNED");expect(refusal).toBe(!["correct","missing"].includes(mode));if(!refusal)expect(result.fields.reminderTime).toEqual({hour:8,minute:0,qualifier:"H24"});}finally{probe.dispose();}
 }
});
function clockNotesContinuation(){const input=notesContinuation("12h trưa.");input.turns.splice(2,0,{role:"USER",text:"Nhắc trước 2 ngày."},{role:"ASSISTANT",text:"Nhắc lúc nào?"});input.currentTurn=4;return input;}
it("wire76 exact bound missing marker preserves all other ambiguity guards",()=>{
 const base=clockNotesContinuation(),marker={field:"reminderTime",reason:"MISSING",alternatives:[]};
 base.ambiguities=[marker] as typeof base.ambiguities;expect(completenessModule.isBoundRetainedSeriesNotesFree(base)).toBe(true);
 base.ambiguities=[{field:"queryRange",reason:"MISSING",alternatives:[]},marker,marker] as typeof base.ambiguities;expect(completenessModule.isBoundRetainedSeriesNotesFree(base)).toBe(true);
 const invalid:unknown[]=[{}, {field:"reminderTime"},{...marker,field:"eventTime"},{...marker,reason:"AMBIGUOUS"},{...marker,reason:"CONFLICT"},{...marker,reason:"UNSUPPORTED_COMBINATION"},{...marker,alternatives:[null]},{...marker,extra:true},{...marker,[Symbol("private")]:true},{...marker,alternatives:new Array(1)},{...marker,alternatives:Object.assign([],{extra:true})}];
 let getters=0;for(const key of ["field","reason","alternatives"])invalid.push(Object.defineProperty({...marker},key,{get(){getters++;return marker[key as keyof typeof marker];}}));
 invalid.push(new Proxy(marker,{ownKeys(){throw Error("PRIVATE_UNAVAILABLE");}}));
 for(const issue of invalid){const input=clockNotesContinuation();input.ambiguities=[issue] as typeof input.ambiguities;expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(false);}
 expect(getters).toBe(0);
 const sparse=clockNotesContinuation();sparse.ambiguities=new Array(1);expect(completenessModule.isBoundRetainedSeriesNotesFree(sparse)).toBe(false);
 const offset=notesContinuation("Nhắc trước 2 ngày.");offset.ambiguities=[marker] as typeof offset.ambiguities;expect(completenessModule.isBoundRetainedSeriesNotesFree(offset)).toBe(false);
 for(const field of ["eventTime","eventDate"] as const){const input=clockNotesContinuation();input.pendingQuestion!.field=field;input.ambiguities=[marker] as typeof input.ambiguities;expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(false);}
 const scope=clockNotesContinuation();scope.pendingQuestion!.scope="QUERY";scope.ambiguities=[marker] as typeof scope.ambiguities;expect(completenessModule.isBoundRetainedSeriesNotesFree(scope)).toBe(false);
});
it("wire74 actual service rejects clock text as notes without merging the valid clock",async()=>{
 const date={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 const h=await harness([scriptedProposal({title:"đi thi",eventDate:date,frequency:"DAILY",occurrenceCount:2}),scriptedProposal({eventRelation:"BEFORE_EVENT"},"CURRENT"),scriptedProposal({reminderTime:{hour:12,minute:0,qualifier:"H24"},notes:"12h trưa."},"CURRENT")]);
 await h.turn(0,"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi.");await h.turn(1,"Nhắc trước 2 ngày.");const before=await h.read(2);await h.turn(2,"12h trưa.");const after=await h.read(3);expect(after?.slots.notes.value).toBeNull();expect(after?.slots.reminderTime.value).toEqual(before?.slots.reminderTime.value);expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_NOTES_UNOWNED")).toBe(true);expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);
});
it("wire74 clock notes exclusion preserves meaningful history and each binding prerequisite",()=>{
 const baseline=clockNotesContinuation(),before=JSON.stringify(baseline);expect(completenessModule.isBoundRetainedSeriesNotesFree(baseline)).toBe(true);expect(JSON.stringify(baseline)).toBe(before);
 const direct=notesContinuation("9h.");expect(completenessModule.isBoundRetainedSeriesNotesFree(direct)).toBe(true);
 const repeated=clockNotesContinuation();repeated.turns.splice(4,0,{role:"USER",text:"Nhắc trước hai ngày."});repeated.currentTurn=5;expect(completenessModule.isBoundRetainedSeriesNotesFree(repeated)).toBe(true);
 for(const text of ["mang giấy tờ","Nhắc trước 3 ngày.","Nhắc trước 2 ngày, mang giấy tờ.","Bắt đầu nhắc trước 2 ngày.","Nhắc một lần trước 2 ngày.","Không nhắc trước 2 ngày.",'"Nhắc trước 2 ngày."',"Nhắc trước 2 ngày [CONTROL]","unknown"]){const input=clockNotesContinuation();input.turns[2].text=text;expect(completenessModule.isBoundRetainedSeriesNotesFree(input),text).toBe(false);}
 for(const text of ["Ngày 11/10 đi thi mang giấy tờ.","Ngày 11/10 đi thi. Ghi chú mang giấy tờ.","unknown"]){const input=clockNotesContinuation();input.turns[0].text=text;expect(completenessModule.isBoundRetainedSeriesNotesFree(input),text).toBe(false);}
 for(const text of ["9h và 10h.","9h mang giấy tờ.","Sửa 9h.","Không 9h.","Nếu 9h.",'"9h."',"9h [CONTROL]","9h; tạo nhắc việc mới.","chiều","25h."]){const input=clockNotesContinuation();input.turns[4].text=text;expect(completenessModule.isBoundRetainedSeriesNotesFree(input),text).toBe(false);}
 const changes:Array<(input:typeof baseline)=>void>=[v=>{v.currentTurn=0},v=>{v.turns[4].role="ASSISTANT"},v=>{v.pendingQuestion!.field="eventTime"},v=>{v.pendingQuestion!.scope="QUERY"},v=>{v.capabilities.supported=["ONCE"]},v=>{Reflect.set(v.capabilities.limits,"dailyCount",29)},v=>{v.activeRequest!.slots.frequency.value="WEEKLY"},v=>{v.activeRequest!.slots.occurrenceCount.value=31},v=>{v.activeRequest!.slots.occurrenceCount.value=1},v=>{v.activeRequest!.slots.occurrenceCount.value=2.5},v=>{v.activeRequest!.slots.notes.state="PROPOSED";v.activeRequest!.slots.notes.value="meaningful"},v=>{v.activeRequest!.slots.notes.fact="f1"},v=>{v.facts.push({alias:"f1",scope:"REMINDER",field:"notes",value:"meaningful",provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:v.reference.instant,dependencies:[]})},v=>{v.ambiguities=[{field:"notes",reason:"MISSING",alternatives:[]}]}];
 for(const field of ["frequency","occurrenceCount","eventDate"] as const)changes.push(v=>{v.activeRequest!.slots[field].state="CONFLICT"},v=>{v.activeRequest!.slots[field].value=null});
 for(const mutate of changes){const input=structuredClone(baseline);mutate(input);expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(false);}
 for(const key of ["turns","currentTurn","facts","ambiguities","activeRequest","pendingQuestion","capabilities"]){const input=structuredClone(baseline);Reflect.deleteProperty(input,key);expect(completenessModule.isBoundRetainedSeriesNotesFree(input),key).toBe(false);}
 for(const reference of [undefined,{instant:"invalid"}]){const input=structuredClone(baseline);Reflect.set(input,"reference",reference);expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(false);}
 const marker=clockNotesContinuation();marker.ambiguities=[{field:"queryRange",reason:"MISSING",alternatives:[]}];expect(completenessModule.isBoundRetainedSeriesNotesFree(marker)).toBe(true);
});
it("wire74 meaningful earlier notes and retained FACT reuse survive whole clock replies",async()=>{
 const first="Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi. Ghi chú mang giấy tờ.",date={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 for(const factReuse of [false,true]){
  const h=await harness([scriptedProposal({title:"đi thi",eventDate:date,frequency:"DAILY",occurrenceCount:2,...(factReuse?{notes:"mang giấy tờ"}:{})}),scriptedProposal({eventRelation:"BEFORE_EVENT"},"CURRENT"),input=>{
   const current=[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}],fact=input.facts.find(f=>f.field==="notes");if(factReuse&&!fact)throw Error("NOTES_FACT_REQUIRED");
   return {schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence:current},changes:[{field:"reminderTime",operation:"SET",value:{hour:12,minute:0,qualifier:"H24"},evidence:current},{field:"notes",operation:"SET",value:"mang giấy tờ",evidence:factReuse?[{kind:"CONTEXT_FACT",ref:fact!.alias}]:[{kind:"USER_QUOTE",turn:0,quote:first,occurrence:1}]}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null};
  }]);await h.turn(0,first);await h.turn(1,"Nhắc trước 2 ngày.");await h.turn(2,"12h trưa.");const input=h.inputs.at(-1)!;expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(false);expect(deriveGenerationFieldCapability(input).notesProposalAllowed).toBe(true);const state=await h.read(3);expect(state?.slots.notes.value).toBe("mang giấy tờ");expect(state?.slots.reminderTime.value).toEqual({hour:12,minute:0,qualifier:"H24"});expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_NOTES_UNOWNED")).toBe(false);expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);
 }
});
it("wire74 clock exclusion remains CURRENT-only and leaves NEW source ownership strict",()=>{
 const input=clockNotesContinuation(),evidence=[{kind:"USER_QUOTE" as const,turn:4,quote:input.turns[4].text,occurrence:1}];
 for(const operation of ["SET","REPLACE","CLEAR"]){const proposal=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"notes",operation,value:operation==="CLEAR"?null:"private-note",evidence}],query:null,uncertainties:[]});expect(completenessModule.notesCoverageComplete(input,proposal)).toBe(false);expect(completenessModule.notesCoverageComplete(input,{...proposal,requestTarget:{kind:"NEW",evidence}})).toBe(true);}
});
it("wire74 NEW clock request still cannot borrow earlier meaningful notes",async()=>{
 const first="Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi. Ghi chú mang giấy tờ.",date={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 const h=await harness([scriptedProposal({title:"đi thi",eventDate:date,frequency:"DAILY",occurrenceCount:2}),scriptedProposal({eventRelation:"BEFORE_EVENT"},"CURRENT"),input=>({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]},changes:[{field:"notes",operation:"SET",value:"mang giấy tờ",evidence:[{kind:"USER_QUOTE",turn:0,quote:first,occurrence:1}]}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null})]);
 await h.turn(0,first);await h.turn(1,"Nhắc trước 2 ngày.");await h.turn(2,"12h trưa.");const state=await h.read(3);expect(state?.slots.notes.value).toBeNull();expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="EVIDENCE_INVALID")).toBe(true);expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);
});
it("wire72 actual projection retains missing query marker while excluding continuation notes",async()=>{
 const script=regressions.cases.find(c=>c.id==="R02")!;
 for(const mode of ["correct","change","alternative"]){const probe=await createContextContractProbe({sourceSha:"5140639d30684ee29b634967ff6db6340b506f2f",referenceNow:Date.parse(script.turns[0].receipt)},(input,index)=>{const proposed=frozenContextProposal(input,"R02",index-1) as {uncertainties:unknown[];changes:unknown[]};if(index===1)proposed.uncertainties=[{field:"queryRange",reason:"MISSING",alternatives:[]}];else {expect(input.ambiguities).toEqual([{field:"queryRange",reason:"MISSING",alternatives:[]}]);expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(true);expect(deriveGenerationFieldCapability(input).notesProposalAllowed).toBe(false);const schema=googleLiteEuContextWireSchemaV3(deriveGenerationFieldCapability(input),input).schema;expect(JSON.stringify(schema.properties!.changes)).not.toContain('"notes"');if(mode==="change")proposed.changes.push({field:"notes",operation:"SET",value:input.turns[input.currentTurn].text,evidence:[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]});if(mode==="alternative")proposed.uncertainties=[{field:"notes",reason:"AMBIGUOUS",alternatives:[{value:input.turns[input.currentTurn].text,evidence:[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]}]}];}return proposed;});try{await probe.turn(script.turns[0].text,script.turns[0].receipt);const result=await probe.turn(script.turns[1].text,script.turns[1].receipt);expect(result.fields.notes).toBeNull();expect(result.mutations).toBe(0);if(mode!=="correct")expect(probe.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_NOTES_UNOWNED")).toBe(true);else expect(result.fields.eventRelation).toBe("BEFORE_EVENT");}finally{probe.dispose();}}
});
function notesContinuation(text="Nhắc trước 2 ngày.") {
 const msg=message("Ngày 11/10 đi thi."),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});if(built.status!=="READY")throw Error("NOT_READY");
 const input=structuredClone(built.input);input.turns=[{role:"USER",text:"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp."},{role:"ASSISTANT",text:"Nhắc lúc nào?"},{role:"USER",text}];input.currentTurn=2;
 const slots=Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<typeof input.activeRequest>["slots"];
 slots.frequency={state:"PROPOSED",value:"DAILY",fact:null};slots.occurrenceCount={state:"PROPOSED",value:2,fact:null};slots.eventDate={state:"PROPOSED",value:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},fact:null};
 input.activeRequest={lifecycle:"CLARIFYING",slots};input.pendingQuestion={scope:"REMINDER",field:"reminderTime",reason:"MISSING",text:"time?",decisionKind:null};return input;
}
it("wire72 only exact empty missing query markers are irrelevant to bound reminder notes",()=>{
 const marker={field:"queryRange",reason:"MISSING",alternatives:[]};for(const issues of [[],[marker],[marker,marker]]){const input=notesContinuation();input.ambiguities=issues as typeof input.ambiguities;const before=JSON.stringify(input);expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(true);expect(JSON.stringify(input)).toBe(before);}
 const invalid:unknown[]=[null,{}, {...marker,extra:"private"},{...marker,field:"notes"},{...marker,field:"operation"},...['AMBIGUOUS','CONFLICT','UNSUPPORTED_COMBINATION'].map(reason=>({...marker,reason})),{...marker,alternatives:[{}]},{...marker,alternatives:null},{...marker,alternatives:{}},Object.defineProperty({...marker},"field",{get(){throw Error("NO_GETTER");}})];for(const issue of invalid){const input=notesContinuation();input.ambiguities=[issue] as typeof input.ambiguities;expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(false);}const sparse=notesContinuation();sparse.ambiguities=new Array(1);expect(completenessModule.isBoundRetainedSeriesNotesFree(sparse)).toBe(false);
});
it("wire72 query markers reject symbols, array properties and context cardinality overflow",()=>{
 const marker={field:"queryRange",reason:"MISSING",alternatives:[]};for(const issue of [{...marker,[Symbol("private")]:true},{...marker,alternatives:Object.assign([],{private:true})}]){const input=notesContinuation();input.ambiguities=[issue] as typeof input.ambiguities;expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(false);}const input=notesContinuation();input.ambiguities=Array.from({length:5},()=>marker) as typeof input.ambiguities;expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(false);
});
it("wire70 sufficient notes exclusion requires every trusted binding and complete source, never mutates context",()=>{
 for(const text of ["Nhắc trước 2 ngày.","Nhắc trước hai ngày.","Nhắc 2 ngày trước ngày thi."]){for(const state of ["PROPOSED","RESOLVED"] as const){const input=notesContinuation(text);for(const field of ["frequency","occurrenceCount","eventDate"] as const)input.activeRequest!.slots[field].state=state;const before=JSON.stringify(input);expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(true);expect(JSON.stringify(input)).toBe(before);}}
 for(const text of ["Nhắc trước 3 ngày.","Nhắc trước 2 ngày giúp tôi.","Nhắc trước 2 ngày; ghi chú mang giấy tờ.","Nhắc trước 2 ngày mang giấy tờ.","Sửa ghi chú: nhắc trước 2 ngày.","Bắt đầu nhắc trước 2 ngày.","Nhắc một lần trước 2 ngày.","Ngày 20/12 đi làm việc mới, nhắc trước 2 ngày.","Nhắc trước 2 ngày lúc 8h.","Nhắc trước 2 ngày; nhắc trước 2 ngày.","Không nhắc trước 2 ngày.","Nếu nhắc trước 2 ngày.",'"Nhắc trước 2 ngày."',"Nhắc trước 2 ngày [CONTROL]"]){expect(completenessModule.isBoundRetainedSeriesNotesFree(notesContinuation(text)),text).toBe(false);}
 const input=notesContinuation();
 for(const key of ["turns","currentTurn","facts","ambiguities","activeRequest","pendingQuestion","capabilities"]){const changed=structuredClone(input);Reflect.deleteProperty(changed,key);expect(completenessModule.isBoundRetainedSeriesNotesFree(changed),key).toBe(false);}
 const changes:Array<(value:typeof input)=>void>=[v=>{v.currentTurn=0},v=>{v.turns[2].role="ASSISTANT"},v=>{v.capabilities.supported=["ONCE"]},v=>{Reflect.set(v.capabilities.limits,"dailyCount",29)},v=>{v.pendingQuestion!.scope="QUERY"},v=>{v.ambiguities.push({field:"notes",reason:"AMBIGUOUS",alternatives:[]})},v=>{v.activeRequest!.slots.frequency.value="WEEKLY"},v=>{v.facts.push({alias:"f1",scope:"REMINDER",field:"notes",value:"mang giấy tờ",provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:v.reference.instant,dependencies:[]})},v=>{v.activeRequest!.slots.notes.fact="f1"}];
 for(const field of ["frequency","occurrenceCount","eventDate"] as const){changes.push(v=>{v.activeRequest!.slots[field].state="CONFLICT"},v=>{v.activeRequest!.slots[field].value=null});}
 for(const count of [1,31,2.5])changes.push(v=>{v.activeRequest!.slots.occurrenceCount.value=count});
 for(const state of ["PROPOSED","RESOLVED","CONFLICT"] as const)changes.push(v=>{v.activeRequest!.slots.notes.state=state;v.activeRequest!.slots.notes.value="meaningful"});
 for(const mutate of changes){const changed=structuredClone(input);mutate(changed);expect(completenessModule.isBoundRetainedSeriesNotesFree(changed)).toBe(false);}
 for(const count of [3,30]){const changed=notesContinuation(`Nhắc trước ${count} ngày.`);changed.activeRequest!.slots.occurrenceCount.value=count;expect(completenessModule.isBoundRetainedSeriesNotesFree(changed)).toBe(true);}
});
it("wire70 earlier meaningful or unknown USER source and additional USER history preserve notes authority",()=>{
 for(const text of ["Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp. Ghi chú mang giấy tờ.","Ngày 11/10 đi thi mang giấy tờ.","Ghi chú mang giấy tờ.","unknown instruction"]){const input=notesContinuation();input.turns[0].text=text;expect(completenessModule.isBoundRetainedSeriesNotesFree(input),text).toBe(false);}
 const input=notesContinuation();input.turns.splice(1,0,{role:"USER",text:"mang giấy tờ"});input.currentTurn=3;expect(completenessModule.isBoundRetainedSeriesNotesFree(input)).toBe(false);
});
it("wire70 actual earlier USER notes reproposal and retained FACT reuse remain accepted",async()=>{
 const first="Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi. Ghi chú mang giấy tờ.",date={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 for(const factReuse of [false,true]){const h=await harness([scriptedProposal({title:"đi thi",eventDate:date,frequency:"DAILY",occurrenceCount:2,...(factReuse?{notes:"mang giấy tờ"}:{})}),input=>{const current=[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}],fact=input.facts.find(f=>f.field==="notes");if(factReuse&&!fact)throw Error("NOTES_FACT_REQUIRED");return {schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence:current},changes:[{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence:current},{field:"notes",operation:"SET",value:"mang giấy tờ",evidence:factReuse?[{kind:"CONTEXT_FACT",ref:fact!.alias}]:[{kind:"USER_QUOTE",turn:0,quote:first,occurrence:1}]}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null};}]);await h.turn(0,first);await h.turn(1,"Nhắc trước 2 ngày.");const state=await h.read(2);expect(state?.slots.notes.value).toBe("mang giấy tờ");expect(state?.slots.eventRelation.value).toBe("BEFORE_EVENT");expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_NOTES_UNOWNED")).toBe(false);expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);}
});
it("wire70 bound scheduling continuation rejects notes mutations and typed alternatives, preserving empty MISSING and NEW guards",()=>{
 const input=notesContinuation(),evidence=[{kind:"USER_QUOTE" as const,turn:2,quote:input.turns[2].text,occurrence:1}];
 for(const operation of ["SET","REPLACE","CLEAR"]){const proposal=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[{field:"notes",operation,value:operation==="CLEAR"?null:"private-note",evidence}],query:null,uncertainties:[]});const before=JSON.stringify(proposal);expect(completenessModule.notesCoverageComplete(input,proposal)).toBe(false);expect(JSON.stringify(proposal)).toBe(before);expect(completenessModule.notesCoverageComplete(input,{...proposal,requestTarget:{kind:"NEW",evidence}})).toBe(true);}
 for(const typed of [false,true]){const proposal=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence},changes:[],query:null,uncertainties:[{field:"notes",reason:typed?"AMBIGUOUS":"MISSING",alternatives:typed?[{value:"private-note",evidence}]:[]}]});expect(completenessModule.notesCoverageComplete(input,proposal)).toBe(!typed);}
});
it("wire70 actual service refuses scheduling text as notes without partial merge",async()=>{
 const date={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 for(const misplaced of [false,true]){const h=await harness([scriptedProposal({title:"đi thi",eventDate:date,frequency:"DAILY",occurrenceCount:2}),scriptedProposal({eventRelation:"BEFORE_EVENT",...(misplaced?{notes:"Nhắc trước 2 ngày."}:{})},"CURRENT")]);await h.turn(0,"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi.");const prior=await h.read(1);expect(prior?.slots.notes.value).toBeNull();await h.turn(1,"Nhắc trước 2 ngày.");const next=await h.read(2);expect(next?.slots.notes.value).toBeNull();if(misplaced){expect(next?.slots.eventRelation.value).toEqual(prior?.slots.eventRelation.value);expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_NOTES_UNOWNED")).toBe(true);}else expect(next?.slots.eventRelation.value).toBe("BEFORE_EVENT");expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);}
});
it("wire70 actual typed notes alternative is atomically refused, while empty notes MISSING survives",async()=>{
 const date={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 for(const typed of [false,true]){const h=await harness([scriptedProposal({title:"đi thi",eventDate:date,frequency:"DAILY",occurrenceCount:2}),input=>{const value=scriptedProposal({eventRelation:"BEFORE_EVENT"},"CURRENT")(input) as Record<string,unknown>;return {...value,uncertainties:[{field:"notes",reason:typed?"AMBIGUOUS":"MISSING",alternatives:typed?[{value:input.turns[input.currentTurn].text,evidence:[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]}]:[]}]};}]);await h.turn(0,"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi.");const before=await h.read(1);await h.turn(1,"Nhắc trước 2 ngày.");const after=await h.read(2);expect(after?.slots.notes.value).toBeNull();if(typed){expect(after?.slots.eventRelation.value).toEqual(before?.slots.eventRelation.value);expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_NOTES_UNOWNED")).toBe(true);}else expect(after?.slots.eventRelation.value).toBe("BEFORE_EVENT");expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);}
});
it("wire69 service rejects duplicated initial event date ownership atomically",async()=>{
 const value={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 const h=await harness([scriptedProposal({title:"đi thi",eventDate:value,reminderDate:value,frequency:"DAILY",occurrenceCount:2})]);
 await h.turn(0,"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi.");
 const state=await h.read(1);expect(state?.slots.title.value??null).toBeNull();expect(state?.slots.reminderDate.value??null).toBeNull();
 expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_REMINDER_DATE_UNOWNED")).toBe(true);
 expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);
});
it("wire69 event date ownership requires full initial context, adjacent prefix, one token and resolved classifier",()=>{
 const initial=(text:string)=>{const msg=message("Ngày 11/10 đi thi."),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});if(built.status!=="READY")throw Error("NOT_READY");const input=structuredClone(built.input);input.turns[0].text=text;return input;};
 for(const text of ["Ngày 11/10 đi thi.","Ngày 11/10/2026 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.","Ngày 11-10 đi thi, nhắc lúc 8h."]){const input=initial(text),before=JSON.stringify(input);expect(isInitialEventDateOnlySource(input)).toBe(true);expect(JSON.stringify(input)).toBe(before);for(const instant of ["2025-01-01T00:00:00Z","2027-01-01T00:00:00Z"]){const changed=structuredClone(input);changed.reference.instant=instant;expect(isInitialEventDateOnlySource(changed)).toBe(true);}}
 for(const text of ["Ngày 11/10 đi thi ngày 11/10.","Ngày 11/10 đi thi ngày 12/10.","Đi thi ngày 11/10.","Tôi thi ngày 11/10 lúc 8h.","Mai đi thi.","Ngày 11/10 âm đi thi.","Ngày 11/10 đi thi âm lịch.","Ngày 31/13 đi thi.","Ngày 29/2/2025 đi thi.","Ngày 11/10 đi thi, nhắc tôi ngày 10/10.","Ngày 11/10 đi thi, gọi mẹ.",'"Ngày 11/10 đi thi."',"Nếu ngày 11/10 đi thi.","Không ngày 11/10 đi thi.","Ngày 11/10 đi thi?","Ngày 11/10 đi thi [CONTROL]","Sửa ngày 11/10 đi thi."]){expect(isInitialEventDateOnlySource(initial(text)),text).toBe(false);}
 const input=initial("Ngày 11/10 đi thi.");
 for(const key of ["activeRequest","facts","pendingQuestion","ambiguities","turns","currentTurn","reference"]){const missing=structuredClone(input);Reflect.deleteProperty(missing,key);expect(isInitialEventDateOnlySource(missing),key).toBe(false);}
 for(const mutate of [(v:typeof input)=>{v.turns[0].role="ASSISTANT"},(v:typeof input)=>{v.turns.push({role:"USER",text:v.turns[0].text});v.currentTurn=1},(v:typeof input)=>{v.pendingQuestion={scope:"REMINDER",field:"reminderDate",reason:"MISSING",text:"date?",decisionKind:null}},(v:typeof input)=>{v.ambiguities.push({field:"reminderDate",reason:"AMBIGUOUS",alternatives:[]})},(v:typeof input)=>{v.facts.push({alias:"f1",scope:"REMINDER",field:"reminderDate",value:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null},provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:v.reference.instant,dependencies:[]})},(v:typeof input)=>{v.activeRequest={lifecycle:"CLARIFYING",slots:Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<typeof input.activeRequest>["slots"]}}]){const changed=structuredClone(input);mutate(changed);expect(isInitialEventDateOnlySource(changed)).toBe(false);}
});
it("wire69 shared ownership refuses every date mutation or typed alternative, preserving empty MISSING and outside-context values",()=>{
 const msg=message("Ngày 11/10 đi thi."),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});if(built.status!=="READY")throw Error("NOT_READY");const evidence=[{kind:"USER_QUOTE",turn:0,quote:msg.text,occurrence:1}],date={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 for(const operation of ["SET","REPLACE","CLEAR"]){const value=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"reminderDate",operation,value:operation==="CLEAR"?null:date,evidence}],query:null,uncertainties:[]});const before=JSON.stringify(value);expect(reminderDateCoverageComplete(built.input,value)).toBe(false);expect(JSON.stringify(value)).toBe(before);}
 for(const alternative of [false,true]){const value=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"eventDate",operation:"SET",value:date,evidence}],query:null,uncertainties:[{field:"reminderDate",reason:alternative?"AMBIGUOUS":"MISSING",alternatives:alternative?[{value:date,evidence}]:[]}]});expect(reminderDateCoverageComplete(built.input,value)).toBe(!alternative);const diagnostics:DownstreamDiagnostic[]=[];const result=validateEvidenceV3(value,built,d=>diagnostics.push(d));if(alternative)expect(result).toEqual({status:"REFUSED",reason:"SEMANTIC_REMINDER_DATE_UNOWNED"});else expect(result.status).toBe("VALID");expect(JSON.stringify(diagnostics)).not.toContain(msg.text);for(const d of diagnostics)expect(DownstreamDiagnosticSchema.safeParse(d).success).toBe(true);}
});
it("wire50 notes predicate declines incomplete trusted contexts and meaningful detail",()=>{
 // Wire69 uses the same trusted initial boundary, not generic note/date parsing.
 const msg=message("Ngày 15/12 đi thi, nhắc 3 ngày liên tiếp giúp tôi."),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
 if(built.status!=="READY")throw Error("NOT_READY");const input=built.input;
 expect(isInitialIsolatedExamNotesFree(input)).toBe(true);
 const occupied=structuredClone(input);occupied.activeRequest={lifecycle:"CLARIFYING",slots:Object.fromEntries(SLOT_NAMES.map(field=>[field,{state:"MISSING",value:null,fact:null}])) as NonNullable<typeof input.activeRequest>["slots"]};expect(isInitialIsolatedExamNotesFree(occupied)).toBe(false);
 for(const key of ["turns","currentTurn","activeRequest","facts","pendingQuestion","ambiguities"]){const missing=structuredClone(input);Reflect.deleteProperty(missing,key);expect(isInitialIsolatedExamNotesFree(missing)).toBe(false);}
 for(const text of [msg.text+" Ghi chú mang giấy tờ.",msg.text+", nhớ mang giấy tờ.","Sửa ghi chú thành mang giấy tờ.","Xem lịch đi thi.","Không đi thi.",'"đi thi"',"[CONTROL] đi thi","Nếu đi thi.","Nhắc gọi mẹ."]){const changed=structuredClone(input);changed.turns[0].text=text;expect(isInitialIsolatedExamNotesFree(changed)).toBe(false);}
 for(const mutate of [(v:typeof input)=>{v.turns[0].role="ASSISTANT"},(v:typeof input)=>{v.turns.push({role:"USER",text:"đi thi"});v.currentTurn=1},(v:typeof input)=>{v.pendingQuestion={text:"ghi chú?",scope:"REMINDER",field:"notes",decisionKind:null,reason:"MISSING"}},(v:typeof input)=>{v.facts.push({alias:"f1",scope:"REMINDER",field:"notes",value:"mang giấy tờ",provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:input.reference.instant,dependencies:[]})},(v:typeof input)=>{v.ambiguities.push({field:"notes",reason:"AMBIGUOUS",alternatives:[]})}]){const changed=structuredClone(input);mutate(changed);expect(isInitialIsolatedExamNotesFree(changed)).toBe(false);}
});
it("wire69 service preserves correct event-only facts and independently stated reminder dates",async()=>{
 const date={kind:"CIVIL_DATE",calendar:"GREGORIAN",day:11,month:10,year:null,leapMonth:null};
 for(const explicit of [false,true]){const h=await harness([scriptedProposal({title:"đi thi",eventDate:date,frequency:"DAILY",occurrenceCount:2,...(explicit?{reminderDate:{...date,day:10}}:{})})]);
 await h.turn(0,"Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp giúp tôi."+(explicit?" Nhắc ngày 10/10.":""));const state=await h.read(1);
 expect(state?.slots.eventDate.value).toEqual(date);expect(state?.slots.reminderDate.value??null).toEqual(explicit?{...date,day:10}:null);
 expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_REMINDER_DATE_UNOWNED")).toBe(false);
 expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);}
});
it("wire50 finite notes rejection diagnostics never disclose authored notes or source text",()=>{
 const msg=message("Ngày 15/12 đi thi, nhắc 3 ngày liên tiếp giúp tôi."),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});if(built.status!=="READY")throw Error("NOT_READY");
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:msg.text,occurrence:1}],value=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},{field:"notes",operation:"SET",value:"PRIVATE_NOTES_SENTINEL",evidence}],query:null,uncertainties:[]});const diagnostics:DownstreamDiagnostic[]=[];
 expect(validateEvidenceV3(value,built,d=>diagnostics.push(d))).toEqual({status:"REFUSED",reason:"SEMANTIC_NOTES_UNOWNED"});expect(diagnostics).toContainEqual({stage:"EVIDENCE",result:"REJECTED",reason:"SEMANTIC_NOTES_UNOWNED"});for(const d of diagnostics)expect(DownstreamDiagnosticSchema.safeParse(d).success).toBe(true);expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_NOTES_SENTINEL");expect(JSON.stringify(diagnostics)).not.toContain(msg.text);
});
it("wire50 service atomically refuses notes restatement and retains meaningful notes outside boundary",async()=>{
 for(const meaningful of [false,true]){const h=await harness([scriptedProposal({title:"đi thi",notes:meaningful?"mang giấy tờ":"nhắc 3 ngày liên tiếp"})]);await h.turn(0,"Ngày 15/12 đi thi, nhắc 3 ngày liên tiếp giúp tôi."+(meaningful?" Ghi chú mang giấy tờ.":""));const state=await h.read(1);
 if(meaningful)expect(state?.slots.notes.value).toBe("mang giấy tờ");else{expect(state?.slots.notes.value??null).toBeNull();expect(state?.slots.title.value??null).toBeNull();expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_NOTES_UNOWNED")).toBe(true);}
 expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);}
});
it("wire50 complete isolated instruction rejects misplaced notes without modifying authored proposal",()=>{
 const msg=message("Ngày 15/12 đi thi, nhắc 3 ngày liên tiếp giúp tôi.");
 const built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
 expect(built.status).toBe("READY");if(built.status!=="READY")throw Error("NOT_READY");
 const evidence=[{kind:"USER_QUOTE",turn:0,quote:msg.text,occurrence:1}];
 for(const alternative of [false,true]){const value=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"title",operation:"SET",value:"đi thi",evidence},...(!alternative?[{field:"notes",operation:"SET",value:"nhắc 3 ngày liên tiếp",evidence}]:[])],query:null,uncertainties:alternative?[{field:"notes",reason:"AMBIGUOUS",alternatives:[{value:"nhắc 3 ngày liên tiếp",evidence}]}]:[]});const before=JSON.stringify(value);expect(validateEvidenceV3(value,built)).toEqual({status:"REFUSED",reason:"SEMANTIC_NOTES_UNOWNED"});expect(JSON.stringify(value)).toBe(before);}
});

function coverage(text: string, value?: string | null, options: {target?: "NEW" | "CURRENT"; retained?:string; source?:string; intent?:"LIST_REMINDERS"; uncertainty?:boolean; clear?:boolean} = {}) {
  const current=turn(text,"current"), sources=[{kind:"USER_QUOTE" as const,sourceTurnId:options.source??"current",sourceMapTurnId:"current",quote:text,occurrence:1,sourceSpan:{start:0,end:[...text].length},viewSpan:{start:0,end:[...text].length},normalizationVersion:"nfc-codepoint-v1" as const}];
  const bound={field:"location",sources,current:options.source===undefined,provenance:{kind:"EXPLICIT_USER" as const},referenceTime:current.receivedAt};
  return locationCoverageComplete({intent:options.intent??"CREATE_REMINDER",target:{kind:options.target??"NEW",evidence:[]},currentTurn:current,
    changes:value!==undefined&&!options.uncertainty?[FieldChangeV3Schema.parse({field:"location",operation:options.clear||value===null?"CLEAR":"SET",value,evidence:[{kind:"USER_QUOTE",turn:0,quote:text,occurrence:1}]})]:[],changeEvidence:[bound],
    uncertainties:options.uncertainty?[UncertaintyV3Schema.parse({field:"location",reason:"AMBIGUOUS",alternatives:value===undefined?[]:[{value,evidence:[{kind:"USER_QUOTE",turn:0,quote:text,occurrence:1}]}]})]:[],alternativeEvidence:[bound],retainedLocation:options.retained??null});
}

function titleCoverage(value: string|null|undefined, options:{text?:string;target?:"CURRENT"|"NEW";retained?:string;source?:string;uncertainty?:boolean;span?:{start:number;end:number};role?:"USER"|"ASSISTANT"}={}) {
  const text=options.text??"Ngày 11/10 đi thi, nhắc tôi trước 2 ngày.",current=options.role==="ASSISTANT" ? TranscriptEntrySchema.parse({...turn(text,"current"),role:"ASSISTANT",kind:"CLARIFICATION",deliveryState:"SENT"}) : turn(text,"current");
  const evidence=[{kind:"USER_QUOTE" as const,turn:0,quote:text,occurrence:1}];
  const bound={field:"title",current:!options.source,sources:[{kind:"USER_QUOTE" as const,sourceTurnId:options.source??"current",sourceMapTurnId:"current",quote:text,occurrence:1,sourceSpan:{start:0,end:[...text].length},viewSpan:options.span??{start:0,end:[...text].length},normalizationVersion:"nfc-codepoint-v1" as const}],provenance:{kind:"EXPLICIT_USER" as const},referenceTime:current.receivedAt};
  return titleCoverageComplete({intent:"CREATE_REMINDER",target:{kind:options.target??"NEW",evidence:[]},currentTurn:current,
    changes:value!==undefined&&!options.uncertainty?[FieldChangeV3Schema.parse({field:"title",operation:value===null?"CLEAR":"SET",value,evidence})]:[],changeEvidence:[bound],
    uncertainties:options.uncertainty?[UncertaintyV3Schema.parse({field:"title",reason:"AMBIGUOUS",alternatives:value===undefined?[]:[{value,evidence}]})]:[],alternativeEvidence:[bound],retainedTitle:options.retained??null});
}
it("finite bare exam normalization covers only authored title with validated current assertion",()=>{
 const text="Tôi thi ngày 11/10 lúc 8h.";
 expect(titleCoverage("đi thi",{text})).toBe(true);expect(titleCoverage("thi",{text})).toBe(false);expect(titleCoverage(undefined,{text})).toBe(false);
 expect(titleCoverage("đi thi",{text,source:"old"})).toBe(false);expect(titleCoverage("đi thi",{text,span:{start:0,end:7}})).toBe(false);
 expect(titleCoverage(undefined,{text,target:"CURRENT"})).toBe(true);
 expect(titleCoverage(undefined,{text,role:"ASSISTANT"})).toBe(true);
});
it("title completeness accepts only model subject coverage with current validated source",()=>{
  expect(titleCoverage("đi thi")).toBe(true);
  expect(titleCoverage("đi thi",{source:"old"})).toBe(false);
  expect(titleCoverage("đi thi",{span:{start:0,end:9}})).toBe(false);
  expect(titleCoverage("thi")).toBe(false);
  expect(titleCoverage("khác")).toBe(false);
  expect(titleCoverage(null)).toBe(false);
  expect(titleCoverage(undefined,{target:"CURRENT",retained:"đi thi"})).toBe(true);
  expect(titleCoverage(undefined,{target:"NEW",retained:"đi thi"})).toBe(false);
  expect(titleCoverage(undefined,{target:"CURRENT",retained:"khác"})).toBe(false);
  expect(titleCoverage(null,{target:"CURRENT",retained:"đi thi"})).toBe(false);
  expect(titleCoverage("đi thi",{uncertainty:true})).toBe(true);
  expect(titleCoverage(undefined,{uncertainty:true})).toBe(false);
  expect(titleCoverage(undefined,{role:"ASSISTANT"})).toBe(true);
});

describe("grounded location completeness before patch issuance", () => {
  it.each(["Ngày 11/10 đi thi, nhắc tôi uống thuốc lúc 8h.","Ngày 11/10 đi thi, nhắc tôi đóng tiền trước 2 ngày."])("accepts actual different reminder task without imposing exam title: %s",text=>{
    const msg=message(text),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
    if(built.status!=="READY")throw Error(built.reason);
    const ref={kind:"USER_QUOTE",turn:built.input.currentTurn,quote:text,occurrence:1};
    const changes=[{field:"title",operation:"SET",value:text.includes("uống thuốc")?"uống thuốc":"đóng tiền",evidence:[ref]},...(text.includes("trước 2 ngày")?[{field:"leadOffsetDays",operation:"SET",value:2,evidence:[ref]},{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence:[ref]}]:[])];
    const value=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[ref]},changes,query:null,uncertainties:[]});
    expect(validateEvidenceV3(value,built).status).toBe("VALID");
  });
  it("rejects R05 omitted explicit exam title atomically", () => {
    const msg=message("Ngày 11/10 đi thi, nhắc tôi trước 2 ngày.");
    const built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
    if(built.status!=="READY") throw Error(built.reason);
    const ref={kind:"USER_QUOTE",turn:built.input.currentTurn,quote:msg.text,occurrence:1};
    const value=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[ref]},changes:[{field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence:[ref]},{field:"leadOffsetDays",operation:"SET",value:2,evidence:[ref]}],query:null,uncertainties:[]});
    const before=JSON.stringify(value);
    expect(validateEvidenceV3(value,built)).toEqual({status:"REFUSED",reason:"SEMANTIC_TITLE_OMITTED"});
    expect(JSON.stringify(value)).toBe(before);
  });
  it("rejects R02's omitted explicit venue without filling or modifying the proposal", () => {
    const msg = message("Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
    const built = buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
    if(built.status!=="READY") throw new Error(built.reason);
    const ref={kind:"USER_QUOTE",turn:built.input.currentTurn,quote:msg.text,occurrence:1};
    const proposal=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:[ref]},changes:[{field:"title",operation:"SET",value:"đi thi",evidence:[ref]}],query:null,uncertainties:[]});
    const before=JSON.stringify(proposal);
    const diagnostics: DownstreamDiagnostic[]=[];
    expect(validateEvidenceV3(proposal,built,d=>diagnostics.push(d))).toEqual({status:"REFUSED",reason:"SEMANTIC_LOCATION_OMITTED"});
    expect(diagnostics.some(d=>d.reason==="SEMANTIC_LOCATION_OMITTED")).toBe(true);
    expect(diagnostics.every(d=>DownstreamDiagnosticSchema.safeParse(d).success)).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain("Quang Trung");
    expect(JSON.stringify(proposal)).toBe(before);
    expect(built.candidateSnapshot.slots.location.value).toBeNull();
  });
  it.each([
    ["đi thi ở Quang Trung", "Quang Trung", true],
    ["họp tại Công ty A", "Công ty A", true],
    ["đi thi ở Quang Trung", "khác", false],
    ["đi thi ở Quang Trung", null, false],
    ["đi thi ở Quang Trung", undefined, false],
    ["nhắc gọi mẹ", undefined, true],
    ["không đi thi ở Quang Trung", undefined, true],
    ["nếu đi thi ở Quang Trung", undefined, true],
    ["ví dụ đi thi ở Quang Trung", undefined, true],
    ["tên là đi thi ở Quang Trung", undefined, true],
    ["\"đi thi ở Quang Trung\"", undefined, true],
    ["đi thi ở đâu?", undefined, true],
    ["đi thi ở Quang Trung hay Công ty A", undefined, true],
    ["đi thi ở [CONTROL]", undefined, true],
    ["😀 đi thi ở Quang Trung", "Quang Trung", true],
    ["đi thi ở Quang Trung nhớ mang giấy tờ", "Quang Trung", true],
    ["đi thi ở Quang Trung nhé", "Quang Trung", true],
    ["đi thi ở Quang Trung rồi về nhà", "Quang Trung", true],
    ["đi thi ở Quang Trung và ăn trưa", "Quang Trung", true],
    ["họp tại Công ty Ngày Mới", "Công ty Ngày Mới", true],
    ["họp tại Công ty Ngày Mới", "Công ty", false],
    ["họp tại công ty ngày mới", "công ty", false],
    ["họp tại Công ty Nhớ Mãi", "Công ty", false],
    ["đi thi ở Quang Trung nhớ mua bút", "Quang Trung", true],
    ["họp tại Công ty A rồi chuẩn bị tài liệu", "Công ty A", true],
    ["đi thi ở Quang Trung nhớ mua bút", undefined, true],
    ["đi thi ở Quang Trung nhắc anh mang bút", "Quang Trung", true],
    ["đi thi ở Quang Trung nhắc anh mang bút", undefined, true],
    ["đi thi ở Quang Trung", "Quang", false],
  ] as const)("bounded coverage: %s", (text,value,want) => expect(coverage(text,value)).toBe(want));
  it("current retained exact venue covers KEEP, never NEW or a changed venue",()=>{
    expect(coverage("đi thi ở Quang Trung",undefined,{target:"CURRENT",retained:"Quang Trung"})).toBe(true);
    expect(coverage("đi thi ở Quang Trung",undefined,{retained:"Quang Trung"})).toBe(false);
    expect(coverage("đi thi ở Công ty A",undefined,{target:"CURRENT",retained:"Quang Trung"})).toBe(false);
    expect(coverage("đi thi ở Quang Trung",null,{target:"CURRENT",retained:"Quang Trung",clear:true})).toBe(false);
    expect(coverage("họp tại Công ty Ngày Mới",undefined,{target:"CURRENT",retained:"Công ty"})).toBe(false);
  });
  it("requires current grounded location alternative, not empty uncertainty or old source",()=>{
    expect(coverage("đi thi ở Quang Trung","Quang Trung",{uncertainty:true})).toBe(true);
    expect(coverage("đi thi ở Quang Trung",undefined,{uncertainty:true})).toBe(false);
    expect(coverage("đi thi ở Quang Trung","Quang Trung",{source:"old"})).toBe(false);
    expect(coverage("đi thi ở Quang Trung","Quang Trung",{source:"assistant"})).toBe(false);
  });
  it("side query establishes no fresh reminder coverage obligation",()=>expect(coverage("lịch đi thi ở Quang Trung",undefined,{intent:"LIST_REMINDERS"})).toBe(true));
  it("service blocks omitted venue without creating a partial draft or reminder",async()=>{
    const h=await harness([scriptedProposal(complete)]);
    await h.turn(0,"nhắc 8h ngày 8/10/2026 đi thi ở Quang Trung");
    const state=await h.read(1);
    expect(state?.slots.location.value??null).toBeNull();
    expect(state?.slots.title.value??null).toBeNull();
    expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);
    expect(h.events.some(e=>e.event==="PROVENANCE_DOMAIN_VALIDATED"&&e.result==="INVALID")).toBe(true);
    expect(h.events.some(e=>e.event==="POST_CANONICAL_STAGE"&&e.diagnostic.reason==="SEMANTIC_LOCATION_OMITTED")).toBe(true);
  });
});
