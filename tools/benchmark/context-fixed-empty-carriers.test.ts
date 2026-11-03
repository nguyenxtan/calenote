// @vitest-environment node
import {expect,it} from 'vitest';
import {fixedEmptyCarrierCodec} from '../../src/modules/intelligence/infrastructure/openrouter/context-fixed-empty-carriers';
const source={type:'object',properties:{payload:{type:'string'},empty:{type:'array',maxItems:0,items:{anyOf:[{type:'string'},{type:'integer'}]}}},required:['payload','empty'],additionalProperties:false};
it('omits and restores only the fixed empty syntax after strict validation',()=>{
 const codec=fixedEmptyCarrierCodec(source);expect(codec.schema.properties).toEqual({payload:{type:'string'}});expect(codec.encode({payload:'mang hồ sơ',empty:[]})).toEqual({payload:'mang hồ sơ'});expect(codec.decode({payload:'mang hồ sơ'})).toEqual({payload:'mang hồ sơ',empty:[]});
 for(const empty of [[],['authored']])expect(()=>codec.decode({payload:'mang hồ sơ',empty})).toThrow();expect(()=>codec.encode({payload:'mang hồ sơ',empty:['authored']})).toThrow('FIXED_EMPTY_AUTHORED_ROW');expect(()=>codec.decode({payload:1})).toThrow();
});
it('keeps discriminated branch ownership and array order without rewriting values',()=>{
 const branch=(kind:string,key:string)=>({type:'object',properties:{kind:{type:'string',enum:[kind]},[key]:{type:'array',maxItems:0,items:{type:'string'}},values:{type:'array',items:{type:'string'}}},required:['kind',key,'values'],additionalProperties:false});
 const codec=fixedEmptyCarrierCodec({anyOf:[branch('A','unusedA'),branch('B','unusedB')]});
 for(const[kind,key]of [['A','unusedA'],['B','unusedB']]){const original={kind,[key]:[],values:['second','first']};expect(codec.decode(codec.encode(original))).toEqual(original);}
});
it('refuses branch aliases that would restore different old shapes',()=>{
 const branch=(key:string)=>({type:'object',properties:{[key]:{type:'array',maxItems:0,items:{type:'string'}}},required:[key],additionalProperties:false});const codec=fixedEmptyCarrierCodec({anyOf:[branch('a'),branch('b')]});expect(()=>codec.decode({})).toThrow('FIXED_EMPTY_BRANCH_AMBIGUOUS');expect(()=>codec.encode({a:[]})).toThrow('FIXED_EMPTY_BRANCH_AMBIGUOUS');
});
it('fails closed on optional or unsupported fixed-empty positions',()=>{
 expect(()=>fixedEmptyCarrierCodec({...source,required:['payload']})).toThrow('FIXED_EMPTY_OPTIONAL_POSITION');expect(()=>fixedEmptyCarrierCodec({type:'array',maxItems:0,items:{type:'string'}})).toThrow('FIXED_EMPTY_POSITION_UNSUPPORTED');
});
