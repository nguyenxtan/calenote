// @vitest-environment node
import {expect,it} from 'vitest';
import {compileCompactContext,COMPACT_KEYS} from './context-small-compact';
const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const schema=obj({changes:obj({title:obj({SET:{type:'array',maxItems:1,items:obj({rank:{type:'integer'},value:{type:'string'},evidence:{type:'array',items:{type:'string',enum:['U0']}}})}})})});
const flat={changes:{title:{SET:[{rank:0,value:'k',evidence:['U0']}]}}};
it('uses one scoped projection for schema and exact inverse without changing free strings',()=>{const codec=compileCompactContext(schema),packed=codec.pack(flat);expect(packed).toEqual({c:{a:{s:[{r:0,v:'k',e:['U0']}]}}});expect(codec.unpack(packed)).toEqual(flat);expect(codec.pack(codec.unpack(packed))).toEqual(packed);expect(COMPACT_KEYS.root.operation).toBe('o');expect(JSON.stringify(codec.schema)).not.toContain('"null"');});
it('refuses malformed scalar cells, old operation columns and unknown keys before projection',()=>{
 const nullable=obj({reply:{type:'array',items:obj({text:{type:['integer','null']}})}}),codec=compileCompactContext(nullable);
 for(const cell of [null,0,[0,1],['0'],[[0]]])expect(()=>codec.unpack({r:[{t:cell}]})).toThrow('COMPACT_SHAPE_INVALID');
 const active=compileCompactContext(schema);for(const value of [null,[],['k'],0])expect(()=>active.unpack({c:{a:{s:[{r:0,v:value,e:['U0']}]}}})).toThrow();
 expect(()=>active.unpack(flat)).toThrow();expect(()=>active.unpack({c:{a:{s:[{r:0,v:'k',e:['U0'],o:'s'}]}}})).toThrow();
 const packed=active.pack(flat) as Record<string,unknown>;Object.defineProperty(packed,'constructor',{value:[],enumerable:true});expect(()=>active.unpack(packed)).toThrow();
});
it('keeps exact false, zero and empty-string values distinct from null',()=>{for(const [type,value]of [['boolean',false],['integer',0],['string','']] as const){const codec=compileCompactContext(obj({reply:{type:'array',items:obj({text:{type:[type,'null']}})}}));for(const v of [null,value]){const flat={reply:[{text:v}]};expect(codec.unpack(codec.pack(flat))).toEqual(flat);}}});
