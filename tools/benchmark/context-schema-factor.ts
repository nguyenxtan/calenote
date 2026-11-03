/** Exact validation-domain factoring for synthetic provider comparisons.
 * Annotation descriptions are redundant with the unchanged prompt codebooks.
 * This is not the Google production request format or a paid-run authority. */
type Row=Record<string,unknown>;
type Node=Row|boolean;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
function children(node:Row,visit:(v:Node)=>Node):Row {
 const result={...node};
 for(const key of ['properties','patternProperties','dependentSchemas'])if(object(node[key]))result[key]=Object.fromEntries(Object.entries(node[key]).map(([name,value])=>[name,visit(value as Node)]));
 for(const key of ['anyOf','oneOf','allOf','prefixItems'])if(Array.isArray(node[key]))result[key]=node[key].map(value=>visit(value as Node));
 for(const key of ['items','contains','additionalProperties','propertyNames','not','if','then','else'])if(object(node[key])||typeof node[key]==='boolean')result[key]=visit(node[key] as Node);
 return result;
}
function definitionName(index:number){const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';let value=index,name='';do{name=alphabet[value%alphabet.length]+name;value=Math.floor(value/alphabet.length)-1;}while(value>=0);return name;}
export function factorContextSchema(source:unknown):{schema:Row;definitions:number} {
 if(!object(source))throw Error('SCHEMA_OBJECT_REQUIRED');
 const strip=(node:Node):Node=>{
  if(typeof node==='boolean')return node;
  if(!object(node))throw Error('SCHEMA_NODE_INVALID');
  if(['$ref','$defs','definitions','$id','$dynamicRef','$recursiveRef'].some(k=>Object.hasOwn(node,k)))throw Error('EXISTING_SCHEMA_REFERENCE');
  const copy={...node};delete copy.description;return children(copy,strip);
 };
 const schema=strip(structuredClone(source)) as Row,counts=new Map<string,number>(),nodes=new Map<string,Row>();
 const count=(node:Node):Node=>{
  if(typeof node==='boolean')return node;
  const key=JSON.stringify(node);counts.set(key,(counts.get(key)??0)+1);nodes.set(key,node);children(node,count);return node;
 };
 count(schema);
 const selected=new Map<string,string>();
 for(const [key,count]of counts){const node=nodes.get(key)!;if(node.type==='array'&&node.maxItems===0)continue;const bytes=new TextEncoder().encode(key).byteLength;if(count>1&&(count-1)*bytes>count*30+16)selected.set(key,definitionName(selected.size));}
 const emit=(node:Node,definition?:string):Node=>{
  if(typeof node==='boolean')return node;
  const key=JSON.stringify(node),name=selected.get(key);
  if(name&&key!==definition)return {$ref:`#/$defs/${name}`};
  return children(node,value=>emit(value));
 };
 let result=emit(schema) as Row;
 const definitions:Record<string,Node>=Object.fromEntries([...selected].map(([key,name])=>[name,emit(nodes.get(key)!,key)]));
 // Sharing a parent reduces the actual use count of its children. Recompute
 // graph costs; a single-use or now-unprofitable child only adds token overhead.
 for(;;){
  const uses=new Map<string,number>();
  const tally=(node:Node):Node=>{if(typeof node==='boolean')return node;if(typeof node.$ref==='string'){const name=node.$ref.slice('#/$defs/'.length);uses.set(name,(uses.get(name)??0)+1);}else children(node,tally);return node;};
  tally(result);Object.values(definitions).forEach(tally);
  const removable=Object.keys(definitions).find(name=>{
   const count=uses.get(name)??0,bytes=new TextEncoder().encode(JSON.stringify(definitions[name])).byteLength;
   const refBytes=JSON.stringify({$ref:`#/$defs/${name}`}).length;
   return count<=1||(count-1)*bytes<=count*refBytes+JSON.stringify(name).length+2;
  });
  if(removable===undefined)break;
  const value=definitions[removable];
  const inline=(node:Node):Node=>typeof node==='boolean'?node:node.$ref===`#/$defs/${removable}`?structuredClone(value):children(node,inline);
  result=inline(result) as Row;
  for(const name of Object.keys(definitions))if(name!==removable)definitions[name]=inline(definitions[name]);
  delete definitions[removable];
 }
 if(Object.keys(definitions).length)result.$defs=definitions;
 return {schema:result,definitions:Object.keys(definitions).length};
}
