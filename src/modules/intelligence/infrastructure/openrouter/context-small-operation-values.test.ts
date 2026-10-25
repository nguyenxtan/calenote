// @vitest-environment node
import {expect,it} from 'vitest';
import {SLOT_NAMES} from '../../../conversation/context-contract/contracts';
import type {OwnedClockWire} from './context-small-owned-clocks';
import {operationValueSchema,attachOperationValues,expandOperationValues} from './context-small-operation-values';
const date={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null,offsetDays:null,weekday:null,qualifier:null};
const clock={hour:8,minute:0,qualifier:'H24'};
const family=(f:string)=>['eventTime','reminderTime'].includes(f)?'clock':['eventDate','reminderDate','endDate'].includes(f)?'date':['occurrenceCount','leadOffsetDays'].includes(f)?'number':'text';
const value=(f:string)=>family(f)==='clock'?clock:family(f)==='date'?date:family(f)==='number'?2:f==='calendar'?'GREGORIAN':f==='frequency'?'DAILY':f==='eventRelation'?'BEFORE_EVENT':'a  g';
// Synthetic permission schema tests the representation domain; public tests retain actual selected capabilities.
const props=Object.fromEntries(SLOT_NAMES.map(field=>[field,{properties:{operation:{enum:['KEEP','SET','REPLACE','CLEAR']},value:{type:['integer','null']},text:{type:['string','null']},date:{items:{type:'object',properties:{kind:{type:'string'}},required:['kind'],additionalProperties:false}},clock:{items:{type:'object',properties:{hour:{type:'integer'},minute:{type:'integer'},qualifier:{type:'string'}},required:['hour','minute','qualifier'],additionalProperties:false}},evidence:{type:'array',items:{type:'string',enum:['U0']},minItems:0,maxItems:3}}}]));
const shape=operationValueSchema({properties:{changes:{properties:props}}});
const keep=()=>({rank:null,operation:'KEEP',value:null,text:null,date:[],evidence:[],clock:[]});
const base=()=>({operation:{code:'0',targetEvidence:['U0']},changes:Object.fromEntries(SLOT_NAMES.map(f=>[f,keep()])),query:[],uncertainties:[],directive:[],reply:[],texts:[],integers:[],dates:[],clocks:[],periods:[]}) as OwnedClockWire;
it.each(SLOT_NAMES)('requires an owned nonnull value for SET/REPLACE and no value for CLEAR: %s',field=>{
 for(const operation of ['SET','REPLACE','CLEAR']){
  const flat=base(),v=value(field),kind=family(field);flat.changes[field]={rank:8,operation,value:operation!=='CLEAR'&&kind==='number'?v as number:null,text:operation!=='CLEAR'&&kind==='text'?v as string:null,date:operation!=='CLEAR'&&kind==='date'?[structuredClone(date)]:[],clock:operation!=='CLEAR'&&kind==='clock'?[structuredClone(clock)]:[],evidence:['U0']};
  const owned=attachOperationValues(flat,shape);expect(expandOperationValues(owned,shape)).toEqual(flat);expect(attachOperationValues(expandOperationValues(owned,shape),shape)).toEqual(owned);
  const row=owned.changes[field][operation][0];expect(Object.keys(row)).toEqual(operation==='CLEAR'?['rank','evidence']:['rank','value','evidence']);
  for(const poison of operation==='CLEAR'?[{value:null},{value:v}]:[{value:null},{value:undefined}]){const bad=structuredClone(owned);Object.assign(bad.changes[field][operation][0],poison);const before=JSON.stringify(bad);expect(()=>expandOperationValues(bad,shape)).toThrow('OPERATION_VALUE_INVALID');expect(JSON.stringify(bad)).toBe(before);}
 }
});
it('validates every field and competing operation before projection without selecting, renumbering or mutation',()=>{
 const owned=attachOperationValues(base(),shape);owned.changes.title.SET=[{rank:2,value:'g',evidence:['U0']}];owned.changes.notes.SET=[{rank:8,value:'a  b',evidence:['U0']}];expect(expandOperationValues(owned,shape).changes.notes.rank).toBe(8);
 for(const mutate of [(w:typeof owned)=>{w.changes.title.CLEAR=[{rank:3,evidence:['U0']}];},(w:typeof owned)=>{w.changes.notes.SET[0].rank=2;},(w:typeof owned)=>{w.changes.title.SET.push(structuredClone(w.changes.title.SET[0]));},(w:typeof owned)=>{delete w.changes.title.CLEAR;},(w:typeof owned)=>{Object.assign(w.changes,{unknown:{SET:[]}});},(w:typeof owned)=>{w.changes.notes.SET[0].evidence=[];}]){const bad=structuredClone(owned);mutate(bad);const before=JSON.stringify(bad);expect(()=>expandOperationValues(bad,shape)).toThrow('OPERATION_VALUE_INVALID');expect(JSON.stringify(bad)).toBe(before);}
});
it('trusted authoring refuses poisoned inactive columns instead of extracting only the expected value',()=>{
 for(const field of SLOT_NAMES){const flat=base();flat.changes[field]={rank:0,operation:'SET',value:null,text:null,date:[],clock:[],evidence:['U0']};const f=family(field);if(f==='text')flat.changes[field].text=value(field) as string;else if(f==='number')flat.changes[field].value=2;else if(f==='date')flat.changes[field].date=[structuredClone(date)];else flat.changes[field].clock=[structuredClone(clock)];
  const bad=structuredClone(flat);if(f==='text')bad.changes[field].value=9;else bad.changes[field].text='poison';const before=JSON.stringify(bad);expect(()=>attachOperationValues(bad,shape)).toThrow('OPERATION_VALUE_INVALID');expect(JSON.stringify(bad)).toBe(before);
 }
});
