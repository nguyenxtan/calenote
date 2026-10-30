import type {ContextInput} from '../../../conversation/context-contract/contracts';
import {deriveGenerationFieldCapability,isInitialRelationUncertaintyAbsent} from '../../../conversation/context-contract/field-capability';
import {extractTemporalEvidence} from '../../../semantic/temporal-evidence';
/** Sufficient existing whole-source grammar, never an authored value or target.
 * Unknown, retained, ambiguous and competing source contexts keep111 language. */
export function initialDateClockUncertaintyProof(input?:ContextInput){
 const eventDateMissingExcluded=!!input&&isInitialRelationUncertaintyAbsent(input);
 const eventTimeUncertaintyAbsent=eventDateMissingExcluded&&deriveGenerationFieldCapability(input!).allowedClockFields.length===0
  &&extractTemporalEvidence({text:input!.turns[0].text,referenceNow:Date.parse(input!.reference.instant)}).time.state==='MISSING';
 return {eventDateMissingExcluded,eventTimeUncertaintyAbsent};
}
/** Producer only: receiver still preserves every canonical uncertainty. */
export function constrainInitialDateClockUncertainties<T>(original:T,input?:ContextInput):T{
 const proof=initialDateClockUncertaintyProof(input);if(!proof.eventDateMissingExcluded&&!proof.eventTimeUncertaintyAbsent)return original;
 const schema=structuredClone(original);let count=0;
 function visit(value:unknown){if(Array.isArray(value)){value.forEach(visit);return}if(!value||typeof value!=='object')return;const node=value as Record<string,unknown>,properties=node.properties as Record<string,unknown>|undefined;
  if(properties&&Object.hasOwn(properties,'fieldCode')){
   const field=properties.fieldCode as {type?:string;enum?:string[]},reason=properties.reason as {type?:string;enum?:string[]};
   if(field.type!=='string'||!Array.isArray(field.enum)||!field.enum.length||reason.type!=='string'||!Array.isArray(reason.enum)||!reason.enum.length||reason.enum.includes('MISSING')&&reason.enum.length!==1)throw Error('INITIAL_DATE_CLOCK_SCHEMA_TOPOLOGY');
   const retained=field.enum.filter(name=>!(proof.eventTimeUncertaintyAbsent&&name==='eventTime')&&!(proof.eventDateMissingExcluded&&reason.enum![0]==='MISSING'&&name==='eventDate'));
   if(!retained.length)throw Error('INITIAL_DATE_CLOCK_SCHEMA_TOPOLOGY');properties.fieldCode={...field,enum:retained};count++;
  }
  for(const[key,child]of Object.entries(node))if(key!=='fieldCode')visit(child);
 }
 visit(schema);if(!count)throw Error('INITIAL_DATE_CLOCK_SCHEMA_TOPOLOGY');return schema;
}
