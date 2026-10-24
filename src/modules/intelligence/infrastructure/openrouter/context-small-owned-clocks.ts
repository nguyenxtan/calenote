import {ClockOperandSchema,SLOT_NAMES} from '../../../conversation/context-contract/contracts';
import {UNCERTAINTY_FIELD_WIRE_CODE_V1} from './context-provider-wire';
import type {SmallChangeCarrier,SmallContextWire} from './context-small-intermediate';
type Row=Record<string,unknown>;
export interface OwnedCarrier extends SmallChangeCarrier {clock:Row[]}
type Issue=SmallContextWire['uncertainties'][number];
export interface OwnedClockWire extends Omit<SmallContextWire,'changes'|'uncertainties'> {changes:Record<string,OwnedCarrier>;uncertainties:Array<Omit<Issue,'alternatives'>&{alternatives:Array<Issue['alternatives'][number]&{clock:Row[]}>}>}
const clockFields=new Set(['eventTime','reminderTime']);
function check(valid:unknown):asserts valid {if(!valid)throw Error('OWNED_CLOCK_INVALID');}
const issueField=(code:number)=>{check(Number.isSafeInteger(code));const entry=Object.entries(UNCERTAINTY_FIELD_WIRE_CODE_V1).find(([,value])=>value===code);check(entry);return entry[0];};
/** Logical producer grammar: no independent model-authored operand pool. */
export function ownedClockSchema(source:unknown):Row {
 const schema=structuredClone(source) as {properties:Record<string,Row>},props=schema.properties,clock=(props.clocks as {items:unknown}).items,empty={type:'array',items:{type:'string'},maxItems:0},owned={type:'array',items:clock,maxItems:1};
 const controls=props.changes as {properties:Record<string,Row>};
 for(const [field,control]of Object.entries(controls.properties)){(control.properties as Row).clock=clockFields.has(field)?owned:empty;(control.required as string[]).push('clock');}
 const alternative=((props.uncertainties.items as {properties:Row}).properties.alternatives as {items:Row}).items;
 (alternative.properties as Row).clock=owned;(alternative.required as string[]).push('clock');props.clocks=empty;
 return schema as unknown as Row;
}
/** Trusted canonical fixture authoring only. Missing/extra stream rows are errors. */
export function attachOwnedClocks(flat:SmallContextWire):OwnedClockWire {
 const result=structuredClone(flat) as OwnedClockWire;for(const control of Object.values(result.changes))control.clock=[];for(const issue of result.uncertainties)for(const a of issue.alternatives)a.clock=[];
 let index=0;const take=()=>{check(index<flat.clocks.length);return [structuredClone(flat.clocks[index++])];};
 // The trusted encoder has already authored the stream in rank-address order.
 for(let rank=0;rank<=12;rank++)for(const [field,control]of Object.entries(result.changes))if(control.rank===rank&&clockFields.has(field)&&control.operation!=='KEEP'&&control.operation!=='CLEAR')control.clock=take();
 for(const issue of result.uncertainties)if(clockFields.has(issueField(issue.fieldCode)))for(const a of issue.alternatives)a.clock=take();
 check(index===flat.clocks.length);result.clocks=[];return result;
}
/** Model inverse: validate EVERY owner,rank and operand before constructing an internal stream. */
export function flattenOwnedClocks(owned:OwnedClockWire):SmallContextWire {
 check(Array.isArray(owned.clocks)&&owned.clocks.length===0);
 const ranks=new Set<number>();
 const cell=(value:unknown,count:number)=>{check(Array.isArray(value)&&value.length===count);for(const row of value)check(ClockOperandSchema.safeParse(row).success);};
 for(const [field,c]of Object.entries(owned.changes)){
  check(SLOT_NAMES.some(name=>name===field));
  if(c.operation==='KEEP')check(c.rank===null);
  else {check(Number.isSafeInteger(c.rank)&&c.rank!==null&&c.rank>=0&&c.rank<=12&&!ranks.has(c.rank));ranks.add(c.rank);}
  cell(c.clock,clockFields.has(field)&&c.operation!=='KEEP'&&c.operation!=='CLEAR'?1:0);
 }
 for(const issue of owned.uncertainties){const clock=clockFields.has(issueField(issue.fieldCode));for(const a of issue.alternatives)cell(a.clock,clock?1:0);}
 // No clocks have been consumed or canonical values materialized above. Every
 // owned object is copied exactly once to the internal representation below.
 const clocks:Row[]=[];
 for(let rank=0;rank<=12;rank++)for(const c of Object.values(owned.changes))if(c.rank===rank)clocks.push(...c.clock);
 for(const issue of owned.uncertainties)for(const a of issue.alternatives)clocks.push(...a.clock);
 return {...owned,clocks,changes:Object.fromEntries(Object.entries(owned.changes).map(([field,c])=>{const {clock,...control}=c;void clock;return [field,control];})),uncertainties:owned.uncertainties.map(issue=>({...issue,alternatives:issue.alternatives.map(a=>{const {clock,...alternative}=a;void clock;return alternative;})}))};
}
