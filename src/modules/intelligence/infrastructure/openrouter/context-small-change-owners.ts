/** Single typed value owner per field; authored order is an exact reference permutation. */
import {z} from 'zod';
import type {OrderedChange} from './context-small-ordered-changes';
type Row=Record<string,unknown>;
type Owner=Pick<OrderedChange,'write'|'evidence'>;
export type ChangeOwnerWire<T extends {changes:OrderedChange[]}>=Omit<T,'changes'>&{changes:{owners:Record<string,Owner[]>;order:string[]}};
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
function check(v:unknown):asserts v {if(!v)throw Error('CHANGE_OWNER_INVALID');}
function branches(source:unknown){
 check(record(source)&&record(source.properties)&&record(source.properties.changes));
 const changes=source.properties.changes;check(changes.type==='array'&&record(changes.items)&&Array.isArray(changes.items.anyOf));
 const rows=changes.items.anyOf.map(branch=>{check(record(branch)&&record(branch.properties)&&record(branch.properties.field)&&Array.isArray(branch.properties.field.enum)&&branch.properties.field.enum.length===1);const field=branch.properties.field.enum[0];check(typeof field==='string');return {field,branch};});
 check(rows.length>0&&rows.length<=13&&new Set(rows.map(r=>r.field)).size===rows.length);return rows;
}
/** Copies all selected typed write/value/evidence domains; no sibling value union. */
export function changeOwnerSchema(source:unknown):Row {
 const rows=branches(source),schema=structuredClone(source) as {properties:Row};
 const owners=Object.fromEntries(rows.map(({field,branch})=>{const row=structuredClone(branch);check(record(row.properties)&&Array.isArray(row.required)&&Object.keys(row.properties).length===3&&['field','write','evidence'].every(k=>Object.hasOwn(row.properties as Row,k)));delete row.properties.field;row.required=row.required.filter(k=>k!=='field');delete row.description;return [field,{type:'array',maxItems:1,items:row}];}));
 schema.properties.changes={type:'object',additionalProperties:false,required:['owners','order'],properties:{owners:{type:'object',additionalProperties:false,required:Object.keys(owners),properties:owners},order:{type:'array',maxItems:13,items:{type:'string',enum:rows.map(r=>r.field)}}}};return schema as unknown as Row;
}
function selectedChanges(raw:unknown,source:unknown){
 check(record(raw));const schema=changeOwnerSchema(source).properties as Row;return z.fromJSONSchema(schema.changes as Parameters<typeof z.fromJSONSchema>[0]).parse(raw.changes) as ChangeOwnerWire<{changes:OrderedChange[]}>['changes'];
}
/** Trusted authoring only. Canonical order and each whole row's evidence remain paired. */
export function attachChangeOwners<T extends {changes:OrderedChange[]}>(source:T,schema:unknown):ChangeOwnerWire<T> {
 const rows=branches(schema);check(Array.isArray(source.changes)&&source.changes.length<=13&&new Set(source.changes.map(r=>r.field)).size===source.changes.length);
 const owners=Object.fromEntries(rows.map(r=>[r.field,[]])) as Record<string,Owner[]>;
 for(const change of source.changes){check(record(change)&&Object.keys(change).length===3&&['field','write','evidence'].every(k=>Object.hasOwn(change,k))&&Object.hasOwn(owners,change.field));owners[change.field]=[{write:structuredClone(change.write),evidence:structuredClone(change.evidence)}];}
 const result={...source,changes:{owners,order:source.changes.map(r=>r.field)}};selectedChanges(result,schema);return result;
}
/** Whole owner/vector validation precedes construction; every valid permutation is authored. */
export function expandChangeOwners(raw:unknown,schema:unknown):Row {
 check(record(raw));const {owners,order}=selectedChanges(raw,schema),active=Object.keys(owners).filter(field=>owners[field].length===1);
 check(new Set(order).size===order.length&&order.length===active.length&&order.every(field=>Object.hasOwn(owners,field)&&owners[field].length===1));
 return {...raw,changes:order.map(field=>({field,...structuredClone(owners[field][0])}))};
}
