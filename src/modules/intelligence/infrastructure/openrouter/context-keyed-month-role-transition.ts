import type {ContextInput} from '../../../conversation/context-contract/contracts';
import type {SourceEvidence} from '../../../conversation/context-contract/state';
import {relativeMonthOccurrenceCount} from '../../../conversation/context-contract/relative-month-evidence';
import {CONTROL_PLACEHOLDER} from '../../../conversation/context-contract/projection';
import {keyedClosedDailyWindowSource,type ClosedWindowSourcePolicy} from './context-keyed-window-source';

const unsafe=/[\r\n\t\v\f\u0085\u2028\u2029"'“”‘’\x60?]/u;
const notification=/(?:^|[^\p{L}\p{M}\p{N}_])(?:nhắc|nhac|nhớ|nho|báo|bao|thông báo|thong bao|hẹn giờ|hen gio|remind|reminder|notify|notification|alert)(?:$|[^\p{L}\p{M}\p{N}_])/iu;
const uncertain=/(?:^|[^\p{L}\p{M}\p{N}_])(?:không|khong|ko|đừng|dung|chẳng|chang|chưa|chua|nếu|neu|ví dụ|vi du|giả sử|gia su|hoặc|hoac|hay là|và)(?:$|[^\p{L}\p{M}\p{N}_])/iu;
function whole(text:string,id:string){
 const turn={id,role:'USER' as const,semanticView:text},length=[...text].length;
 const source:SourceEvidence={kind:'USER_QUOTE',sourceTurnId:id,sourceMapTurnId:id,quote:text,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:'nfc-codepoint-v1'};
 return {turn,source};
}

/** A sufficient first follow-up only. Returns an atomic owner obligation;
 * no date, amount, evidence, target or mutation authority is generated. */
export type PendingMonthWindowPolicy=ClosedWindowSourcePolicy&{dateField:'eventDate'|'reminderDate'};
export function keyedPendingMonthWindowPolicy(input:ContextInput):PendingMonthWindowPolicy|undefined {
 const active=input.activeRequest,question=input.pendingQuestion;
 if(active?.lifecycle!=='CLARIFYING'||input.currentTurn!==2||input.turns.length!==3
  ||input.turns[0]?.role!=='USER'||input.turns[1]?.role!=='ASSISTANT'||input.turns[2]?.role!=='USER'
  ||input.ambiguities.length||question?.scope!=='REMINDER'||question.field!=='reminderTime'
  ||question.reason!=='MISSING'||question.decisionKind!==null||input.currentBurstTurns!==undefined||input.currentBurstReferences!==undefined
  ||Object.values(active.slots).some(slot=>slot.state==='CONFLICT')||input.facts.some(fact=>fact.scope!=='REMINDER')
  ||!input.capabilities.supported.includes('FINITE_DAILY')||input.capabilities.limits.dailyCount!==30)return;
 const reference=Date.parse(input.reference.instant);
 if(!Number.isFinite(reference))return;
 for(const field of ['eventTime','endDate','reminderTime','eventRelation','leadOffsetDays','frequency','occurrenceCount'] as const){
  const slot=active.slots[field];
  if(!slot||slot.state!=='MISSING'||slot.value!==null||slot.fact!==null||input.facts.some(fact=>fact.field===field))return;
 }
 for(const field of ['leadOffsetWeeks','leadOffsetHours','leadOffsetMinutes'] as const){
  const slot=active.slots[field];
  if((slot&&(slot.state!=='MISSING'||slot.value!==null||slot.fact!==null))||input.facts.some(fact=>fact.field===field))return;
 }
 const occupied=(['eventDate','reminderDate'] as const).filter(field=>active.slots[field].state==='RESOLVED'&&active.slots[field].value!==null);
 if(occupied.length!==1)return;const dateField=occupied[0],other=active.slots[dateField==='eventDate'?'reminderDate':'eventDate'];
 if(other.state!=='MISSING'||other.value!==null||other.fact!==null||input.facts.some(f=>f.field===(dateField==='eventDate'?'reminderDate':'eventDate')))return;
 const date=active.slots[dateField];
 if(date.state!=='RESOLVED'||!date.value||date.value.kind!=='RELATIVE_MONTH'
  ||!Number.isSafeInteger(date.value.offsetMonths)||date.value.offsetMonths<1||date.value.offsetMonths>12)return;
 let originalReference:string|undefined;
 for(const field of ['title',dateField] as const){
  const slot=active.slots[field],facts=input.facts.filter(fact=>fact.field===field),fact=facts[0];
  const time=Date.parse(fact?.sourceReferenceTime??'');
  if(slot.state!=='RESOLVED'||slot.value===null||facts.length!==1||fact.scope!=='REMINDER'
   ||slot.fact!==fact.alias||input.facts.filter(item=>item.alias===fact.alias).length!==1
   ||JSON.stringify(slot.value)!==JSON.stringify(fact.value)||fact.provenance.kind!=='EXPLICIT_USER'
   ||fact.dependencies.length||!Number.isFinite(time)||time>reference)return;
  if(field==='title'&&(typeof slot.value!=='string'||!slot.value.trim()))return;
  if(originalReference!==undefined&&originalReference!==fact.sourceReferenceTime)return;
  originalReference=fact.sourceReferenceTime;
 }
 const first=input.turns[0].text,current=input.turns[2].text;
 if([first,current].some(text=>unsafe.test(text)||text.includes(CONTROL_PLACEHOLDER)||uncertain.test(text))
  ||notification.test(first))return;
 // The bounded operand verifier deliberately ignores unsupported, negative
 // or day-of-month expressions. A second month token must therefore decline
 // independently; it cannot disappear merely because it was not a valid probe.
 if([...first.matchAll(/(?:^|[^\p{L}\p{M}\p{N}_])(?:tháng|thang)(?=$|[^\p{L}\p{M}\p{N}_])/giu)].length!==1)return;
 const window=keyedClosedDailyWindowSource(input);if(!window)return;
 const original=whole(first,'month-role-original'),now=whole(current,'month-role-current');
 let occurrences=0,matching=0;
 for(let offsetMonths=1;offsetMonths<=12;offsetMonths++){
  const value={kind:'RELATIVE_MONTH',offsetMonths},found=relativeMonthOccurrenceCount(value,[original.source],[original.turn]);
  occurrences+=found;if(offsetMonths===date.value.offsetMonths)matching=found;
  if(relativeMonthOccurrenceCount(value,[now.source],[now.turn]))return;
 }
 return occurrences===1&&matching===1?{...window,dateField}:undefined;
}

/** The original role-repair scope remains limited to a reminder-owned date. */
export function keyedRelativeMonthRoleTransitionPolicy(input:ContextInput):ClosedWindowSourcePolicy|undefined {
 const policy=keyedPendingMonthWindowPolicy(input);
 return policy?.dateField==='reminderDate'?{leadField:policy.leadField,clockRequired:policy.clockRequired}:undefined;
}

/** Compatibility truth predicate; the source/state certificate is unchanged. */
export function keyedRelativeMonthRoleTransitionClearRequired(input:ContextInput):boolean {
 return keyedRelativeMonthRoleTransitionPolicy(input)!==undefined;
}
