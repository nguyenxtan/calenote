import type {ActiveCarrierWire} from './context-small-active-carriers';
type Row=Record<string,unknown>;
type Query=ActiveCarrierWire['query'][number];
interface KindQueryCarriers {list:Array<Pick<Query,'period'|'evidence'>>;calendar:Array<Pick<Query,'date'|'outputCalendar'|'evidence'>>;capability:Array<Pick<Query,'topic'|'evidence'>>}
type QuerySource=Pick<ActiveCarrierWire,'operation'|'query'>;
export type KindQueryWire<T extends QuerySource=ActiveCarrierWire> = Omit<T,'query'>&{query:KindQueryCarriers};
const kinds=['list','calendar','capability'] as const;
type Kind=typeof kinds[number];
const columns={list:['period','evidence'],calendar:['date','outputCalendar','evidence'],capability:['topic','evidence']} as const;
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
function check(v:unknown):asserts v {if(!v)throw Error('KIND_QUERY_INVALID');}
const exact=(v:unknown,keys:readonly string[]):v is Row=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const empty=(v:unknown)=>Array.isArray(v)&&v.length===0;
const operand=(v:unknown)=>Array.isArray(v)&&v.length<=1&&v.every(record);
const evidence=(v:unknown)=>Array.isArray(v)&&v.length>=1&&v.length<=3&&v.every(x=>typeof x==='string'&&x.length>0);
const selected=(code:string):Kind|undefined=>code==='3'?'list':code==='4'?'calendar':code==='5'?'capability':undefined;
/** Whole query family has one monomorphic carrier per kind, with no inactive cross-kind columns. */
export function kindQuerySchema(source:unknown):Row {
 const schema=structuredClone(source) as {properties:{query:{items:{properties:Row}}}};const props=schema.properties.query.items.properties;
 const properties=Object.fromEntries(kinds.map(kind=>[kind,{type:'array',maxItems:1,items:{type:'object',additionalProperties:false,required:[...columns[kind]],properties:Object.fromEntries(columns[kind].map(key=>[key,props[key]]))}}]));
 (schema.properties as unknown as Row).query={type:'object',additionalProperties:false,required:[...kinds],properties};return schema as unknown as Row;
}
/** Trusted authoring rejects contradictory inactive data before selecting a kind. */
export function attachKindQueries<T extends QuerySource>(flat:T):KindQueryWire<T> {
 check(Array.isArray(flat.query)&&flat.query.length<=1);const query:KindQueryCarriers={list:[],calendar:[],capability:[]};
 if(flat.query.length){const row=flat.query[0],kind=selected(flat.operation.code);check(kind&&exact(row,['period','date','outputCalendar','topic','evidence']));
  if(kind==='list'){check(empty(row.date)&&row.outputCalendar===null&&row.topic===null);query.list=[{period:structuredClone(row.period),evidence:structuredClone(row.evidence)}];}
  else if(kind==='calendar'){check(empty(row.period)&&row.topic===null);query.calendar=[{date:structuredClone(row.date),outputCalendar:row.outputCalendar,evidence:structuredClone(row.evidence)}];}
  else{check(empty(row.period)&&empty(row.date)&&row.outputCalendar===null);query.capability=[{topic:row.topic,evidence:structuredClone(row.evidence)}];}
 }
 const result={...flat,query};expandKindQueries(result);return result;
}
/** Validate all carriers before expanding only declared inactive syntax. No selection, inference or repair. */
export function expandKindQueries<T extends {operation:QuerySource['operation'];query:KindQueryCarriers}>(owned:T):Omit<T,'query'>&{query:Query[]} {
 check(exact(owned.query,kinds));let active:Kind|undefined;
 for(const kind of kinds){const rows=owned.query[kind];check(Array.isArray(rows)&&rows.length<=1);
  for(const row of rows){check(exact(row,columns[kind])&&evidence(row.evidence));
   if(kind==='list')check(operand((row as KindQueryWire['query']['list'][number]).period));
   else if(kind==='calendar'){const value=row as KindQueryWire['query']['calendar'][number];check(operand(value.date)&&(value.outputCalendar===null||value.outputCalendar==='GREGORIAN'||value.outputCalendar==='LUNAR_VN'));}
   else{const value=row as KindQueryWire['query']['capability'][number];check(value.topic===null||typeof value.topic==='string');}
   check(active===undefined);active=kind;
  }
 }
 if(active===undefined)return {...owned,query:[]};check(active===selected(owned.operation.code));
 const inactive={period:[],date:[],outputCalendar:null,topic:null};
 const row=owned.query[active][0];return {...owned,query:[{...inactive,...structuredClone(row)} as Query]};
}
