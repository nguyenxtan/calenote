// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {encodeKeyedSmallComparison,keyedSmallComparisonSchema} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {frozenContextProposal} from './context-contract-fixtures';
import {constrainComparisonDateSchema} from './context-comparison-date-schema';
it('excludes the observed Gregorian false leap marker without changing source or valid dates',()=>{
 const input=ContextInputSchema.parse(JSON.parse(readFileSync('src/modules/intelligence/infrastructure/openrouter/__fixtures__/small106-r02-turn2-before.json','utf8')).input);
 const initial={...input,turns:input.turns.slice(0,1),currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[]};
 const source=keyedSmallComparisonSchema(initial),before=JSON.stringify(source),schema=constrainComparisonDateSchema(source);
 const value=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(initial,'R02',0)),initial) as {changes:{owners:{eventDate:Array<{write:Array<{value:Record<string,unknown>}>}>}}};
 const codec=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);expect(codec.safeParse(value).success).toBe(true);
 const bad=structuredClone(value);bad.changes.owners.eventDate[0].write[0].value.leapMonth=false;expect(codec.safeParse(bad).success).toBe(false);
 const missing=structuredClone(value);missing.changes.owners.eventDate[0].write[0].value.day=null;expect(codec.safeParse(missing).success).toBe(false);
 expect(JSON.stringify(source)).toBe(before);
});
it('keeps canonical date-family keys closed while intersecting their existing Gregorian leap rule',()=>{
 const properties={kind:{type:'string',enum:['CIVIL_DATE']},calendar:{type:'string',enum:['GREGORIAN','LUNAR_VN']},day:{type:'integer'},month:{type:'integer'},year:{type:['integer','null']},leapMonth:{type:['boolean','null']}};
 const source={type:'object',properties,required:Object.keys(properties),additionalProperties:false},schema=constrainComparisonDateSchema(source) as {anyOf:Array<{properties:Record<string,unknown>;required:string[]}>};
 for(const branch of schema.anyOf)expect(Object.keys(branch.properties).sort()).toEqual([...branch.required].sort());
 const validator=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]),date={kind:'CIVIL_DATE',calendar:'GREGORIAN',day:11,month:10,year:null,leapMonth:null};
 expect(validator.safeParse(date).success).toBe(true);expect(validator.safeParse({...date,leapMonth:false}).success).toBe(false);expect(validator.safeParse({...date,calendar:'LUNAR_VN',leapMonth:true}).success).toBe(true);expect(validator.safeParse({...date,offsetDays:null}).success).toBe(false);
});
