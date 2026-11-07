/** Explicit typed keyed124 comparison. Fixed V3_SLOT_NAMES traversal is protocol syntax;
 * received106/107 reference vectors or arrays are never repaired into this shape. */
import {z} from 'zod';
import {V3_SLOT_NAMES,type ContextInput,type ConversationInterpretationV3} from '../../../conversation/context-contract/contracts';
import {changeOwnerSchema,attachChangeOwners,expandChangeOwners} from './context-small-change-owners';
import {CONTEXT_TYPED_PROTOCOL_V3} from '../../../conversation/context-contract/typed-protocol';
import {internalFlatSchemaV3,encodeInternalFlatV3} from './context-small-intermediate';
import {ownedClockSchema,attachOwnedClocks} from './context-small-owned-clocks';
import {operationValueSchema,attachOperationValues} from './context-small-operation-values';
import {kindQuerySchema,attachKindQueries} from './context-small-kind-queries';
import {orderedChangeSchema,attachOrderedChanges,projectOrderedSmallV3} from './context-small-ordered-changes';
import {operationQuerySchema,attachOperationQuery,expandOperationQuery} from './context-small-operation-query';
import {smallGuidanceSchema} from './context-small-guidance';
import {CONTEXT_OPERATION_WIRE_METADATA_V1} from './context-provider-wire';
import {UNCERTAINTY_FIELD_WIRE_CODE_V3} from './context-provider-wire';
import {primaryEvidenceSourceCodebook} from './evidence-pointer';
import {keyedNoteValuePattern} from './context-keyed-note-boundary';
import {keyedClockCorrectionField,keyedClockNotationField,keyedBoundReminderClockRequired} from './context-keyed-clock-correction';
import {isRetainedClosedRelationFieldUncertaintyAbsent,isInitialClocklessSeriesUncertaintyAbsent} from '../../../conversation/context-contract/field-capability';
import {keyedSingleNotificationCountAbsent} from './context-keyed-single-notification';
import {keyedDailyCadenceRequired} from './context-keyed-daily-cadence';
import {keyedQueryFactEvidenceCodes} from './context-keyed-query-evidence';
import {fixedEmptyCarrierCodec} from './context-fixed-empty-carriers';
import {keyedMaterialDetailPrimary} from './context-keyed-material-detail';
import {currentBurstTurnIndexes} from '../../../conversation/context-contract/burst-prompt';
const operationLabels:Record<string,string>={
 'CREATE_REMINDER/CURRENT':'CONTINUE_CURRENT_REMINDER','CREATE_REMINDER/NEW':'START_NEW_REMINDER','CREATE_REMINDER/UNRESOLVED':'ASK_WHICH_REMINDER',
 'LIST_REMINDERS':'LIST_REMINDERS','CALENDAR_QUERY':'CALENDAR_QUERY','CAPABILITY_QUERY':'CAPABILITY_QUERY','HELP':'HELP','UNSUPPORTED':'UNSUPPORTED',
 'AMBIGUOUS':'UNKNOWN_ACTION','AMBIGUOUS/CURRENT':'UNKNOWN_ACTION_CURRENT_TARGET','AMBIGUOUS/NEW':'UNKNOWN_ACTION_NEW_TARGET','AMBIGUOUS/UNRESOLVED':'UNKNOWN_ACTION_UNRESOLVED_TARGET',
};
export const KEYED_OPERATION_NAMES=Object.freeze(Object.fromEntries(CONTEXT_OPERATION_WIRE_METADATA_V1.map((tuple,index)=>{
 const name=operationLabels[tuple.slice(0,2).filter(value=>value!==null).join('/')];if(!name)throw Error('KEYED_OPERATION_MAPPING');return [String(index),name];
})));
const operationNumbers=Object.freeze(Object.fromEntries(Object.entries(KEYED_OPERATION_NAMES).map(([code,name])=>[name,code])));
type Row=Record<string,unknown>;
import {decodeGoogleLiteEuTypedOrderedContextTransportV3,googleLiteEuTypedOrderedContextValidationSchemaV3,encodeGoogleLiteEuTypedContextV3} from './context-provider-typed-wire';
type Schema={type?:string;$ref?:string;$defs?:Record<string,Schema>;anyOf?:Schema[];properties?:Record<string,Schema>;items?:Schema;enum?:unknown[];minimum?:number;maximum?:number;minItems?:number;maxItems?:number;required?:string[];additionalProperties?:boolean;pattern?:string};
const inactiveTables=['texts','integers','dates','clocks','periods'] as const;
const reminderIssueCodes=new Set<number>(V3_SLOT_NAMES.map(field=>UNCERTAINTY_FIELD_WIRE_CODE_V3[field]));
/** Preserve existing admission obligations when singleton carriers become owners.
 * Presence and operation permissions come from the strict policy, never inferred
 * from field eligibility or supplied by the decoder after generation. */
