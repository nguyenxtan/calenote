// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {z} from 'zod';
import {ContextInputSchema,ConversationInterpretationV3Schema,type ContextInput} from '../../../conversation/context-contract/contracts';
import {createContextContractProbe} from '../../../../../tools/benchmark/context-contract-probe';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {resolveQuery} from '../../../conversation/context-contract/query';
import {lunarCalendar} from '../../../conversation/lunar-calendar';
import {isInitialRelativeCalendarQuestion} from '../../../conversation/context-contract/relative-calendar-source';
import {buildContextInputV2} from '../../../conversation/context-contract/context';
import {validateEvidenceV3} from '../../../conversation/context-contract/evidence';
import {chat,message,observation} from '../../../conversation/context-contract/context-test-fixtures';
import {SemanticPatchProposalV3Schema} from '../../../conversation/context-contract/contracts';
import {createKeyedContextContractGateway} from './keyed-context-gateway';
import {decodeKeyedSmallComparison,encodeKeyedSmallComparison,keyedSmallComparisonSchema} from './context-provider-keyed-small-wire';

type Wire={operation:{code:string;query:Array<{date:Array<Record<string,unknown>>;outputCalendar:string|null;evidence:string[]}>}};
interface Frame {id:string;eligible:boolean;input:ContextInput;schemaSha256?:string;expectedSchemaSha256?:string;schemaError?:{name:string;messageSha256:string}}
const before=JSON.parse(readFileSync(new URL('./__fixtures__/keyed158-relative-calendar-before.json',import.meta.url),'utf8')) as {
 input:ContextInput;proposal:unknown;badWire:Wire;cases:Frame[];
};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fresh=()=>ContextInputSchema.parse(structuredClone(before.input));
const good=()=>ConversationInterpretationV3Schema.parse(structuredClone(before.proposal));
const envelope=(wire:unknown)=>({status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:0,prompt_tokens:8000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})});

it('refuses a reconstructed civil-year emission for the relative calendar question without rewriting it',()=>{
 const input=fresh(),wire=structuredClone(before.badWire),original=JSON.stringify(wire);
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(false);
 expect(decodeKeyedSmallComparison(wire,input).status).toBe('REFUSED');
 expect(JSON.stringify(wire)).toBe(original);
});

it.each(['CIVIL_DATE','WEEKDAY','RELATIVE_MONTH'])('excludes unsupported date representation %s from the certified query',kind=>{
 const input=fresh(),wire=encodeKeyedSmallComparison(good(),input) as Wire;
 wire.operation.query[0].date[0].kind=kind;
 expect(z.fromJSONSchema(keyedSmallComparisonSchema(input) as Parameters<typeof z.fromJSONSchema>[0]).safeParse(wire).success).toBe(false);
 expect(decodeKeyedSmallComparison(wire,input).status).toBe('REFUSED');
});

it.each(before.cases)('limits the date-family schema delta to the certified frame $id',row=>{
 const original=JSON.stringify(row.input);
 if(row.schemaError){let caught:unknown;try{keyedSmallComparisonSchema(row.input);}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(Error);expect((caught as Error).name).toBe(row.schemaError.name);expect(hash((caught as Error).message)).toBe(row.schemaError.messageSha256);
 }else expect(hash(keyedSmallComparisonSchema(row.input))).toBe(row.eligible?row.expectedSchemaSha256:row.schemaSha256);
 expect(JSON.stringify(row.input)).toBe(original);
});

it.each(before.cases)('declines unproven source eligibility even before transport validation: $id',row=>{
 expect(isInitialRelativeCalendarQuestion(row.input)).toBe(row.eligible);
});

