import type {ContextInput} from '../../../conversation/context-contract/contracts';
import {isBoundReminderClockAnswer} from '../../../conversation/context-contract/semantic-completeness';
import {extractTemporalEvidence} from '../../../semantic/temporal-evidence';

/** A complete positive clock answer to the sole retained task. This proves
 * field presence only; the model must author the clock and current evidence. */
export function keyedBoundReminderClockRequired(input:ContextInput):boolean {
 const active=input.activeRequest,current=input.turns[input.currentTurn],question=input.pendingQuestion;
 if(active?.lifecycle!=='CLARIFYING'||current?.role!=='USER'||input.currentTurn<=0
   ||input.currentTurn!==input.turns.length-1||input.ambiguities.length
   ||question?.scope!=='REMINDER'||question.field!=='reminderTime'||question.reason!=='MISSING'||question.decisionKind!==null
   ||Object.values(active.slots).some(slot=>slot.state==='CONFLICT'))return false;
 const clock=active.slots.reminderTime;
 if(clock?.state!=='MISSING'||clock.value!==null||clock.fact!==null||input.facts.some(fact=>fact.field==='reminderTime'))return false;
 const title=active.slots.title,facts=input.facts.filter(fact=>fact.scope==='REMINDER'&&fact.field==='title'),fact=facts[0];
 const reference=Date.parse(input.reference.instant),source=Date.parse(fact?.sourceReferenceTime??'');
 if(title?.state!=='RESOLVED'||typeof title.value!=='string'||!title.value.trim()||facts.length!==1
   ||title.fact!==fact.alias||input.facts.filter(item=>item.alias===fact.alias).length!==1
   ||fact.value!==title.value||fact.provenance.kind!=='EXPLICIT_USER'||fact.dependencies.length
   ||!Number.isFinite(reference)||!Number.isFinite(source)||source>reference)return false;
 const match=/^\s*nhắc(?:\s+(?:tôi|mình|tui))?\s+lúc\s+((\d{1,2})(?:h(?:\d{1,2})?|:\d{2}))(?:\s+(sáng|trưa|chiều|tối))?\s*[.!]?\s*$/iu.exec(current.text);
 if(!match)return false;
 // The general scanner conservatively treats a numeric clock plus a daypart
 // as separate expressions. This complete grammar admits only an unqualified
 // numeric clock or a clear 1..11 morning clock; other forms stay optional.
 // Probe the exact authored token privately, never a replacement input/value.
 const daypart=match[3]?.toLocaleLowerCase('vi');
 if(daypart&&(daypart!=='sáng'||Number(match[2])<1||Number(match[2])>11))return false;
 const temporal=extractTemporalEvidence({text:match[1],referenceNow:reference});
 return temporal.time.state==='RESOLVED'&&temporal.time.source==='EXACT_TIME';
}

/** Restrict operation syntax only when a whole clock-only edit unambiguously
 * addresses the sole occupied, bound clock of a pending preview. No clock
 * value is extracted or supplied to generation/decoding by this proof. */
export function keyedClockCorrectionField(input:ContextInput):'eventTime'|'reminderTime'|undefined {
 const active=input.activeRequest,current=input.turns[input.currentTurn];
 if(active?.lifecycle!=='AWAITING_CONFIRMATION'||current?.role!=='USER'||input.currentTurn!==input.turns.length-1||input.ambiguities.length)return;
 if(!/^(?:có(?: \[CONTROL\])?, nhưng |\[CONTROL\], nhưng )?đổi sang (?:[01]?\d|2[0-3])(?:h(?:[0-5]\d)?|:[0-5]\d)\.?$/iu.test(current.text))return;
 if(Object.values(active.slots).some(slot=>slot.state==='CONFLICT'))return;
 const occupied=(['eventTime','reminderTime'] as const).filter(field=>active.slots[field].state!=='MISSING'||active.slots[field].value!==null);
 if(occupied.length!==1)return;const field=occupied[0],slot=active.slots[field];
 if(input.pendingQuestion&&(input.pendingQuestion.scope!=='REMINDER'||input.pendingQuestion.field!==field))return;
 const facts=input.facts.filter(fact=>fact.scope==='REMINDER'&&fact.field===field),fact=facts[0];
 const reference=Date.parse(input.reference.instant),source=Date.parse(fact?.sourceReferenceTime??'');
 if(slot.state!=='RESOLVED'||slot.value===null||facts.length!==1||slot.fact!==fact.alias||JSON.stringify(slot.value)!==JSON.stringify(fact.value)||fact.provenance.kind!=='EXPLICIT_USER'||fact.dependencies.length||!Number.isFinite(source)||!Number.isFinite(reference)||source>reference)return;
 return field;
}

/** Lexical qualifier only. The model still authors hour/minute/evidence. */
export function keyedClockNotationField(input:ContextInput):'eventTime'|'reminderTime'|undefined {
 const correction=keyedClockCorrectionField(input);if(correction)return correction;
 const active=input.activeRequest,current=input.turns[input.currentTurn],clock=active?.slots.reminderTime;
 if(active?.lifecycle!=='CLARIFYING'||input.currentTurn!==input.turns.length-1||input.ambiguities.length||!isBoundReminderClockAnswer(input)||clock?.state!=='MISSING'||clock.value!==null||clock.fact!==null||input.facts.some(fact=>fact.field==='reminderTime'))return;
 if(/^\s*(?:\d{1,2}h(?:\d{1,2})?|\d{1,2}:\d{2})\s*[.!]?\s*$/iu.test(current.text))return 'reminderTime';
}
