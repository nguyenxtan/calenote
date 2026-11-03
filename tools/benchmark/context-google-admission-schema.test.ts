// @vitest-environment node
import {expect,it} from 'vitest';
import {googleComparisonAdmissionSchema} from './context-google-admission-schema';
it('removes only positive repetition ceilings and preserves null-only arrays and required cells',()=>{
 const source={type:'object',properties:{a:{type:'array',minItems:1,maxItems:3,items:{type:'string'}},b:{type:'array',maxItems:0,items:{type:'string'}}}},before=JSON.stringify(source);
 expect(googleComparisonAdmissionSchema(source)).toEqual({type:'object',properties:{a:{type:'array',minItems:1,items:{type:'string'}},b:source.properties.b}});expect(JSON.stringify(source)).toBe(before);
});
