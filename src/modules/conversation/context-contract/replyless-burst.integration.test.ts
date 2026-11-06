// @vitest-environment node
import {expect,it} from 'vitest';
import {harness} from './service-test-support';
import {buildContextInputV2} from './context';
import {chat,message} from './context-test-fixtures';
it('atomically retains an individual USER receipt without a reply and replays the same transition once',async()=>{
 const h=await harness([]),scope=h.f.scope(0),observed=await h.deps.store.observe(scope);
 if('failure' in observed)throw Error(observed.failure);
 const built=buildContextInputV2({message:{...message('Nhắc họp QA'),id:scope.sourceInboundId,receivedAt:scope.now,claimMarker:scope.claimMarker},context:{...chat,inboundRowId:observed.observation.inbound.rowid},snapshot:null,observation:observed.observation});
 expect(built.status).toBe('READY');if(built.status!=='READY')return;
 const transition={expectedContextRevision:null,expectedDraftRevision:null,snapshot:built.candidateSnapshot,preview:null,terminal:null,inboundOutcome:'PROCESSED' as const};
 expect(await h.deps.store.apply(scope,observed.observation,transition)).toMatchObject({status:'APPLIED'});
 expect(await h.deps.store.apply(scope,observed.observation,transition)).toMatchObject({status:'IDEMPOTENT'});
 const next=await h.read(1);expect(next).toMatchObject({lifecycle:'NONE',requestId:null,transcript:[{role:'USER',id:scope.sourceInboundId,receivedAt:new Date(scope.now).toISOString(),text:'Nhắc họp QA'}]});
 expect(next?.pendingDecision).toBeNull();expect(h.replies).toHaveLength(0);expect(h.inputs).toHaveLength(0);
});
