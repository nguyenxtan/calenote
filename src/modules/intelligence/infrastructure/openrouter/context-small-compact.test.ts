// @vitest-environment node
import {expect,it} from 'vitest';
import {compileCompactContext,COMPACT_KEYS} from './context-small-compact';
const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const schema=obj({changes:obj({title:{type:'array',maxItems:1,items:obj({rank:{type:'integer'},write:{type:'array',minItems:1,maxItems:1,items:obj({operation:{type:'string',enum:['SET','REPLACE']},value:{type:'string'}})},evidence:{type:'array',items:{type:'string',enum:['U0']}}})}})});
const flat={changes:{title:[{rank:0,write:[{operation:'SET',value:'k'}],evidence:['U0']}]}};
it('uses one scoped projection for schema and exact inverse without changing free strings',()=>{const codec=compileCompactContext(schema),packed=codec.pack(flat);expect(packed).toEqual({c:{a:[{r:0,w:[{o:'s',v:'k'}],e:['U0']}]}});expect(codec.unpack(packed)).toEqual(flat);expect(codec.pack(codec.unpack(packed))).toEqual(packed);expect(COMPACT_KEYS.root.operation).toBe('o');expect(JSON.stringify(codec.schema)).not.toContain('"null"');});
it('refuses malformed scalar cells, old operation columns and unknown keys before projection',()=>{
 const nullable=obj({reply:{type:'array',items:obj({text:{type:['integer','null']}})}}),codec=compileCompactContext(nullable);for(const cell of [null,0,[0,1],['0'],[[0]]])expect(()=>codec.unpack({r:[{t:cell}]})).toThrow('COMPACT_SHAPE_INVALID');
 const active=compileCompactContext(schema);for(const value of [null,[],['k'],0])expect(()=>active.unpack({c:{a:[{r:0,w:[{o:'s',v:value}],e:['U0']}]}})).toThrow();expect(()=>active.unpack(flat)).toThrow();expect(()=>active.unpack({c:{a:[{r:0,w:[{o:'s',v:'k',extra:[]}],e:['U0']}]}})).toThrow();const packed=active.pack(flat) as Record<string,unknown>;Object.defineProperty(packed,'constructor',{value:[],enumerable:true});expect(()=>active.unpack(packed)).toThrow();
});
it('keeps exact false, zero and empty-string values distinct from null',()=>{for(const[type,value]of [['boolean',false],['integer',0],['string','']] as const){const codec=compileCompactContext(obj({reply:{type:'array',items:obj({text:{type:[type,'null']}})}}));for(const v of [null,value]){const flat={reply:[{text:v}]};expect(codec.unpack(codec.pack(flat))).toEqual(flat);}}});

it('projects every intrinsic date kind through its scoped alphabet and keeps alias-looking titles literal',()=>{
 // Transport-only specimen; the public suite retains complete typed date semantics.
 const dateSchema=obj({changes:obj({eventDate:{type:'array',maxItems:1,items:obj({rank:{type:'integer'},write:{type:'array',maxItems:1,items:obj({operation:{type:'string',enum:['SET']},value:obj({kind:{type:'string',enum:['CIVIL_DATE','RELATIVE_DAY','WEEKDAY']}})})},evidence:{type:'array',items:{type:'string'}}})}})}),codec=compileCompactContext(dateSchema);
 for(const[kind,alias]of Object.entries({CIVIL_DATE:'date',RELATIVE_DAY:'receipt',WEEKDAY:'weekday'})){const logical={changes:{eventDate:[{rank:0,write:[{operation:'SET',value:{kind}}],evidence:['U0']}]}};const packed=codec.pack(logical) as {c:Record<string,Array<{w:Array<{v:{k:string}}>}> >};expect(packed.c[COMPACT_KEYS.fields.eventDate][0].w[0].v.k).toBe(alias);expect(codec.unpack(packed)).toEqual(logical);for(const legacy of ['c','r','w']){const bad=structuredClone(packed);bad.c[COMPACT_KEYS.fields.eventDate][0].w[0].v.k=legacy;expect(()=>codec.unpack(bad)).toThrow('COMPACT_SHAPE_INVALID');}}
 const texts=compileCompactContext(schema);for(const value of ['event','notify','until','date','receipt','weekday','d','f','m','c','r','w']){const logical={changes:{title:[{rank:0,write:[{operation:'SET',value}],evidence:['U0']}]}};expect(texts.unpack(texts.pack(logical))).toEqual(logical);}
});
