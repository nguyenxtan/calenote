import { expect, it, vi } from "vitest";
import { createConversationService, type ConversationServiceDependencies } from "@/modules/conversation/service";
import { lunarCalendar } from "@/modules/conversation/lunar-calendar";
import type { ConversationModel } from "@/modules/conversation/contracts";

const now = Date.parse("2026-10-15T08:04:00Z");
function fixture() {
  const model: ConversationModel = { intent: "CREATE_REMINDER", title: "gọi khách", titleState: "RESOLVED", targetIntent: null,
    dialogueAct: "NEW_REQUEST", continuation: "NO", capability: null };
  const dispatch = vi.fn(async () => ({ status: "SUCCESS" as const, interpretation: model, usage: { costMicrounits: 1 } }));
  const deps: ConversationServiceDependencies = {
    contextStore: { load: async () => null, save: vi.fn(async () => "SAVED" as const), finish: async () => true, purgeExpired: async () => 0 },
    seriesStore: { findPending: async () => null, discard: async () => false, propose: vi.fn(async () => null),
      confirm: async () => ({ status: "STALE" }), proposeCancellation: async () => null, cancelRemaining: async () => "STALE" },
    commandStore: { findBoundContext: async () => null, findPendingDraft: async () => null,
      createDraft: vi.fn(async () => "CONFLICT" as const), confirmDraft: vi.fn(async () => "CONFLICT" as const), cancelDraft: async () => "CONFLICT",
      expireDraft: async () => "CONFLICT", rejectMessage: async () => true },
    runtimeStore: { ownsPendingDraft: async () => false, claimAttempt: vi.fn(async () => true), complete: vi.fn(async () => true) },
    gateway: { prepare: vi.fn(() => ({ status: "READY" as const, model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", maximumCostMicrounits: 10, dispatch })) },
    budgetStore: { reservePaidCall: vi.fn(async () => ({ status: "RESERVED" as const, reservationId: "synthetic", reservedMaximumMicrounits: 10 })),
      markDispatched: vi.fn(async () => true), finalizeUsage: vi.fn(async () => true), releaseOrExpireReservation: vi.fn(async () => true), reapExpiredReservations: async () => 0 },
    keyring: { encryptSensitive: async () => { throw new Error("Unexpected mutation"); }, decryptSensitive: async () => "synthetic" },
    now: () => now, calendar: lunarCalendar, reply: vi.fn(async () => {}), list: vi.fn(async () => []),
  };
  const handle = (text = "mai nhắc gọi khách") => createConversationService(deps).handle({ id: "inbound", connectionId: "connection", providerUserId: "provider-user",
    privateChatId: "chat", claimMarker: "claim", text, receivedAt: now }, {
    userId: "owner", chatIdentityId: "chat-identity", workspaceId: "workspace", timezone: "Asia/Ho_Chi_Minh", inboundRowId: 1,
  });
  return { deps, dispatch, handle };
}


// Regression contract: initially RED before the optional observer was implemented.
// This test defines the minimum allowlisted diagnostic contract before code.
it.each([
 {stage:'GATEWAY_PREPARE',category:'UNAVAILABLE'},
 {stage:'BUDGET_RESERVE',category:'BUDGET_EXHAUSTED'},
 {stage:'MODEL_RESULT',category:'TIMEOUT'},
 {stage:'MODEL_RESULT',category:'SCHEMA_INVALID'},
] as const)('retains correlation and $stage/$category without content',async expected=>{
 const h=fixture(),observeFailure=vi.fn();Object.assign(h.deps,{observeFailure});
 if(expected.stage==='GATEWAY_PREPARE')h.deps.gateway.prepare=vi.fn(()=>({status:'FAILURE' as const,category:'UNAVAILABLE' as const}));
 if(expected.stage==='BUDGET_RESERVE')h.deps.budgetStore.reservePaidCall=vi.fn(async()=>({status:'BUDGET_EXHAUSTED' as const}));
 if(expected.stage==='MODEL_RESULT')h.deps.gateway.prepare=vi.fn(()=>({status:'READY' as const,model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu',maximumCostMicrounits:10,dispatch:async()=>({status:'FAILURE' as const,category:expected.category})}));
 expect(await h.handle('mai 8h nhắc t gọi khách nhé')).toEqual({status:'REJECTED'});
 expect(h.deps.commandStore.createDraft).not.toHaveBeenCalled();
 expect(observeFailure).toHaveBeenCalledExactlyOnceWith({sourceInboundId:'inbound',stage:expected.stage,category:expected.category});
 expect(Object.keys(observeFailure.mock.calls[0][0]).sort()).toEqual(['category','sourceInboundId','stage']);
});

import { failureDetails, observeConversationFailure } from './failure-observation';
it.each(['sync','async'] as const)('observer %s rejection preserves reply and all budget/state operations',async mode=>{
 const baseline=fixture(),observed=fixture(),observer=vi.fn(()=>{if(mode==='sync')throw Error('private diagnostic failure');return Promise.reject(Error('private diagnostic failure'))});
 for(const h of [baseline,observed])h.deps.gateway.prepare=vi.fn(()=>({status:'FAILURE' as const,category:'UNAVAILABLE' as const}));
 observed.deps.observeFailure=observer;
 expect(await observed.handle('mai 8h nhắc t gọi khách nhé')).toEqual(await baseline.handle('mai 8h nhắc t gọi khách nhé'));
 expect(observed.deps.reply).toHaveBeenCalledWith(vi.mocked(baseline.deps.reply).mock.calls[0][0]);expect(observer).toHaveBeenCalledOnce();
 for(const h of [baseline,observed]){
  expect(h.deps.budgetStore.reservePaidCall).not.toHaveBeenCalled();expect(h.deps.commandStore.createDraft).not.toHaveBeenCalled();expect(h.deps.contextStore.save).not.toHaveBeenCalled();expect(h.deps.runtimeStore.complete).toHaveBeenCalledOnce();
 }
});
it('emits nothing before a lost completion authority fence and suppresses the reply',async()=>{
 const h=fixture(),observer=vi.fn();h.deps.observeFailure=observer;h.deps.runtimeStore.complete=vi.fn(async()=>false);
 h.deps.gateway.prepare=vi.fn(()=>({status:'FAILURE' as const,category:'UNAVAILABLE' as const}));
 expect(await h.handle()).toEqual({status:'SUPERSEDED'});expect(observer).not.toHaveBeenCalled();expect(h.deps.reply).not.toHaveBeenCalled();
});
it('successful classification/clarification emits no false failure event',async()=>{
 const h=fixture(),observer=vi.fn();h.deps.observeFailure=observer;
 expect(await h.handle('mai nhắc gọi khách')).toEqual({status:'CLARIFICATION_REQUESTED'});expect(observer).not.toHaveBeenCalled();
 expect(h.dispatch).toHaveBeenCalledOnce();expect(h.deps.budgetStore.finalizeUsage).toHaveBeenCalledOnce();
});
it('projects unknown stage/category and extra error fields without logging content',()=>{
 const observer=vi.fn(),details={stage:'SELECT private payload',category:'error with request body',error:Error('private-error')};
 // Only the finite projection is accepted; unknown values never become logs.
 observeConversationFailure(observer,'opaque-inbound',failureDetails(details.stage,details.category));
 expect(observer).toHaveBeenCalledExactlyOnceWith({sourceInboundId:'opaque-inbound',stage:'UNKNOWN_STAGE',category:'UNKNOWN_CATEGORY'});
 expect(Object.isFrozen(observer.mock.calls[0][0])).toBe(true);
 expect(JSON.stringify(observer.mock.calls)).not.toContain('private');expect(JSON.stringify(observer.mock.calls)).not.toContain('request body');
});
it.each(['private body with spaces','bad:id','<user>','x'.repeat(129)])('refuses a non-opaque correlation ID %s',id=>{
 const observer=vi.fn();observeConversationFailure(observer,id,{stage:'MODEL_RESULT',category:'TIMEOUT'});expect(observer).not.toHaveBeenCalled();
});
it('rejects invalid semantic output with metadata only instead of normalizing it',async()=>{
 const h=fixture(),observer=vi.fn();h.deps.observeFailure=observer;
 const invalid={intent:'CREATE_REMINDER' as const,title:'gọi khách',titleState:'RESOLVED' as const,targetIntent:null,dialogueAct:'NEW_REQUEST' as const,continuation:'NO' as const,capability:null,privatePayload:'untrusted content'};
 h.deps.gateway.prepare=vi.fn(()=>({status:'READY' as const,model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu',maximumCostMicrounits:10,dispatch:async()=>({status:'SUCCESS' as const,interpretation:invalid,usage:{costMicrounits:1}})}));
 expect(await h.handle('mai 8h nhắc gọi khách')).toEqual({status:'REJECTED'});
 expect(observer).toHaveBeenCalledExactlyOnceWith({sourceInboundId:'inbound',stage:'MODEL_SCHEMA',category:'SCHEMA_INVALID'});
 expect(h.deps.contextStore.save).not.toHaveBeenCalled();expect(h.deps.commandStore.createDraft).not.toHaveBeenCalled();expect(JSON.stringify(observer.mock.calls)).not.toContain('untrusted');
});
it('reports the fixed failing storage stage without exception text or a retry',async()=>{
 const h=fixture(),observer=vi.fn();h.deps.observeFailure=observer;h.deps.contextStore.load=vi.fn(async()=>{throw Error('SQL private message and secret')});
 expect(await h.handle()).toEqual({status:'REJECTED'});
 expect(observer).toHaveBeenCalledExactlyOnceWith({sourceInboundId:'inbound',stage:'CONTEXT_LOAD',category:'LOCAL_FAILURE'});
 expect(h.deps.contextStore.load).toHaveBeenCalledOnce();expect(h.deps.gateway.prepare).not.toHaveBeenCalled();expect(JSON.stringify(observer.mock.calls)).not.toContain('SQL');
});

it.each(['RATE_LIMITED', 'PROVIDER_FAILURE', 'INVALID_JSON', 'REQUIRED_FEATURE_UNSUPPORTED', 'INVALID_INPUT'] as const)(
  'retains finite gateway category %s without provider payload or altered settlement', async category => {
    const h = fixture(), observer = vi.fn();
    h.deps.observeFailure = observer;
    h.deps.gateway.prepare = () => ({status: 'READY', model: 'google/gemini-2.5-flash-lite', provider: 'google-vertex/eu', maximumCostMicrounits: 10,
      dispatch: async () => ({status: 'FAILURE', category})});
    expect(await h.handle()).toEqual({status: 'REJECTED'});
    expect(observer).toHaveBeenCalledExactlyOnceWith({sourceInboundId: 'inbound', stage: 'MODEL_RESULT', category});
    expect(h.deps.budgetStore.markDispatched).toHaveBeenCalledOnce();
    expect(h.deps.budgetStore.finalizeUsage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({actualCostMicrounits: null}));
    expect(h.deps.budgetStore.releaseOrExpireReservation).not.toHaveBeenCalled();
  },
);
it.each(['UNDERFUNDED', 'FENCE_DENIED'] as const)('does not dispatch after %s and reports the existing finite gate', async mode => {
  const h = fixture(), observer = vi.fn(); h.deps.observeFailure = observer;
  if (mode === 'UNDERFUNDED') h.deps.budgetStore.reservePaidCall = async () => ({status: 'RESERVED', reservationId: 'synthetic', reservedMaximumMicrounits: 1});
  else h.deps.budgetStore.markDispatched = vi.fn(async () => false);
  expect(await h.handle()).toEqual({status: 'REJECTED'});
  expect(h.dispatch).not.toHaveBeenCalled();
  expect(observer).toHaveBeenCalledExactlyOnceWith({sourceInboundId: 'inbound',
    stage: mode === 'UNDERFUNDED' ? 'BUDGET_FUNDING' : 'DISPATCH_FENCE',
    category: mode === 'UNDERFUNDED' ? 'RESERVATION_UNDERFUNDED' : 'DISPATCH_FENCE_DENIED'});
  expect(h.deps.budgetStore.finalizeUsage).not.toHaveBeenCalled();
});
it('labels a local month reader exception at the read-only boundary, without calling AI', async () => {
  const h = fixture(), observer = vi.fn(); h.deps.observeFailure = observer;
  h.deps.listMonth = async () => { throw Error('private month payload'); };
  expect(await h.handle('xem lịch tháng này')).toEqual({status: 'REJECTED'});
  expect(observer).toHaveBeenCalledExactlyOnceWith({sourceInboundId: 'inbound', stage: 'READ_ONLY_QUERY', category: 'LOCAL_FAILURE'});
  expect(h.deps.gateway.prepare).not.toHaveBeenCalled();
  expect(h.deps.budgetStore.reservePaidCall).not.toHaveBeenCalled();
  expect(JSON.stringify(observer.mock.calls)).not.toContain('private month');
});
