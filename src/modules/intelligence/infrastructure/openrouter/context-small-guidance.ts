/** Producer advice variants derived from the canonical contract. No defaults,
 * alias repair or authority to choose the application's next action. */
import {z} from 'zod';
import {ModelDirectiveV3Schema} from '../../../conversation/context-contract/contracts';
type Row=Record<string,unknown>;
const keys=['kind','field','reason','issue','topic'];
export function smallGuidanceSchema(source:unknown):Row {
 const schema=structuredClone(source) as {properties:Row};
 const branches=ModelDirectiveV3Schema.unwrap().options.map(variant=>{
  const canonical=z.toJSONSchema(variant,{target:'draft-07'}) as Row,properties=canonical.properties as Row;
  const kind=(properties.kind as Row).const;
  if(typeof kind!=='string')throw Error('GUIDANCE_KIND_SCHEMA_INVALID');
  return {type:'object',additionalProperties:false,required:keys,properties:Object.fromEntries(keys.map(key=>[
   key,key==='kind'?{type:'string',enum:[kind]}:properties[key]?{...properties[key] as Row,type:['string','null']}:{type:'null'},
  ]))};
 });
 schema.properties.directive={type:'array',maxItems:1,items:{anyOf:branches}};
 return schema as unknown as Row;
}
