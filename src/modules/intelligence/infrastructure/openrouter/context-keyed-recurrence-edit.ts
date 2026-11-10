import type {ContextInput} from '../../../conversation/context-contract/contracts';
import type {SourceEvidence} from '../../../conversation/context-contract/state';
import {CONTROL_PLACEHOLDER} from '../../../conversation/context-contract/projection';
import {hasLeadWeekOffsetEvidence,supportsLeadWeekOffset} from '../../../conversation/context-contract/lead-week-evidence';
import {supportsCadenceOperand} from '../../../conversation/context-contract/cadence-count-evidence';
import {isBareNumericClockAnswer} from '../../../conversation/context-contract/semantic-completeness';

type ExplicitField='title'|'eventDate'|'eventRelation'|'reminderTime'|'frequency'|'leadOffsetWeeks';
export type RecurrenceEditPolicy={replaceOnly:readonly ('leadOffsetWeeks'|'frequency')[];onceCountHidden:boolean};
const unsafe=/[\r\n\t\v\f\u0085\u2028\u2029"'“”‘’`?]/u;
const clock='(\\d{1,2}(?:h(?:\\d{1,2})?|:\\d{2}))(?:\\s+(sáng))?';
const prefix='^\\s*(?:đổi thành|đổi sang)\\s+nhắc(?:\\s+(?:tôi|mình|tui))?\\s+';
const weeks='(?:\\d{1,2}|một|hai|ba)\\s+tuần';
const daily=new RegExp(`${prefix}trước\\s+${weeks}[.,]?\\s+(?:liên tục|mỗi ngày|hằng ngày|hàng ngày)\\s+(?:vào|lúc)\\s+${clock}\\s*[.!]?\\s*$`,'iu');
const once=new RegExp(`${prefix}(?:một|1)\\s+lần\\s+trước\\s+${weeks}[.,]?\\s+(?:vào|lúc)\\s+${clock}\\s*[.!]?\\s*$`,'iu');

/** A private support check for the existing clock, never a newly extracted
 * clock. Combined clock edits retain the ordinary interpretation language. */
function restatesClock(value:unknown,atom:string,morning:boolean,reference:string):boolean {
 if(!value||typeof value!=='object'||!('hour'in value)||!('minute'in value)||!('qualifier'in value))return false;
 const {hour,minute,qualifier}=value;
 if(typeof hour!=='number'||!Number.isInteger(hour)||hour<0||hour>23
  ||typeof minute!=='number'||!Number.isInteger(minute)||minute<0||minute>59
  ||qualifier!=='H24'&&qualifier!=='AM'||qualifier==='AM'&&(hour<1||hour>11)
  ||morning&&(hour<1||hour>11)||!isBareNumericClockAnswer(atom,reference))return false;
 const h=String(hour),hh=h.padStart(2,'0'),m=String(minute).padStart(2,'0');
 const forms=[`${h}:${m}`,`${hh}:${m}`,`${h}h${m}`,`${hh}h${m}`,...(minute===0?[`${h}h`,`${hh}h`]:[])];
 return forms.includes(atom.toLocaleLowerCase('vi'));
}

/** Grammar and occupancy choose permissions only. No proposed value, count,
 * target, evidence code or mutation is returned or inserted into a response. */
export function keyedRecurrenceEditPolicy(input:ContextInput):RecurrenceEditPolicy|undefined {
 const active=input.activeRequest,current=input.turns[input.currentTurn];
 if(active?.lifecycle!=='AWAITING_CONFIRMATION'||input.pendingQuestion!==null||input.currentTurn!==2||input.turns.length!==3
  ||input.turns[0]?.role!=='USER'||input.turns[1]?.role!=='ASSISTANT'||current?.role!=='USER'
  ||input.ambiguities.length||Object.values(active.slots).some(slot=>slot.state==='CONFLICT')
  ||input.currentBurstTurns!==undefined||input.currentBurstReferences!==undefined
  ||input.facts.some(f=>f.scope!=='REMINDER')||!input.capabilities.supported.includes('FINITE_DAILY')
  ||!input.capabilities.supported.includes('ONCE')||input.capabilities.limits.dailyCount!==30)return;
 const reference=Date.parse(input.reference.instant);if(!Number.isFinite(reference))return;
 const aliases=new Map(input.facts.map(f=>[f.alias,f]));if(aliases.size!==input.facts.length)return;
 const explicit=(field:ExplicitField)=>{
  const slot=active.slots[field],facts=input.facts.filter(f=>f.field===field),fact=facts[0],at=Date.parse(fact?.sourceReferenceTime??'');
  if(!slot||slot.state!=='RESOLVED'||slot.value===null||facts.length!==1||!fact||fact.scope!=='REMINDER'
   ||slot.fact!==fact.alias||JSON.stringify(slot.value)!==JSON.stringify(fact.value)
   ||fact.provenance.kind!=='EXPLICIT_USER'||fact.dependencies.length||!Number.isFinite(at)||at>reference)return;
  return fact;
 };
 const title=explicit('title'),date=explicit('eventDate'),relation=explicit('eventRelation'),time=explicit('reminderTime'),frequency=explicit('frequency'),lead=explicit('leadOffsetWeeks');
 if(!title||typeof title.value!=='string'||!title.value.trim()||!date||!relation||relation.value!=='BEFORE_EVENT'
  ||!time||!frequency||frequency.value!=='DAILY'||!lead||typeof lead.value!=='number'
  ||!Number.isSafeInteger(lead.value)||lead.value<1||lead.value>52)return;
 for(const field of ['leadOffsetDays','leadOffsetHours','leadOffsetMinutes','endDate'] as const){
  const slot=active.slots[field];
  if(slot&&(slot.state!=='MISSING'||slot.value!==null||slot.fact!==null)||input.facts.some(f=>f.field===field))return;
 }
 const slot=active.slots.occurrenceCount,facts=input.facts.filter(f=>f.field==='occurrenceCount'),count=facts[0];
 const at=Date.parse(count?.sourceReferenceTime??'');
 if(slot.state!=='RESOLVED'||typeof slot.value!=='number'||!Number.isSafeInteger(slot.value)||slot.value<1||slot.value>30
  ||facts.length!==1||!count||count.scope!=='REMINDER'||slot.fact!==count.alias||count.value!==slot.value
  ||count.provenance.kind!=='DERIVED_POLICY'||!Number.isFinite(at)||at>reference
  ||count.provenance.referenceTime!==count.sourceReferenceTime)return;
 const expected=new Set([frequency.alias,lead.alias]),dependencies=new Set(count.dependencies);
 if(count.dependencies.length!==2||dependencies.size!==2||[...dependencies].some(alias=>!expected.has(alias)||!aliases.has(alias))
  ||count.provenance.dependencies.length!==2||new Set(count.provenance.dependencies).size!==2
  ||count.provenance.dependencies.some(alias=>!dependencies.has(alias)))return;
 const text=current.text;if(unsafe.test(text)||text.includes(CONTROL_PLACEHOLDER))return;
 const dailyMatch=daily.exec(text),onceMatch=once.exec(text),match=dailyMatch??onceMatch;
 if(!match||!restatesClock(time.value,match[1],!!match[2],input.reference.instant))return;
 const id='recurrence-edit-current',length=[...text].length,turn={id,role:'USER' as const,semanticView:text};
 const source:SourceEvidence={kind:'USER_QUOTE',sourceTurnId:id,sourceMapTurnId:id,quote:text,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:'nfc-codepoint-v1'};
 if(!hasLeadWeekOffsetEvidence([source],[turn],true))return;
 if(dailyMatch&&supportsCadenceOperand('frequency','DAILY',[source],[turn]))return {replaceOnly:['leadOffsetWeeks'],onceCountHidden:false};
 // The ONCE-only edit leaves the existing distance alone. This checks an
 // existing fact against the source; it does not extract a new week operand.
 if(onceMatch&&supportsCadenceOperand('frequency','ONCE',[source],[turn])&&supportsLeadWeekOffset(lead.value,[source],[turn],true))return {replaceOnly:['frequency'],onceCountHidden:true};
}
