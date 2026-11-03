// @vitest-environment node
import {expect,it} from 'vitest';
import {z} from 'zod';
import {openAiComparisonAdmissionSchema} from './context-openai-admission-schema';
const branch=(kinds:string[])=>({type:'object',properties:{kind:{type:'string',enum:kinds},value:{type:'integer'}},required:['kind','value'],additionalProperties:false});
it('preserves disjoint oneOf acceptance with references and nested anyOf branches without changing the source',()=>{
 const source={$defs:{civil:branch(['CIVIL'])},type:'object',properties:{oneOf:{type:'string'},value:{oneOf:[{$ref:'#/$defs/civil'},{anyOf:[branch(['RELATIVE']),branch(['WEEKDAY'])]}]}},required:['oneOf','value'],additionalProperties:false};
 const before=JSON.stringify(source),result=openAiComparisonAdmissionSchema(source),a=z.fromJSONSchema(source as Parameters<typeof z.fromJSONSchema>[0]),b=z.fromJSONSchema(result as Parameters<typeof z.fromJSONSchema>[0]);
 for(const value of [{oneOf:'literal',value:{kind:'CIVIL',value:1}},{oneOf:'literal',value:{kind:'RELATIVE',value:2}},{oneOf:'literal',value:{kind:'WEEKDAY',value:3}},{oneOf:'literal',value:{kind:'UNKNOWN',value:4}},{oneOf:'literal',value:{kind:'CIVIL'}},{oneOf:'literal',value:{kind:'RELATIVE',value:2,extra:true}}])expect(b.safeParse(value).success).toBe(a.safeParse(value).success);
 expect(JSON.stringify(source)).toBe(before);expect(result).toMatchObject({properties:{oneOf:{type:'string'},value:{anyOf:expect.any(Array)}}});
});
it('refuses overlapping, optional or unproved discriminators rather than broadening oneOf',()=>{
 expect(()=>openAiComparisonAdmissionSchema({oneOf:[branch(['SAME']),branch(['SAME'])]})).toThrow('ONEOF_DISCRIMINATORS_OVERLAP');
 const optional={...branch(['A']),required:['value']};expect(()=>openAiComparisonAdmissionSchema({oneOf:[optional,branch(['B'])]})).toThrow('ONEOF_DISCRIMINATOR_REQUIRED');
 expect(()=>openAiComparisonAdmissionSchema({oneOf:[{type:'string'},{type:'number'}]})).toThrow('ONEOF_DISCRIMINATOR_REQUIRED');
});
