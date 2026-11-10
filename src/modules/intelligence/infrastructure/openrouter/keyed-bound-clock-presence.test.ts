// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {extractTemporalEvidence} from '../../../semantic/temporal-evidence';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {keyedBoundReminderClockRequired} from './context-keyed-clock-correction';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';

const observed=JSON.parse(readFileSync(new URL('./__fixtures__/keyed146-r04-clock-omission-before.json',import.meta.url),'utf8'));
const input=ContextInputSchema.parse(observed.input);
it('refuses the exact captured R04 pending-clock omission without repairing its provider output',()=>{
 const before=JSON.stringify(observed);
 expect(input.turns[input.currentTurn].text).toBe('Nhắc tôi lúc 8h sáng.');
 const schema=z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]);
 expect(schema.safeParse(observed.providerWire).success).toBe(false);
 expect(decodeKeyedSmallComparison(observed.providerWire,input).status).toBe('REFUSED');
 expect(JSON.stringify(observed)).toBe(before);
});


type ClockOwner={minItems?:number;maxItems?:number;items:{properties:{write:{minItems?:number;maxItems?:number;items:{properties:{operation:{enum:string[]};value:unknown}}};evidence:unknown}}};
const clockOwner=(source:ContextInput)=>(keyedSmallComparisonSchema(source) as {properties:{changes:{properties:{owners:{properties:{reminderTime?:ClockOwner}}}}}}).properties.changes.properties.owners.properties.reminderTime;
const withText=(text:string):ContextInput=>{const source=structuredClone(input);source.turns[source.currentTurn].text=text;return source;};
const ownerValidator=(source:ContextInput)=>{const owner=clockOwner(source);expect(owner).toBeDefined();return z.fromJSONSchema(owner as Parameters<typeof z.fromJSONSchema>[0]);};
const authoredRow=(value={hour:8,minute:0,qualifier:'H24'})=>({write:[{operation:'SET',value}],evidence:['U4']});

it('retains the frozen R04 turn-two authored clock, target and evidence without filling an omitted owner',()=>{
 const before=JSON.stringify(input),canonical=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R04',2));
 expect(canonical.changes).toEqual([expect.objectContaining({field:'reminderTime',operation:'SET',value:{hour:8,minute:0,qualifier:'H24'}})]);
 const encoded=encodeKeyedSmallComparison(canonical,input);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(encoded).success).toBe(true);
 expect(decodeKeyedSmallComparison(encoded,input)).toMatchObject({status:'PARSED',value:{semantic:{changes:canonical.changes,requestTarget:canonical.requestTarget}}});
 expect(()=>encodeKeyedSmallComparison({...canonical,changes:[]},input)).toThrow();
 expect(JSON.stringify(input)).toBe(before);
});

it.each([
 'Nhắc tôi lúc 8h sáng.',
 'Nhắc mình lúc 8h sáng.',
 'Nhắc tui lúc 08:30 sáng.',
 'Nhắc lúc 0h.',
 'Nhắc tôi lúc 17:45.',
])('requires only a model-authored clock SET for the complete bound source: %s',text=>{
 const source=withText(text),before=JSON.stringify(source);
 const numericClock=/\d{1,2}(?:h(?:[0-5]\d)?|:[0-5]\d)/iu.exec(text)![0];
 expect(extractTemporalEvidence({text:numericClock,referenceNow:Date.parse(source.reference.instant)}).time).toMatchObject({state:'RESOLVED',source:'EXACT_TIME'});
 expect(keyedBoundReminderClockRequired(source)).toBe(true);
 const owner=clockOwner(source)!;expect(owner.minItems).toBe(1);expect(owner.items.properties.write.minItems).toBe(1);expect(owner.items.properties.write.items.properties.operation.enum).toEqual(['SET']);
 const validator=ownerValidator(source),row=authoredRow();
 expect(validator.safeParse([row]).success).toBe(true);
 for(const candidate of [[],[{...row,write:[]}],[{...row,write:[{operation:'REPLACE',value:row.write[0].value}]}],[{...row,evidence:[]}]])expect(validator.safeParse(candidate).success).toBe(false);
 expect(JSON.stringify(source)).toBe(before);
});

