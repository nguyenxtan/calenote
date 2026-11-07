// @vitest-environment node
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,DateOperandSchema,LegacyV2SemanticPatchProposalSchema,SemanticPatchProposalV3Schema} from './contracts';
import {resolveDateOperand,resolveRequest} from './resolve';
import {lunarCalendar} from '../lunar-calendar';
import {buildContextInputV2} from './context';
import {validateEvidenceV3} from './evidence';
import {mergePatchV3} from './merge';
import {chat,message,observation,snapshot} from './context-test-fixtures';
import {ContextSnapshotV1Schema,decodeContextSnapshotV2,encodeContextSnapshotV2,type ContextSnapshotV2} from './state';
import {encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {serializeKeyedSmallComparison} from './keyed-small-wire';
import {createKeyedContextContractGateway} from '../../intelligence/infrastructure/openrouter/keyed-context-gateway';
import {constrainComparisonDateSchema} from '../../intelligence/infrastructure/openrouter/context-comparison-date-schema';
import {encodeGoogleLiteEuContextV3,parseGoogleLiteEuContextSectionsV3} from '../../intelligence/infrastructure/openrouter/context-provider-wire';
import {CONTEXT_PROTOCOL_V3} from './protocol';

const month={kind:'RELATIVE_MONTH',offsetMonths:4} as const;
const receipt=Date.parse('2026-11-07T16:59:00.000Z');
function build(text:string,state:ContextSnapshotV2|null=null,at=receipt){
 const msg={...message(text),id:`month-${state?.transcript.length??0}`,receivedAt:at},context={...chat,inboundRowId:(state?.inbound.rowid??0)+1};
 const observed=observation(null,msg,context);
 const result=buildContextInputV2({message:msg,context,snapshot:state,observation:state?{...observed,observed:{presence:'PRESENT',contextId:state.id,contextRevision:state.contextRevision}}:observed});
 if(result.status!=='READY')throw Error(result.reason);return result;
}
function apply(text:string,values:Record<string,unknown>,state:ContextSnapshotV2|null=null,at=receipt,replacements:string[]=[],fact=false){
 const built=build(text,state,at),source=[{kind:'USER_QUOTE',turn:built.input.currentTurn,quote:text,occurrence:1}];
 const semantic=SemanticPatchProposalV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:state?'CURRENT':'NEW',evidence:source},changes:Object.entries(values).map(([field,value])=>({field,value,operation:replacements.includes(field)?'REPLACE':'SET',evidence:fact?[{kind:'CONTEXT_FACT',ref:built.input.facts.find(f=>f.field===field)!.alias}]:source})),query:null,uncertainties:[]});
 const accepted=validateEvidenceV3(semantic,built);if(accepted.status!=='VALID')throw Error(accepted.reason);
 const merged=mergePatchV3(state,accepted.patch);if(merged.status!=='MERGED')throw Error(merged.status);return merged.candidate;
}

it('accepts authored months only in successor changes and alternatives, leaving legacy dates unchanged',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:'4 tháng sau',occurrence:1}];
 const core={intent:'CREATE_REMINDER',changes:[{field:'eventDate',operation:'SET',value:month,evidence}],query:null,uncertainties:[{field:'eventDate',reason:'AMBIGUOUS',alternatives:[{value:month,evidence}]}]};
 expect(SemanticPatchProposalV3Schema.safeParse({...core,schemaVersion:'calenote-context-3',requestTarget:{kind:'NEW',evidence}}).success).toBe(true);
 expect(DateOperandSchema.safeParse(month).success).toBe(false);
 expect(LegacyV2SemanticPatchProposalSchema.safeParse({...core,schemaVersion:'calenote-context-2',dialogueAct:'NEW_REQUEST',continuation:'NO',controlEvidence:[]}).success).toBe(false);
});

it('keeps the legacy state question field domain frozen when appending an active operand',()=>{
 const legacy=snapshot();legacy.pendingReminderQuestion={questionId:'week-question',text:'Bao nhiêu tuần?',scope:'REMINDER',field:'leadOffsetWeeks' as never,decisionKind:null,reason:'MISSING',noProgressCount:0,deliveryState:'SENT',issuedAfterOrder:{receivedAt:legacy.inbound.receivedAt,rowid:legacy.inbound.rowid}};
 expect(ContextSnapshotV1Schema.safeParse(legacy).success).toBe(false);
});

