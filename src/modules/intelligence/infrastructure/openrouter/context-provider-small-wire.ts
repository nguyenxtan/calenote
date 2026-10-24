import {projectWireValidation,type SmallTableDiagnostic} from "../../../conversation/context-contract/validation-diagnostics";
import {z} from 'zod';
import {deriveGenerationFieldCapability,NUMERIC_PROPOSAL_FIELDS} from '../../../conversation/context-contract/field-capability';
import {ContextInputSchema,SLOT_NAMES,type ContextInput,type ConversationInterpretationV3} from '../../../conversation/context-contract/contracts';
import {CONTEXT_SMALL_PROTOCOL_V3,isContextSmallProtocolV3} from '../../../conversation/context-contract/small-protocol';
import {CONTEXT_TYPED_PROTOCOL_V3} from '../../../conversation/context-contract/typed-protocol';
import {encodeGoogleLiteEuTypedContextV3,decodeGoogleLiteEuTypedContextTransportV3} from './context-provider-typed-wire';
import {primaryEvidenceSourceCodebook} from './evidence-pointer';
import {contextTypedWirePrimitives,UNCERTAINTY_FIELD_WIRE_CODE_V1} from './context-provider-wire';
type JsonSchema=Parameters<typeof z.fromJSONSchema>[0];
type Row=Record<string,unknown>;
type Observer=Parameters<typeof decodeGoogleLiteEuTypedContextTransportV3>[2];
const singleton=contextTypedWirePrimitives.singletonChangeDefinitions;
const str={type:'string'},integer={type:'integer'},nullableInteger={type:['integer','null']},nullableString={type:['string','null']};
const obj=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const arr=(items:unknown)=>({type:'array',items});
const dateFields:Record<string,readonly string[]>={CIVIL_DATE:['kind','calendar','day','month','year','leapMonth'],RELATIVE_DAY:['kind','offsetDays'],WEEKDAY:['kind','weekday','qualifier']};
const periodFields:Record<string,readonly string[]>={DAY:['kind','date'],WEEK:['kind','offset'],MONTH:['kind','offset'],WEEKEND:['kind','offset'],REST_OF_MONTH:['kind'],NEXT_7_DAYS:['kind'],UPCOMING:['kind'],DATE_BOUNDS:['kind','from','through']};
// A finite transport control carries both relative kind and offset. No default
// or repair of model-authored offsets is possible at the canonical boundary.
const relativePeriods:Record<string,{kind:string;offset:number}>=Object.fromEntries(['WEEK','MONTH','WEEKEND'].flatMap(kind=>[[-1,'PREVIOUS'],[0,'CURRENT'],[1,'NEXT']].map(([offset,label])=>[`${kind}_${label}`,{kind,offset:Number(offset)}])));
const periodCodes=['DAY',...Object.keys(relativePeriods),'REST_OF_MONTH','NEXT_7_DAYS','UPCOMING','DATE_BOUNDS','UNSUPPORTED'];
const fieldNames=Object.keys(UNCERTAINTY_FIELD_WIRE_CODE_V1);
function uncertaintyField(code:number):string {const entry=Object.entries(UNCERTAINTY_FIELD_WIRE_CODE_V1).find(([,value])=>value===code);if(!entry)throw Error('SMALL_FIELD_CODE_INVALID');return entry[0];}
type Family='texts'|'integers'|'dates'|'clocks'|'periods';
function family(field:string):Family {
 if(['eventDate','reminderDate','endDate'].includes(field))return 'dates';
 if(['eventTime','reminderTime'].includes(field))return 'clocks';
 if(['occurrenceCount','leadOffsetDays'].includes(field))return 'integers';
 if(field==='queryRange')return 'periods';
 if(fieldNames.includes(field))return 'texts';
 throw Error('SMALL_FIELD_INVALID');
}
/** A fixed typed grammar. Input selects evidence codes before transport exists.
 * Table references replace polymorphic value schemas; no JSON-in-string. */
