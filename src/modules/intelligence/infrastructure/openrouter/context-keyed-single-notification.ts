import type {ContextInput} from '../../../conversation/context-contract/contracts';

/** In this complete source form, “one notification” is the ONCE frequency,
 * not an independently authored finite-series count. Restrict the comparison
 * carrier only; do not supply cadence, distance, target or any operand. */
export function keyedSingleNotificationCountAbsent(input:ContextInput):boolean {
 const active=input.activeRequest,current=input.turns[input.currentTurn];
 if(active?.lifecycle!=='CLARIFYING'||current?.role!=='USER'||input.ambiguities.length||Object.values(active.slots).some(slot=>slot.state==='CONFLICT'))return false;
 for(const field of ['frequency','occurrenceCount'] as const){const slot=active.slots[field];if(slot.state!=='MISSING'||slot.value!==null||slot.fact!==null||input.facts.some(fact=>fact.field===field))return false;}
 return /^nhắc(?:\s+(?:tôi|mình|tui))?\s+(?:một|1)\s+lần\s+trước\s+(?:sự kiện|ngày thi|hôm thi|đó)\s+(?:\d{1,3}|một|hai|ba)\s+ngày[.!]?$/iu.test(current.text);
}