it('does not admit the new date family through historical opaque uncertainty JSON',()=>{
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:'mai',occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[],query:null,uncertainties:[{field:'eventDate',reason:'AMBIGUOUS',alternatives:[{value:{kind:'RELATIVE_DAY',offsetDays:1},evidence}]}],conversationDirective:null,replyProposal:null});
 const old=encodeGoogleLiteEuContextV3(canonical) as {uncertainties:Array<{alternatives:string[]}>},alternative=JSON.parse(old.uncertainties[0].alternatives[0]);
 alternative.value=month;old.uncertainties[0].alternatives[0]=JSON.stringify(alternative);
 expect(parseGoogleLiteEuContextSectionsV3(old,CONTEXT_PROTOCOL_V3).status).toBe('REFUSED');
});

it.each([
 ['Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại.',{kind:'RELATIVE_DAY',offsetDays:0},'SEMANTIC_RELATIVE_MONTH_OMITTED'],
 ['Sau 4 tháng nhắc sửa máy lạnh.',{kind:'RELATIVE_MONTH',offsetMonths:5},'RELATIVE_MONTH_NOT_SUPPORTED'],
] as const)('refuses an omitted or changed authored month amount: %s',(text,value,reason)=>{
 const built=build(text),evidence=[{kind:'USER_QUOTE',turn:0,quote:text,occurrence:1}];
 const semantic=SemanticPatchProposalV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'title',operation:'SET',value:'sửa máy lạnh',evidence},{field:'reminderDate',operation:'SET',value,evidence}],query:null,uncertainties:[]});
 expect(validateEvidenceV3(semantic,built)).toEqual({status:'REFUSED',reason});
});

it.each(['Không nhắc sau 4 tháng.','Nếu sau 4 tháng thì nhắc sửa máy lạnh.','Nhắc chữ “sau 4 tháng”.'])('does not manufacture a month requirement from nonasserted source %s',text=>{
 const built=build(text),evidence=[{kind:'USER_QUOTE',turn:0,quote:text,occurrence:1}],semantic=SemanticPatchProposalV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'title',operation:'SET',value:'sửa máy lạnh',evidence}],query:null,uncertainties:[]});
 expect(validateEvidenceV3(semantic,built).status).toBe('VALID');
});

it.each([
 ['Nhắc họp ngày 5 tháng sau lúc 9h.',5,5,'2026-12-05'],
 ['Nhắc họp mùng 1 tháng tới lúc 9h.',1,1,'2026-12-01'],
 ['Nhắc họp mồng 12 tháng sau lúc 9h.',12,12,'2026-12-12'],
 ['Nhắc họp ngày mười một tháng sau lúc 9h.',11,11,'2026-12-11'],
 ['Nhắc họp ngày hai mươi hai tháng sau lúc 9h.',22,2,'2026-12-22'],
] as const)('keeps the day of next month distinct from a month duration: %s',(text,day,offsetMonths,expectedDate)=>{
 const civil={kind:'CIVIL_DATE',calendar:'GREGORIAN',day,month:12,year:null,leapMonth:null};
 const state=apply(text,{title:'họp',reminderDate:civil,reminderTime:{hour:9,minute:0,qualifier:'H24'}});
 expect(resolveRequest(state,receipt,lunarCalendar)).toMatchObject({status:'READY',occurrences:[{localDate:expectedDate}]});
 const built=build(text),evidence=[{kind:'USER_QUOTE',turn:0,quote:text,occurrence:1}];
 const semantic=SemanticPatchProposalV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'reminderDate',operation:'SET',value:{kind:'RELATIVE_MONTH',offsetMonths},evidence}],query:null,uncertainties:[]});
 expect(validateEvidenceV3(semantic,built)).toEqual({status:'REFUSED',reason:'RELATIVE_MONTH_NOT_SUPPORTED'});
});

it.each([['mười một',11,1],['mười hai',12,2]] as const)('keeps the whole authored month amount %s instead of its final word',(amount,offsetMonths,tail)=>{
 const text=`${amount} tháng sau nhắc kiểm tra QA.`,value={kind:'RELATIVE_MONTH',offsetMonths};
 expect(apply(text,{title:'kiểm tra QA',reminderDate:value}).slots.reminderDate.value).toEqual(value);
 const built=build(text),evidence=[{kind:'USER_QUOTE',turn:0,quote:text,occurrence:1}];
 const semantic=SemanticPatchProposalV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'reminderDate',operation:'SET',value:{kind:'RELATIVE_MONTH',offsetMonths:tail},evidence}],query:null,uncertainties:[]});
 expect(validateEvidenceV3(semantic,built)).toEqual({status:'REFUSED',reason:'RELATIVE_MONTH_NOT_SUPPORTED'});
});

