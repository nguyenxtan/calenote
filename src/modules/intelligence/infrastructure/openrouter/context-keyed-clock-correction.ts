import type {ContextInput} from '../../../conversation/context-contract/contracts';
import {isBoundReminderClockAnswer} from '../../../conversation/context-contract/semantic-completeness';

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
