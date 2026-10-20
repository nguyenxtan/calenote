import {z} from "zod";
import {ContextInputSchema,ConversationInterpretationV3Schema,DateOperandSchema,QueryPeriodSchema,IntentSchema,SlotValueSchemas,parseInterpretationSectionsV3,type ContextInput,type ConversationInterpretationV3} from "../../../conversation/context-contract/contracts";
import {deriveGenerationFieldCapability} from "../../../conversation/context-contract/field-capability";
import {CONTEXT_TYPED_PROTOCOL_V3,isContextTypedProtocolV3} from "../../../conversation/context-contract/typed-protocol";
import {contextTypedWirePrimitives as core,UNCERTAINTY_FIELD_WIRE_CODE_V1,WireShapeFailure} from "./context-provider-wire";
import {primaryEvidenceSourceCodebook,materializeTypedEvidencePointer,evidenceSourceCatalogue,EvidencePointerFailure} from "./evidence-pointer";
import {projectCanonicalValidation,projectWireValidation} from "../../../conversation/context-contract/validation-diagnostics";
import {CONTROL_PLACEHOLDER} from "../../../conversation/context-contract/projection";
import {issueListTransport,type ListPeriodProposal,type DecodedListCore} from "../../../conversation/context-contract/list-period-transport";
type Schema={ [key:string]:unknown; type?:"object"|"array"|"string"|"number"|"boolean"|"null"|"integer"; $ref?:string; properties?:Record<string,Schema>; required?:string[]; $defs?:Record<string,Schema>; anyOf?:Schema[]; oneOf?:Schema[]; items?:Schema; enum?:Array<string|number|boolean|null>;const?:string|number|boolean|null;minimum?:number;maximum?:number };
type DecoderStage=NonNullable<import("../../../conversation/context-contract/validation-diagnostics").CanonicalValidationIssue["typedDecoder"]>["stage"];
type Observer=Parameters<typeof parseInterpretationSectionsV3>[1];
const jsonSchema=(schema:z.ZodType)=>z.toJSONSchema(schema,{unrepresentable:"any",io:"input"}) as Schema;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
function map(node:Schema,visit:(node:Schema)=>Schema):Schema {
 const result={...node};for(const key of ["properties","$defs"] as const)if(node[key])result[key]=Object.fromEntries(Object.entries(node[key]).map(([k,v])=>[k,visit(v)]));
 for(const key of ["anyOf","oneOf"] as const)if(node[key])result[key]=node[key].map(visit);
 if(node.items)result.items=visit(node.items);return result;
}
function resolve(node:Schema,root:Schema):Schema {return node.$ref?resolve(root.$defs![node.$ref.slice("#/$defs/".length)],root):node;}
const pointerSchema=jsonSchema(z.union([z.strictObject({kind:z.literal("USER_TURN"),turn:z.number().int().min(0).max(11)}),z.strictObject({kind:z.literal("USER_SEGMENT"),turn:z.number().int().min(0).max(11),segment:z.number().int().min(0)}),z.strictObject({kind:z.literal("CONTEXT_FACT"),ref:z.string().regex(/^f[1-9][0-9]*$/u).max(16)})]));
/** Share exact structural equality only: this changes no accepted payload. */
function shareTypedDefinitions(root:Schema):Schema {
 const source=root;
 const inline=(node:Schema,depth=0):Schema=>{if(depth>64)throw Error("TYPED_SCHEMA_DEPTH");const resolved=resolve(node,source),result=map(resolved,child=>inline(child,depth+1));delete result.$defs;return result;};
 const coalesce=(node:Schema):Schema=>{
  const result=map(node,coalesce);if(!result.anyOf)return result;
  // Associativity and singleton elimination only; never distribute a union
  // across sibling constraints or widen a field/reason/value correlation.
  const branches=result.anyOf.flatMap(branch=>Object.keys(branch).length===1&&branch.anyOf?branch.anyOf:[branch]);
  const integerPoints=(schema:Schema):Schema[]|undefined=>{
   if(Object.keys(schema).length===1&&schema.anyOf){const points=schema.anyOf.map(integerPoints);return points.every(Boolean)?points.flatMap(value=>value!):undefined;}
   return schema.type==="integer"&&Number.isSafeInteger(schema.minimum)&&schema.minimum===schema.maximum&&Object.keys(schema).every(key=>["type","minimum","maximum"].includes(key))?[schema]:undefined;
  };
  for(let left=0;left<branches.length;left++)for(let right=left+1;right<branches.length;right++){
   const a=branches[left],b=branches[right];if(a.type!=="object"||b.type!=="object"||!a.properties||!b.properties)continue;
   if(JSON.stringify({...a,properties:undefined})!==JSON.stringify({...b,properties:undefined})||JSON.stringify(Object.keys(a.properties))!==JSON.stringify(Object.keys(b.properties)))continue;
   const changed=Object.keys(a.properties).filter(key=>JSON.stringify(a.properties![key])!==JSON.stringify(b.properties![key]));if(changed.length!==1)continue;
   const key=changed[0],x=a.properties[key],y=b.properties[key];
   if(x.type==="string"&&y.type==="string"&&x.enum?.length&&y.enum?.length&&Object.keys(x).every(k=>k==="type"||k==="enum")&&Object.keys(y).every(k=>k==="type"||k==="enum")){
    a.properties[key]={type:"string",enum:[...new Set([...x.enum,...y.enum])]};
   }else{
    const leftPoints=integerPoints(x),rightPoints=integerPoints(y);if(!leftPoints||!rightPoints)continue;
    // Keep non-contiguous integer domains exact with supported numeric bounds;
    // a min/max interval here would admit unrelated uncertainty fields.
    a.properties[key]={anyOf:[...new Map([...leftPoints,...rightPoints].map(point=>[point.minimum,point])).values()]};
   }
   branches.splice(right--,1);
  }
  return branches.length===1&&Object.keys(result).length===1?branches[0]:{...result,anyOf:branches};
 };
 root=coalesce(inline({...root,$defs:undefined}));
 const counts=new Map<string,number>();
 const count=(node:Schema):Schema=>{const signature=JSON.stringify(node);if(signature.length>=96)counts.set(signature,(counts.get(signature)??0)+1);return map(node,count);};
 count(root);
 const definitions:Record<string,Schema>={},names=new Map<string,string>();let next=0;
 const share=(node:Schema):Schema=>{
  const signature=JSON.stringify(node);
  if((counts.get(signature)??0)>1&&signature.length>=96){
   const prior=names.get(signature);if(prior)return {$ref:`#/$defs/${prior}`};
   const name=`t${next++}`;if(Object.hasOwn(root.$defs??{},name))throw Error("TYPED_SCHEMA_DEFINITION_COLLISION");
   names.set(signature,name);definitions[name]=map(node,share);return {$ref:`#/$defs/${name}`};
  }
  return map(node,share);
 };
 const result=map(root,share);result.$defs={...result.$defs,...definitions};
 const reached=new Set<string>();
 const visit=(node:Schema):void=>{
  if(node.$ref){if(!node.$ref.startsWith("#/$defs/"))throw Error("TYPED_SCHEMA_REFERENCE_INVALID");const name=node.$ref.slice(8);if(!reached.has(name)){const definition=result.$defs![name];if(!definition)throw Error("TYPED_SCHEMA_REFERENCE_INVALID");reached.add(name);visit(definition);}}
  for(const child of Object.values(node.properties??{}))visit(child);
  for(const branch of [...node.anyOf??[],...node.oneOf??[]])visit(branch);
  if(node.items)visit(node.items);
 };
 visit(result);for(const name of Object.keys(result.$defs))if(!reached.has(name))delete result.$defs[name];
 const aliases=new Map(Object.keys(result.$defs).map((name,index)=>[name,index.toString(36)]));
 const rename=(node:Schema):Schema=>{const output=map(node,rename);if(output.$ref)output.$ref=`#/$defs/${aliases.get(output.$ref.slice(8))}`;return output;};
 const compact=rename(result);compact.$defs=Object.fromEntries(Object.entries(compact.$defs!).map(([name,node])=>[aliases.get(name)!,node]));
 return compact;
}
/** Full input-bound acceptance language. Never relax this for provider admission. */
export function googleLiteEuTypedContextValidationSchemaV3(input:ContextInput) {
 const parsed=ContextInputSchema.parse(input),capability=deriveGenerationFieldCapability(parsed);
 let schema=core.selectedSchema(capability,parsed) as Schema;
 const transform=(node:Schema):Schema=>{
  const result=map(node,transform);
  if(result.properties){
   const field=result.properties.field,domain=field?.enum??(field?.const?[field.const]:[]);
   if(domain.length&&domain.every(value=>["eventDate","reminderDate","endDate"].includes(String(value)))&&result.properties.value&&resolve(result.properties.value,schema).type==="string")result.properties.value=jsonSchema(DateOperandSchema);
   const date=(raw:Schema):Schema=>{const node=resolve(raw,schema);return node.type==="string"?jsonSchema(DateOperandSchema):node.anyOf?{...node,anyOf:node.anyOf.map(date)}:raw;};
   for(const key of ["date","from","through"])if(result.properties[key])result.properties[key]=date(result.properties[key]);
  }
  if(result.properties?.additionalEvidenceJson){delete result.properties.additionalEvidenceJson;result.properties.additionalEvidence={type:"array",items:structuredClone(pointerSchema),minItems:0,maxItems:2};result.required=result.required!.map(key=>key==="additionalEvidenceJson"?"additionalEvidence":key);}
  return result;
 };
 schema=transform(schema);schema.$defs!.__d=jsonSchema(DateOperandSchema);
 const evidence={type:"object",properties:{primaryEvidence:{type:"string",enum:[...primaryEvidenceSourceCodebook(parsed).codes]},additionalEvidence:{type:"array",items:pointerSchema,minItems:0,maxItems:2}},required:["primaryEvidence","additionalEvidence"],additionalProperties:false} as Schema;
 const items=resolve(schema.properties!.uncertainties.items!,schema);
 const branches=(items.anyOf??[items]).flatMap(raw=>{
  const branch=resolve(raw,schema),field=resolve(branch.properties!.fieldCode,schema);
  const accepts=(code:number,node:Schema):boolean=>(!node.enum||node.enum.includes(code))&&(node.minimum===undefined||code>=node.minimum)&&(node.maximum===undefined||code<=node.maximum)&&(!node.anyOf||node.anyOf.some(child=>accepts(code,child)));
  return Object.entries(UNCERTAINTY_FIELD_WIRE_CODE_V1).flatMap(([name,code])=>{
   if(!accepts(code,field))return [];
   const result=structuredClone(branch);const value:Schema=name in SlotValueSchemas?jsonSchema(SlotValueSchemas[name as keyof typeof SlotValueSchemas]):name==="queryRange"?jsonSchema(QueryPeriodSchema):name==="intent"?jsonSchema(IntentSchema):{type:"string",enum:["CURRENT","NEW"]};
   result.properties!.fieldCode={type:"integer",minimum:code,maximum:code};
   result.properties!.alternatives={...resolve(result.properties!.alternatives,schema),items:{type:"object",properties:{value,evidence},required:["value","evidence"],additionalProperties:false}};
   return [result];
  });
 });
 // Merge only identical field/value/evidence shells whose finite reason
 // domains differ. This preserves the exact field/reason/value correlation.
 const grouped=new Map<string,Schema>();
 for(const branch of branches){
  const reason=resolve(branch.properties!.reason,schema),domain=reason.enum??(reason.const!==undefined?[reason.const]:undefined);
  if(!domain?.length||!domain.every(value=>typeof value==="string"))throw Error("TYPED_UNCERTAINTY_REASON_DOMAIN");
  const {reason:omitted,...properties}=branch.properties!;void omitted;
  const signature=JSON.stringify({...branch,properties}),prior=grouped.get(signature);
  if(prior)prior.properties!.reason={type:"string",enum:[...new Set([...prior.properties!.reason.enum!,...domain])]};
  else grouped.set(signature,{...branch,properties:{...branch.properties,reason:{type:"string",enum:[...domain]}}});
 }
 schema.properties!.uncertainties.items={anyOf:[...grouped.values()]};
 const enums=(node:Schema):Schema=>{const result=map(node,enums);delete result.$schema;if(typeof result.const==="string"){result.enum=[result.const];delete result.const;}return result;};
 return {version:CONTEXT_TYPED_PROTOCOL_V3.wireVersion,schema:shareTypedDefinitions(enums(schema))};
}
/** Factor generation-only unions by exact object/array shell. Discriminator
 * correlations stay intact; other sibling constraints retain the strict gate.
 * Different key sets remain distinct typed objects; no padding or JSON strings. */
