// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { semanticRuntime } from '@/modules/semantic/infrastructure/d1/runtime.test-support';
import { migrationStatements } from '@/testing/sqlite-d1.test-support';
import { createKeyring } from '@/modules/security/keyring';
import { D1CalendarSyncStore } from './store';
import { SYNC_LEASE_MS } from './contracts';

it('actual Workerd D1 enforces nonce, claim, unresolved egress and disconnect CAS fences under migration 0025',async()=>{
 const {db,runtime}=await semanticRuntime();
 try{
  for(const file of readdirSync('migrations').filter(name=>name.endsWith('.sql')).sort()){
   for(const sql of migrationStatements(readFileSync('migrations/'+file,'utf8'))){if(sql.replace(/--[^\n]*/gu,'').trim())await db.prepare(sql).run();}
  }
  const now=1_800_000_000_000;const principal={userId:'owner',sessionId:'session',expiresAt:now+86_400_000};
  await db.batch([
   db.prepare("INSERT INTO users VALUES ('owner','owner@example.invalid','Owner','Asia/Ho_Chi_Minh',1,1)"),
   db.prepare("INSERT INTO sessions VALUES ('session','owner','session-digest',?,NULL,1)").bind(principal.expiresAt),
  ]);
  const store=new D1CalendarSyncStore(db);const keyring=await createKeyring('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  expect(await store.putNonce(principal,await keyring.digestCode('fixture-nonce'),now+300000,now)).toBe(true);
  const nonce=await keyring.digestCode('fixture-nonce');
  expect((await Promise.all([store.consumeNonce(principal,nonce,now),store.consumeNonce(principal,nonce,now)])).filter(Boolean)).toHaveLength(1);
  const auth=await store.reserveAuthorization(principal,'calendar-connection','auth-marker',now);expect(auth).not.toBeNull();
  const encrypted=await keyring.encryptSensitive('calendar-oauth-tokens','calendar-connection:1',1,JSON.stringify({accessToken:'mock-access',refreshToken:'mock-refresh',expiresAt:now+3600000}));
  expect(await store.saveAuthorization(auth!,'auth-marker',encrypted,principal,now)).toBe(true);await store.release(auth!.id,'auth-marker');
  const claims=await Promise.all([store.claim(auth!.id,'claim-a',now),store.claim(auth!.id,'claim-b',now)]);
  expect(claims.filter(Boolean)).toHaveLength(1);const winner=claims.find(Boolean)!;const marker=winner.lease_marker!;
  expect(await store.reserveEgress(winner.id,marker,'in-flight',now+1)).toBe(true);
  const later=now+SYNC_LEASE_MS+1;
  expect(await store.claim(winner.id,'cannot-reclaim',later)).toBeNull();expect(await store.beginDisconnect(winner,'cannot-disconnect',later)).toBe(false);
  await store.finishEgress(winner.id,'wrong-marker','in-flight');expect((await store.find(winner.id))?.egress_marker).toBe('in-flight');
  await store.finishEgress(winner.id,marker,'in-flight');const successor=await store.claim(winner.id,'new-claim',later);expect(successor?.lease_marker).toBe('new-claim');
  expect(await store.activate(winner.id,marker,'foreign-calendar',later+1)).toBe(false);
  expect(await store.prepareMapping(winner.id,marker,'logical','cn01234','digest','UPSERT',later+1)).toBe(false);
  expect(await store.prepareMapping(winner.id,'new-claim','logical','cn01234','digest','UPSERT',later+1)).toBe(true);
  expect((await store.mappings(winner.id,'new-claim',['logical','absent'],later+1)).get('logical')).toMatchObject({remote_event_id:'cn01234',state:'WRITING'});
  expect((await store.mappings(winner.id,'wrong-marker',['logical'],later+1)).size).toBe(0);
  expect(await store.beginDisconnect(winner,'still-live',later+1)).toBe(false);await store.release(winner.id,'new-claim');
  await db.prepare("CREATE TRIGGER reject_calendar_audit BEFORE INSERT ON audit_events WHEN NEW.action='CALENDAR_DISCONNECTED' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END").run();
  await expect(store.beginDisconnect(winner,'audit-fails',later+2)).rejects.toThrow();
  const unchanged=await store.find(winner.id);expect(unchanged?.state).toBe('PENDING');expect(unchanged?.token_ciphertext).not.toBeNull();expect(unchanged?.generation).toBe(1);
  await db.prepare('DROP TRIGGER reject_calendar_audit').run();
  const disconnected=await Promise.all([store.beginDisconnect(winner,'disconnect-a',later+3),store.beginDisconnect(winner,'disconnect-b',later+3)]);
  expect(disconnected.filter(Boolean)).toHaveLength(1);const removing=await store.find(winner.id);
  expect(removing).toMatchObject({state:'DISCONNECTING',token_ciphertext:null,token_iv:null,generation:2});
  expect(await store.reserveAuthorization(principal,'other','new-auth',later+4)).toBeNull();
  await store.finishDisconnect(winner.id,removing!.lease_marker!,later+4);
  expect(await store.find(winner.id)).toMatchObject({state:'DISCONNECTED',token_ciphertext:null,token_iv:null,lease_marker:null,egress_marker:null});
  expect(await db.prepare("SELECT count(*) n FROM audit_events WHERE action='CALENDAR_DISCONNECTED'").first('n')).toBe(1);
 }finally{await runtime.dispose();}
},30000);
