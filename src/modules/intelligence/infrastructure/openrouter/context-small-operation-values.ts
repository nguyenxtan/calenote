import {SLOT_NAMES,SlotValueSchemas,ClockOperandSchema} from '../../../conversation/context-contract/contracts';
import type {OwnedCarrier,OwnedClockWire} from './context-small-owned-clocks';
type Row=Record<string,unknown>;
export interface WriteValue {operation:string;value:unknown}
export interface OperationRow {rank:number;write:WriteValue[];evidence:string[]}
export interface OperationValueWire extends Omit<OwnedClockWire,'changes'> {changes:Record<string,OperationRow[]>}
const operations=['SET','REPLACE','CLEAR'];
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
function check(v:unknown):asserts v {if(!v)throw Error('OPERATION_VALUE_INVALID');}
const exact=(v:unknown,keys:readonly string[]):v is Row=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const empty=(v:unknown)=>Array.isArray(v)&&v.length===0;
const family=(f:string)=>['eventTime','reminderTime'].includes(f)?'clock':['eventDate','reminderDate','endDate'].includes(f)?'date':['occurrenceCount','leadOffsetDays'].includes(f)?'number':'text';
const fields=(shape:unknown)=>(shape as {properties:{changes:{properties:Record<string,Row>}}}).properties.changes.properties;
interface WritePolicy {minItems?:number;maxItems:number;items:{properties?:{operation:{enum:string[]}}}}
const writePolicy=(field:Row)=>(field.items as {properties:{write:WritePolicy}}).properties.write;
function nonnull(value:unknown):Row {check(record(value));const types=Array.isArray(value.type)?value.type:[value.type],active=types.filter(t=>t!=='null');check(active.length===1&&['string','integer'].includes(active[0] as string));const result:Row={...value,type:active[0]};if(Array.isArray(result.enum)){const enums=result.enum.filter(v=>v!==null);check(enums.length>0);result.enum=enums;}return result;}
/** One outer active row and one inner WRITE structurally exclude simultaneous WRITE/CLEAR. */
export function operationValueSchema(source:unknown):Row {
 const schema=structuredClone(source) as Row;
 for(const[field,control]of Object.entries(fields(schema))){const props=control.properties as Row,allowed=(props.operation as {enum:string[]}).enum.filter(op=>op!=='KEEP');check(allowed.length&&allowed.every(op=>operations.includes(op)));const write=allowed.filter(op=>op!=='CLEAR');
  const value=write.length?(family(field)==='text'?nonnull(props.text):family(field)==='number'?nonnull(props.value):family(field)==='date'?(props.date as {items:Row}).items:(props.clock as {items:Row}).items):undefined;
  const writeCell={type:'array',maxItems:write.length?1:0,...(allowed.includes('CLEAR')?{}:{minItems:1}),items:write.length?{type:'object',additionalProperties:false,required:['operation','value'],properties:{operation:{type:'string',enum:write},value}}:{type:'string'}};
  const properties={rank:{type:'integer'},write:writeCell,evidence:{...props.evidence as Row,minItems:1,maxItems:3}};fields(schema)[field]={type:'array',maxItems:1,items:{type:'object',additionalProperties:false,required:Object.keys(properties),properties}};
 }return schema;
}
function typed(field:string,value:unknown):boolean {
 if(value===null||value===undefined)return false;
 const f=family(field);if(f==='clock')return ClockOperandSchema.safeParse(value).success;
 if(f==='number')return typeof value==='number'&&Number.isSafeInteger(value);
 if(f==='text'){if(typeof value!=='string')return false;return field==='calendar'||field==='frequency'||field==='eventRelation'?SlotValueSchemas[field].safeParse(value).success:true;}
 const keys=['kind','calendar','day','month','year','leapMonth','offsetDays','weekday','qualifier'];if(!exact(value,keys))return false;
 return ['CIVIL_DATE','RELATIVE_DAY','WEEKDAY'].includes(value.kind as string)&&(value.calendar===null||['GREGORIAN','LUNAR_VN'].includes(value.calendar as string))&&['day','month','year','offsetDays','weekday'].every(k=>value[k]===null||typeof value[k]==='number'&&Number.isSafeInteger(value[k]))&&(value.leapMonth===null||typeof value.leapMonth==='boolean')&&(value.qualifier===null||['THIS_WEEK','NEXT_WEEK','UNRESOLVED'].includes(value.qualifier as string));
}
const keep=():OwnedCarrier=>({rank:null,operation:'KEEP',value:null,text:null,date:[],evidence:[],clock:[]});
/** Trusted encoding checks every inactive old column and exact selected permission. */
export function attachOperationValues(flat:OwnedClockWire,shape:unknown):OperationValueWire {
 const changes:OperationValueWire['changes']={},policy=fields(shape);check(exact(flat.changes,Object.keys(policy)));
 for(const[field,p]of Object.entries(policy)){const c=flat.changes[field],selected=writePolicy(p);check(exact(c,['rank','operation','value','text','date','evidence','clock']));changes[field]=[];
  if(c.operation==='KEEP'){check(c.rank===null&&c.value===null&&c.text===null&&[c.date,c.clock,c.evidence].every(empty));continue;}
  check(c.operation==='CLEAR'?(selected.minItems??0)===0:selected.items.properties?.operation.enum.includes(c.operation));let value:unknown;
  if(c.operation==='CLEAR')check(c.value===null&&c.text===null&&empty(c.date)&&empty(c.clock));
  else if(family(field)==='text'){check(c.value===null&&empty(c.date)&&empty(c.clock));value=c.text;}
  else if(family(field)==='number'){check(c.text===null&&empty(c.date)&&empty(c.clock));value=c.value;}
  else if(family(field)==='date'){check(c.value===null&&c.text===null&&empty(c.clock)&&Array.isArray(c.date)&&c.date.length===1);value=c.date[0];}
  else{check(c.value===null&&c.text===null&&empty(c.date)&&Array.isArray(c.clock)&&c.clock.length===1);value=c.clock[0];}
  changes[field]=[{rank:c.rank as number,write:c.operation==='CLEAR'?[]:[{operation:c.operation,value:structuredClone(value)}],evidence:structuredClone(c.evidence)}];
 }const result={...flat,changes};expandOperationValues(result,shape);return result;
}
/** Empty outer means unchanged; explicitly authored empty inner means permitted CLEAR. */
export function expandOperationValues(wire:OperationValueWire,shape:unknown):OwnedClockWire {
 const policy=fields(shape),ranks=new Set<number>();check(exact(wire.changes,Object.keys(policy)));
 for(const[field,p]of Object.entries(policy)){check(SLOT_NAMES.some(f=>f===field));const rows=wire.changes[field],selected=writePolicy(p);check(Array.isArray(rows)&&rows.length<=1);
  for(const row of rows){check(exact(row,['rank','write','evidence']));check(Number.isSafeInteger(row.rank)&&row.rank>=0&&row.rank<=12&&!ranks.has(row.rank));ranks.add(row.rank);check(Array.isArray(row.evidence)&&row.evidence.length>=1&&row.evidence.length<=3&&row.evidence.every(e=>typeof e==='string'&&e.length>0));check(Array.isArray(row.write)&&row.write.length<=selected.maxItems&&row.write.length>=(selected.minItems??0));for(const write of row.write){check(exact(write,['operation','value'])&&typeof write.operation==='string'&&['SET','REPLACE'].includes(write.operation)&&selected.items.properties?.operation.enum.includes(write.operation));check(typed(field,write.value));}}
 }
 const changes:OwnedClockWire['changes']={};for(const[field,rows]of Object.entries(wire.changes)){let c=keep();for(const row of rows){c={...keep(),rank:row.rank,operation:row.write.length===0?'CLEAR':row.write[0].operation,evidence:structuredClone(row.evidence)};if(row.write.length===1){const value=structuredClone(row.write[0].value);if(family(field)==='text')c.text=value as string;else if(family(field)==='number')c.value=value as number;else if(family(field)==='date')c.date=[value as Row];else c.clock=[value as Row];}}changes[field]=c;}return {...wire,changes};
}