function factorGenerationUnions(root:Schema):Schema {
 const inline=(node:Schema,depth=0):Schema=>{
  if(depth>64)throw Error("TYPED_SCHEMA_DEPTH");
  const resolved=resolve(node,root),body={...resolved};delete body.$defs;
  return map(body,child=>inline(child,depth+1));
 };
 const union=(raw:Schema[]):Schema=>{
  const branches=[...new Map(raw.flatMap(node=>Object.keys(node).length===1&&node.anyOf?node.anyOf:[node]).map(node=>[JSON.stringify(node),node])).values()];
  // A finite integer control domain can use one integer range instead of N
  // singleton ranges inside a repeated object. Coalesce adjacent integers only;
  // preserve gaps and every extra constraint rather than broadening acceptance.
  if(branches.length>1&&branches.every(node=>node.type==="integer"&&Number.isSafeInteger(node.minimum)&&node.minimum===node.maximum&&Object.keys(node).every(key=>["type","minimum","maximum"].includes(key)))){
   const points=[...new Set(branches.map(node=>node.minimum!))].sort((a,b)=>a-b);
   const ranges:Schema[]=[];
   for(const point of points){const last=ranges.at(-1);if(last&&point===last.maximum!+1)last.maximum=point;else ranges.push({type:"integer",minimum:point,maximum:point});}
   if(ranges.length<branches.length)return ranges.length===1?ranges[0]:{anyOf:ranges};
  }
  const groups=new Map<string,Schema[]>();
  for(const node of branches){
   const shell=node.type==="object"&&node.properties?{...node,properties:undefined,keys:Object.keys(node.properties).sort()}:node.type==="array"&&node.items?{...node,items:undefined}:node.type==="string"&&Object.keys(node).every(key=>key==="type"||key==="enum")?{type:"string"}:node;
   const key=JSON.stringify(shell),prior=groups.get(key);if(prior)prior.push(node);else groups.set(key,[node]);
  }
  // Keep discriminated object alternatives correlated. Independently unioning
  // sibling fields creates a Cartesian product (DAY + range dates, or a numeric
  // uncertainty field + every date/time/query value under nested arrays).
  // Both kind and fieldCode select the sibling value language. Merge only one
  // differing property; identical value/reason shells can still share codes.
  const correlated=[...groups.values()].flatMap(nodes=>{
   const first=nodes[0];
   if(first.type!=="object"||!(first.properties?.kind||first.properties?.fieldCode)||nodes.length===1)return [nodes];
   const changed=Object.keys(first.properties).filter(key=>nodes.some(node=>JSON.stringify(node.properties![key])!==JSON.stringify(first.properties![key])));
   return changed.length>1?nodes.map(node=>[node]):[nodes];
  });
  const factored=correlated.map(nodes=>{
   const first=nodes[0];if(nodes.length===1)return first;
   if(first.type==="object"&&first.properties)return {...first,properties:Object.fromEntries(Object.keys(first.properties).map(key=>[key,union(nodes.map(node=>node.properties![key]))]))};
   if(first.type==="array"&&first.items)return {...first,items:union(nodes.map(node=>node.items!))};
   if(first.type==="string")return nodes.some(node=>!node.enum)?{type:"string" as const}:{type:"string" as const,enum:[...new Set(nodes.flatMap(node=>node.enum!))]};
   throw Error("TYPED_GENERATION_UNION_SHAPE");
  });
  return factored.length===1?factored[0]:{anyOf:factored};
 };
 // Generation is a superset. Inclusive unions avoid exclusive-branch overlap
 // after widening children; the strict local schema retains original oneOf.
 const factor=(node:Schema):Schema=>{const result=map(node,factor),branches=result.anyOf??result.oneOf;return branches&&Object.keys(result).length===1?union(branches):result;};
 return factor(inline(root));
}
/** Provider generation is a typed structural superset, not the acceptance gate.
 * Variable scalar/length bounds multiply Google's grammar states. Keep exact
 * discriminators, input-selected types/enums and empty-only arrays on the wire;
 * enforce every removed domain constraint against the original schema below. */
