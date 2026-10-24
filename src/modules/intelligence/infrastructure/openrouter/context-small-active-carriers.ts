import {SLOT_NAMES} from '../../../conversation/context-contract/contracts';
import type {OwnedCarrier,OwnedClockWire} from './context-small-owned-clocks';
type Row=Record<string,unknown>;
export interface ActiveCarrier extends Omit<OwnedCarrier,'rank'|'operation'> {rank:number;operation:'SET'|'REPLACE'|'CLEAR'}
export interface ActiveCarrierWire extends Omit<OwnedClockWire,'changes'> {changes:Record<string,ActiveCarrier[]>}
const keys=['rank','operation','value','text','date','evidence','clock'];
function check(valid:unknown):asserts valid {if(!valid)throw Error('ACTIVE_CARRIER_INVALID');}
const record=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:unknown):value is Row=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const keep=():OwnedCarrier=>({rank:null,operation:'KEEP',value:null,text:null,date:[],evidence:[],clock:[]});
/** Required field identity with optional monomorphic active carrier, no noop object. */
export function activeCarrierSchema(source:unknown):Row {
 const schema=structuredClone(source) as {properties:{changes:{properties:Record<string,Row>}}};
 for(const [field,control]of Object.entries(schema.properties.changes.properties)){
  const props=control.properties as Row,op=props.operation as {enum:string[]};check(Array.isArray(op.enum)&&op.enum.includes('KEEP'));const active=op.enum.filter(value=>value!=='KEEP');check(active.length>0&&active.every(value=>['SET','REPLACE','CLEAR'].includes(value)));
  props.operation={...op,enum:active};props.rank={type:'integer'};props.evidence={...props.evidence as Row,minItems:1};
  schema.properties.changes.properties[field]={type:'array',items:control,maxItems:1};
 }
 return schema as unknown as Row;
}
/** Trusted authoring: never discard a contradictory internal noop or any active data. */
export function attachActiveCarriers(owned:OwnedClockWire):ActiveCarrierWire {
 const changes:Record<string,ActiveCarrier[]>={};
 for(const [field,c]of Object.entries(owned.changes)){
  check(exact(c));
  if(c.operation==='KEEP'){check(c.rank===null&&c.value===null&&c.text===null&&[c.date,c.evidence,c.clock].every(value=>Array.isArray(value)&&value.length===0));changes[field]=[];}
  else {check(['SET','REPLACE','CLEAR'].includes(c.operation)&&Number.isSafeInteger(c.rank)&&c.rank!==null&&c.rank>=0&&c.rank<=12);changes[field]=[structuredClone(c) as ActiveCarrier];}
 }
 return {...owned,changes};
}
/** Model inverse: all cells validate before exact inert syntax expansion. */
export function expandActiveCarriers(active:ActiveCarrierWire):OwnedClockWire {
 for(const [field,rows]of Object.entries(active.changes)){
  check(SLOT_NAMES.some(name=>name===field)&&Array.isArray(rows)&&rows.length<=1);
  if(rows.length){const row=rows[0];check(exact(row));check(['SET','REPLACE','CLEAR'].includes(row.operation)&&Number.isSafeInteger(row.rank)&&row.rank>=0&&row.rank<=12);check(Array.isArray(row.evidence)&&row.evidence.length>=1&&row.evidence.length<=3);}
 }
 return {...active,changes:Object.fromEntries(Object.entries(active.changes).map(([field,rows])=>[field,rows.length===0?keep():structuredClone(rows[0])]))};
}
