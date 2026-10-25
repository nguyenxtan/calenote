import {kindQuerySchema,attachKindQueries} from '../../src/modules/intelligence/infrastructure/openrouter/context-small-kind-queries';
import {operationValueSchema,attachOperationValues} from '../../src/modules/intelligence/infrastructure/openrouter/context-small-operation-values';
import {ownedClockSchema,attachOwnedClocks} from '../../src/modules/intelligence/infrastructure/openrouter/context-small-owned-clocks';
// @vitest-environment node
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {createContextContractProbe,runContextFixtureCampaign} from './context-contract-probe';
import {admitCanonicalCampaign,type ContextManifest} from './context-contract';
import {frozenContextProposal} from './context-contract-fixtures';
import {SLOT_NAMES,ConversationInterpretationV3Schema,type ContextInput} from '../../src/modules/conversation/context-contract/contracts';
import {deriveGenerationFieldCapability,isBoundRelationUncertaintyAbsent,isInitialFiniteSeriesWithoutRelationSource} from '../../src/modules/conversation/context-contract/field-capability';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../src/modules/conversation/context-contract/small-protocol';
import {encodeSmallContextV3,decodeSmallContextV3,smallContextSchemaV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-small-wire';
import {encodeInternalFlatV3,decodeInternalFlatV3,internalFlatSchemaV3} from '../../src/modules/intelligence/infrastructure/openrouter/context-small-intermediate';
import {compileCompactContext,COMPACT_KEYS,COMPACT_ENUMS} from '../../src/modules/intelligence/infrastructure/openrouter/context-small-compact';
type Row=Record<string,unknown>;
const captured:Array<{input:ContextInput;id:string;index:number}>=[];
beforeAll(async()=>{const manifest:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(name=>JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`,'utf8')).cases)};await runContextFixtureCampaign(admitCanonicalCampaign(manifest,'FULL'),{sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'TYPED_105'},(input,id,index)=>{captured.push({input:structuredClone(input),id,index});return frozenContextProposal(input,id,index);});},30000);
const original=(row:typeof captured[number])=>encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),row.input);
const decode=(wire:unknown,input:ContextInput)=>decodeSmallContextV3(wire,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,input);
const carriers=(wire:Row)=>wire.c as Record<string,Row[]>;
const change=(wire:Row,key:string)=>{const rows=carriers(wire)[key];expect(rows).toHaveLength(1);return rows[0];};
const control=(wire:Row,key:string)=>{const rows=change(wire,key).w as Row[];expect(rows).toHaveLength(1);return rows[0];};
function mutation(input:ContextInput,field:typeof SLOT_NAMES[number],operation:string){
 const date=['eventDate','reminderDate','endDate'].includes(field),clock=['eventTime','reminderTime'].includes(field),numeric=['occurrenceCount','leadOffsetDays'].includes(field);
 const value=date?{k:'c',c:['g'],d:[11],m:[10],y:[],l:[],o:[],w:[],q:[]}:clock?{h:8,m:0,q:'h'}:numeric?2:field==='frequency'?'d':field==='calendar'?'g':field==='eventRelation'?'b':'synthetic';
 return {r:0,w:operation==='CLEAR'?[]:[{o:operation==='SET'?'s':'r',v:value}],e:[`U${input.currentTurn}`]};
}
function clearFields(wire:Row){for(const key of Object.keys(carriers(wire)))carriers(wire)[key]=[];}
function put(wire:Row,field:typeof SLOT_NAMES[number],_operation:'SET'|'REPLACE'|'CLEAR',row:Row){carriers(wire)[COMPACT_KEYS.fields[field]]=[row];}
it('proves all144 public compact schemas and exact bidirectional valid-domain inverses before canonical decoding',()=>{
 expect(captured).toHaveLength(144);let nullable=0,unions=0,maxBytes=0;
 for(const row of captured){
  const value=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),flat=encodeInternalFlatV3(value,row.input),wire=original(row),codec=compileCompactContext(kindQuerySchema(operationValueSchema(ownedClockSchema(internalFlatSchemaV3(row.input).schema)))),schema=smallContextSchemaV3(row.input).schema;
  expect(codec.unpack(wire),`${row.id}/${row.index}`).toEqual(attachKindQueries(attachOperationValues(attachOwnedClocks(flat),operationValueSchema(ownedClockSchema(internalFlatSchemaV3(row.input).schema)))));expect(codec.pack(codec.unpack(wire))).toEqual(wire);
  expect(z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(true);
  expect(decode(wire,row.input)).toEqual(decodeInternalFlatV3(flat,CONTEXT_SMALL_PROTOCOL_V3,undefined,undefined,row.input));expect(decode(wire,row.input).status).toBe('PARSED');
  expect(decode(flat,row.input).status).toBe('REFUSED');
  const visit=(node:unknown)=>{if(!node||typeof node!=='object')return;const n=node as Row;expect(Array.isArray(n.type)).toBe(false);expect(n.type).not.toBe('null');if(Array.isArray(n.enum))expect(n.enum).not.toContain(null);if(n.anyOf){unions++;expect(n.anyOf).toHaveLength(2);expect(node).toBe((schema.properties as Row).o);}for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else visit(v);};visit(schema);
  const inventory=(node:unknown)=>{if(!node||typeof node!=='object')return;const n=node as Row;if(Array.isArray(n.type)&&n.type.includes('null'))nullable++;for(const v of Object.values(n))if(Array.isArray(v))v.forEach(inventory);else inventory(v);};inventory(internalFlatSchemaV3(row.input).schema);
  maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify(schema)));
 }
 expect(unions).toBe(144);expect(nullable).toBeGreaterThan(10000);expect(maxBytes).toBeLessThan(26000);
},30000);
it('retains117 relation and234 initial negative controls through the actual public compact boundary',()=>{
 let relation=0,initial=0;
 for(const row of captured){const bound=isBoundRelationUncertaintyAbsent(row.input),first=isInitialFiniteSeriesWithoutRelationSource(row.input);if(!bound&&!first)continue;const wire=original(row),schema=z.fromJSONSchema(smallContextSchemaV3(row.input).schema as Parameters<typeof z.fromJSONSchema>[0]);
  for(const field of SLOT_NAMES)for(const operation of ['SET','REPLACE','CLEAR'] as const){
   const bad=structuredClone(wire);clearFields(bad);put(bad,field,operation,mutation(row.input,field,operation));bad.k=[];
   if(bound){relation++;const permitted=field==='eventRelation'&&operation==='SET';expect(schema.safeParse(bad).success,`${row.id}/${field}/${operation}`).toBe(permitted);if(!permitted)expect(decode(bad,row.input).status).toBe('REFUSED');}
   if(first){initial++;const cap=deriveGenerationFieldCapability(row.input),allowedFields=new Set(['title','location','eventDate',...cap.allowedClockFields,...(cap.calendarProposalAllowed?['calendar']:[]),...cap.allowedNumericFields]);const allowed=allowedFields.has(field)&&operation==='SET';expect(schema.safeParse(bad).success,`${row.id}/${field}/${operation}`).toBe(allowed);if(!allowed)expect(decode(bad,row.input).status).toBe('REFUSED');}
  }
 }
 expect(relation).toBe(117);expect(initial).toBe(234);
});
it('refuses raw-null, multi, wrong-type cells, unknown aliases, obsolete protocols and contradictory KEEP without mutation',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,wire=original(row),slot=carriers(wire).g;expect(slot).toBeDefined();
 for(const value of [null,0,[0],[123],[false],['0'],[[],[]]]){const bad=structuredClone(wire);control(bad,'g').v=value;const before=JSON.stringify(bad);expect(decode(bad,row.input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);}
 for(const value of [null,[],[0],[0,1],['0'],[[0]]]){const bad=structuredClone(wire);change(bad,'g').r=value;expect(decode(bad,row.input).status).toBe('REFUSED');}
 for(const mutate of [(w:Row)=>{control(w,'g').v=null;},(w:Row)=>{control(w,'g').v=[control(w,'g').v,control(w,'g').v];},(w:Row)=>{w.changes=w.c;delete w.c;},(w:Row)=>{Object.assign(carriers(w),{unknown:{s:[]}});},(w:Row)=>{Object.assign(carriers(w),{a:[{r:0,o:'k',v:[],t:['hidden'],d:[],e:[],k:[]}]});},(w:Row)=>{Object.assign(control(w,'g'),{field:'eventTime'});},(w:Row)=>{control(w,'g').o='SET';}]){const bad=structuredClone(wire);mutate(bad);expect(decode(bad,row.input).status).toBe('REFUSED');}
 for(const id of ['kind-queries-26','active-carriers-25','owned-clocks-24','compact-cells-23','flat-dates-22','field-controls-21','clock-stream-19'])expect(decodeSmallContextV3(wire,{...CONTEXT_SMALL_PROTOCOL_V3,promptVersion:'calenote-context-small-tables-106-'+id,wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-'+id},undefined,undefined,row.input).status).toBe('REFUSED');
});
it('keeps valid core when optional compact advice is malformed, but refuses unknown roots',()=>{const row=captured[0],wire=original(row);for(const advice of [{g:'bad',r:null},{g:[{k:'HELP',t:[1]}],r:[{t:42}]},{g:[{k:'HELP',f:[],r:[],i:[],t:['GENERAL','LUNAR']}],r:[]}])expect(decode({...wire,...advice},row.input).status).toBe('PARSED');expect(decode({...wire,unknownAdvice:[]},row.input).status).toBe('REFUSED');});
it('preserves alias-looking free text and exact U/S/F evidence without global enum replacement',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,base=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),evidence=[{kind:'USER_QUOTE',turn:row.input.currentTurn,quote:row.input.turns[row.input.currentTurn].text,occurrence:1}];
 for(const text of ['k','s','d','g','u','U0','S0.0','Ff1','constructor','__proto__','a  b',' g ','quoted "k"','literal\\nvalue']){const value=ConversationInterpretationV3Schema.parse({...base,changes:[{field:'title',operation:'SET',value:text,evidence}],uncertainties:[],conversationDirective:null,replyProposal:null}),flat=encodeInternalFlatV3(value,row.input),wire=encodeSmallContextV3(value,row.input),codec=compileCompactContext(kindQuerySchema(operationValueSchema(ownedClockSchema(internalFlatSchemaV3(row.input).schema))));expect(control(wire,'a').v).toBe(text);expect(codec.unpack(wire)).toEqual(attachKindQueries(attachOperationValues(attachOwnedClocks(flat),operationValueSchema(ownedClockSchema(internalFlatSchemaV3(row.input).schema)))));}
 const wire=original(captured[0]);wire.g=[{k:'HELP',f:[],r:[],i:[],t:['g']}];wire.r=[{t:'s'}];const codec=compileCompactContext(kindQuerySchema(operationValueSchema(ownedClockSchema(internalFlatSchemaV3(captured[0].input).schema))));expect((codec.unpack(wire) as Row).reply).toEqual([{text:'s'}]);expect((codec.unpack(wire) as Row).directive).toEqual([{kind:'HELP',field:null,reason:null,issue:null,topic:'g'}]);
});
it('retains authored rank addresses, gaps, clock order and meaningful date nulls',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,base=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),evidence=[{kind:'USER_QUOTE',turn:row.input.currentTurn,quote:row.input.turns[row.input.currentTurn].text,occurrence:1}];const value=ConversationInterpretationV3Schema.parse({...base,changes:[{field:'reminderTime',operation:'SET',value:{hour:8,minute:0,qualifier:'H24'},evidence},{field:'eventTime',operation:'SET',value:{hour:9,minute:30,qualifier:'H24'},evidence}],uncertainties:[]}),wire=encodeSmallContextV3(value,row.input),expected=decode(wire,row.input);expect(expected.status).toBe('PARSED');change(wire,'g').r=2;change(wire,'e').r=8;wire.c=Object.fromEntries(Object.entries(carriers(wire)).reverse());expect(decode(wire,row.input)).toEqual(expected);const collision=structuredClone(wire);change(collision,'e').r=2;expect(decode(collision,row.input).status).toBe('REFUSED');
});

/** Pure schema specimens test the syntax bijection; never fed to the application or a provider. */
function specimen(schema:unknown):unknown {
 const n=schema as Row;if(Array.isArray(n.anyOf))return specimen(n.anyOf[0]);
 if(n.type==='object')return Object.fromEntries(Object.entries(n.properties as Row).map(([key,value])=>[key,specimen(value)]));
 if(n.type==='array')return n.maxItems===0?[]:Array.from({length:Math.max(1,typeof n.minItems==='number'?n.minItems:0)},()=>specimen(n.items));
 if(Array.isArray(n.type)&&n.type.includes('null')||n.type==='null')return null;
 if(Array.isArray(n.enum))return n.enum[0];
 return n.type==='string'?'synthetic':n.type==='boolean'?false:0;
}
function replacePath(value:unknown,path:Array<string|number>,replacement:unknown){let cursor=value as Record<string|number,unknown>;for(const key of path.slice(0,-1))cursor=cursor[key] as Record<string|number,unknown>;cursor[path.at(-1)!]=replacement;}
it('exhausts every nullable scalar scope and constrained enum member with exact forward/inverse syntax',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,schema=kindQuerySchema(operationValueSchema(ownedClockSchema(internalFlatSchemaV3(row.input).schema))),codec=compileCompactContext(schema),base=specimen(schema);let nullablePaths=0,enumValues=0,freePaths=0;
 const visit=(schema:unknown,path:Array<string|number>=[])=>{
  const n=schema as Row;if(Array.isArray(n.anyOf)){visit(n.anyOf[0],path);return;}
  if(n.type==='object'){for(const [key,value]of Object.entries(n.properties as Row))visit(value,[...path,key]);return;}
  if(n.type==='array'){if(n.maxItems!==0)visit(n.items,[...path,0]);return;}
  const types=Array.isArray(n.type)?n.type:[n.type],isNull=types.includes('null'),values:unknown[]=[];
  if(isNull){nullablePaths++;values.push(null);}
  if(Array.isArray(n.enum)){enumValues+=n.enum.filter(v=>v!==null).length;values.push(...n.enum.filter(v=>v!==null));}
  else if(types.includes('string')){freePaths++;values.push('g','k','d','u','s','DAY','DAILY','U0','S0.0','Ff1','constructor','__proto__','');}
  else if(types.includes('integer'))values.push(0,1,-1,Number.MAX_SAFE_INTEGER);
  else if(types.includes('boolean'))values.push(false,true);
  for(const replacement of values){const flat=structuredClone(base);replacePath(flat,path,replacement);const compact=codec.pack(flat);expect(codec.unpack(compact),path.join('.')).toEqual(flat);expect(codec.pack(codec.unpack(compact))).toEqual(compact);}
 };
 visit(schema);expect(nullablePaths).toBe(98);expect(enumValues).toBeGreaterThan(100);expect(freePaths).toBeGreaterThan(10);
},30000);
it('refuses malformed cell shape at every populated nullable scope before any semantic interpretation',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,source=kindQuerySchema(operationValueSchema(ownedClockSchema(internalFlatSchemaV3(row.input).schema))),codec=compileCompactContext(source),flat=specimen(source),compact=codec.pack(flat);let covered=0;
 const visit=(logical:unknown,packed:unknown,path:Array<string|number>=[])=>{
  if(logical===null){covered++;for(const bad of [null,0,[null],[[]],[{}],[[],[]],[{},{}]]){const wire=structuredClone(compact);replacePath(wire,path,bad);expect(()=>codec.unpack(wire),path.join('.')).toThrow('COMPACT_SHAPE_INVALID');}return;}
  if(Array.isArray(logical)){logical.forEach((v,i)=>visit(v,(packed as unknown[])[i],[...path,i]));return;}
  if(logical&&typeof logical==='object'){const a=Object.values(logical),b=Object.entries(packed as Row);a.forEach((v,i)=>visit(v,b[i][1],[...path,b[i][0]]));}
 };
 visit(flat,compact);expect(covered).toBe(98);
});
it('keeps all constrained codebooks bijective and rejects undeclared alias values',()=>{
 for(const book of [...Object.values(COMPACT_KEYS),...Object.values(COMPACT_ENUMS)])expect(new Set(Object.values(book)).size).toBe(Object.keys(book).length);
 const row=captured[0],wire=original(row);for(const code of ['LIST_REMINDERS','12','__proto__']){const bad=structuredClone(wire);(bad.o as Row).c=code;expect(decode(bad,row.input).status).toBe('REFUSED');}
 const source=kindQuerySchema(operationValueSchema(ownedClockSchema(internalFlatSchemaV3(row.input).schema))),codec=compileCompactContext(source),sample=specimen(source) as Row;const query=sample.query as {capability:Row[];list:Row[]};query.capability[0].topic='g';(query.list[0].period as Row[])[0].unsupportedKind='d';((sample.uncertainties as Row[])[0].alternatives as Row[])[0].text='s';expect(codec.unpack(codec.pack(sample))).toEqual(sample);
});

// Public compact gateway, evidence, draft persistence and API positive controls.
it.each([
 ['Đổi ngày thi sang ngày 12/10.','eventDate','REPLACE',{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:12,month:10,year:null,leapMonth:null}],
 ['Nhắc cả ngày thi.','eventRelation','SET','INCLUDING_EVENT'],
 ['Đổi số lần nhắc thành 3 lần.','occurrenceCount','REPLACE',3],
 ['Đổi thành nhắc 3 ngày liên tiếp.','frequency','REPLACE','DAILY'],
] as const)('keeps legitimate %s edits through gateway, evidence, draft persistence and API observation',async(text,field,operation,value)=>{
 let calls=0;const first=captured.find(row=>row.id==='R02'&&row.index===0)!;
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},input=>{
  if(calls++===0){const initial=frozenContextProposal(input,'R02',0) as {changes:Array<{field:string;value:unknown}>};return field==='frequency'?{...initial,changes:initial.changes.filter(change=>change.field!=='occurrenceCount').map(change=>change.field==='frequency'?{...change,value:'ONCE'}:change)}:initial;}
  const evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
  return ConversationInterpretationV3Schema.parse({...ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',1)),changes:[{field,operation,value,evidence},...(field==='frequency'?[{field:'occurrenceCount',operation:'SET',value:3,evidence}]:[])],conversationDirective:null,replyProposal:null});
 });
 try{
  await probe.turn(field==='frequency'?'Ngày 11/10 đi thi ở Quang Trung, nhắc một lần giúp tôi.':first.input.turns[0].text,'2026-09-28T03:00:00Z');const result=await probe.turn(text,'2026-09-28T03:01:00Z');
  expect(result.status).toBe('CLARIFICATION_REQUESTED');expect(result.fullSchemaValid).toBe(true);expect(result.mutations).toBe(0);expect(result.draftRevision).toBe(2);
  expect(result.fields).toMatchObject({frequency:'DAILY',occurrenceCount:field==='occurrenceCount'||field==='frequency'?3:2,reminderDate:null,eventRelation:field==='eventRelation'?'INCLUDING_EVENT':null,eventDate:{kind:'CIVIL_DATE',day:field==='eventDate'?12:11,month:10,year:null}});
 }finally{probe.dispose();}
});

it('refuses the complete recorded20 unowned root-clock pattern unchanged instead of reusing or dropping it',()=>{
 const row=captured.find(row=>row.id==='R02'&&row.index===1)!;
 const recorded={o:{c:'0',e:['U2']},c:{k:{r:[0],o:'s',v:[],t:['b'],d:[],e:['U2']}},q:[],u:[],g:[],r:[],x:[],n:[],d:[],k:[{h:0,m:0,q:'u'}],p:[]};const before=JSON.stringify(recorded);expect(decode(recorded,row.input).status).toBe('REFUSED');expect(JSON.stringify(recorded)).toBe(before);
 const wire=original(row);expect(wire.k).toEqual([]);expect(control(wire,'k').v).toBe('b');const bad=structuredClone(wire);bad.k=[{h:0,m:0,q:'u'}];expect(z.fromJSONSchema(smallContextSchemaV3(row.input).schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(bad).success).toBe(false);expect(decode(bad,row.input).status).toBe('REFUSED');const nonowner=structuredClone(wire);control(nonowner,'k').k=[{h:0,m:0,q:'u'}];expect(decode(nonowner,row.input).status).toBe('REFUSED');
});
it('validates every owned clock before interpreting any consumer, retaining duplicate operands and no indexed fallback',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,base=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index)),evidence=[{kind:'USER_QUOTE',turn:row.input.currentTurn,quote:row.input.turns[row.input.currentTurn].text,occurrence:1}],clock={hour:8,minute:0,qualifier:'H24'};
 const value=ConversationInterpretationV3Schema.parse({...base,changes:[{field:'eventTime',operation:'SET',value:clock,evidence},{field:'reminderTime',operation:'REPLACE',value:clock,evidence}],uncertainties:[{field:'reminderTime',reason:'AMBIGUOUS',alternatives:[{value:clock,evidence},{value:clock,evidence}]}]}),wire=encodeSmallContextV3(value,row.input);expect(decode(wire,row.input).status).toBe('PARSED');expect(wire.k).toEqual([]);expect(control(wire,'e').v).toEqual({h:8,m:0,q:'h'});expect(control(wire,'g').v).toEqual({h:8,m:0,q:'h'});const issue=(wire.u as Array<{a:Array<Row>}>)[0];expect(issue.a.map(a=>a.k)).toEqual([[{h:8,m:0,q:'h'}],[{h:8,m:0,q:'h'}]]);
 for(const mutate of [(w:Row)=>{control(w,'e').v=null;},(w:Row)=>{control(w,'g').v=[{h:8,m:0,q:'h'},{h:8,m:0,q:'h'}];},(w:Row)=>{control(w,'g').v={h:0,m:0,q:'a'};},(w:Row)=>{(w.u as Array<{a:Array<Row>}>)[0].a[1].k=[{h:24,m:0,q:'h'}];},(w:Row)=>{control(w,'e').v=[123];},(w:Row)=>{(w.u as Array<{f:number;a:Array<Row>}>)[0].f=0;}]){const bad=structuredClone(wire);mutate(bad);const before=JSON.stringify(bad);expect(decode(bad,row.input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);}
});

it('represents the entire unchanged field family as empty carriers and refuses the recorded21 KEEP-rank pattern unchanged',()=>{
 const row=captured.find(row=>row.id==='R01'&&row.index===0)!,wire=original(row);expect(Object.values(carriers(wire)).every(rows=>rows.length===0)).toBe(true);expect(decode(wire,row.input).status).toBe('PARSED');
 const legacy=structuredClone(wire);for(const [rank,key]of Object.keys(carriers(legacy)).entries())Object.assign(carriers(legacy),{[key]:{r:[rank],o:'k',v:[],t:[],d:[],e:[],k:[]}});const before=JSON.stringify(legacy);expect(decode(legacy,row.input).status).toBe('REFUSED');expect(JSON.stringify(legacy)).toBe(before);
 const accept=z.fromJSONSchema(smallContextSchemaV3(row.input).schema as Parameters<typeof z.fromJSONSchema>[0]);
 for(const [key]of Object.entries(carriers(wire)))for(const value of [null,{},[{r:0,o:'k',v:[],t:[],d:[],e:[],k:[]}],[{},{}]]){const bad=structuredClone(wire);Object.assign(carriers(bad),{[key]:value});expect(accept.safeParse(bad).success).toBe(false);expect(decode(bad,row.input).status).toBe('REFUSED');}
 const missing=structuredClone(wire);delete carriers(missing).a;expect(decode(missing,row.input).status).toBe('REFUSED');
});
it('keeps authored primitive active ranks and refuses null/wrapped ranks or empty active evidence at the producer boundary',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,wire=original(row),accept=z.fromJSONSchema(smallContextSchemaV3(row.input).schema as Parameters<typeof z.fromJSONSchema>[0]);expect(typeof change(wire,'g').r).toBe('number');expect(accept.safeParse(wire).success).toBe(true);
 for(const rank of [null,[],[0],[[0]],'0']){const bad=structuredClone(wire);change(bad,'g').r=rank;expect(accept.safeParse(bad).success).toBe(false);expect(decode(bad,row.input).status).toBe('REFUSED');}
 const empty=structuredClone(wire);change(empty,'g').e=[];expect(accept.safeParse(empty).success).toBe(false);expect(decode(empty,row.input).status).toBe('REFUSED');
});

// Semantic-boundary counterfactuals use authored fixtures, never replay a paid payload.
it.each([[11,2,8],[12,3,9]] as const)('leaves finite-series arithmetic to the backend for event day %s, count %s and clock %s',async(day,count,hour)=>{
 for(const inventedCandidate of [false,true]){
  let calls=0;
  const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},input=>{
   const first=calls++===0,evidence=[{kind:'USER_QUOTE',turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}];
   const baseline=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R03',first?0:1));
   return ConversationInterpretationV3Schema.parse({...baseline,changes:first?baseline.changes.map(change=>change.field==='eventDate'?{...change,value:{kind:'CIVIL_DATE',calendar:'GREGORIAN',day,month:10,year:null,leapMonth:null}}:change.field==='occurrenceCount'?{...change,value:count}:change.field==='reminderTime'?{...change,value:{hour,minute:0,qualifier:'H24'}}:change):[{field:'eventRelation',operation:'SET',value:'BEFORE_EVENT',evidence}],uncertainties:!first&&inventedCandidate?[{field:'reminderDate',reason:'MISSING',alternatives:[{value:{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:day-count,month:10,year:null,leapMonth:null},evidence}]}]:[],conversationDirective:null,replyProposal:null});
  });
  try{
   const first=await probe.turn(`Ngày ${day}/10 đi thi, nhắc ${count} ngày liên tiếp lúc ${hour}h.`,'2026-09-28T03:00:00Z');expect(first.pendingField).toBe('reminderDate');
   const result=await probe.turn('Nhắc trước sự kiện.','2026-09-28T03:01:00Z');expect(result.fullSchemaValid).toBe(true);expect(result.mutations).toBe(0);
   if(inventedCandidate){expect(result.status).toBe('CLARIFICATION_REQUESTED');expect(result.pendingField).toBe('reminderDate');expect(result.occurrences).toHaveLength(0);}
   else{expect(result.status).toBe('DRAFT_CREATED');expect(result.pendingField).toBe(null);expect(result.occurrences).toHaveLength(count);expect(result.fields).toMatchObject({eventRelation:'BEFORE_EVENT',frequency:'DAILY',occurrenceCount:count,reminderDate:null});}
  }finally{probe.dispose();}
 }
});

// CAPABILITY is an additional trusted schema specimen; it is not a new corpus fixture or service evidence proof.
function querySpecimen(kind:'LIST'|'CALENDAR_DATE'|'CAPABILITY'){
 const row=captured.find(row=>(frozenContextProposal(row.input,row.id,row.index) as {query?:{kind?:string}}).query?.kind===kind)??captured[0];
 const base=ConversationInterpretationV3Schema.parse(frozenContextProposal(row.input,row.id,row.index));
 const value=kind==='CAPABILITY'&&base.query?.kind!==kind?ConversationInterpretationV3Schema.parse({...base,intent:'CAPABILITY_QUERY',requestTarget:null,changes:[],query:{kind,topic:'FINITE_SERIES',evidence:base.query!.evidence},uncertainties:[],conversationDirective:null,replyProposal:null}):base;
 return {row,value,wire:encodeSmallContextV3(value,row.input)};
}
it.each([['l','3',['p','e']],['c','4',['d','c','e']],['b','5',['t','e']]] as const)('owns only kind-specific columns in public query carrier %s', (key,code,keys)=>{
 const {row,wire}=querySpecimen(key==='l'?'LIST':key==='c'?'CALENDAR_DATE':'CAPABILITY');const query=wire.q as Record<string,Row[]>;expect(Object.keys(query)).toEqual(['l','c','b']);expect(Object.keys(query[key][0])).toEqual(keys);expect((wire.o as Row).c).toBe(code);expect(decode(wire,row.input).status).toBe('PARSED');
 const extra=structuredClone(wire);Object.assign((extra.q as Record<string,Row[]>)[key][0],{unexpected:[]});const before=JSON.stringify(extra);expect(decode(extra,row.input).status).toBe('REFUSED');expect(JSON.stringify(extra)).toBe(before);
 const mismatch=structuredClone(wire);(mismatch.o as Row).c='6';(mismatch.o as Row).e=[];expect(decode(mismatch,row.input).status).toBe('REFUSED');
 const multiple=structuredClone(wire),q=multiple.q as Record<string,Row[]>;q[key].push(structuredClone(q[key][0]));expect(decode(multiple,row.input).status).toBe('REFUSED');
});
it('refuses the complete recorded24 generic query and every cross-kind poison unchanged without dropping a value',()=>{
 const row=captured.find(row=>row.id==='R01'&&row.index===1)!,wire=original(row),before=JSON.stringify(wire);
 const old={...wire,q:[{p:[{k:'mc',d:[],f:[],t:[],u:[]}],d:[],c:['g'],t:[],e:['U2']}]},raw=JSON.stringify(old);expect(decode(old,row.input).status).toBe('REFUSED');expect(JSON.stringify(old)).toBe(raw);
 for(const kind of ['l','c','b']){const bad=structuredClone(wire),q=bad.q as Record<string,Row[]>;q.l=[];q.c=[];q.b=[];q[kind]=[kind==='l'?{p:[],e:['U2'],c:['g']}:kind==='c'?{d:[],c:[],e:['U2'],p:[]}: {t:[],e:['U2'],d:[]}];const bytes=JSON.stringify(bad);expect(decode(bad,row.input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(bytes);}
 const many=structuredClone(wire);(many.q as Record<string,Row[]>).b=[{t:[],e:['U2']}];expect(decode(many,row.input).status).toBe('REFUSED');expect(JSON.stringify(wire)).toBe(before);
});
it.each(['LIST','CALENDAR_DATE','CAPABILITY'] as const)('preserves source-authored missing operands and targeted uncertainty for %s',kind=>{
 const {row,value:base}=querySpecimen(kind);if(!base.query)throw Error('QUERY_REQUIRED');
 // Select the canonical family exactly; avoid importing columns from another kind.
 const exact=kind==='LIST'?{kind,period:null,statusScope:'DEFAULT',evidence:base.query.evidence}:kind==='CALENDAR_DATE'?{kind,date:null,outputCalendar:null,evidence:base.query.evidence}:{kind,topic:null,evidence:base.query.evidence};
 const value=ConversationInterpretationV3Schema.parse({...base,query:exact,uncertainties:[{field:kind==='CAPABILITY'?'intent':'queryRange',reason:'MISSING',alternatives:[]}]});const wire=encodeSmallContextV3(value,row.input);expect(decode(wire,row.input).status).toBe('PARSED');
});

it('requires nonnull selected WRITE values or explicitly permitted CLEAR across all13 fields and actual selected operations',()=>{
 const covered=new Set<string>();
 for(const row of captured){const source=smallContextSchemaV3(row.input).schema as unknown as {properties:{c:{properties:Record<string,{items:{properties:{w:{minItems?:number;maxItems:number;items:{properties?:{o:{enum:string[]}}}}}}}>}}};
  for(const field of SLOT_NAMES){const policy=source.properties.c.properties[COMPACT_KEYS.fields[field]];if(!policy)continue;const write=policy.items.properties.w;
   for(const operation of ['SET','REPLACE','CLEAR'] as const){const id=field+'/'+operation;if(covered.has(id))continue;if(operation==='CLEAR'?(write.minItems??0)!==0:!write.items.properties?.o.enum.includes(operation==='SET'?'s':'r'))continue;
    const accept=z.fromJSONSchema(policy.items as Parameters<typeof z.fromJSONSchema>[0]),value=mutation(row.input,field,operation);expect(accept.safeParse(value).success,id).toBe(true);
    const invalid=operation==='CLEAR'?[{...value,v:null},{...value,o:'c'}]:[{...value,w:[{o:operation==='SET'?'s':'r',v:null}]},{...value,w:[{o:operation==='SET'?'s':'r'}]},{...value,w:[{o:'c',v:(value.w[0] as Row).v}]}];for(const bad of invalid)expect(accept.safeParse(bad).success,id).toBe(false);
    const missing=original(row);clearFields(missing);expect(z.fromJSONSchema(smallContextSchemaV3(row.input).schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(missing).success).toBe(true);covered.add(id);
   }
  }
 }expect(covered.size).toBe(39);expect(new Set([...covered].map(v=>v.split('/')[0])).size).toBe(13);
});
it('refuses competing operation carriers before projection without choosing, dropping or mutating',()=>{
 const row=captured.find(row=>row.id==='R04'&&row.index===2)!,wire=original(row),bad=structuredClone(wire);clearFields(bad);
 put(bad,'reminderTime','SET',mutation(row.input,'reminderTime','SET'));carriers(bad).g.push({r:8,w:[],e:[`U${row.input.currentTurn}`]});const before=JSON.stringify(bad);expect(decode(bad,row.input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);
});
it('refuses the recorded25 missing SET value syntax unchanged instead of inferring a relation',()=>{
 const row=captured.find(row=>row.id==='R02'&&row.index===1)!,wire=original(row),legacy={...wire,c:{k:[{r:0,o:'s',v:[],t:[],d:[],e:['U2'],k:[]}]}};const before=JSON.stringify(legacy);expect(decode(legacy,row.input).status).toBe('REFUSED');expect(JSON.stringify(legacy)).toBe(before);
 const expected=control(wire,'k');expect(expected.v).toBe('b');const noValue=structuredClone(wire);delete control(noValue,'k').v;expect(decode(noValue,row.input).status).toBe('REFUSED');const nullable=structuredClone(wire);control(nullable,'k').v=null;expect(decode(nullable,row.input).status).toBe('REFUSED');
});

it('rejects legacy27 operation-key dictionaries and unpermitted or missing WRITE operation without changing payload',()=>{const row=captured.find(r=>r.id==='R02'&&r.index===1)!,wire=original(row);for(const mutate of [(w:Row)=>{const c=carriers(w).k;Object.assign(carriers(w),{k:{w:[{r:c[0].r,...(c[0].w as Row[])[0],e:c[0].e}],c:[]}});},(w:Row)=>{delete control(w,'k').o;},(w:Row)=>{control(w,'k').o='c';},(w:Row)=>{control(w,'k').o=['s'];}]){const bad=structuredClone(wire);mutate(bad);const before=JSON.stringify(bad);expect(decode(bad,row.input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);}});

// Authored semantic counterfactuals, not a replay or repair of provider payloads.
it.each(['đi thi','đi họp','uống thuốc','đóng tiền','đi khám định kỳ','nộp báo cáo quý','mua vé tàu','báo cáo quý'])('preserves the complete authored activity %s through public wire, evidence and draft observation',async(activity)=>{
 const text=`Ngày 11/10 ${activity} ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.`;
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},input=>{
  const baseline=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',0));return ConversationInterpretationV3Schema.parse({...baseline,changes:baseline.changes.map(c=>c.field==='title'?{...c,value:activity}:c),conversationDirective:null,replyProposal:null});
 });try{const result=await probe.turn(text,'2026-09-28T03:00:00Z');expect(result.fullSchemaValid).toBe(true);expect(result.status).toBe('CLARIFICATION_REQUESTED');expect(result.fields.title).toBe(activity);expect(result.draftRevision).toBe(1);expect(result.mutations).toBe(0);}finally{probe.dispose();}
});
it.each([11,12])('retains the unchanged bounded exam evidence refusal when an authored action is shortened on day%s',async(day)=>{
 for(const shortened of [false,true]){
  const text=`Ngày ${day}/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.`;
  const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},input=>{
   const baseline=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R02',0));return ConversationInterpretationV3Schema.parse({...baseline,changes:baseline.changes.map(c=>c.field==='title'?{...c,value:shortened?'thi':'đi thi'}:c.field==='eventDate'?{...c,value:{kind:'CIVIL_DATE',calendar:'GREGORIAN',day,month:10,year:null,leapMonth:null}}:c),conversationDirective:null,replyProposal:null});
  });try{const result=await probe.turn(text,'2026-09-28T03:00:00Z');expect(result.fullSchemaValid).toBe(true);expect(result.mutations).toBe(0);if(shortened){expect(result.status).toBe('REJECTED');expect(result.downstreamDiagnostics).toContainEqual(expect.objectContaining({stage:'EVIDENCE',reason:'SEMANTIC_TITLE_OMITTED'}));}else{expect(result.status).toBe('CLARIFICATION_REQUESTED');expect(result.fields.title).toBe('đi thi');expect(result.draftRevision).toBe(1);}}finally{probe.dispose();}
 }
});

it('requires one outer active row and a present permission-bound inner write without selecting competing data',()=>{
 const row=captured.find(r=>r.id==='R04'&&r.index===2)!,wire=original(row),accept=z.fromJSONSchema(smallContextSchemaV3(row.input).schema as Parameters<typeof z.fromJSONSchema>[0]);for(const mutate of [(w:Row)=>{carriers(w).g.push({r:8,w:[],e:[`U${row.input.currentTurn}`]});},(w:Row)=>{(change(w,'g').w as Row[]).push(structuredClone(control(w,'g')));},(w:Row)=>{delete change(w,'g').w;},(w:Row)=>{change(w,'g').w=null;},(w:Row)=>{Object.assign(change(w,'g'),{c:[]});}]){const bad=structuredClone(wire);mutate(bad);const before=JSON.stringify(bad);expect(accept.safeParse(bad).success).toBe(false);expect(decode(bad,row.input).status).toBe('REFUSED');expect(JSON.stringify(bad)).toBe(before);}
 const clear=structuredClone(wire);change(clear,'g').w=[];expect(accept.safeParse(clear).success).toBe(true);expect(decode(clear,row.input).status).toBe('PARSED');const setOnly=captured.find(r=>r.id==='R02'&&r.index===1)!,s=original(setOnly);change(s,'k').w=[];expect(decode(s,setOnly.input).status).toBe('REFUSED');
});

it('publishes canonical names locally for every selected compact field without adding authored values',()=>{
 let fields=0;for(const row of captured){const schema=smallContextSchemaV3(row.input).schema as unknown as {properties:{c:{properties:Record<string,Row>}}};for(const [name,alias]of Object.entries(COMPACT_KEYS.fields)){const selected=schema.properties.c.properties[alias];if(selected){fields++;expect(selected.description).toBe(`Canonical field: ${name}.`);expect(selected).not.toHaveProperty('default');expect(selected).not.toHaveProperty('const');}}}expect(fields).toBeGreaterThan(13);
});

it('keeps every compact ownership scope and selected static codebook local without changing free-string authority',()=>{
 let objects=0;for(const row of captured){const schema=smallContextSchemaV3(row.input).schema as unknown as Row,properties=schema.properties as Row,fields=properties.c;expect(schema.description).toContain('o=operation');expect((properties.q as Row).description).toBe('queryCarriers: l=list;c=calendar;b=capability');const issue=((properties.u as Row).items as Row);expect(issue.description).toContain('5=reminderDate');expect(issue.description).toContain('14=queryRange');expect(issue.description).toContain('r=reason(');for(const branch of (properties.o as Row).anyOf as Row[]){const codes=((branch.properties as Row).c as Row).enum as string[];expect(branch.description).toContain('c=code(');for(const code of codes)expect(branch.description).toContain(`${code}=`);}
 const visit=(node:unknown):void=>{if(!node||typeof node!=='object')return;const n=node as Row;if(n.type==='object'&&node!==fields){objects++;expect(typeof n.description).toBe('string');expect(n.description).not.toMatch(/U\d+|S\d+\.\d+/);if((n.description as string).startsWith('date: '))expect(n.description).toContain('c=calendar[item:');if((n.description as string).startsWith('query: ')&&Object.hasOwn(n.properties as Row,'c'))expect(n.description).toContain('c=outputCalendar[item:');}for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else visit(v);};visit(schema);
 }expect(objects).toBeGreaterThan(1000);
});