export function googleLiteEuTypedContextWireSchemaV3(input:ContextInput) {
 const selected=googleLiteEuTypedContextValidationSchemaV3(input);
 const structural=(node:Schema):Schema=>{
  const result=map(node,structural);
  for(const key of ["minLength","maxLength","pattern","minItems"])delete result[key];
  if(result.maxItems!==0)delete result.maxItems;
  if(result.minimum===undefined||result.minimum!==result.maximum){delete result.minimum;delete result.maximum;}
  return result;
 };
 return {...selected,schema:shareTypedDefinitions(factorGenerationUnions(structural(selected.schema)))};
}
function mapEvidence(raw:unknown,transform:(evidence:unknown,path:Array<string|number>)=>unknown,path:Array<string|number>=[]):unknown {
 if(Array.isArray(raw))return raw.map((value,index)=>mapEvidence(value,transform,[...path,index]));if(!object(raw))return raw;
 return Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,key==="evidence"?transform(value,[...path,key]):mapEvidence(value,transform,[...path,key])]));
}
/** Offline authoring helper; never repairs or selects evidence for a provider. */
export function encodeGoogleLiteEuTypedContextV3(canonical:ConversationInterpretationV3,input:ContextInput):unknown {
 const parsed=ConversationInterpretationV3Schema.parse(canonical),book=primaryEvidenceSourceCodebook(input);
 const pointer=(raw:unknown):Record<string,unknown>=>{
  if(!object(raw))throw Error("TYPED_EVIDENCE_INVALID");
  if(raw.kind==="CONTEXT_FACT")return {kind:raw.kind,ref:raw.ref};
  if(raw.kind!=="USER_QUOTE"||typeof raw.turn!=="number")throw Error("TYPED_EVIDENCE_INVALID");
  const source=input.turns[raw.turn];if(!source||source.role!=="USER")throw Error("TYPED_EVIDENCE_INVALID");
  if(typeof raw.quote!=="string"||!raw.quote.length||typeof raw.occurrence!=="number"||!Number.isSafeInteger(raw.occurrence)||raw.occurrence<1)throw Error("TYPED_EVIDENCE_INVALID");
  let count=0,offset=0,start=-1;
  for(;;){const found=source.text.indexOf(raw.quote,offset);if(found<0)break;if(++count===raw.occurrence){start=found;break;}offset=found+raw.quote.length;}
  if(start<0)throw Error("TYPED_EVIDENCE_INVALID");
  if(!source.text.includes(CONTROL_PLACEHOLDER))return {kind:"USER_TURN",turn:raw.turn};
  let segmentStart=0;
  const spans=source.text.split(CONTROL_PLACEHOLDER).map(text=>{const from=segmentStart;segmentStart+=text.length+CONTROL_PLACEHOLDER.length;return {from,through:from+text.length};});
  const segment=evidenceSourceCatalogue(input).find(value=>value.turn===raw.turn&&spans[value.segment].from<=start&&spans[value.segment].through>=start+(raw.quote as string).length);
  if(!segment)throw Error("TYPED_EVIDENCE_INVALID");
  return {kind:"USER_SEGMENT",turn:raw.turn,segment:segment.segment};
 };
 const generated:Record<string,unknown>=Object.fromEntries(Object.entries(parsed).filter(([key])=>key!=="schemaVersion"));
 if(parsed.query?.kind==="LIST")generated.query=Object.fromEntries(Object.entries(parsed.query).filter(([key])=>key!=="statusScope"));
 const stripDatePadding=(raw:unknown):unknown=>{if(Array.isArray(raw))return raw.map(stripDatePadding);if(!object(raw))return raw;const keys=raw.kind==="CIVIL_DATE"?["kind","calendar","day","month","year","leapMonth"]:raw.kind==="RELATIVE_DAY"?["kind","offsetDays"]:raw.kind==="WEEKDAY"?["kind","weekday","qualifier"]:Object.keys(raw);return Object.fromEntries(keys.map(key=>[key,stripDatePadding(raw[key])]));};
 let output=stripDatePadding(core.canonicalCodec(generated,"encode")) as Record<string,unknown>;
 output=mapEvidence(output,raw=>{if(!Array.isArray(raw)||!raw.length)throw Error("TYPED_EVIDENCE_INVALID");const refs=raw.map(pointer);return {primaryEvidence:book.encode(JSON.stringify(refs[0])),additionalEvidence:refs.slice(1)};}) as Record<string,unknown>;
 output.uncertainties=parsed.uncertainties.map((issue,index)=>({fieldCode:UNCERTAINTY_FIELD_WIRE_CODE_V1[issue.field],reason:issue.reason,alternatives:(output.uncertainties as Array<{alternatives:Record<string,unknown>[]}>)[index].alternatives.map((alternative,position)=>({...alternative,value:issue.alternatives[position].value}))}));
 return core.indexedChanges(core.operationValues(output,"encode"),"encode");
}
export function decodeGoogleLiteEuTypedContextTransportV3(raw:unknown,selected:unknown,observeInvalid:Observer|undefined,observeWireInvalid:Observer|undefined,input:ContextInput) {
 if(!isContextTypedProtocolV3(selected))return {status:"REFUSED" as const,reason:"ENVELOPE_INVALID" as const};
 let stage:DecoderStage="SCHEMA";
 try {
  const schema=googleLiteEuTypedContextValidationSchemaV3(input).schema,validator=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  if(!object(raw))throw Error("TYPED_ENVELOPE_INVALID");
  let candidate:Record<string,unknown>={...raw,conversationDirective:null,replyProposal:null};
  let unsupported:ListPeriodProposal|undefined;
  stage="PERIOD";
  if(raw.operationCode==="3"&&object(raw.query)&&object(raw.query.period)){
   const period=raw.query.period,known=["DAY","DATE_BOUNDS","WEEK","WEEKEND","MONTH","REST_OF_MONTH","NEXT_7_DAYS","UPCOMING"];
   if(!known.includes(String(period.kind))){
    if(typeof period.kind!=="string"||!/^[A-Za-z0-9_:.-]{1,48}$/u.test(period.kind)||Object.keys(period).length!==5||!["kind","date","offset","from","through"].every(key=>Object.hasOwn(period,key))||period.offset!==null&&(typeof period.offset!=="number"||!Number.isFinite(period.offset)))throw Error("TYPED_PERIOD_INVALID");
    for(const key of ["date","from","through"])if(!validator.safeParse({...candidate,query:{...raw.query,period:{kind:"DAY",date:period[key],offset:null,from:null,through:null}}}).success)throw Error("TYPED_PERIOD_INVALID");
    unsupported={status:"UNSUPPORTED",diagnostic:projectWireValidation(raw,["query","period","kind"],"CONTROL_ENUM",undefined,"calenote-context-3")};
    candidate={...candidate,query:{...raw.query,period:null}};
   }
  }
  stage="SCHEMA";
  const checked=validator.safeParse(candidate);
  if(!checked.success){observeWireInvalid?.(projectCanonicalValidation(raw,checked.error.issues,"calenote-context-3"));return {status:"REFUSED" as const,reason:"SEMANTIC_PATCH_INVALID" as const};}
  stage="INDEXED_CHANGES";
  const unfolded=core.indexedChanges(checked.data as Record<string,unknown>,"decode",deriveGenerationFieldCapability(input).titlePresenceRequired),book=primaryEvidenceSourceCodebook(input);
  stage="EVIDENCE";
  const evidenced=mapEvidence(unfolded,(raw,path)=>{if(!object(raw)||!Array.isArray(raw.additionalEvidence))throw Error("TYPED_EVIDENCE_INVALID");const primary=book.decode(raw.primaryEvidence);if(primary===undefined)throw Error("TYPED_EVIDENCE_INVALID");return [JSON.parse(primary),...raw.additionalEvidence].map((ref,index)=>materializeTypedEvidencePointer(ref,index===0?[...path,"primaryEvidence"]:[...path,"additionalEvidence",index-1],input));}) as Record<string,unknown>;
  stage="UNCERTAINTIES";
  evidenced.uncertainties=(evidenced.uncertainties as Array<Record<string,unknown>>).map(issue=>{const entry=Object.entries(UNCERTAINTY_FIELD_WIRE_CODE_V1).find(([,code])=>code===issue.fieldCode);if(!entry)throw Error("TYPED_FIELD_INVALID");return {field:entry[0],reason:issue.reason,alternatives:issue.alternatives};});
  stage="CANONICAL_CODEC";
  const decoded=core.canonicalCodec(core.operationValues(evidenced,"decode"),"decode") as Record<string,unknown>;
  stage="INTERPRETATION";
  for(const key of ["conversationDirective","replyProposal"]){try{decoded[key]=core.canonicalField(key,raw[key]);}catch{decoded[key]=key==="conversationDirective"?{kind:"INVALID_PROVIDER_WIRE"}:raw[key];}}
  decoded.schemaVersion=selected.canonicalVersion;
  if(object(decoded.query)&&decoded.query.kind==="LIST")decoded.query={...decoded.query,statusScope:"DEFAULT"};
  if(object(decoded.query)&&decoded.query.kind==="LIST"&&decoded.intent==="LIST_REMINDERS"&&decoded.requestTarget===null&&Array.isArray(decoded.changes)&&decoded.changes.length===0){
   const {period,...query}=decoded.query,{conversationDirective,replyProposal,...canonicalCore}=decoded;
   return {status:"PARSED" as const,value:issueListTransport({core:{...canonicalCore,query} as DecodedListCore,period:unsupported??(period===null?{status:"ABSENT"}:{status:"KNOWN",value:period as z.infer<typeof QueryPeriodSchema>}),guidance:{conversationDirective,replyProposal}})};
  }
  return parseInterpretationSectionsV3(decoded,observeInvalid);
 }catch(error) {
  try {
  // Preserve trusted structural failures; never retain exception messages or
  // authored payloads. Even an unexpected failure has one bounded issue.
  const diagnostic=error instanceof WireShapeFailure
   ?projectWireValidation(raw,error.path,error.expected,error.extraKeyCount,"calenote-context-3",error.cardinality,error.control)
   :error instanceof EvidencePointerFailure
    ?projectWireValidation(raw,error.path,"EVIDENCE_SOURCE_POINTER",undefined,"calenote-context-3")
    :projectWireValidation(raw,[],"object",undefined,"calenote-context-3");
  if(!(error instanceof WireShapeFailure)&&!(error instanceof EvidencePointerFailure))delete diagnostic.issues[0].expected;
  diagnostic.issues[0].typedDecoder={stage,reason:error instanceof WireShapeFailure?"WIRE_SHAPE_INVALID":error instanceof EvidencePointerFailure?"EVIDENCE_POINTER_INVALID":"INTERNAL_FAILURE"};
  if(error instanceof EvidencePointerFailure)diagnostic.issues[0].evidencePointer=error.diagnostic;
  if(error instanceof WireShapeFailure&&error.dateOperand)diagnostic.issues[0].dateOperand=error.dateOperand;
  observeWireInvalid?.(diagnostic);
  }catch{/* Diagnostic projection and observers cannot alter refusal. */}
  return {status:"REFUSED" as const,reason:"SEMANTIC_PATCH_INVALID" as const};
 }
}
