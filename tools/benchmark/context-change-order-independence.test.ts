// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {ConversationInterpretationV3Schema,SLOT_NAMES} from '../../src/modules/conversation/context-contract/contracts';
import {admitCanonicalCampaign,scoreContextCampaign,type ContextManifest} from './context-contract';
import {runContextFixtureCampaign} from './context-contract-probe';
import {frozenContextProposal} from './context-contract-fixtures';
const manifest:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(n=>JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${n}.json`,'utf8')).cases)};
it.each(['REVERSED','SLOT_ORDER'] as const)('retains the full corpus business oracle and future-turn evidence under %s writes',async mode=>{
 const planned=admitCanonicalCampaign(manifest,'FULL');let changes=0;
 const observations=await runContextFixtureCampaign(planned,{sourceSha:'a'.repeat(40),referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106'},(input,id,index)=>{
  const raw=frozenContextProposal(input,id,index),parsed=ConversationInterpretationV3Schema.safeParse(raw);if(!parsed.success)return raw;
  const reordered=[...parsed.data.changes];if(mode==='REVERSED')reordered.reverse();else reordered.sort((a,b)=>SLOT_NAMES.indexOf(a.field)-SLOT_NAMES.indexOf(b.field));
  if(JSON.stringify(reordered)!==JSON.stringify(parsed.data.changes))changes++;
  return {...parsed.data,changes:reordered};
 });
 const score=scoreContextCampaign(planned,observations);expect(score).toMatchObject({gate:'PASS',passedScripts:80,healthyFullSchemaValid:144,failedScripts:[],safetyFailures:0});expect(changes).toBeGreaterThan(20);
},30000);
