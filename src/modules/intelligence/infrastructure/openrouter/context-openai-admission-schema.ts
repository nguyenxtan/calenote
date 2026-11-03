/** Exact provider-dialect conversion. oneOf becomes anyOf only after a
 * required finite kind discriminator proves its complete branches disjoint. */
type Row=Record<string,unknown>;
const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function openAiComparisonAdmissionSchema(source:unknown):Row {
 if(!object(source))throw Error('OPENAI_SCHEMA_OBJECT');
 const root=structuredClone(source);
 const resolve=(raw:unknown):Row=>{
  if(!object(raw))throw Error('OPENAI_SCHEMA_NODE');let node=raw;const seen=new Set<string>();
  while(typeof node.$ref==='string'){
   const ref=node.$ref;if(!ref.startsWith('#/')||seen.has(ref))throw Error('OPENAI_SCHEMA_REFERENCE');seen.add(ref);
   let target:unknown=root;for(const part of ref.slice(2).split('/')){if(!object(target))throw Error('OPENAI_SCHEMA_REFERENCE');target=target[part.replaceAll('~1','/').replaceAll('~0','~')];}
   if(!object(target))throw Error('OPENAI_SCHEMA_REFERENCE');node=target;
  }return node;
 };
 const domain=(raw:unknown,depth=0):string[]=>{
  if(depth>64)throw Error('OPENAI_SCHEMA_DEPTH');const node=resolve(raw),union=node.anyOf??node.oneOf;
  if(Array.isArray(union))return [...new Set(union.flatMap(branch=>domain(branch,depth+1)))];
  if(node.type!=='object'||!object(node.properties)||!Array.isArray(node.required)||!node.required.includes('kind'))throw Error('ONEOF_DISCRIMINATOR_REQUIRED');
  const kind=resolve(node.properties.kind),values=kind.enum??(typeof kind.const==='string'?[kind.const]:undefined);
  if(!Array.isArray(values)||!values.length||!values.every(value=>typeof value==='string'))throw Error('ONEOF_FINITE_DISCRIMINATOR_REQUIRED');return values as string[];
 };
 const visit=(raw:unknown):unknown=>{
  if(typeof raw==='boolean')return raw;if(!object(raw))throw Error('OPENAI_SCHEMA_NODE');const result={...raw};
  for(const key of ['properties','patternProperties','$defs','definitions','dependentSchemas'])if(object(raw[key]))result[key]=Object.fromEntries(Object.entries(raw[key]).map(([name,node])=>[name,visit(node)]));
  for(const key of ['anyOf','oneOf','allOf','prefixItems'])if(Array.isArray(raw[key]))result[key]=raw[key].map(visit);
  for(const key of ['items','contains','additionalProperties','propertyNames','not','if','then','else'])if(object(raw[key])||typeof raw[key]==='boolean')result[key]=visit(raw[key]);
  if(Array.isArray(raw.oneOf)){
   if(raw.anyOf!==undefined)throw Error('ONEOF_CONJUNCTION_UNSUPPORTED');const seen=new Set<string>();
   for(const branch of raw.oneOf)for(const kind of domain(branch)){if(seen.has(kind))throw Error('ONEOF_DISCRIMINATORS_OVERLAP');seen.add(kind);}
   result.anyOf=result.oneOf;delete result.oneOf;
  }return result;
 };
 return visit(root) as Row;
}