export function smallContextSchemaV3(input:ContextInput){
 const parsed=ContextInputSchema.parse(input),codes=primaryEvidenceSourceCodebook(parsed).codes;
 const capability=deriveGenerationFieldCapability(parsed),numericFields=new Set<string>(NUMERIC_PROPOSAL_FIELDS),allowedNumeric=new Set<string>(capability.allowedNumericFields);
 const changeFields=SLOT_NAMES.filter(field=>!numericFields.has(field)||allowedNumeric.has(field));
 const evidence=arr({type:'string',enum:[...codes]});
 const date={anyOf:[obj({kind:{type:'string',enum:['CIVIL_DATE']},calendar:{type:'string',enum:['GREGORIAN','LUNAR_VN']},day:integer,month:integer,year:nullableInteger,leapMonth:{type:['boolean','null']}}),obj({kind:{type:'string',enum:['RELATIVE_DAY']},offsetDays:integer}),obj({kind:{type:'string',enum:['WEEKDAY']},weekday:integer,qualifier:{type:'string',enum:['THIS_WEEK','NEXT_WEEK','UNRESOLVED']}})]};
 const dateCell={...arr(date),maxItems:1};
 const period=obj({kind:{type:'string',enum:periodCodes},date:dateCell,from:dateCell,through:dateCell,unsupportedKind:nullableString});
 const periodCell={...arr(period),maxItems:1};
 // The operation header correlates code and target presence in two branches.
 const operation={anyOf:[obj({code:{type:'string',enum:['0','1','2','9','10','11']},targetEvidence:{...evidence,minItems:1,maxItems:3}}),obj({code:{type:'string',enum:['3','4','5','6','7','8']},targetEvidence:{...evidence,maxItems:0}})]};
 const schema=obj({operation,
  changes:arr(obj({field:{type:'string',enum:changeFields},rank:integer,operation:{type:'string',enum:['SET','REPLACE','CLEAR']},value:nullableInteger,text:nullableString,date:dateCell,evidence})),
  query:arr(obj({period:periodCell,date:dateCell,outputCalendar:nullableString,topic:nullableString,evidence})),
  uncertainties:arr(obj({fieldCode:integer,reason:{type:'string',enum:['MISSING','AMBIGUOUS','CONFLICT','UNSUPPORTED_COMBINATION']},alternatives:arr(obj({value:nullableInteger,text:nullableString,date:dateCell,period:periodCell,evidence}))})),
  directive:arr(obj({kind:str,field:nullableString,reason:nullableString,issue:nullableString,topic:nullableString})),reply:arr(obj({text:str})),
  texts:{...arr(str),maxItems:0},integers:{...arr(integer),maxItems:0},dates:{...arr(date),maxItems:0},clocks:arr(obj({hour:integer,minute:integer,qualifier:str})),periods:{...arr(period),maxItems:0}});
 return {version:CONTEXT_SMALL_PROTOCOL_V3.wireVersion,schema:schema as unknown as ReturnType<typeof import("./context-provider-typed-wire").googleLiteEuTypedContextWireSchemaV3>["schema"]};
}
export interface SmallContextWire {
 operation:{code:string;targetEvidence:string[]};
 changes:Array<{field:string;rank:number;operation:string;value:number|null;text:string|null;date:Row[];evidence:string[]}>;
 query:Array<{period:Row[];date:Row[];outputCalendar:string|null;topic:string|null;evidence:string[]}>;
 uncertainties:Array<{fieldCode:number;reason:string;alternatives:Array<{value:number|null;text:string|null;date:Row[];period:Row[];evidence:string[]}>}>;
 directive:Row[];reply:Array<{text:string}>;texts:string[];integers:number[];dates:Row[];clocks:Row[];periods:Row[];
}
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
class SmallTableError extends Error {
 constructor(readonly diagnostic:SmallTableDiagnostic){super('SMALL_TYPED_VALUE_INVALID');}
}
function requireValue(valid:unknown,reason:SmallTableDiagnostic['reason']='INVALID_TABLE_VALUE',table?:Family):asserts valid {
 if(!valid)throw new SmallTableError({reason,...(table?{table}:{})});
}
/** Offline authoring only. No repair/coercion helper is used for model data. */
export function encodeSmallContextV3(value:ConversationInterpretationV3,input:ContextInput):SmallContextWire {
 const raw=encodeGoogleLiteEuTypedContextV3(value,input) as Row,book=primaryEvidenceSourceCodebook(input);
 const out:SmallContextWire={operation:{code:raw.operationCode as string,targetEvidence:[]},changes:[],query:[],uncertainties:[],directive:[],reply:[],texts:[],integers:[],dates:[],clocks:[],periods:[]};
 const store=(name:Family,value:unknown):number=>{const rows=out[name] as unknown[];const old=rows.findIndex(row=>JSON.stringify(row)===JSON.stringify(value));if(old>=0)return old;rows.push(value);return rows.length-1;};
 const date=(value:unknown):Row[]=>{if(value===null||value===undefined)return [];requireValue(record(value));return [{...value}];};
 const period=(value:unknown):Row[]=>{if(value===null||value===undefined)return [];requireValue(record(value));const relative=['WEEK','MONTH','WEEKEND'].includes(String(value.kind));const kind=relative?Object.keys(relativePeriods).find(code=>relativePeriods[code].kind===value.kind&&relativePeriods[code].offset===value.offset):String(value.kind);requireValue(kind&&periodCodes.includes(kind));return [{kind,date:date(value.date),from:date(value.from),through:date(value.through),unsupportedKind:null}];};
 const save=(field:string,value:unknown):number=>{const type=family(field);requireValue(type!=='dates'&&type!=='periods');if(type==='integers'){requireValue(typeof value==='number'&&Number.isSafeInteger(value),'INVALID_TABLE_VALUE','integers');return value;}return store(type,value);};
 const evidence=(value:unknown):string[]=>{requireValue(record(value)&&Array.isArray(value.additionalEvidence));return [String(value.primaryEvidence),...value.additionalEvidence.map(pointer=>book.encode(JSON.stringify(pointer)))];};
 if(record(raw.requestTarget))out.operation.targetEvidence=evidence(raw.requestTarget.evidence);
 const add=(carrier:unknown)=>{requireValue(record(carrier)&&record(carrier.change));const c=carrier.change;out.changes.push({field:c.field as string,rank:carrier.rank as number,operation:c.operation as string,value:c.value===null||['texts','dates'].includes(family(c.field as string))?null:save(c.field as string,c.value),text:c.value!==null&&family(c.field as string)==='texts'?c.value as string:null,date:c.value!==null&&family(c.field as string)==='dates'?date(c.value):[],evidence:evidence(c.evidence)});};
 for(const {root} of singleton)if(raw[root]!==null)add(raw[root]);
 (raw.changes as unknown[]).forEach(add);out.changes.sort((a,b)=>a.rank-b.rank);
 if(record(raw.query)){const q=raw.query;out.query=[{period:period(q.period),date:date(q.date),outputCalendar:q.outputCalendar as string|null,topic:q.topic as string|null,evidence:evidence(q.evidence)}];}
 out.uncertainties=(raw.uncertainties as Row[]).map(issue=>({fieldCode:issue.fieldCode as number,reason:issue.reason as string,alternatives:(issue.alternatives as Row[]).map(alternative=>({value:['texts','dates','periods'].includes(family(uncertaintyField(issue.fieldCode as number)))?null:save(uncertaintyField(issue.fieldCode as number),alternative.value),text:family(uncertaintyField(issue.fieldCode as number))==='texts'?alternative.value as string:null,date:family(uncertaintyField(issue.fieldCode as number))==='dates'?date(alternative.value):[],period:family(uncertaintyField(issue.fieldCode as number))==='periods'?period(alternative.value):[],evidence:evidence(alternative.evidence)}))}));
 if(record(raw.conversationDirective))out.directive=[structuredClone(raw.conversationDirective)];
 if(record(raw.replyProposal))out.reply=[raw.replyProposal as {text:string}];
 return out;
}
function expandSmall(raw:unknown,input:ContextInput):Row {
 requireValue(record(raw));
 // Guidance retains the existing quarantine boundary rather than poisoning core.
 const parsed=z.fromJSONSchema(smallContextSchemaV3(input).schema as JsonSchema).parse({...raw,directive:[],reply:[]}) as unknown as SmallContextWire;
 const book=primaryEvidenceSourceCodebook(input),used:Record<Family,Set<number>>={texts:new Set(),integers:new Set(),dates:new Set(),clocks:new Set(),periods:new Set()};
 for(const name of Object.keys(used) as Family[])requireValue(parsed[name].length<=128,'TABLE_CAPACITY_EXCEEDED',name);
 requireValue(parsed.changes.length<=13&&parsed.query.length<=1&&parsed.uncertainties.length<=4,'COLLECTION_CARDINALITY_INVALID');
 const at=(name:Family,index:unknown):unknown=>{requireValue(typeof index==='number'&&Number.isSafeInteger(index)&&index>=0&&index<parsed[name].length,'TABLE_REFERENCE_INVALID',name);used[name].add(index);return parsed[name][index];};
 const inactive=(valid:unknown,location:SmallTableDiagnostic['location'])=>{if(!valid)throw new SmallTableError({reason:'INACTIVE_VALUE_NON_NULL',location});};
 const active=(value:Row,keys:readonly string[])=>{for(const [key,item]of Object.entries(value))if(!keys.includes(key))inactive(item===null,'PADDED_OPERAND');return Object.fromEntries(keys.map(key=>[key,value[key]]));};
 const date=(rows:Row[]):Row|null=>{requireValue(rows.length<=1,'COLLECTION_CARDINALITY_INVALID','dates');if(!rows.length)return null;const row=rows[0],keys=dateFields[String(row.kind)];requireValue(keys);return active(row,keys);};
 const period=(rows:Row[],padded:boolean):Row|null=>{requireValue(rows.length<=1,'COLLECTION_CARDINALITY_INVALID','periods');if(!rows.length)return null;const row=rows[0],relative=Object.hasOwn(relativePeriods,String(row.kind))?relativePeriods[String(row.kind)]:undefined;const unsupported=row.kind==='UNSUPPORTED';inactive(unsupported?typeof row.unsupportedKind==='string'&&!Object.hasOwn(periodFields,row.unsupportedKind)&&!periodCodes.includes(row.unsupportedKind):row.unsupportedKind===null,'PERIOD_UNSUPPORTED_KIND');const value:Row={kind:unsupported?row.unsupportedKind:relative?.kind??row.kind,date:date(row.date as Row[]),offset:relative?.offset??null,from:date(row.from as Row[]),through:date(row.through as Row[])};return padded?value:active(value,periodFields[String(value.kind)]??Object.keys(value));};
 const value=(field:string,index:unknown):unknown=>{const type=family(field);requireValue(type!=='dates'&&type!=='periods');return at(type,index);};
 const authoredValue=(field:string,row:{value:number|null;text:string|null;date:Row[];period?:Row[]}):unknown=>{
  if(family(field)==='periods'){requireValue(row.value===null&&row.text===null&&row.date.length===0&&row.period?.length===1,'CHANGE_VALUE_INVALID');return period(row.period,false);}
  inactive(!row.period?.length,'NON_PERIOD_ALTERNATIVE');
  if(family(field)==='dates'){requireValue(row.value===null&&row.text===null&&row.date.length===1,'CHANGE_VALUE_INVALID');return date(row.date);}
  inactive(row.date.length===0,'NON_DATE_VALUE');
  if(family(field)==='texts'){requireValue(row.value===null&&typeof row.text==='string','CHANGE_VALUE_INVALID');return row.text;}
  requireValue(row.text===null&&row.value!==null,'CHANGE_VALUE_INVALID');if(family(field)==='integers'){requireValue(Number.isSafeInteger(row.value),'INVALID_TABLE_VALUE','integers');return row.value;}return value(field,row.value);
 };
 const evidence=(codes:string[])=>{requireValue(codes.length>=1&&codes.length<=3,'EVIDENCE_CARDINALITY_INVALID');const pointers=codes.map(code=>{const json=book.decode(code);requireValue(json!==undefined);return JSON.parse(json);});return {primaryEvidence:codes[0],additionalEvidence:pointers.slice(1)};};
 const result:Row={operationCode:parsed.operation.code,requestTarget:parsed.operation.targetEvidence.length?{evidence:evidence(parsed.operation.targetEvidence)}:null,changes:[],query:null,uncertainties:[],conversationDirective:null,replyProposal:null,...Object.fromEntries(singleton.map(({root})=>[root,null]))};
 const fields=new Set<string>(),ranks=new Set<number>();let previous=-1;
 for(const row of parsed.changes){requireValue(!fields.has(row.field)&&Number.isSafeInteger(row.rank)&&row.rank>previous&&!ranks.has(row.rank),'CHANGE_ORDER_INVALID');fields.add(row.field);ranks.add(row.rank);previous=row.rank;
  requireValue(row.operation==='CLEAR'?row.value===null&&row.text===null&&row.date.length===0:true,'CHANGE_VALUE_INVALID');
  const carrier={rank:row.rank,change:{field:row.field,operation:row.operation,value:row.operation==='CLEAR'?null:authoredValue(row.field,row),evidence:evidence(row.evidence)}};
  const definition=singleton.find(({field})=>field===row.field);if(definition)result[definition.root]=carrier;else (result.changes as unknown[]).push(carrier);
 }
 if(parsed.query[0]){const q=parsed.query[0];inactive(parsed.operation.code==='4'||q.date.length===0,'QUERY_DATE');inactive(parsed.operation.code==='3'||q.period.length===0,'QUERY_PERIOD');result.query={period:period(q.period,true),date:date(q.date),outputCalendar:q.outputCalendar,topic:q.topic,evidence:evidence(q.evidence)};}
 result.uncertainties=parsed.uncertainties.map(issue=>{requireValue(Number.isSafeInteger(issue.fieldCode)&&issue.alternatives.length<=2);const field=uncertaintyField(issue.fieldCode);return {fieldCode:issue.fieldCode,reason:issue.reason,alternatives:issue.alternatives.map(a=>({value:authoredValue(field,a),evidence:evidence(a.evidence)}))};});
 for(const name of Object.keys(used) as Family[])requireValue(used[name].size===parsed[name].length,'UNUSED_TABLE_ROWS',name);
 result.conversationDirective=Array.isArray(raw.directive)&&raw.directive.length<=1?(raw.directive[0]??null):{kind:'INVALID_PROVIDER_WIRE'};
 result.replyProposal=Array.isArray(raw.reply)&&raw.reply.length<=1?(raw.reply[0]??null):{invalid:true};
 return result;
}
export function decodeSmallContextV3(raw:unknown,selected:unknown,observeInvalid:Observer|undefined,observeWireInvalid:Observer|undefined,input:ContextInput){
 if(!isContextSmallProtocolV3(selected))return {status:'REFUSED' as const,reason:'ENVELOPE_INVALID' as const};
 try{return decodeGoogleLiteEuTypedContextTransportV3(expandSmall(raw,input),CONTEXT_TYPED_PROTOCOL_V3,observeInvalid,observeWireInvalid,input);}
 catch(error){try{
  const shape=error instanceof z.ZodError;
  const table=shape?(['texts','integers','dates','clocks','periods'] as const).find(name=>name===error.issues[0]?.path[0]):undefined;
  const diagnostic=error instanceof SmallTableError?error.diagnostic:{reason:shape?'GENERATION_SHAPE_INVALID' as const:'INVALID_TABLE_VALUE' as const,...(table?{table}:{})};
  const projection=projectWireValidation(raw,shape?(error.issues[0]?.path??[]):[],"SMALL_TYPED_TABLES",undefined,"calenote-context-3");
  projection.issues[0].smallTables=diagnostic;
  observeWireInvalid?.(projection);
 }catch{/* Diagnostics cannot alter refusal. */}return {status:'REFUSED' as const,reason:'SEMANTIC_PATCH_INVALID' as const};}
}
