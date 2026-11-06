// @vitest-environment node
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {googleLiteEuTypedContextValidationSchemaV3,googleLiteEuTypedContextWireSchemaV3} from './context-provider-typed-wire';
import {preDurationSchemaFixture} from '../../../../../tools/benchmark/context-singleton-json.test-support';
import {expandTypedSchemaReferences} from '../../../../../tools/benchmark/context-typed-grammar-audit';

const frozen=JSON.parse(readFileSync(new URL('./__fixtures__/typed105-r01-before.json',import.meta.url),'utf8'));
const qualified=JSON.parse(readFileSync(new URL('./__fixtures__/typed106-hour-minute-qualification.json',import.meta.url),'utf8'));
const rejected=JSON.parse(readFileSync(new URL('./__fixtures__/typed105-6e-r01-generation.json',import.meta.url),'utf8'));
const itemSchema=(schema:unknown)=>{
 const expanded=expandTypedSchemaReferences(schema) as {properties:{uncertainties:{items:Parameters<typeof z.fromJSONSchema>[0]}}};
 return z.fromJSONSchema(expanded.properties.uncertainties.items);
};
const evidence={primaryEvidence:'U0',additionalEvidence:[]};
const issue=(fieldCode:number,values:unknown[],reason='AMBIGUOUS')=>({fieldCode,reason,alternatives:values.map(value=>({value,evidence}))});
const date={kind:'RELATIVE_DAY',offsetDays:1},time={hour:9,minute:30,qualifier:'H24'},period={kind:'DAY',date};

it('keeps each uncertainty field bound to its value type instead of the rejected ten-way array union',()=>{
 expect(createHash('sha256').update(JSON.stringify(rejected)).digest('hex')).toBe('1acd89496b1540b1e35f29e9d4612d892bd4cec4417054e4cdf19fbe7af23552');
 const before=itemSchema(rejected),after=itemSchema(googleLiteEuTypedContextWireSchemaV3(frozen.input).schema);
 // Hand-selected invalid cross-field values are admitted by the actual rejected grammar.
 for(const candidate of [issue(11,[date]),issue(11,[2,date]),issue(3,[2]),issue(4,[period]),issue(14,[time]),issue(0,[date])]){
  expect(before.safeParse(candidate).success).toBe(true);
  expect(after.safeParse(candidate).success,JSON.stringify(candidate)).toBe(false);
 }
 for(const candidate of [issue(11,[2]),issue(3,[date]),issue(4,[time]),issue(14,[period]),issue(0,['title'])])expect(after.safeParse(candidate).success,JSON.stringify(candidate)).toBe(true);
});

it('retains strict-valid field/reason/value combinations and input-selected code holes',()=>{
 const r02={...frozen.input,turns:[{role:'USER',text:'Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.'}]};
 const values=[null,-1,0,1,2,30,31,366,367,'title','CURRENT','NEW','ONCE','FINITE_DAILY','BEFORE_EVENT','GREGORIAN','HELP',date,time,period,{kind:'DATE_BOUNDS',from:date,through:date}];
 for(const input of [frozen.input,r02]){
  const strict=itemSchema(googleLiteEuTypedContextValidationSchemaV3(input).schema),generation=itemSchema(googleLiteEuTypedContextWireSchemaV3(input).schema),historical=input===frozen.input?itemSchema(frozen.schema):null;
  let retained=0,rejectedCrossType=0;
  for(let field=0;field<=18;field++)for(const reason of ['MISSING','AMBIGUOUS','CONFLICT','UNSUPPORTED_COMBINATION'])for(const value of values){
   const candidate=issue(field,[value],reason);
   if(historical&&field<=15)expect(strict.safeParse(candidate).success,`historical V1 ${JSON.stringify(candidate)}`).toBe(historical.safeParse(candidate).success);
   if(strict.safeParse(candidate).success){retained++;expect(generation.safeParse(candidate).success,JSON.stringify(candidate)).toBe(true);}
   else if(!generation.safeParse(candidate).success)rejectedCrossType++;
  }
  expect(retained).toBeGreaterThan(50);expect(rejectedCrossType).toBeGreaterThan(500);
 }
 const selected=itemSchema(googleLiteEuTypedContextWireSchemaV3(r02).schema);
 for(const code of [8,9,10,11,18])expect(selected.safeParse(issue(code,[],'MISSING')).success).toBe(false);
 // This complete day/count source cannot author an hour/minute issue. The
 // generic source still retains those correctly typed successor alternatives.
 const generic=itemSchema(googleLiteEuTypedContextWireSchemaV3(frozen.input).schema);
 for(const code of [16,17]){expect(selected.safeParse(issue(code,[2])).success).toBe(false);expect(generic.safeParse(issue(code,[2])).success).toBe(true);expect(generic.safeParse(issue(code,['2'])).success).toBe(false);}
});

it('isolates the historical correlation change through an explicit pre-duration specimen and pins current strict acceptance',()=>{
 const selected=googleLiteEuTypedContextWireSchemaV3(frozen.input).schema;
 const before=expandTypedSchemaReferences(rejected) as {properties:Record<string,unknown>};
 const after=expandTypedSchemaReferences(selected) as typeof before;
 const {uncertainties:oldItems,...oldProperties}=before.properties;
 const {uncertainties:newItems,...newProperties}=after.properties;
 expect(newItems).not.toEqual(oldItems);
 expect(preDurationSchemaFixture({...after,properties:newProperties})).toEqual({...before,properties:oldProperties});
 const strict=googleLiteEuTypedContextValidationSchemaV3(frozen.input).schema;
 // The captured typed105 specimen and the later qualified strict schema are
 // separate historical artifacts; neither hash is relabelled as current.
 expect(createHash('sha256').update(JSON.stringify(frozen.schema)).digest('hex')).toBe('ea72396f909182cdc4bbe22365212c60c86246401a8d82feb154982242a4f633');
 expect(qualified.previousSha256).toBe('0363d0b00e38f19c6cedc652eb97a2906b0129af7fce38e1ccd620adb5081f14');
 expect(createHash('sha256').update(JSON.stringify(strict)).digest('hex')).toBe(qualified.sha256);
});
