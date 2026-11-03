import {ChangeOrderValidationError,changeOwnerSchema,attachChangeOwners,expandChangeOwners} from './context-small-change-owners';
import {smallGuidanceSchema} from './context-small-guidance';
import {operationQuerySchema,attachOperationQuery,expandOperationQuery} from './context-small-operation-query';
import {orderedChangeSchema,attachOrderedChanges,projectOrderedSmallV3} from './context-small-ordered-changes';
import {decodeGoogleLiteEuTypedOrderedContextTransportV3} from './context-provider-typed-wire';
import {CONTEXT_TYPED_PROTOCOL_V3} from '../../../conversation/context-contract/typed-protocol';
import {kindQuerySchema,attachKindQueries} from './context-small-kind-queries';
import {z} from 'zod';
import type {ContextInput,ConversationInterpretationV3} from '../../../conversation/context-contract/contracts';
import {isContextSmallProtocolV3} from '../../../conversation/context-contract/small-protocol';
import {projectWireValidation} from '../../../conversation/context-contract/validation-diagnostics';
import {internalFlatSchemaV3,encodeInternalFlatV3,decodeInternalFlatV3} from './context-small-intermediate';
import {compileCompactContext} from './context-small-compact';
import {attachOwnedClocks,ownedClockSchema} from './context-small-owned-clocks';
import {operationValueSchema,attachOperationValues} from './context-small-operation-values';
type Observer=Parameters<typeof decodeInternalFlatV3>[2];
type Row=Record<string,unknown>;
const record=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
function selected(input:ContextInput){const flat=internalFlatSchemaV3(input),operations=operationValueSchema(ownedClockSchema(flat.schema));const ordered=orderedChangeSchema(kindQuerySchema(operations));return {...flat,operations,ordered,codec:compileCompactContext(smallGuidanceSchema(operationQuerySchema(changeOwnerSchema(ordered))))};}
export function smallContextSchemaV3(input:ContextInput){
 const value=selected(input);return {version:value.version,schema:value.codec.schema as unknown as ReturnType<typeof internalFlatSchemaV3>['schema']};
}
/** Google admission profile only. The strict codec retains maxItems:13.
 * The owner/order bijection already requires local validation; extending this
 * provider grammar never permits a larger accepted patch or repairs output. */
export function smallContextGenerationSchemaV3(input:ContextInput){
 const selected=smallContextSchemaV3(input),schema=structuredClone(selected.schema);
 const order=(schema as unknown as {properties:{c:{properties:{o:{maxItems?:number}}}}}).properties.c.properties.o;
 delete order.maxItems;
 return {...selected,schema};
}
/** Trusted canonical fixture authoring only; the inverse is the sole model entry. */
export function encodeSmallContextV3(value:ConversationInterpretationV3,input:ContextInput):Row {const selectedValue=selected(input);return selectedValue.codec.pack(attachOperationQuery(attachChangeOwners(attachOrderedChanges(attachKindQueries(attachOperationValues(attachOwnedClocks(encodeInternalFlatV3(value,input)),selectedValue.operations)),value.changes,selectedValue.operations),selectedValue.ordered))) as Row;}
export function decodeSmallContextV3(raw:unknown,protocol:unknown,observeInvalid:Observer|undefined,observeWireInvalid:Observer|undefined,input:ContextInput){
 if(!isContextSmallProtocolV3(protocol))return {status:'REFUSED' as const,reason:'ENVELOPE_INVALID' as const};
 try {
  if(!record(raw)||!record(raw.c))throw Error('COMPACT_SHAPE_INVALID');
  const {codec,ordered}=selected(input);
  // Only the two declared advice roots are quarantined. Extra roots still refuse.
  const core={...raw,g:[],r:[]};
  const parsed=z.fromJSONSchema(codec.schema as Parameters<typeof z.fromJSONSchema>[0]).parse(core);
  const flat=codec.unpack(parsed) as Row;
  for(const [alias,name]of [['g','directive'],['r','reply']] as const){
   try {if(!Object.hasOwn(raw,alias))throw Error('COMPACT_GUIDANCE_INVALID');flat[name]=(codec.unpack({...core,[alias]:raw[alias]}) as Row)[name];}
   catch {flat[name]=name==='directive'?[{kind:'INVALID_PROVIDER_WIRE'}]:[{invalid:true}];}
  }
  return decodeGoogleLiteEuTypedOrderedContextTransportV3(projectOrderedSmallV3(expandChangeOwners(expandOperationQuery(flat),ordered),input),CONTEXT_TYPED_PROTOCOL_V3,observeInvalid,observeWireInvalid,input);
 }catch(error){try {const projection=projectWireValidation(raw,[],"SMALL_TYPED_TABLES",undefined,"calenote-context-3");projection.issues[0].smallTables={reason:error instanceof ChangeOrderValidationError?'CHANGE_ORDER_INVALID':'GENERATION_SHAPE_INVALID'};observeWireInvalid?.(projection);}catch{/* Diagnostics cannot change refusal. */}return {status:'REFUSED' as const,reason:'SEMANTIC_PATCH_INVALID' as const};}
}