it.each([
 ['Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại.','sửa máy lạnh','REFUSED'],
 ['Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại. Nhắc lúc 18h.','sửa máy lạnh','REFUSED'],
 ['Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại nhắc lúc 18h.','sửa máy lạnh','REFUSED'],
 ['Hôm nay họp. 4 tháng sau nhắc tôi gửi biên bản.','họp','VALID'],
 ['Hôm nay họp. Sau 4 tháng, nhắc tôi gửi biên bản.','họp','VALID'],
 ['Hôm nay họp, nhắc tôi gửi biên bản sau 4 tháng.','họp','VALID'],
] as const)('requires the notification to own a future month beside a historical event: %s',(text,title,status)=>{
 const built=build(text),evidence=[{kind:'USER_QUOTE',turn:0,quote:text,occurrence:1}];
 const semantic=SemanticPatchProposalV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'title',operation:'SET',value:title,evidence},{field:'eventDate',operation:'SET',value:{kind:'RELATIVE_DAY',offsetDays:0},evidence},{field:'reminderDate',operation:'SET',value:month,evidence}],query:null,uncertainties:[]});
 expect(validateEvidenceV3(semantic,built)).toMatchObject(status==='VALID'?{status}:{status,reason:'REMINDER_DATE_SOURCE_ROLE_NOT_SUPPORTED'});
});

it('does not apply the same-source month role guard to a separate retained event turn',()=>{
 const original=apply('Hôm nay họp.',{title:'họp',eventDate:{kind:'RELATIVE_DAY',offsetDays:0}});
 expect(apply('4 tháng sau.',{reminderDate:month},original,receipt+60000).slots.reminderDate.value).toEqual(month);
});

it('a replaced retained month cannot cover an omitted current authored month',()=>{
 const state=apply('Sau 4 tháng nhắc sửa máy lạnh.',{title:'sửa máy lạnh',reminderDate:month}),text='Đổi thành nhắc 4 tháng sau.',built=build(text,state,receipt+60000),evidence=[{kind:'USER_QUOTE',turn:built.input.currentTurn,quote:text,occurrence:1}];
 const semantic=SemanticPatchProposalV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'CURRENT',evidence},changes:[{field:'reminderDate',operation:'REPLACE',value:{kind:'RELATIVE_DAY',offsetDays:0},evidence}],query:null,uncertainties:[]});
 expect(validateEvidenceV3(semantic,built)).toEqual({status:'REFUSED',reason:'SEMANTIC_RELATIVE_MONTH_OMITTED'});
});

it('constrains the active generation month family to its authored column',()=>{
 const input=build('4 tháng sau nhắc sửa máy lạnh.').input,request=serializeKeyedSmallComparison(input),schema=constrainComparisonDateSchema(request.response_format.json_schema.schema,true);
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}],canonical=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'reminderDate',operation:'SET',value:month,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeKeyedSmallComparison(canonical,input) as {changes:{owners:{reminderDate:Array<{write:Array<{value:Record<string,unknown>}>}>}}},validator=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
 expect(validator.safeParse(wire).success).toBe(true);
 const mixed=structuredClone(wire);mixed.changes.owners.reminderDate[0].write[0].value.offsetDays=120;
 expect(validator.safeParse(mixed).success).toBe(false);
});

it.each([
 ['2026-11-07T03:00:00Z',4,'2027-03-07'],
 ['2026-01-31T03:00:00Z',1,null],
 ['2028-01-29T03:00:00Z',1,'2028-02-29'],
 ['2027-01-29T03:00:00Z',1,null],
 ['2026-01-07T03:00:00Z',-2,'2025-11-07'],
 ['2026-11-07T17:00:00Z',4,'2027-03-08'],
] as const)('resolves calendar months from the Vietnam source day %s offset %i', (at,offsetMonths,date)=>{
 const result=resolveDateOperand({kind:'RELATIVE_MONTH',offsetMonths} as unknown as Parameters<typeof resolveDateOperand>[0],Date.parse(at),lunarCalendar);
 expect(result).toEqual(date?{status:'RESOLVED',date,inferredYear:false,method:'POLICY_DEFAULT'}:{status:'CLARIFY',reason:'INVALID_DATE'});
});