it('does not turn the scanner into a clock operand or evidence supplier',()=>{
 const source=withText('Nhắc tôi lúc 8h sáng.'),unproved=withText('Có thể nhắc tôi lúc 8h sáng.');
 expect(keyedBoundReminderClockRequired(source)).toBe(true);expect(keyedBoundReminderClockRequired(unproved)).toBe(false);
 // Presence is the only new obligation. The existing semantic verifier still
 // owns matching the model-authored clock value/evidence to the source.
 expect(ownerValidator(source).safeParse([authoredRow({hour:9,minute:45,qualifier:'H24'})]).success).toBe(true);
 expect(ownerValidator(unproved).safeParse([authoredRow({hour:9,minute:45,qualifier:'H24'})]).success).toBe(true);
 expect(typeof keyedBoundReminderClockRequired(source)).toBe('boolean');
});

it.each([
 '8h sáng.',
 'Nhắc mình lúc 8h30 sáng.',
 'Nhắc lúc 12h trưa.',
 'Nhắc tôi lúc 3h chiều.',
 'Nhắc tôi lúc 8h tối.',
 'Nhắc lúc 23h15.',
 'Nhắc tôi lúc 12h sáng.',
 'Nhắc tôi lúc 0h sáng.',
 'Nhắc tôi buổi sáng.',
 'Nhắc tôi lúc 25h sáng.',
 'Nhắc tôi lúc 8h60 sáng.',
 'Nhắc tôi lúc 08:99 sáng.',
 'Nhắc tôi lúc 8h sáng hoặc 9h sáng.',
 'Nhắc tôi lúc 8h sáng, lúc 9h sáng.',
 'Nhắc tôi lúc 8h sáng và 8h sáng.',
 '"Nhắc tôi lúc 8h sáng."',
 '“Nhắc tôi lúc 8h sáng.”',
 'Ghi chú: Nhắc tôi lúc 8h sáng.',
 'Tên việc là nhắc tôi lúc 8h sáng.',
 'Không nhắc tôi lúc 8h sáng.',
 'Đừng nhắc tôi lúc 8h sáng.',
 'Nếu nhắc tôi lúc 8h sáng.',
 'Có thể nhắc tôi lúc 8h sáng.',
 'Nhắc tôi lúc 8h sáng nhé, hoặc mai cũng được.',
 'Nhắc tôi lúc 8h sáng mai.',
 'Nhắc tôi đi khám lúc 8h sáng.',
 'Tạo nhắc mới lúc 8h sáng.',
 'Nhắc tôi lúc 8h sáng và mua thuốc.',
 'Đổi sang 8h sáng.',
 'Nhắc tôi lúc 8h sáng thay vì 9h.',
 'Nhắc tôi lúc 8h sáng?',
 'Nhắc tôi lúc 8h sáng. [CONTROL]',
 'Nhắc tôi lúc 8h sáng.\nĐổi ghi chú.',
])('declines an unproved, conservatively unresolved, quoted, negative, mixed or correction source: %s',text=>{
 const source=withText(text),before=JSON.stringify(source);expect(keyedBoundReminderClockRequired(source)).toBe(false);expect(JSON.stringify(source)).toBe(before);
});