function retainRequiredOwners(source:Schema,input:ContextInput){
 const policy=googleLiteEuTypedOrderedContextValidationSchemaV3(input,true),strict=policy.schema as Schema;
 const resolve=(node:Schema):Schema=>node.$ref?resolve(strict.$defs![node.$ref.slice('#/$defs/'.length)]):node;
 const leaves=(node:Schema):Schema[]=>{const body=resolve(node);return body.anyOf?body.anyOf.flatMap(leaves):[body];};
 const owners=source.properties!.changes.properties!.owners.properties!;
 for(const field of policy.requiredChangeFields){
  const owner=owners[field];if(!owner)throw Error('KEYED_REQUIRED_OWNER_MISSING');
  const allowed=[...new Set(leaves(strict.properties!.changes.items!).filter(branch=>resolve(branch.properties!.field).enum!.includes(field)).flatMap(branch=>resolve(branch.properties!.operation).enum!))];
  const write=owner.items!.properties!.write,operation=write.items!.properties!.operation;
  // Required strict singleton carriers cannot encode an absent or cleared value.
  if(!allowed.length||allowed.includes('CLEAR'))throw Error('KEYED_REQUIRED_OWNER_POLICY');
  owner.minItems=1;write.minItems=1;operation.enum=operation.enum!.filter(value=>allowed.includes(value));
  if(!operation.enum.length)throw Error('KEYED_REQUIRED_OWNER_OPERATION');
 }
 const allowed=resolve(strict.properties!.operationCode).enum!;
 const operation=source.properties!.operation;
 operation.anyOf=operation.anyOf!.flatMap(branch=>{branch.properties!.code.enum=branch.properties!.code.enum!.filter(code=>allowed.includes(code));return branch.properties!.code.enum.length?[branch]:[];});
 if(!operation.anyOf.length)throw Error('KEYED_OPERATION_POLICY');
 const accepts=(raw:Schema,code:number):boolean=>{const node=resolve(raw);return (!node.enum||node.enum.includes(code))&&(node.minimum===undefined||code>=node.minimum)&&(node.maximum===undefined||code<=node.maximum)&&(!node.anyOf||node.anyOf.some(branch=>accepts(branch,code)));};
 const uncertaintyReasons=new Map<number,Set<string>>();
 for(const branch of leaves(strict.properties!.uncertainties.items!)){
  const reasons=resolve(branch.properties!.reason).enum;if(!reasons?.length||!reasons.every(reason=>typeof reason==='string'))throw Error('KEYED_UNCERTAINTY_POLICY');
  for(const code of Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V3))if(accepts(branch.properties!.fieldCode,code)){
   const existing=uncertaintyReasons.get(code)??new Set<string>();for(const reason of reasons)existing.add(reason as string);uncertaintyReasons.set(code,existing);
  }
 }
 // This emission language leaves reminder completeness to the existing
 // deterministic resolver. Explicit unknown details remain authored AMBIGUOUS
 // issues; received MISSING claims are rejected, never discarded or rewritten.
 for(const[code,reasons]of uncertaintyReasons){if(reminderIssueCodes.has(code))reasons.delete('MISSING');if(!reasons.size)uncertaintyReasons.delete(code);}
 const inline=(value:unknown,depth=0):unknown=>{
  if(depth>64)throw Error('KEYED_SCHEMA_DEPTH');if(Array.isArray(value))return value.map(child=>inline(child,depth+1));
  if(!value||typeof value!=='object')return value;const node=value as Schema;
  if(node.$ref)return inline(resolve(node),depth+1);
  return Object.fromEntries(Object.entries(node).filter(([key])=>key!=='$defs').map(([key,child])=>[key,inline(child,depth+1)]));
 };
 const rows:Schema[]=[];
 for(const branch of leaves(strict.properties!.uncertainties.items!))for(const[code,allowed]of uncertaintyReasons){
  if(code===UNCERTAINTY_FIELD_WIRE_CODE_V3.operation||!accepts(branch.properties!.fieldCode,code))continue;
  const reasons=resolve(branch.properties!.reason).enum!.filter(reason=>allowed.has(reason as string));if(!reasons.length)continue;
  const row=inline(branch) as Schema;row.properties!.fieldCode={type:'integer',enum:[code]};row.properties!.reason={type:'string',enum:reasons};rows.push(row);
 }
 return {uncertaintyReasons,uncertaintyRows:rows};
}
function selected(input:ContextInput){
 const operations=operationValueSchema(ownedClockSchema(internalFlatSchemaV3(input,true).schema)),ordered=orderedChangeSchema(kindQuerySchema(operations));
 const source=smallGuidanceSchema(operationQuerySchema(changeOwnerSchema(ordered))) as {properties:Record<string,unknown>;required:string[]};
 const changes=source.properties.changes as {required:string[];properties:Record<string,unknown>};
 delete changes.properties.order;changes.required=['owners'];
 const {uncertaintyReasons,uncertaintyRows}=retainRequiredOwners(source as Schema,input),book=primaryEvidenceSourceCodebook(input);
 const materialPrimary=keyedMaterialDetailPrimary(input);
 if(materialPrimary){
  const primaryOperations=operationValueSchema(ownedClockSchema(internalFlatSchemaV3(materialPrimary,true).schema));
  const primary=changeOwnerSchema(orderedChangeSchema(kindQuerySchema(primaryOperations))) as Schema;
  const owners=(source as Schema).properties!.changes.properties!.owners.properties!;
  const title=owners.title,primaryDate=primary.properties!.changes.properties!.owners.properties!.eventDate;
  if(!title||!primaryDate||!owners.eventDate)throw Error('KEYED_MATERIAL_DETAIL_POLICY');
  // Existing primary source policy supplies only domain/lower-bound
  // restrictions. Every actual value and source code remains model-authored.
  title.minItems=1;title.items!.properties!.write.minItems=1;
  title.items!.properties!.write.items!.properties!.operation.enum=['SET'];
  owners.eventDate.items!.properties!.write.items!.properties!.value=structuredClone(primaryDate.items!.properties!.write.items!.properties!.value);
 }
 const notePattern=currentBurstTurnIndexes(input).length?undefined:keyedNoteValuePattern(input),noteValue=(source as Schema).properties!.changes.properties!.owners.properties!.notes?.items?.properties?.write.items?.properties?.value;
 if(notePattern&&noteValue){if(noteValue.type!=='string')throw Error('KEYED_NOTE_VALUE_POLICY');noteValue.pattern=notePattern;}
 const correctionField=keyedClockCorrectionField(input);
 if(correctionField){const write=(source as Schema).properties!.changes.properties!.owners.properties![correctionField]?.items?.properties?.write,operation=write?.items?.properties?.operation;if(!write||!operation?.enum?.includes('REPLACE'))throw Error('KEYED_CLOCK_CORRECTION_POLICY');write.minItems=1;operation.enum=['REPLACE'];}
 if(keyedBoundReminderClockRequired(input)){
  const owner=(source as Schema).properties!.changes.properties!.owners.properties!.reminderTime,write=owner?.items?.properties?.write,operation=write?.items?.properties?.operation;
  if(!owner||!write||!operation?.enum?.includes('SET'))throw Error('KEYED_BOUND_CLOCK_POLICY');
  owner.minItems=1;write.minItems=1;operation.enum=['SET'];
 }
 const clockNotationField=keyedClockNotationField(input);
 if(clockNotationField){const qualifier=(source as Schema).properties!.changes.properties!.owners.properties![clockNotationField]?.items?.properties?.write.items?.properties?.value.properties?.qualifier;if(!qualifier?.enum?.includes('H24'))throw Error('KEYED_CLOCK_NOTATION_POLICY');qualifier.enum=['H24'];}
 const countOwner=(source as Schema).properties!.changes.properties!.owners.properties!.occurrenceCount;
 if(countOwner&&keyedSingleNotificationCountAbsent(input))countOwner.maxItems=0;
 if(keyedDailyCadenceRequired(input)){
  const owner=(source as Schema).properties!.changes.properties!.owners.properties!.frequency,write=owner?.items?.properties?.write,value=write?.items?.properties?.value;
  if(!owner||!write||!value?.enum?.includes('DAILY')||!write.items?.properties?.operation.enum?.includes('SET'))throw Error('KEYED_DAILY_CADENCE_POLICY');
  owner.minItems=1;write.minItems=1;write.items.properties.operation.enum=['SET'];value.enum=['DAILY'];
 }
 for(const key of inactiveTables){const table=source.properties[key] as Schema;if(table.type!=='array'||table.maxItems!==0)throw Error('KEYED_INACTIVE_TABLE_POLICY');delete source.properties[key];source.required=source.required.filter(name=>name!==key);}
 const operation=source.properties.operation as {anyOf:Schema[]},operationCode=UNCERTAINTY_FIELD_WIRE_CODE_V3.operation;
 const issues=source.properties.uncertainties as Schema;
 const omittedAlternatives=new Set<string>();
 for(const row of uncertaintyRows){
  const alternatives=row.properties!.alternatives;
  if(alternatives.type!=='array'||alternatives.maxItems===0&&(alternatives.minItems??0)>0)throw Error('KEYED_ALTERNATIVE_CARDINALITY_POLICY');
  if(alternatives.maxItems===0){for(const reason of row.properties!.reason.enum!)omittedAlternatives.add(`${row.properties!.fieldCode.enum![0]}/${reason}`);delete row.properties!.alternatives;row.required=row.required!.filter(key=>key!=='alternatives');}
  else {if(alternatives.items?.type!=='object'||!alternatives.items.properties?.value||!alternatives.items.properties.evidence)throw Error('KEYED_TYPED_ALTERNATIVE_POLICY');alternatives.items.properties.evidence={type:'array',minItems:1,maxItems:3,items:{type:'string',enum:[...book.codes]}};}
 }
 const controlFields=new Set<number>([UNCERTAINTY_FIELD_WIRE_CODE_V3.intent,UNCERTAINTY_FIELD_WIRE_CODE_V3.queryRange]);
 const controlRows=uncertaintyRows.filter(row=>controlFields.has(row.properties!.fieldCode.enum![0] as number)),fieldRows=uncertaintyRows.filter(row=>!controlFields.has(row.properties!.fieldCode.enum![0] as number));
 if(!uncertaintyRows.length)throw Error('KEYED_FIELD_UNCERTAINTY_POLICY');issues.maxItems=fieldRows.length?4:0;issues.items=fieldRows.length?{anyOf:fieldRows}:{type:'object',properties:{},required:[],additionalProperties:false};
 if(isRetainedClosedRelationFieldUncertaintyAbsent(input)||isInitialClocklessSeriesUncertaintyAbsent(input))issues.maxItems=0;
 const operationReasons=uncertaintyReasons.get(operationCode),operationIssue:Schema={type:'object',properties:{reason:{type:'string',enum:[...operationReasons??[]]},alternatives:{type:'array',maxItems:2,items:{type:'object',properties:{value:{type:'string',enum:['CURRENT','NEW']},evidence:{type:'array',minItems:1,maxItems:3,items:{type:'string',enum:[...primaryEvidenceSourceCodebook(input).currentCodes]}}},required:['value','evidence'],additionalProperties:false}}},required:['reason','alternatives'],additionalProperties:false};
 const burstMembers=currentBurstTurnIndexes(input);
 if(burstMembers.length){
  const alternative=operationIssue.properties!.alternatives.items!,current=structuredClone(alternative),fresh=structuredClone(alternative);
  current.properties!.value.enum=['CURRENT'];fresh.properties!.value.enum=['NEW'];
  fresh.properties!.evidence.items!.enum=book.entries.filter(entry=>entry.kind!=='CONTEXT_FACT'&&entry.turn!==undefined&&burstMembers.includes(entry.turn)).map(entry=>entry.code);
  operationIssue.properties!.alternatives.items={anyOf:[current,fresh]};
 }
 operation.anyOf=operation.anyOf.flatMap(branch=>['RESOLVED_REMINDER','OTHER','UNKNOWN_ACTION'].flatMap(group=>{
  const ambiguous=group==='UNKNOWN_ACTION',resolved=group==='RESOLVED_REMINDER';
  const codes=(branch.properties!.code.enum as string[]).filter(code=>resolved?['0','1'].includes(code):ambiguous?['9','10','11'].includes(code):!['0','1','9','10','11'].includes(code));if(!codes.length||ambiguous&&!operationReasons?.size)return [];
  const selected=structuredClone(branch);selected.properties!.code.enum=codes;
  // A known reminder action with a resolved CURRENT/NEW target cannot also
  // declare that action/target unresolved. The fixed-empty codec omits only
  // this structural zero-capacity carrier, never any received authored issue.
  if(operationReasons?.size){selected.properties!.operationUncertainties={type:'array',minItems:ambiguous?1:0,maxItems:resolved?0:4,items:structuredClone(operationIssue)};selected.required!.push('operationUncertainties');}return [selected];
 }));
 const controlOperations=new Set<string>();
 operation.anyOf=operation.anyOf.flatMap(branch=>[false,true].flatMap(controls=>{
  const codes=(branch.properties!.code.enum as string[]).filter(code=>!['0','1','2'].includes(code)===controls);if(!codes.length)return [];
  const selected=structuredClone(branch);selected.properties!.code.enum=codes;
  if(controls&&controlRows.length){selected.properties!.controlUncertainties={type:'array',maxItems:4,items:{anyOf:structuredClone(controlRows)}};selected.required!.push('controlUncertainties');codes.forEach(code=>controlOperations.add(code));}
  return [selected];
 }));
 const branches=operation.anyOf,untargeted=new Set<string>();
 for(const branch of branches){
  const codes=branch.properties!.code.enum as string[],evidence=branch.properties!.targetEvidence;
  // Canonical query intents always own a query object, including a genuine
  // missing operand. [] would erase that object and strict decoding refuses it.
  if(branch.properties!.query){
   const query=branch.properties!.query;query.minItems=1;
   const kind=codes.length===1?({'3':'LIST','4':'CALENDAR_DATE','5':'CAPABILITY'} as const)[codes[0] as '3'|'4'|'5']:undefined;
   const items=query.items?.properties?.evidence.items;
   if(!kind||!items?.enum)throw Error('KEYED_QUERY_EVIDENCE_POLICY');
   const allowed=new Set([...book.currentCodes,...keyedQueryFactEvidenceCodes(input,kind)]);
   items.enum=items.enum.filter(code=>typeof code==='string'&&allowed.has(code));
   if(!items.enum.length)throw Error('KEYED_QUERY_EVIDENCE_EMPTY');
  }
  branch.properties!.code.enum=codes.map(code=>KEYED_OPERATION_NAMES[code]);
  if(evidence.type==='array'&&evidence.maxItems===0){for(const code of branch.properties!.code.enum as string[])untargeted.add(code);delete branch.properties!.targetEvidence;branch.required=branch.required!.filter(name=>name!=='targetEvidence');}
 }
 const translate=(value:unknown,forward:boolean):Row=>{
  const raw=value as Row,operation=raw.operation as {code:string;targetEvidence:unknown;operationUncertainties?:unknown};
  const map=forward?KEYED_OPERATION_NAMES:operationNumbers;
  if(!Object.hasOwn(map,operation.code))throw Error('KEYED_OPERATION_INVALID');
  const translated:Row={...operation,code:map[operation.code]},result:Row={...raw,operation:translated};
  if(untargeted.has(forward?String(translated.code):operation.code)){
   if(forward){if(!Array.isArray(operation.targetEvidence)||operation.targetEvidence.length!==0)throw Error('KEYED_UNTARGETED_EVIDENCE');delete translated.targetEvidence;}
   else translated.targetEvidence=[];
  }
  for(const key of inactiveTables){if(forward){if(!Array.isArray(raw[key])||raw[key].length!==0)throw Error('KEYED_INACTIVE_TABLE_VALUE');delete result[key];}else result[key]=[];}
  return result;
 };
 type Issue={fieldCode:number;reason:string;alternatives?:Array<{value:unknown;evidence:unknown}>};
 const packEvidence=(raw:unknown)=>{const value=raw as {primaryEvidence:string;additionalEvidence:unknown[]};if(typeof value.primaryEvidence!=='string'||!book.decode(value.primaryEvidence)||!Array.isArray(value.additionalEvidence))throw Error('KEYED_TYPED_EVIDENCE');return [value.primaryEvidence,...value.additionalEvidence.map(pointer=>book.encode(JSON.stringify(pointer)))];};
 const unpackEvidence=(raw:unknown)=>{const codes=raw as string[];if(!Array.isArray(codes)||codes.length<1||codes.length>3)throw Error('KEYED_TYPED_EVIDENCE');const pointers=codes.map(code=>{const value=book.decode(code);if(value===undefined)throw Error('KEYED_TYPED_EVIDENCE');return JSON.parse(value);});return {primaryEvidence:codes[0],additionalEvidence:pointers.slice(1)};};
 const pack=(raw:unknown):Row=>{
  const value=translate(raw,true),rows=(raw as Row).uncertainties as Issue[];if(!Array.isArray(rows))throw Error('KEYED_UNCERTAINTIES');
  if(rows.some(row=>reminderIssueCodes.has(row.fieldCode)&&row.reason==='MISSING'))throw Error('KEYED_REMINDER_COMPLETENESS_OWNER');
  const operationIssues=rows.filter(row=>row.fieldCode===operationCode).map(row=>({reason:row.reason,alternatives:row.alternatives!.map(alt=>{if(!['CURRENT','NEW'].includes(String(alt.value)))throw Error('KEYED_OPERATION_ALTERNATIVE');return {value:structuredClone(alt.value),evidence:packEvidence(alt.evidence)};})}));
  if(operationReasons?.size)(value.operation as Row).operationUncertainties=operationIssues;else if(operationIssues.length)throw Error('KEYED_OPERATION_UNCERTAINTY_EXCLUDED');
  const packIssue=(row:Issue)=>{const result:Row={fieldCode:row.fieldCode,reason:row.reason};if(row.alternatives!.length||!omittedAlternatives.has(`${row.fieldCode}/${row.reason}`))result.alternatives=row.alternatives!.map(alt=>({value:structuredClone(alt.value),evidence:packEvidence(alt.evidence)}));return result;};
  const controls=rows.filter(row=>controlFields.has(row.fieldCode));
  if(controlOperations.has(String(((raw as Row).operation as Row).code)))(value.operation as Row).controlUncertainties=controls.map(packIssue);else if(controls.length)throw Error('KEYED_CONTROL_UNCERTAINTY_OPERATION');
  value.uncertainties=rows.filter(row=>row.fieldCode!==operationCode&&!controlFields.has(row.fieldCode)).map(packIssue);
  return value;
 };
 const unpack=(raw:unknown)=>{
  const value=translate(raw,false),operation=(raw as Row).operation as Row;
  const operationIssues=(operationReasons?.size?operation.operationUncertainties:[]) as Array<{reason:string;alternatives:Array<{value:unknown;evidence:unknown}>}>;
  const controls=(controlOperations.has(operationNumbers[String(operation.code)])?operation.controlUncertainties:[]) as Issue[];
  const rows:Issue[]=[...operationIssues.map(row=>({fieldCode:operationCode,...row})),...controls,...(raw as Row).uncertainties as Issue[]];
  if(rows.length>4)throw Error('KEYED_UNCERTAINTY_LIMIT');
  const typedUncertainties=rows.map(row=>({fieldCode:row.fieldCode,reason:row.reason,alternatives:(row.alternatives??[]).map(alt=>({value:structuredClone(alt.value),evidence:unpackEvidence(alt.evidence)}))}));
  delete (value.operation as Row).operationUncertainties;
  delete (value.operation as Row).controlUncertainties;
  // The old changes/query projection sees no uncertainty padding. Every
  // authored typed issue travels separately into the same strict decoder.
  value.uncertainties=[];return {value,typedUncertainties};
 };
 const fixed=fixedEmptyCarrierCodec(source);
 return {operations,ordered,codec:{schema:fixed.schema,pack:(raw:unknown)=>fixed.encode(pack(raw)) as Row,unpack:(raw:unknown)=>unpack(fixed.decode(raw))}};
}
export function keyedSmallComparisonSchema(input:ContextInput){return selected(input).codec.schema;}
export function encodeKeyedSmallComparison(value:ConversationInterpretationV3,input:ContextInput){
 const {codec,operations,ordered}=selected(input);
 const flat=attachOperationQuery(attachChangeOwners(attachOrderedChanges(attachKindQueries(attachOperationValues(attachOwnedClocks(encodeInternalFlatV3(value,input,true)),operations)),value.changes,operations),ordered));
 const {owners}=flat.changes,typed=encodeGoogleLiteEuTypedContextV3(value,input,true) as Row;return codec.pack({...flat,changes:{owners},uncertainties:typed.uncertainties});
}
export function decodeKeyedSmallComparison(raw:unknown,input:ContextInput){
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!('changes' in raw)||!raw.changes||typeof raw.changes!=='object'||Array.isArray(raw.changes))throw Error('KEYED_COMPARISON_SHAPE');
  const {codec,ordered}=selected(input),value=raw as Record<string,unknown>,core={...value,directive:[],reply:[]},validation=z.fromJSONSchema(codec.schema as Parameters<typeof z.fromJSONSchema>[0]);
  const decoded=codec.unpack(validation.parse(core)),flat=decoded.value;
  for(const [alias,name] of [['directive','directive'],['reply','reply']] as const){try{if(!Object.hasOwn(value,alias))throw Error('ADVICE_MISSING');flat[name]=codec.unpack(validation.parse({...core,[alias]:value[alias]})).value[name];}catch{flat[name]=name==='directive'?[{kind:'INVALID_PROVIDER_WIRE'}]:[{invalid:true}];}}
  const projected=projectOrderedSmallV3(expandChangeOwners({...expandOperationQuery(flat),changes:{owners:(flat.changes as {owners:Record<string,unknown[]>}).owners,order:V3_SLOT_NAMES.filter(field=>(flat.changes as {owners:Record<string,unknown[]>}).owners[field]?.length===1)}},ordered),input,true);
  return decodeGoogleLiteEuTypedOrderedContextTransportV3({...projected,uncertainties:decoded.typedUncertainties},CONTEXT_TYPED_PROTOCOL_V3,undefined,undefined,input,true);
 }catch{return {status:'REFUSED' as const,reason:'SEMANTIC_PATCH_INVALID' as const};}
}
