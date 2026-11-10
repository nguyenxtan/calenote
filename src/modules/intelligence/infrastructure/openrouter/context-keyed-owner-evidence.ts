import type {ContextInput} from '../../../conversation/context-contract/contracts';
import {primaryEvidenceSourceCodebook} from './evidence-pointer';

type Schema={type?:string;properties?:Record<string,Schema>;items?:Schema;enum?:unknown[];anyOf?:Schema[];minItems?:number;maxItems?:number};
type Codebook=ReturnType<typeof primaryEvidenceSourceCodebook>;

/** Generation eligibility only. Exact values, receipts and source authority
 * remain the backend's responsibility; no operand or evidence is supplied. */
export function keyedOwnerEvidenceRows(input:ContextInput,field:string,row:Schema,book:Codebook):Schema {
 const write=row.properties?.write,evidence=row.properties?.evidence;
 if(!write||!evidence?.items?.enum)throw Error('KEYED_OWNER_EVIDENCE_SHAPE');
 const original=evidence.items.enum;
 const allowedFacts=new Set(input.facts.filter(fact=>fact.scope==='REMINDER'&&fact.field===field).map(fact=>`F${fact.alias}`));
 const users=new Set(book.entries.filter(entry=>entry.kind!=='CONTEXT_FACT').map(entry=>entry.code));
 const retained=original.filter(code=>typeof code==='string'&&(users.has(code)||allowedFacts.has(code)));
 const current=original.filter(code=>typeof code==='string'&&book.currentCodes.includes(code));
 const withEvidence=(codes:unknown[])=>{
  const selected=structuredClone(row);selected.properties!.evidence.items!.enum=codes;return selected;
 };
 const operations=write.items?.properties?.operation.enum??[];
 const clearAllowed=(write.minItems??0)===0;
 if(!clearAllowed&&!operations.includes('REPLACE'))return withEvidence(retained);
 // For a single current USER source the two languages coincide. Do not add
 // grammar branches when the original language is already equally narrow.
 if(JSON.stringify(retained)===JSON.stringify(current))return withEvidence(current);
 const branches:Schema[]=[];
 if(operations.includes('SET')&&retained.length){
  const set=withEvidence(retained),selectedWrite=set.properties!.write;
  selectedWrite.minItems=1;selectedWrite.items!.properties!.operation.enum=['SET'];branches.push(set);
 }
 if(current.length)branches.push(withEvidence(current));
 if(!branches.length)throw Error('KEYED_OWNER_EVIDENCE_UNAVAILABLE');
 // The current-source branch preserves the original write language, including
 // explicit write:[]. A maxItems:0 CLEAR branch would be omitted by the fixed
 // empty-carrier codec. Overlapping SET branches encode/decode identically.
 return branches.length===1?branches[0]:{anyOf:branches};
}
