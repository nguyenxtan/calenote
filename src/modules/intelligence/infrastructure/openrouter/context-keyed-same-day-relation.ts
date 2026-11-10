import type {ContextInput} from '../../../conversation/context-contract/contracts';
import type {SourceEvidence} from '../../../conversation/context-contract/state';
import {supportsEventRelation} from '../../../conversation/context-contract/event-relation-evidence';
import {CONTROL_PLACEHOLDER} from '../../../conversation/context-contract/projection';

/** A sufficient closed CURRENT source for a generation-presence obligation.
 * This supplies no date, clock, evidence, default, patch or execution authority.
 * The model must author INCLUDING_EVENT and the backend must validate it. */
export function keyedSameDayEventRelationRequired(input:ContextInput):boolean {
 const active=input.activeRequest,current=input.turns[input.currentTurn],question=input.pendingQuestion;
 if(active?.lifecycle!=='CLARIFYING'||current?.role!=='USER'||input.currentTurn<=0
   ||input.currentTurn!==input.turns.length-1||input.ambiguities.length
   ||question?.scope!=='REMINDER'||question.reason!=='MISSING'||question.decisionKind!==null
   ||!['reminderTime','reminderDate','eventRelation'].includes(question.field)
   ||Object.values(active.slots).some(slot=>slot.state==='CONFLICT'))return false;
 for(const field of ['reminderDate','eventRelation','leadOffsetDays','leadOffsetWeeks','leadOffsetHours','leadOffsetMinutes','frequency','occurrenceCount','endDate'] as const){
  const slot=active.slots[field];
  if((slot&&(slot.state!=='MISSING'||slot.value!==null||slot.fact!==null))||input.facts.some(fact=>fact.field===field))return false;
 }
 const reference=Date.parse(input.reference.instant);
 if(!Number.isFinite(reference))return false;
 for(const field of ['title','eventDate'] as const){
  const slot=active.slots[field],facts=input.facts.filter(fact=>fact.field===field),fact=facts[0],source=Date.parse(fact?.sourceReferenceTime??'');
  if(slot.state!=='RESOLVED'||slot.value===null||facts.length!==1||fact.scope!=='REMINDER'
    ||slot.fact!==fact.alias||input.facts.filter(item=>item.alias===fact.alias).length!==1
    ||JSON.stringify(slot.value)!==JSON.stringify(fact.value)||fact.provenance.kind!=='EXPLICIT_USER'
    ||fact.dependencies.length||!Number.isFinite(source)||source>reference)return false;
  if(field==='title'&&(typeof slot.value!=='string'||!slot.value.trim()))return false;
 }
 const text=current.text;
 if(/[\r\n\t"'`“”‘’]/u.test(text)||text.includes(CONTROL_PLACEHOLDER))return false;
 // The optional correction prefix is deliberately closed. Its sole negation
 // rejects month units; it cannot negate or introduce a second reminder task.
 const match=/^\s*(?:đổi ngày sửa lại thành sau ([1-9]\d{0,2}) ngày(?:, không tính theo tháng)?\.\s*)?nhắc (?:ngày đó|hôm đó)(?: lúc (?:[01]?\d|2[0-3])(?:h(?:[0-5]\d)?|:[0-5]\d)(?: sáng)?)?[.!]?\s*$/iu.exec(text);
 if(!match||(match[1]!==undefined&&Number(match[1])>366))return false;
 const turn={id:'same-day-relation-source',role:'USER' as const,semanticView:text},length=[...text].length;
 const source:SourceEvidence={kind:'USER_QUOTE',sourceTurnId:turn.id,sourceMapTurnId:turn.id,quote:text,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:'nfc-codepoint-v1'};
 return supportsEventRelation('INCLUDING_EVENT',[source],[turn],true,'ONCE');
}
