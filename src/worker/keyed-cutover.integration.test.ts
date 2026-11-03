// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as release from './release-runtime';
import {createRuntimeOperations} from './composition-root';
import * as inbound from '@/modules/inbound/processor';
import {fixture,now} from '@/modules/conversation/context-contract/infrastructure/d1/test-support';
import {createD1ContextContractStoreV3} from '@/modules/conversation/context-contract/infrastructure/d1/store';
import {CONTEXT_PROTOCOL_V3} from '@/modules/conversation/context-contract/protocol';
import {ContextSnapshotV2Schema} from '@/modules/conversation/context-contract/state';
const close:Array<()=>void>=[];
afterEach(()=>{vi.restoreAllMocks();for(const done of close.splice(0))done();});
const metadata={id:'50e1bffb-0bdd-4125-8ae6-8dc40f1a25fd',tag:'a'.repeat(40)};
function environment(db:D1Database):Env{return {DB:db,JOBS:{send:async()=>{}},ASSETS:{fetch:async()=>new Response('')},APP_ORIGIN:'https://calenote.iconiclogs.com',CALENOTE_RUNTIME_ENVIRONMENT:'production',CALENOTE_MASTER_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',AI_MODE:'privacy',OPENROUTER_API_KEY:'synthetic-key',OPENROUTER_PRIVACY_MODEL:'openai/gpt-5-mini',OPENROUTER_PRIVACY_PROVIDER:'azure/swedencentral',AI_TIMEOUT_MS:'45000',AI_MAX_OUTPUT_TOKENS:'3072',AI_MAX_INPUT_CHARS:'1800',AI_MAX_PRIVACY_PRICE:'2.2',CF_VERSION_METADATA:metadata} as unknown as Env;}
function capabilities(env:{AI_MODE?:unknown;CF_VERSION_METADATA?:unknown;OPENROUTER_PRIVACY_MODEL?:unknown;OPENROUTER_PRIVACY_PROVIDER?:unknown}){const fn=Reflect.get(release,'contextRuntimeCapabilities');expect(fn).toBeTypeOf('function');return fn(env);}
it('selects the successor only for the qualified route and real version metadata with a full commit tag',()=>{
 const env=environment({} as D1Database);expect(capabilities(env)).toEqual({contextContract:'calenote-context-2',sourceSha:'a'.repeat(40)});
 for(const patch of [{CF_VERSION_METADATA:undefined},{CF_VERSION_METADATA:{id:metadata.id,tag:'a'.repeat(64)}},{CF_VERSION_METADATA:{tag:metadata.tag}},{OPENROUTER_PRIVACY_PROVIDER:'azure'},{OPENROUTER_PRIVACY_MODEL:'google/gemini-2.5-flash-lite'}])expect(capabilities({...env,...patch})).toEqual({});
 // AI off disables inference in the parser, while existing previews and local
 // confirmation authority remain available under the same storage contract.
 expect(capabilities({...env,AI_MODE:'off'})).toEqual({contextContract:'calenote-context-2',sourceSha:'a'.repeat(40)});
});
it('composes a real atomic reservation equal to the keyed gateway maximum',async()=>{
 const f=await fixture();close.push(f.close);vi.spyOn(Date,'now').mockReturnValue(now+1);
 let selected:Parameters<typeof inbound.processInbound>[1]['contextContract'];
 vi.spyOn(inbound,'processInbound').mockImplementation(async(_id,deps)=>{selected=deps.contextContract;return {status:'REJECTED'};});
 const env=environment(f.db);await(await createRuntimeOperations(env,{conversationV2:true,contextContract:'calenote-context-2',sourceSha:metadata.tag})).processInbound('old');
 expect(selected).toBeDefined();if(!selected)throw Error('missing context');
 const input=JSON.parse(readFileSync(new URL('../modules/intelligence/infrastructure/openrouter/__fixtures__/keyed139-qualified-request-hashes.json',import.meta.url),'utf8'))[0].input;
 const attempt=selected.gateway.prepare('PRIMARY',input);expect(attempt).toMatchObject({status:'READY',maximumCostMicrounits:116759});
 const reserved=await selected.budgetStore.reservePaidCall({ownerId:'owner',sourceInboundId:'old',now:now+1});expect(reserved).toMatchObject({status:'RESERVED',reservedMaximumMicrounits:116759});
 expect(await f.db.prepare("SELECT reserved_microunits FROM semantic_budget_windows WHERE kind='USER_MONTHLY' AND scope_id='owner'").first('reserved_microunits')).toBe(116759);
});
it.each([{OWNER_DAILY_CALL_LIMIT:'1'},{OWNER_MONTHLY_COST_MICROUNITS:'116759'},{GLOBAL_DAILY_COST_MICROUNITS:'116759'}])('enforces current production configuration and atomic contention at tightened limit %j',async override=>{
 const f=await fixture();close.push(f.close);vi.spyOn(Date,'now').mockReturnValue(now+1);
 let selected:Parameters<typeof inbound.processInbound>[1]['contextContract'];
 vi.spyOn(inbound,'processInbound').mockImplementation(async(_id,deps)=>{selected=deps.contextContract;return {status:'REJECTED'};});
 const vars=JSON.parse(readFileSync('wrangler.jsonc','utf8')).vars;
 const env={...environment(f.db),...vars,...override} as Env;
 await(await createRuntimeOperations(env,{conversationV2:true,contextContract:'calenote-context-2',sourceSha:metadata.tag})).processInbound('old');
 if(!selected)throw Error('missing context');
 const outcomes=await Promise.all(['old','in-1'].map(sourceInboundId=>selected!.budgetStore.reservePaidCall({ownerId:'owner',sourceInboundId,now:now+1})));
 expect(outcomes.filter(result=>result.status==='RESERVED')).toEqual([expect.objectContaining({reservedMaximumMicrounits:116759})]);
 expect(outcomes.filter(result=>result.status==='BUDGET_EXHAUSTED')).toHaveLength(1);
 expect(await f.db.prepare('SELECT count(*) n FROM semantic_budget_reservations').first('n')).toBe(1);
});
it('expires successor state and releases ownership through the actual scheduled cleanup composition',async()=>{
 const f=await fixture();close.push(f.close);vi.spyOn(Date,'now').mockReturnValue(now+1);
 const store=createD1ContextContractStoreV3({db:f.db,keyring:f.keyring,protocol:CONTEXT_PROTOCOL_V3});const observed=await store.observe(f.scope());if('failure'in observed)throw Error(observed.failure);
 const snapshot=ContextSnapshotV2Schema.parse({...f.snapshot,schemaVersion:'calenote-context-state-2',pendingSemanticCandidate:null});
 expect(await store.apply(f.scope(),observed.observation,{...f.transition,snapshot})).toMatchObject({status:'APPLIED'});
 const ops=await createRuntimeOperations(environment(f.db),{conversationV2:true,contextContract:'calenote-context-2',sourceSha:metadata.tag});
 await ops.purgeConversationContexts!(now+3_600_000,100);
 expect(await f.db.prepare("SELECT status,payload_ciphertext FROM conversation_contexts WHERE contract_version=2").first()).toMatchObject({status:'EXPIRED',payload_ciphertext:null});
 expect(await f.db.prepare('SELECT count(*) n FROM conversation_contract_ownership').first('n')).toBe(0);
});
