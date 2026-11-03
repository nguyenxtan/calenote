/** Google comparison generation only. Unbounded repetition avoids compiler
 * state expansion; every original bound remains enforced by the strict codec. */
export function googleComparisonAdmissionSchema(source:unknown):Record<string,unknown>{
 const visit=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(visit);
  if(!value||typeof value!=='object')return value;
  const node=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v)]));
  if(node.type==='array'&&typeof node.maxItems==='number'&&node.maxItems>0)delete node.maxItems;
  return node;
 };
 return visit(structuredClone(source)) as Record<string,unknown>;
}
