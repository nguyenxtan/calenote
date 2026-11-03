/** Generation-only intersection with existing canonical date-family rules.
 * No received values are filled, coerced or discarded; strict decode stays final. */
type Row=Record<string,unknown>;
const row=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function constrainComparisonDateSchema(source:unknown):Row {
 const visit=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(visit);
  if(!row(value))return value;
  const node=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v)]));
  if(node.type!=='object'||!row(node.properties)||!row(node.properties.kind)||!Array.isArray(node.properties.kind.enum))return node;
  const kinds=node.properties.kind.enum;
  if(!kinds.length||!kinds.every(k=>['CIVIL_DATE','RELATIVE_DAY','WEEKDAY'].includes(String(k))))return node;
  const props=node.properties;
  const nonnull=(p:unknown)=>{if(!row(p))throw Error('DATE_COLUMN_SCHEMA');const types=Array.isArray(p.type)?p.type.filter(t=>t!=='null'):[p.type];if(types.length!==1||types[0]==='null')throw Error('DATE_REQUIRED_COLUMN');return {...p,type:types[0],...(Array.isArray(p.enum)?{enum:p.enum.filter(v=>v!==null)}:{})};};
  const variants=kinds.flatMap(kind=>{
   const calendars=kind==='CIVIL_DATE'&&row(props.calendar)&&Array.isArray(props.calendar.enum)?props.calendar.enum.filter(v=>v!==null):[null];
   return calendars.map(calendar=>{
    const next:Row={...props,kind:{...props.kind as Row,enum:[kind]}};
    const active=kind==='CIVIL_DATE'?['calendar','day','month','year','leapMonth']:kind==='RELATIVE_DAY'?['offsetDays']:['weekday','qualifier'];
    for(const key of ['calendar','day','month','year','leapMonth','offsetDays','weekday','qualifier']){
     if(!Object.hasOwn(props,key))continue;
     if(!active.includes(key)||kind==='CIVIL_DATE'&&calendar==='GREGORIAN'&&key==='leapMonth')next[key]={type:'null'};
     else if(!['year','leapMonth'].includes(key))next[key]=nonnull(props[key]);
    }
    if(kind==='CIVIL_DATE'){if(calendar!=='GREGORIAN'&&calendar!=='LUNAR_VN')throw Error('DATE_CALENDAR_SCHEMA');next.calendar={...next.calendar as Row,enum:[calendar]};}
    return {...node,properties:next};
   });
  });
  return variants.length===1?variants[0]:{anyOf:variants};
 };
 const result=visit(structuredClone(source));if(!row(result))throw Error('SCHEMA_OBJECT_REQUIRED');return result;
}
