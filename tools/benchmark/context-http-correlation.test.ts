// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeObservableCampaign} from './context-contract-runner';
import {readCampaignLedger} from './context-contract-live';
import {createContextHttpTransport} from '../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway';
it('real runner persists bounded observed header correlation when a mocked body fails, leaving cost unknown',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'calenote-local-correlation-'));let calls=0;const requestId='req-0123456789abcdef';
 try{const result=await executeObservableCampaign({directory,sourceSha:'a'.repeat(40),provenanceDigest:'b'.repeat(64),runId:'local-mock-only',profile:'PILOT',cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,now:()=>100,transport:createContextHttpTransport('PRIVATE_CREDENTIAL',async()=>{calls++;return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('PRIVATE_PARTIAL_BODY'));queueMicrotask(()=>controller.error(new Error('PRIVATE_STREAM_ERROR')))}}),{headers:{'content-type':'application/json','x-request-id':requestId,'set-cookie':'PRIVATE_COOKIE','x-generation-id':'PRIVATE_UNOBSERVED_GENERATION'}})})});
 expect(result.status).toBe('STOP');expect(calls).toBe(1);expect(result.responses[0]).toMatchObject({status:'FAILURE',category:'PROVIDER_FAILURE',usage:{costMicrounits:null},transportDiagnostics:{httpResponse:{httpStatus:200,requestId}}});
 const ledger=readCampaignLedger(directory);expect(ledger.filter(r=>r.event==='DISPATCH')).toHaveLength(1);expect(ledger.find(r=>r.event==='FINISH')).toMatchObject({observedMicrounits:null});
 for(const file of ['responses.json','report.json']){const text=readFileSync(join(directory,file),'utf8');expect(text).toContain(requestId);for(const secret of ['PRIVATE_CREDENTIAL','PRIVATE_PARTIAL_BODY','PRIVATE_STREAM_ERROR','PRIVATE_COOKIE','PRIVATE_UNOBSERVED_GENERATION'])expect(text).not.toContain(secret)}
 }finally{rmSync(directory,{recursive:true,force:true})}
});
