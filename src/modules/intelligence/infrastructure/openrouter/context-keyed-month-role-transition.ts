import type {ContextInput} from '../../../conversation/context-contract/contracts';
import type {SourceEvidence} from '../../../conversation/context-contract/state';
import {relativeMonthOccurrenceCount} from '../../../conversation/context-contract/relative-month-evidence';
import {supportsCadenceOperand} from '../../../conversation/context-contract/cadence-count-evidence';
import {isBareNumericClockAnswer} from '../../../conversation/context-contract/semantic-completeness';
import {CONTROL_PLACEHOLDER} from '../../../conversation/context-contract/projection';

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
export function keyedRelativeMonthRoleTransitionClearRequired(input:ContextInput):boolean {
 const active=input.activeRequest,question=input.pendingQuestion;
 if(active?.lifecycle!=='CLARIFYING'||input.currentTurn!==2||input.turns.length!==3
  ||input.turns[0]?.role!=='USER'||input.turns[1]?.role!=='ASSISTANT'||input.turns[2]?.role!=='USER'
  ||input.ambiguities.length||question?.scope!=='REMINDER'||question.field!=='reminderTime'
  ||question.reason!=='MISSING'||question.decisionKind!==null||input.currentBurstTurns!==undefined||input.currentBurstReferences!==undefined
  ||Object.values(active.slots).some(slot=>slot.state==='CONFLICT')||input.facts.some(fact=>fact.scope!=='REMINDER')
  ||!input.capabilities.supported.includes('FINITE_DAILY')||input.capabilities.limits.dailyCount!==30)return false;
 const reference=Date.parse(input.reference.instant);
 if(!Number.isFinite(reference))return false;
 for(const field of ['eventDate','eventTime','endDate','reminderTime','eventRelation','leadOffsetDays','frequency','occurrenceCount'] as const){
  const slot=active.slots[field];
  if(!slot||slot.state!=='MISSING'||slot.value!==null||slot.fact!==null||input.facts.some(fact=>fact.field===field))return false;
 }
 for(const field of ['leadOffsetWeeks','leadOffsetHours','leadOffsetMinutes'] as const){
  const slot=active.slots[field];
  if((slot&&(slot.state!=='MISSING'||slot.value!==null||slot.fact!==null))||input.facts.some(fact=>fact.field===field))return false;
 }
 const date=active.slots.reminderDate;
 if(date.state!=='RESOLVED'||!date.value||date.value.kind!=='RELATIVE_MONTH'
  ||!Number.isSafeInteger(date.value.offsetMonths)||date.value.offsetMonths<1||date.value.offsetMonths>12)return false;
 let originalReference:string|undefined;
 for(const field of ['title','reminderDate'] as const){
  const slot=active.slots[field],facts=input.facts.filter(fact=>fact.field===field),fact=facts[0];
  const time=Date.parse(fact?.sourceReferenceTime??'');
  if(slot.state!=='RESOLVED'||slot.value===null||facts.length!==1||fact.scope!=='REMINDER'
   ||slot.fact!==fact.alias||input.facts.filter(item=>item.alias===fact.alias).length!==1
   ||JSON.stringify(slot.value)!==JSON.stringify(fact.value)||fact.provenance.kind!=='EXPLICIT_USER'
   ||fact.dependencies.length||!Number.isFinite(time)||time>reference)return false;
  if(field==='title'&&(typeof slot.value!=='string'||!slot.value.trim()))return false;
  if(originalReference!==undefined&&originalReference!==fact.sourceReferenceTime)return false;
  originalReference=fact.sourceReferenceTime;
 }
 const first=input.turns[0].text,current=input.turns[2].text;
 if([first,current].some(text=>unsafe.test(text)||text.includes(CONTROL_PLACEHOLDER)||uncertain.test(text))
  ||notification.test(first))return false;
 // The bounded operand verifier deliberately ignores unsupported, negative
 // or day-of-month expressions. A second month token must therefore decline
 // independently; it cannot disappear merely because it was not a valid probe.
 if([...first.matchAll(/(?:^|[^\p{L}\p{M}\p{N}_])(?:tháng|thang)(?=$|[^\p{L}\p{M}\p{N}_])/giu)].length!==1)return false;
 const match=/^\s*nhắc(?:\s+(?:tôi|mình|tui))?\s+trước\s+(\d{1,2}|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s+(tuần|ngày)[.,]?\s+(?:liên tục|liên tiếp|mỗi ngày|hằng ngày|hàng ngày)\s+(?:vào|lúc)\s+(\d{1,2}(?:h(?:\d{1,2})?|:\d{2})(?:\s+(?:sáng|trưa|chiều|tối))?)\s*[.!]?\s*$/iu.exec(current);
 if(!match)return false;
 // Probe numeric clock presence only. The generic scanner also treats a
 // daypart as another time expression; no parsed clock leaves this predicate.
 const clock=/^\d{1,2}(?:h(?:\d{1,2})?|:\d{2})/u.exec(match[3])?.[0];
 if(!clock||!isBareNumericClockAnswer(clock,input.reference.instant))return false;
 const words:Readonly<Record<string,number>>={một:1,hai:2,ba:3,bốn:4,năm:5,sáu:6,bảy:7,tám:8,chín:9,mười:10};
 const count=words[match[1].toLocaleLowerCase('vi')]??Number(match[1]);
 if(!Number.isSafeInteger(count)||count<1||count>(match[2].toLocaleLowerCase('vi')==='tuần'?4:30))return false;
 const original=whole(first,'month-role-original'),now=whole(current,'month-role-current');
 let occurrences=0,matching=0;
 for(let offsetMonths=1;offsetMonths<=12;offsetMonths++){
  const value={kind:'RELATIVE_MONTH',offsetMonths},found=relativeMonthOccurrenceCount(value,[original.source],[original.turn]);
  occurrences+=found;if(offsetMonths===date.value.offsetMonths)matching=found;
  if(relativeMonthOccurrenceCount(value,[now.source],[now.turn]))return false;
 }
 return occurrences===1&&matching===1&&supportsCadenceOperand('frequency','DAILY',[now.source],[now.turn]);
}
