// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {createContextContractProbe,runContextFixtureCampaign} from './context-contract-probe';
import {frozenContextProposal} from './context-pointer-fixtures';
import {admitContextManifest,expandContextCampaign,type ContextManifest} from './context-contract';
import {serializeContextRequest,serializeWire110ContextRequestReference} from '../../src/modules/conversation/context-contract/wire';
import {ConversationInterpretationSchema,type ContextInput} from '../../src/modules/conversation/context-contract/contracts';
import {UNCERTAINTY_FIELD_WIRE_CODE_V1 as codes} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire';
import * as selected from '../../src/modules/intelligence/infrastructure/openrouter/context-literal-insertion-wire';
import {initialDateClockUncertaintyProof} from '../../src/modules/intelligence/infrastructure/openrouter/initial-date-clock-uncertainty';
import {CONTEXT_PROTOCOL_V3} from '../../src/modules/conversation/context-contract/protocol';
it('all163 actual contexts preserve correlated domains except certified112 exclusions and historical110 decoder inverse',async()=>{
 const all=['regressions','development','heldout'].map(name=>admitContextManifest(JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`,'utf8'))));let contexts=0,membershipChecks=0;
 function compare(input:ContextInput,proposal:Parameters<typeof selected.encodeGoogleLiteEuContextV3>[0]){
  contexts++;const proof=initialDateClockUncertaintyProof(input);const old=serializeWire110ContextRequestReference(input),current=serializeContextRequest(input);expect(current.messages[1].content).toBe(old.messages[1].content);
  const a=structuredClone(old.response_format.json_schema.schema) as unknown as Record<string,unknown>,b=structuredClone(current.response_format.json_schema.schema) as unknown as Record<string,unknown>;
  const inline=(value:unknown,root:unknown):unknown=>Array.isArray(value)?value.map(v=>inline(v,root)):!value||typeof value!=='object'?value:typeof (value as {$ref?:string}).$ref==='string'?inline((value as {$ref:string}).$ref.slice(2).split('/').reduce((p,k)=>(p as Record<string,unknown>)[k],root),root):Object.fromEntries(Object.entries(value).filter(([k])=>k!=='$defs').map(([k,v])=>[k,inline(v,root)]));
  function visit(left:Record<string,unknown>,right:Record<string,unknown>){const lp=left.properties as Record<string,unknown>|undefined,rp=right.properties as Record<string,unknown>|undefined;if(lp?.fieldCode){const oldBranch=z.fromJSONSchema(inline(left,a) as Parameters<typeof z.fromJSONSchema>[0]),newBranch=z.fromJSONSchema(inline(right,b) as Parameters<typeof z.fromJSONSchema>[0]);for(const[field,code]of Object.entries(codes))for(const reason of ['MISSING','AMBIGUOUS','CONFLICT','UNSUPPORTED_COMBINATION'])for(const alternatives of [[],['{}'],['{}','{}']]){expect(newBranch.safeParse({fieldCode:field,reason,alternatives}).success).toBe(oldBranch.safeParse({fieldCode:code,reason,alternatives}).success&&!(proof.eventDateMissingExcluded&&field==='eventDate'&&reason==='MISSING')&&!(proof.eventTimeUncertaintyAbsent&&field==='eventTime'));membershipChecks++}delete lp.fieldCode;delete rp!.fieldCode;}for(const[key,value]of Object.entries(left))if(value&&typeof value==='object'){const other=right[key];if(Array.isArray(value))value.forEach((v,i)=>{if(v&&typeof v==='object')visit(v,(other as Array<Record<string,unknown>>)[i])});else visit(value as Record<string,unknown>,other as Record<string,unknown>)}}
  visit(a,b);expect(b).toEqual(a);
  const historical=selected.encodeGoogleLiteEuContextReference110(proposal,input),wire=selected.encodeGoogleLiteEuContextV3(proposal,input);expect(selected.decodeGoogleLiteEuContextTransportV3(wire,CONTEXT_PROTOCOL_V3,undefined,undefined,input)).toEqual(selected.decodeGoogleLiteEuContextTransportReference110(historical,CONTEXT_PROTOCOL_V3,undefined,undefined,input));
 }
 for(const script of all.slice(0,2).flatMap(m=>m.cases).filter(c=>['R02','R07','R14','D01','D02','D06','D07'].includes(c.id))){let index=0;const probe=await createContextContractProbe({sourceSha:'a'.repeat(40),referenceNow:Date.parse(script.turns[0].receipt)},input=>{const proposal=ConversationInterpretationSchema.parse(frozenContextProposal(input,script.id,index));compare(input,proposal);return proposal});try{for(const t of script.turns){await probe.turn(t.text,t.receipt);index++}}finally{probe.dispose()}}
 const planned=expandContextCampaign({version:'context-contract-corpus-1',cases:all.flatMap(m=>m.cases)} as ContextManifest,'FULL');await runContextFixtureCampaign(planned,{sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z')},(input,id,index)=>{const proposal=frozenContextProposal(input,id,index),parsed=ConversationInterpretationSchema.safeParse(proposal);if(parsed.success)compare(input,parsed.data);return proposal});expect(contexts).toBe(163);expect(membershipChecks).toBe(40896);
},60000);
