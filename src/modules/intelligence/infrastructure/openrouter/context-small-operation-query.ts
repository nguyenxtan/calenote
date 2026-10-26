/** One operation owns its query grammar. No independent received query is selected or discarded. */
import {expandKindQueries,type KindQueryWire} from './context-small-kind-queries';
import {CONTEXT_OPERATION_WIRE_METADATA_V1} from './context-provider-wire';
type Row=Record<string,unknown>;
const kinds=['list','calendar','capability'] as const;
type Kind=typeof kinds[number];
interface Source {operation:{code:string;targetEvidence:string[]};query:Record<Kind,unknown[]>}
export type OperationQueryWire<T extends Source>=Omit<T,'operation'|'query'>&{operation:Source['operation']&{query?:unknown[]}};
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
function check(v:unknown):asserts v {if(!v)throw Error('OPERATION_QUERY_INVALID');}
const selected=(code:string):Kind|undefined=>code==='3'?'list':code==='4'?'calendar':code==='5'?'capability':undefined;
const exact=(v:unknown,keys:string[]):v is Row=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const codes=new Set(CONTEXT_OPERATION_WIRE_METADATA_V1.map((_,i)=>String(i)));
function targetEvidence(operation:Source['operation']){check(Array.isArray(operation.targetEvidence)&&operation.targetEvidence.every(e=>typeof e==='string'&&e.length>0));const targeted=CONTEXT_OPERATION_WIRE_METADATA_V1[Number(operation.code)][1]!==null;check(targeted?operation.targetEvidence.length>=1&&operation.targetEvidence.length<=3:operation.targetEvidence.length===0);}
/** Reuse selected domains exactly. Only the three query operations declare a query property. */
export function operationQuerySchema(source:unknown):Row {
 const schema=structuredClone(source) as {properties:Row;required:string[]};
 const operation=schema.properties.operation as {anyOf:Array<{properties:{code:{enum:string[]}};required:string[]}>},query=schema.properties.query as {properties:Record<Kind,Row>};
 check(operation?.anyOf?.length&&query?.properties&&kinds.every(k=>Object.hasOwn(query.properties,k)));
 const branches=operation.anyOf.flatMap(old=>{
  const domain=old.properties.code.enum;check(Array.isArray(domain)&&domain.length&&domain.every(c=>codes.has(c)));
  const groups:Array<{domain:string[];kind?:Kind}>=[{domain:domain.filter(c=>selected(c)===undefined)},...domain.filter(c=>selected(c)!==undefined).map(c=>({domain:[c],kind:selected(c)}))];
  return groups.filter(g=>g.domain.length).map(g=>{const branch=structuredClone(old) as unknown as {properties:Row;required:string[]};branch.properties.code={...old.properties.code,enum:g.domain};
   if(g.kind){branch.properties.query=structuredClone(query.properties[g.kind]);branch.required.push('query');}return branch;});
 });
 schema.properties.operation={anyOf:branches};delete schema.properties.query;schema.required=schema.required.filter(k=>k!=='query');return schema as unknown as Row;
}
/** Trusted source must already satisfy all old carrier/correlation rules before extraction. */
export function attachOperationQuery<T extends Source>(source:T):OperationQueryWire<T> {
 expandKindQueries(source as unknown as KindQueryWire);
 check(exact(source.operation,['code','targetEvidence'])&&codes.has(source.operation.code));targetEvidence(source.operation);
 const {query,operation,...rest}=source,kind=selected(operation.code);
 return {...rest,operation:{...structuredClone(operation),...(kind?{query:structuredClone(query[kind])}:{})}} as OperationQueryWire<T>;
}
/** Inverse expands only declared inactive syntax. Legacy independent root query always refuses. */
export function expandOperationQuery(raw:unknown):Row {
 check(record(raw)&&!Object.hasOwn(raw,'query')&&record(raw.operation));const operation=raw.operation;
 check(typeof operation.code==='string'&&codes.has(operation.code));const kind=selected(operation.code);
 check(exact(operation,kind?['code','targetEvidence','query']:['code','targetEvidence']));
 targetEvidence(operation as unknown as Source['operation']);
 const query:Record<Kind,unknown[]>={list:[],calendar:[],capability:[]};if(kind){check(Array.isArray(operation.query)&&operation.query.length<=1);query[kind]=structuredClone(operation.query);}
 const result={...raw,operation:{code:operation.code,targetEvidence:structuredClone(operation.targetEvidence)},query};
 expandKindQueries(result as unknown as KindQueryWire);return result;
}
