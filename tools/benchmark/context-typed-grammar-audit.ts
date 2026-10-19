/** Structural evidence only. This is NOT Google's compiler or an admission oracle. */
type Node=Record<string,unknown>;
const record=(v:unknown):v is Node=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function expandTypedSchemaReferences(schema:unknown):unknown {
 if(!record(schema))throw Error('GRAMMAR_SCHEMA_SHAPE');let visited=0;
 const expand=(value:unknown,depth:number,active:Set<string>):unknown=>{
  if(++visited>65536||depth>64)throw Error('GRAMMAR_EXPANSION_LIMIT');
  if(Array.isArray(value))return value.map(child=>expand(child,depth+1,active));if(!record(value))return value;
  if(typeof value.$ref==='string'){
   const name=value.$ref.slice(8);if(!value.$ref.startsWith('#/$defs/')||active.has(name)||!record(schema.$defs)||!Object.hasOwn(schema.$defs,name)||Object.keys(value).length!==1)throw Error('GRAMMAR_REFERENCE_BINDING');
   return expand(schema.$defs[name],depth+1,new Set([...active,name]));
  }
  return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='$defs').map(([key,child])=>[key,expand(child,depth+1,active)]));
 };
 return expand(schema,0,new Set());
}
export function auditTypedNumericChoiceUnions(schema:unknown){
 const expanded=expandTypedSchemaReferences(schema),rows:Array<{path:string;arrayAncestors:string[];points:number[];contiguous:boolean}>=[];
 const visit=(node:unknown,path:string,arrays:string[])=>{
  if(!record(node))return;
  if(Array.isArray(node.anyOf)&&node.anyOf.length>1&&node.anyOf.every(branch=>record(branch)&&branch.type==='integer'&&Number.isSafeInteger(branch.minimum)&&branch.minimum===branch.maximum&&Object.keys(branch).every(key=>['type','minimum','maximum'].includes(key)))){
   const points=[...new Set(node.anyOf.map(branch=>(branch as Node).minimum as number))].sort((a,b)=>a-b);
   rows.push({path,arrayAncestors:arrays,points,contiguous:points.every((point,index)=>point===points[0]+index)});
  }
  if(record(node.properties))for(const[key,child]of Object.entries(node.properties))visit(child,`${path}.${key}`,arrays);
  if(node.items)visit(node.items,`${path}[]`,[...arrays,path]);
  for(const key of ['anyOf','oneOf'])if(Array.isArray(node[key]))for(const branch of node[key])visit(branch,path,arrays);
 };
 visit(expanded,'$',[]);return rows;
}
