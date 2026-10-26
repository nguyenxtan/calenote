/** Ordered field-owned transport. No received rank coordinate or operand stream. */
import {z} from 'zod';
import {SlotValueSchemas,ClockOperandSchema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {primaryEvidenceSourceCodebook} from './evidence-pointer';
import {UNCERTAINTY_FIELD_WIRE_CODE_V1} from './context-provider-wire';
import {internalFlatSchemaV3} from './context-small-intermediate';
import {ownedClockSchema} from './context-small-owned-clocks';
import {operationValueSchema,expandOperationValues,type OperationValueWire} from './context-small-operation-values';
import {kindQuerySchema,expandKindQueries,type KindQueryWire} from './context-small-kind-queries';
type Row=Record<string,unknown>;
export interface OrderedChange {field:string;write:Array<{operation:string;value:unknown}>;evidence:string[]}
export type OrderedChangeWire<T extends {changes:unknown}=OperationValueWire>=Omit<T,'changes'>&{changes:OrderedChange[]};
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
function check(v:unknown):asserts v {if(!v)throw Error('ORDERED_CHANGE_INVALID');}
const empty=(v:unknown)=>Array.isArray(v)&&v.length===0;
const dateKeys:Record<string,readonly string[]>={CIVIL_DATE:['kind','calendar','day','month','year','leapMonth'],RELATIVE_DAY:['kind','offsetDays'],WEEKDAY:['kind','weekday','qualifier']};
const periodKeys:Record<string,readonly string[]>={DAY:['kind','date'],WEEK:['kind','offset'],MONTH:['kind','offset'],WEEKEND:['kind','offset'],REST_OF_MONTH:['kind'],NEXT_7_DAYS:['kind'],UPCOMING:['kind'],DATE_BOUNDS:['kind','from','through']};
const relative=Object.fromEntries(['WEEK','MONTH','WEEKEND'].flatMap(kind=>[[-1,'PREVIOUS'],[0,'CURRENT'],[1,'NEXT']].map(([offset,label])=>[`${kind}_${label}`,{kind,offset:Number(offset)}])));
const family=(field:string)=>['eventDate','reminderDate','endDate'].includes(field)?'date':['eventTime','reminderTime'].includes(field)?'clock':['occurrenceCount','leadOffsetDays'].includes(field)?'number':field==='queryRange'?'period':'text';
/** Copy each selected field's complete write/value/evidence domain, not a union of sibling properties. */
export function orderedChangeSchema(source:unknown):Row {
 const schema=structuredClone(source) as {properties:Row},fields=(schema.properties.changes as {properties:Record<string,{items:{properties:Row}} >}).properties;
 const branches=Object.entries(fields).map(([field,node])=>({type:'object',additionalProperties:false,required:['field','write','evidence'],properties:{field:{type:'string',enum:[field]},write:node.items.properties.write,evidence:node.items.properties.evidence}}));
 check(branches.length>0);schema.properties.changes={type:'array',maxItems:13,items:{anyOf:branches}};return schema as Row;
}
/** Trusted fixture helper only: the supplied order is the canonical array, not JSON member order. */
export function attachOrderedChanges<T extends Pick<OperationValueWire,'changes'>>(owned:T,order:readonly {field:string}[],policy:unknown):OrderedChangeWire<T> {
 expandOperationValues(owned as unknown as OperationValueWire,policy);
 check(order.length===Object.values(owned.changes).filter(rows=>rows.length>0).length&&new Set(order.map(row=>row.field)).size===order.length);
 const changes=order.map(({field},index)=>{const rows=owned.changes[field];check(rows?.length===1&&rows[0].rank===index);const {write,evidence}=rows[0];return {field,write:structuredClone(write),evidence:structuredClone(evidence)};});
 return {...owned,changes};
}
/** Validate every owner and inactive operand before constructing the unindexed typed candidate. */
export function projectOrderedSmallV3(raw:unknown,input:ContextInput):Row {
 check(record(raw)&&Array.isArray(raw.changes)&&raw.changes.length<=13);
 const schema=orderedChangeSchema(kindQuerySchema(operationValueSchema(ownedClockSchema(internalFlatSchemaV3(input).schema))));
 const checked=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).parse({...raw,directive:[],reply:[]}) as unknown as OrderedChangeWire<KindQueryWire<OperationValueWire>>;
 check(new Set(checked.changes.map(change=>change.field)).size===checked.changes.length);
 const parsed=expandKindQueries(checked),book=primaryEvidenceSourceCodebook(input);
 check(parsed.uncertainties.length<=4);
 const active=(row:Row,keys:readonly string[])=>{for(const[key,value]of Object.entries(row))if(!keys.includes(key))check(value===null);return Object.fromEntries(keys.map(key=>[key,row[key]]));};
 const date=(row:Row):Row=>{const keys=dateKeys[String(row.kind)];check(keys);const value=active(row,keys);check(SlotValueSchemas.eventDate.safeParse(value).success);return value;};
 const dateCell=(rows:Row[]):Row|null=>{check(rows.length<=1);return rows.length?date(rows[0]):null;};
 const period=(rows:Row[],padded:boolean):Row|null=>{
  check(rows.length<=1);if(!rows.length)return null;const row=rows[0];
  for(const key of row.kind==='DAY'?['from','through']:row.kind==='DATE_BOUNDS'?['date']:['date','from','through'])check(empty(row[key]));
  const rel=relative[String(row.kind)],unsupported=row.kind==='UNSUPPORTED';
  check(unsupported?typeof row.unsupportedKind==='string'&&!Object.hasOwn(periodKeys,row.unsupportedKind)&&!Object.hasOwn(relative,row.unsupportedKind)&&row.unsupportedKind!=='UNSUPPORTED':row.unsupportedKind===null);
  const value:Row={kind:unsupported?row.unsupportedKind:rel?.kind??row.kind,date:dateCell(row.date as Row[]),offset:rel?.offset??null,from:dateCell(row.from as Row[]),through:dateCell(row.through as Row[])};
  return padded?value:active(value,periodKeys[String(value.kind)]??Object.keys(value));
 };
 const evidence=(codes:string[])=>{check(codes.length>=1&&codes.length<=3);const pointers=codes.map(code=>{const json=book.decode(code);check(json!==undefined);return JSON.parse(json);});return {primaryEvidence:codes[0],additionalEvidence:pointers.slice(1)};};
 const writeValue=(field:string,value:unknown):unknown=>{const kind=family(field);if(kind==='date'){check(record(value));return date(value);}if(kind==='clock')check(ClockOperandSchema.safeParse(value).success);check(SlotValueSchemas[field as keyof typeof SlotValueSchemas]?.safeParse(value).success);return value;};
 const issueField=(code:number)=>{check(Number.isSafeInteger(code));const entry=Object.entries(UNCERTAINTY_FIELD_WIRE_CODE_V1).find(([,value])=>value===code);check(entry);return entry[0];};
 const alternativeValue=(field:string,a:Row):unknown=>{
  const kind=family(field);check(Array.isArray(a.clock)&&a.clock.length===(kind==='clock'?1:0));
  if(kind==='clock'){check(a.value===null&&a.text===null&&empty(a.date)&&empty(a.period)&&ClockOperandSchema.safeParse(a.clock[0]).success);return a.clock[0];}
  if(kind==='period'){check(a.value===null&&a.text===null&&empty(a.date)&&Array.isArray(a.period)&&a.period.length===1);return period(a.period as Row[],false);}
  check(empty(a.period));
  if(kind==='date'){check(a.value===null&&a.text===null&&Array.isArray(a.date)&&a.date.length===1);return dateCell(a.date as Row[]);}
  check(empty(a.date));if(kind==='text'){check(a.value===null&&typeof a.text==='string');return a.text;}
  check(a.text===null&&typeof a.value==='number'&&Number.isSafeInteger(a.value));return a.value;
 };
 // Validation-only operand projections are discarded. No candidate/clock cursor exists yet.
 for(const row of parsed.changes){evidence(row.evidence);check(row.write.length<=1);if(row.write.length)writeValue(row.field,row.write[0].value);}
 for(const query of parsed.query){dateCell(query.date);period(query.period,true);evidence(query.evidence);}
 for(const issue of parsed.uncertainties){check(issue.alternatives.length<=2);const field=issueField(issue.fieldCode);for(const a of issue.alternatives){alternativeValue(field,a as unknown as Row);evidence(a.evidence);}}
 if(parsed.operation.targetEvidence.length)evidence(parsed.operation.targetEvidence);
 const result:Row={operationCode:parsed.operation.code,requestTarget:parsed.operation.targetEvidence.length?{evidence:evidence(parsed.operation.targetEvidence)}:null,
  changes:parsed.changes.map(row=>({field:row.field,operation:row.write.length?row.write[0].operation:'CLEAR',value:row.write.length?writeValue(row.field,row.write[0].value):null,evidence:evidence(row.evidence)})),
  query:parsed.query.length?{period:period(parsed.query[0].period,true),date:dateCell(parsed.query[0].date),outputCalendar:parsed.query[0].outputCalendar,topic:parsed.query[0].topic,evidence:evidence(parsed.query[0].evidence)}:null,
  uncertainties:parsed.uncertainties.map(issue=>({fieldCode:issue.fieldCode,reason:issue.reason,alternatives:issue.alternatives.map(a=>({value:alternativeValue(issueField(issue.fieldCode),a as unknown as Row),evidence:evidence(a.evidence)}))})),
  conversationDirective:Array.isArray(raw.directive)&&raw.directive.length<=1?(raw.directive[0]??null):{kind:'INVALID_PROVIDER_WIRE'},replyProposal:Array.isArray(raw.reply)&&raw.reply.length<=1?(raw.reply[0]??null):{invalid:true}};
 return result;
}