it('keeps original month receipt and typed source through later context, storage and schedule projections',()=>{
 const original=apply('Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại.',{title:'sửa máy lạnh',notes:'Hôm nay sửa máy lạnh.',eventDate:month});
 const stored=decodeContextSnapshotV2(encodeContextSnapshotV2(original));
 const answered=apply('Nhắc ngày đó lúc 8h sáng.',{eventRelation:'INCLUDING_EVENT',reminderTime:{hour:8,minute:0,qualifier:'H24'}},stored,receipt+120000);
 const resolved=resolveRequest(answered,receipt+120000,lunarCalendar);
 expect(resolved).toMatchObject({status:'READY',details:{eventDate:'2027-03-07',notes:'Hôm nay sửa máy lạnh.',calendarProvenance:{sourceDate:month}},occurrences:[{localDate:'2027-03-07',scheduledAt:Date.parse('2027-03-07T01:00:00Z')}]});
 if(resolved.status!=='READY')return;
 const projected={...answered,slots:resolved.resolvedSlots,facts:resolved.resolvedFacts};
 const next=build('Giữ ngày sửa lại.',decodeContextSnapshotV2(encodeContextSnapshotV2(projected)),receipt+180000);
 expect(next.input.activeRequest?.slots.eventDate.value).toEqual(month);
 expect(next.input.facts.find(f=>f.field==='eventDate')).toMatchObject({value:month,sourceReferenceTime:'2026-11-07T16:59:00.000Z'});
});

it.each([['ONCE',1,['2027-02-28']],['DAILY',1,['2027-02-28','2027-03-01','2027-03-02','2027-03-03','2027-03-04','2027-03-05','2027-03-06']]] as const)('expands backend-authored week distance for %s without changing its authored unit',(frequency,leadOffsetWeeks,dates)=>{
 const initial=apply('4 tháng sau sửa máy lạnh.',{title:'sửa máy lạnh',eventDate:month});
 const state=structuredClone(initial);
 for(const[field,value]of Object.entries({frequency,leadOffsetWeeks,eventRelation:'BEFORE_EVENT',reminderTime:{hour:8,minute:0,qualifier:'H24'}}))Object.assign((state.slots as unknown as Record<string,object>)[field]??={}, {state:'RESOLVED',value,fact:null,evidence:state.slots.eventDate.evidence,provenance:{kind:'EXPLICIT_USER'},resolution:state.slots.eventDate.resolution,proposalRevision:1});
 const result=resolveRequest(state,receipt,lunarCalendar);
 expect(result).toMatchObject({status:'READY'});if(result.status!=='READY')return;
 expect(result.occurrences.map(o=>o.localDate)).toEqual(dates);
 expect(result.resolvedSlots.leadOffsetWeeks?.value).toBe(1);
 expect(result.resolvedSlots.leadOffsetDays.value).toBeNull();
});

it('retains source receipt on exact fact reuse and reanchors an explicit month correction',()=>{
 const original=apply('4 tháng sau nhắc sửa máy lạnh.',{title:'sửa máy lạnh',reminderDate:month});
 const reused=apply('Giữ ngày nhắc.',{reminderDate:month},original,receipt+120000,[],true);
 expect(reused.slots.reminderDate.resolution?.referenceTime).toBe('2026-11-07T16:59:00.000Z');
 const replaced=apply('Đổi thành 4 tháng sau tính từ hôm nay.',{reminderDate:month},reused,receipt+180000,['reminderDate']);
 expect(replaced.slots.reminderDate.resolution?.referenceTime).toBe('2026-11-07T17:02:00.000Z');
});

it('recomputes a backend-derived week count when DAILY is explicitly corrected to ONCE',()=>{
 const initial=apply('4 tháng sau sửa máy lạnh, nhắc trước 1 tuần mỗi ngày lúc 8h sáng.',{title:'sửa máy lạnh',eventDate:month,frequency:'DAILY',leadOffsetWeeks:1,eventRelation:'BEFORE_EVENT',reminderTime:{hour:8,minute:0,qualifier:'H24'}});
 const daily=resolveRequest(initial,receipt,lunarCalendar);expect(daily.status).toBe('READY');if(daily.status!=='READY')return;
 const projected={...initial,slots:daily.resolvedSlots,facts:daily.resolvedFacts};
 const corrected=apply('Đổi nhắc một lần trước 1 tuần.',{frequency:'ONCE'},projected,receipt+60000,['frequency']);
 expect(corrected.slots.occurrenceCount.state).toBe('PROPOSED');
 const once=resolveRequest(corrected,receipt+60000,lunarCalendar);
 expect(once).toMatchObject({status:'READY',resolvedSlots:{occurrenceCount:{value:1,provenance:{kind:'DERIVED_POLICY'}}},occurrences:[{localDate:'2027-02-28'}]});
});

