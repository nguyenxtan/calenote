// @vitest-environment node
import {expect,it} from 'vitest';
import type {ActiveCarrierWire} from './context-small-active-carriers';
import {attachKindQueries,expandKindQueries,type KindQueryWire} from './context-small-kind-queries';
const base={operation:{code:'3',targetEvidence:[]},changes:{},query:[],uncertainties:[],directive:[],reply:[],texts:[],integers:[],dates:[],clocks:[],periods:[]} as ActiveCarrierWire;
const month={kind:'MONTH_CURRENT',date:[],from:[],through:[],unsupportedKind:null};
it.each([['3',{period:[month],date:[],outputCalendar:null,topic:null,evidence:['U0']}],['4',{period:[],date:[],outputCalendar:null,topic:null,evidence:['U0']}],['5',{period:[],date:[],outputCalendar:null,topic:'g  literal "text"',evidence:['U0']}]] as const)('preserves exact authored and missing query operands for code%s', (code,query)=>{
 const flat={...base,operation:{code,targetEvidence:[]},query:[structuredClone(query)]} as unknown as ActiveCarrierWire;
 const owned=attachKindQueries(flat);expect(expandKindQueries(owned)).toEqual(flat);expect(attachKindQueries(expandKindQueries(owned))).toEqual(owned);
 expect(expandKindQueries(attachKindQueries({...flat,query:[]}))).toEqual({...flat,query:[]});
});
it('validates every carrier before projection and refuses multiple, mismatched or poisoned rows without mutation',()=>{
 const owned=attachKindQueries({...base,query:[{period:[month],date:[],outputCalendar:null,topic:null,evidence:['U0']}]});
 const mutations:Array<(w:KindQueryWire)=>void>=[w=>{w.query.calendar=[{date:[],outputCalendar:null,evidence:['U0']}];},w=>{w.query.list.push(structuredClone(w.query.list[0]));},w=>{w.operation.code='4';},w=>{Object.assign(w.query,{unknown:[]});},w=>{Object.assign(w.query.list[0],{outputCalendar:'GREGORIAN'});},w=>{w.query.list[0].evidence=[];},w=>{w.query.list[0].period=[month,month];},w=>{Object.assign(w.query,{calendar:null});}];
 for(const mutate of mutations){const bad=structuredClone(owned);mutate(bad);const before=JSON.stringify(bad);expect(()=>expandKindQueries(bad)).toThrow('KIND_QUERY_INVALID');expect(JSON.stringify(bad)).toBe(before);}
 expect(()=>expandKindQueries({...owned,query:[] as unknown as KindQueryWire['query']})).toThrow('KIND_QUERY_INVALID');
});
it('trusted encoding refuses inactive cross-kind values instead of discarding them',()=>{
 const query={period:[month],date:[],outputCalendar:null,topic:null,evidence:['U0']};
 for(const patch of [{outputCalendar:'GREGORIAN'},{topic:'LUNAR'},{date:[{kind:'RELATIVE_DAY',offsetDays:0}]}]){const bad={...base,query:[{...query,...patch}]};const before=JSON.stringify(bad);expect(()=>attachKindQueries(bad)).toThrow('KIND_QUERY_INVALID');expect(JSON.stringify(bad)).toBe(before);}
 expect(()=>attachKindQueries({...base,operation:{code:'6',targetEvidence:[]},query:[query]})).toThrow('KIND_QUERY_INVALID');
});
