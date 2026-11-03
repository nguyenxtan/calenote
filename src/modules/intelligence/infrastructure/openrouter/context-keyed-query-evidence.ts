import type {ContextInput,QueryOperand} from '../../../conversation/context-contract/contracts';

/** Eligibility only: absent operands and other query kinds cannot prove a
 * new operand. Exact value matching remains the downstream validator's job. */
export function keyedQueryFactEvidenceCodes(input:ContextInput,kind:QueryOperand['kind']):string[] {
 return input.facts.flatMap(fact=>{
  if(fact.scope!=='QUERY'||fact.value.kind!==kind)return [];
  const query=fact.value;
  if(query.kind==='LIST'){
   const period=query.period;
   if(period===null||period.kind==='DAY'&&period.date===null||period.kind==='DATE_BOUNDS'&&(period.from===null||period.through===null))return [];
  }else if(query.kind==='CALENDAR_DATE'?(query.date===null||query.outputCalendar===null):query.topic===null)return [];
  return [`F${fact.alias}`];
 });
}