it('roundtrips authored months through the actual selected keyed gateway and strict decoder',async()=>{
 const input=ContextInputSchema.parse(build('4 tháng sau nhắc sửa máy lạnh.').input),evidence=[{kind:'USER_QUOTE',turn:0,quote:input.turns[0].text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[{field:'title',operation:'SET',value:'sửa máy lạnh',evidence},{field:'reminderDate',operation:'SET',value:month,evidence}],query:null,uncertainties:[{field:'eventDate',reason:'AMBIGUOUS',alternatives:[{value:month,evidence}]}],conversationDirective:null,replyProposal:null});
 const wire=encodeKeyedSmallComparison(canonical,input),request=serializeKeyedSmallComparison(input);
 expect(request.response_format.json_schema.schema).toBeDefined();
 expect(JSON.stringify(wire)).toContain('RELATIVE_MONTH');
 expect(decodeKeyedSmallComparison(wire,input)).toMatchObject({status:'PARSED',value:{semantic:{changes:canonical.changes,uncertainties:canonical.uncertainties}}});
 const gateway=createKeyedContextContractGateway(async()=>({status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})}),{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const prepared=gateway.prepare('PRIMARY',input);expect(prepared.status).toBe('READY');if(prepared.status!=='READY')return;
 expect(await prepared.dispatch()).toMatchObject({status:'SUCCESS',interpretation:{semantic:{changes:canonical.changes,uncertainties:canonical.uncertainties}}});
 for(const mutate of [(date:Record<string,unknown>)=>{date.offsetMonths=4.5;},(date:Record<string,unknown>)=>{date.offsetDays=120;},(date:Record<string,unknown>)=>{delete date.offsetMonths;}]){
  const changed=structuredClone(wire) as {changes:{owners:{reminderDate:Array<{write:Array<{value:Record<string,unknown>}>}>}}};
  mutate(changed.changes.owners.reminderDate[0].write[0].value);
  expect(decodeKeyedSmallComparison(changed,input).status).toBe('REFUSED');
 }
});

it.each([false,true])('the actual keyed gateway accepts a complete month event, historical notes and daily week window; split=%s',async split=>{
 const initialText='Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại.',initialValues={title:'sửa máy lạnh',notes:'Hôm nay sửa máy lạnh.',eventDate:month};
 const previous=split?apply(initialText,initialValues):null,text=split?'Nhắc trước 1 tuần. Liên tục vào 8h sáng.':`${initialText} Nhắc trước 1 tuần. Liên tục vào 8h sáng.`,built=build(text,previous,split?receipt+60000:receipt);
 const evidence=[{kind:'USER_QUOTE',turn:built.input.currentTurn,quote:text,occurrence:1}],values={...(split?{}:initialValues),leadOffsetWeeks:1,frequency:'DAILY',eventRelation:'BEFORE_EVENT',reminderTime:{hour:8,minute:0,qualifier:'H24'}};
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:split?'CURRENT':'NEW',evidence},changes:Object.entries(values).map(([field,value])=>({field,value,operation:'SET',evidence})),query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 const wire=encodeKeyedSmallComparison(canonical,built.input),gateway=createKeyedContextContractGateway(async()=>({status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})}),{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const prepared=gateway.prepare('PRIMARY',built.input);expect(prepared.status).toBe('READY');if(prepared.status!=='READY')return;
 const result=await prepared.dispatch();expect(result.status).toBe('SUCCESS');if(result.status!=='SUCCESS'||!('semantic'in result.interpretation))return;
 const checked=validateEvidenceV3(result.interpretation.semantic,built);expect(checked.status).toBe('VALID');if(checked.status!=='VALID')return;
 const merged=mergePatchV3(previous,checked.patch);expect(merged.status).toBe('MERGED');if(merged.status!=='MERGED')return;
 const resolved=resolveRequest(merged.candidate,split?receipt+60000:receipt,lunarCalendar);expect(resolved).toMatchObject({status:'READY',details:{eventDate:'2027-03-07',notes:'Hôm nay sửa máy lạnh.'}});if(resolved.status!=='READY')return;
 expect(resolved.occurrences.map(occurrence=>occurrence.localDate)).toEqual(['2027-02-28','2027-03-01','2027-03-02','2027-03-03','2027-03-04','2027-03-05','2027-03-06']);
});