const clockFact=(source:ContextInput):ContextInput['facts'][number]=>({alias:'f999',scope:'REMINDER',field:'reminderTime',value:{hour:8,minute:0,qualifier:'H24'},provenance:{kind:'EXPLICIT_USER'},sourceReferenceTime:source.reference.instant,dependencies:[]});
const declinedBindings:Array<[string,(source:ContextInput)=>void]>=[
 ['no active task',source=>{source.activeRequest=null;}],
 ['awaiting a preview decision',source=>{source.activeRequest!.lifecycle='AWAITING_CONFIRMATION';}],
 ['no pending question',source=>{source.pendingQuestion=null;}],
 ['wrong pending field',source=>{source.pendingQuestion!.field='eventTime';}],
 ['wrong pending scope',source=>{source.pendingQuestion!.scope='QUERY';}],
 ['pending ambiguity',source=>{source.pendingQuestion!.reason='AMBIGUOUS';}],
 ['pending conflict',source=>{source.pendingQuestion!.reason='CONFLICT';}],
 ['pending decision is not a missing-field question',source=>{source.pendingQuestion!.decisionKind='SAVE_PREVIEW';}],
 ['dangling reminder clock fact',source=>{source.facts.push(clockFact(source));}],
 ['proposed reminder clock',source=>{source.activeRequest!.slots.reminderTime={state:'PROPOSED',value:{hour:8,minute:0,qualifier:'H24'},fact:null};}],
 ['resolved reminder clock',source=>{source.facts.push(clockFact(source));source.activeRequest!.slots.reminderTime={state:'RESOLVED',value:{hour:8,minute:0,qualifier:'H24'},fact:'f999'};}],
 ['conflicting reminder clock',source=>{source.activeRequest!.slots.reminderTime={state:'CONFLICT',value:{hour:8,minute:0,qualifier:'H24'},fact:null};}],
 ['clock slot has a value despite MISSING',source=>{source.activeRequest!.slots.reminderTime.value={hour:8,minute:0,qualifier:'H24'};}],
 ['clock slot has a dangling alias',source=>{source.activeRequest!.slots.reminderTime.fact='f999';}],
 ['another retained slot conflicts',source=>{source.activeRequest!.slots.location={state:'CONFLICT',value:'Quang Trung',fact:null};}],
 ['an unresolved issue remains',source=>{source.ambiguities.push({field:'reminderTime',reason:'AMBIGUOUS',alternatives:[]});}],
 ['current turn is not final',source=>{source.turns.push({role:'ASSISTANT',text:'Một câu khác.'});}],
 ['current role is not USER',source=>{source.turns[source.currentTurn].role='ASSISTANT';}],
 ['current turn is unavailable',source=>{source.currentTurn=11;}],
 ['title is missing',source=>{source.activeRequest!.slots.title={state:'MISSING',value:null,fact:null};}],
 ['title is merely proposed',source=>{source.activeRequest!.slots.title={state:'PROPOSED',value:'đi thi',fact:null};}],
 ['title has a dangling fact alias',source=>{source.activeRequest!.slots.title.fact='f999';}],
 ['title fact is absent',source=>{source.facts=source.facts.filter(fact=>fact.field!=='title');}],
 ['title fact value does not match the slot',source=>{source.facts.find(fact=>fact.field==='title')!.value='đón khách';}],
 ['title facts are duplicated',source=>{source.facts.push({...structuredClone(source.facts.find(fact=>fact.field==='title')!),alias:'f998'});}],
 ['title fact has a different scope',source=>{source.facts=source.facts.map(fact=>fact.field==='title'?{...fact,scope:'QUERY'} as unknown as ContextInput['facts'][number]:fact);}],
 ['title was derived by policy',source=>{source.facts.find(fact=>fact.field==='title')!.provenance={kind:'DERIVED_POLICY',policyVersion:'synthetic-policy',dependencies:[],referenceTime:source.reference.instant};}],
 ['title has dependencies',source=>{source.facts.find(fact=>fact.field==='title')!.dependencies=['f2'];}],
 ['title reference is invalid',source=>{source.facts.find(fact=>fact.field==='title')!.sourceReferenceTime='invalid';}],
 ['title reference is in the future',source=>{source.facts.find(fact=>fact.field==='title')!.sourceReferenceTime='2026-09-29T03:02:00.000Z';}],
 ['current reference is invalid',source=>{source.reference.instant='invalid';}],
];
it.each(declinedBindings)('declines mandatory presence when %s',(_label,mutate)=>{
 const source=structuredClone(input);mutate(source);const before=JSON.stringify(source);
 expect(keyedBoundReminderClockRequired(source)).toBe(false);expect(JSON.stringify(source)).toBe(before);
});

it('uses the same bound-clock proof for a different explicit factual task title',()=>{
 const source=structuredClone(input);source.turns[0].text='Tôi đón khách ngày 11/10 lúc 8h.';source.activeRequest!.slots.title.value='đón khách';source.facts.find(fact=>fact.field==='title')!.value='đón khách';
 expect(ContextInputSchema.safeParse(source).success).toBe(true);expect(keyedBoundReminderClockRequired(source)).toBe(true);expect(ownerValidator(source).safeParse([]).success).toBe(false);
});