async function service(query:Record<string,unknown>,options:{keyed?:boolean;text?:string}={}){
 const text=options.text??before.input.turns[0].text,receipt=before.input.reference.instant;
 const proposal=(input:ContextInput)=>{
  const value=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R16',0));
  value.query={...value.query,...query} as typeof value.query;return value;
 };
 const gateway=createKeyedContextContractGateway(async request=>{
  const raw=JSON.parse(request.messages[1].content);for(const key of ['numericOwnership','fieldCapability','evidenceSources'])delete raw[key];
  const input=ContextInputSchema.parse(raw);return envelope(encodeKeyedSmallComparison(proposal(input),input));
 },{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(receipt),...(options.keyed?{liveBudgetProfile:'GPT5_MINI_AZURE_SWEDEN' as const,liveGateway:{...gateway,contextWire:'KEYED_COMPARISON_137' as const}}:{})},proposal);
 try{return await probe.turn(text,receipt);}finally{probe.dispose();}
}

it('round-trips the correct authored relative date and returns the backend lunar conversion without saving',async()=>{
 const input=fresh(),proposal=good();
 expect(decodeKeyedSmallComparison(encodeKeyedSmallComparison(proposal,input),input)).toMatchObject({status:'PARSED',value:{semantic:{query:proposal.query}}});
 const actual=await service({}, {keyed:true});
 expect(actual.status).toBe('REMINDERS_LISTED');expect(actual.selectedText).toContain('2026-09-28');expect(actual.selectedText).toContain('18/8/2026');
 expect(actual.mutations).toBe(0);expect(actual.dispatches).toBe(1);
});

it.each([
 {name:'wrong day',query:{date:{kind:'RELATIVE_DAY',offsetDays:1}}},
 {name:'wrong calendar',query:{outputCalendar:'GREGORIAN'}},
 {name:'civil date without a year',query:{date:{kind:'CIVIL_DATE',calendar:'GREGORIAN',day:28,month:9,year:null,leapMonth:null}}},
])('rejects $name at evidence validation independently of the generation schema',async({query})=>{
 const actual=await service(query);
 expect(actual.status).toBe('REJECTED');expect(actual.mutations).toBe(0);
 expect(actual.downstreamDiagnostics).toContainEqual({stage:'EVIDENCE',result:'REJECTED',reason:'CALENDAR_OPERAND_NOT_SUPPORTED'});
});

it.each(['âm lịch','Hôm nay'])('requires citations covering both authored operand cues: %s',quote=>{
 const msg=message(before.input.turns[0].text),built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
 if(built.status!=='READY')throw Error(built.reason);
 const proposal=good();proposal.query!.evidence=[{kind:'USER_QUOTE',turn:0,quote,occurrence:1}];
 const semantic=Object.fromEntries(Object.entries(proposal).filter(([key])=>!['conversationDirective','replyProposal'].includes(key)));
 expect(validateEvidenceV3(SemanticPatchProposalV3Schema.parse(semantic),built)).toEqual({status:'REFUSED',reason:'CALENDAR_OPERAND_NOT_SUPPORTED'});
});

it.each([
 {text:'Hôm qua là ngày mấy âm lịch?',date:{kind:'RELATIVE_DAY',offsetDays:-1},outputCalendar:'LUNAR_VN'},
 {text:'Ngày mai là ngày mấy dương lịch?',date:{kind:'RELATIVE_DAY',offsetDays:1},outputCalendar:'GREGORIAN'},
])('accepts the source-supported authored operands for $text',async({text,date,outputCalendar})=>{
 const actual=await service({date,outputCalendar},{keyed:true,text});expect(actual.status).toBe('REMINDERS_LISTED');expect(actual.mutations).toBe(0);
});

it.each([{date:null},{outputCalendar:null}])('preserves honest missing query operands $date $outputCalendar',query=>{
 const input=fresh(),proposal=good();proposal.query={...proposal.query,...query} as typeof proposal.query;
 proposal.uncertainties=[{field:'queryRange',reason:'MISSING',alternatives:[]}];
 expect(decodeKeyedSmallComparison(encodeKeyedSmallComparison(proposal,input),input)).toMatchObject({status:'PARSED',value:{semantic:{query:proposal.query}}});
 expect(resolveQuery(proposal.query!,Date.parse(input.reference.instant),lunarCalendar)).toMatchObject({status:'CLARIFY',reason:'MISSING_CALENDAR_OPERAND'});
});
