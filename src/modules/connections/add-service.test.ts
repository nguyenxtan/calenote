// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteD1Database, deterministicRandomBytes } from "@/testing/sqlite-d1.test-support";
import { D1OnboardingStore } from "@/modules/db/onboarding-store";
import { D1RateLimitStore } from "@/modules/db/rate-limit-store";
import { createKeyring } from "@/modules/security/keyring";
import { ProviderOperationError, ProviderVerificationError } from "./provider-error";
import { addConnection } from "./add-service";
import type { BotProvider } from "./contracts";

const databases: SqliteD1Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
async function setup(provider: BotProvider = "telegram") {
  const db = new SqliteD1Database(); databases.push(db);
  db.sqlite.exec("INSERT INTO users VALUES ('owner','owner@example.com','Owner','Asia/Ho_Chi_Minh',1,1),('other','other@example.com','Other','Asia/Ho_Chi_Minh',1,1)");
  db.sqlite.exec("INSERT INTO workspaces VALUES ('space','owner','PERSONAL',1,1)");
  db.sqlite.exec("INSERT INTO sessions VALUES ('session','owner','existing-session',9999999,NULL,1)");
  const keyring = await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  const verifyToken = vi.fn(async () => ({ provider, providerBotId: 'bot-1', displayName: 'Private bot', handle: null, accountType: null, canJoinGroups: false }));
  const registerWebhook = vi.fn(async () => {});
  return { db, deps: { store: new D1OnboardingStore(db as unknown as D1Database), keyring, rateLimitStore: new D1RateLimitStore(db as unknown as D1Database), verifyToken, registerWebhook, appOrigin: 'https://calenote.example', now: () => 1000, randomBytes: deterministicRandomBytes() }, input: { provider, token: '12345678:synthetic-fixture' } };
}
describe('authenticated bot addition', () => {
  it.each(['telegram','zalo'] as const)('adds %s under the existing owner without changing accounts or sessions', async provider => {
    const { db, deps, input } = await setup(provider);
    const result = await addConnection('owner', input, deps);
    expect(result.bot.state).toBe('ACTIVE_UNBOUND');
    expect(result.connectCommand).toMatch(/^\/connect /);
    expect(Object.keys(result).sort()).toEqual(['activationCode','bot','connectCodeExpiresAt','connectCommand']);
    expect(db.sqlite.prepare('SELECT user_id,state FROM bot_connections').get()).toEqual({ user_id:'owner',state:'ACTIVE_UNBOUND' });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({n:2});
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM workspaces').get()).toEqual({n:1});
    expect(db.sqlite.prepare('SELECT id,revoked_at FROM sessions').all()).toEqual([{id:'session',revoked_at:null}]);
    const row = db.sqlite.prepare('SELECT id,encrypted_token,encrypted_token_iv,credential_version FROM bot_connections').get()!;
    expect(await deps.keyring.decryptCredential(row.id as string,provider,row.credential_version as number,{ciphertext:(row.encrypted_token as Uint8Array).buffer as ArrayBuffer,iv:(row.encrypted_token_iv as Uint8Array).buffer as ArrayBuffer})).toBe(input.token);
    expect(JSON.stringify(result)).not.toContain(input.token);
    expect(db.sqlite.prepare('SELECT digest FROM connect_codes').get()?.digest).not.toBe(result.connectCommand?.slice(9));
  });
  it.each(['owner','other'])('does not replace an existing bot belonging to %s', async firstOwner => {
    const { db, deps, input } = await setup();
    await addConnection(firstOwner,input,deps);
    deps.registerWebhook.mockClear();
    await expect(addConnection('owner',input,deps)).rejects.toMatchObject({code:'ONBOARDING_CONFLICT'});
    expect(deps.registerWebhook).not.toHaveBeenCalled();
    expect(db.sqlite.prepare('SELECT user_id FROM bot_connections').all()).toEqual([{user_id:firstOwner}]);
  });
  it('keeps rejected verification out of D1', async () => {
    const { db,deps,input } = await setup();
    deps.verifyToken.mockRejectedValue(new ProviderVerificationError('INVALID_PROVIDER_RESPONSE'));
    await expect(addConnection('owner',input,deps)).rejects.toThrow();
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM bot_connections').get()).toEqual({n:0});
    expect(deps.registerWebhook).not.toHaveBeenCalled();
  });
  it.each([['FAILED','WEBHOOK_FAILED'],['REJECTED_CREDENTIAL','SUSPENDED']] as const)('persists %s activation failure without issuing a code', async (error,state) => {
    const { db,deps,input } = await setup();
    deps.registerWebhook.mockRejectedValue(new ProviderOperationError(error));
    const result = await addConnection('owner',input,deps);
    expect(result).toMatchObject({bot:{state},connectCommand:null,activationCode:'WEBHOOK_ACTIVATION_FAILED'});
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM connect_codes').get()).toEqual({n:0});
    expect(db.sqlite.prepare('SELECT state FROM bot_connections').get()).toEqual({state});
  });
  it('rate limits before verifying the credential', async () => {
    const { deps,input } = await setup();
    deps.rateLimitStore.consume = async () => ({allowed:false,resetAt:61000});
    await expect(addConnection('owner',input,deps)).rejects.toMatchObject({code:'RATE_LIMITED'});
    expect(deps.verifyToken).not.toHaveBeenCalled();
  });
  it('rejects ownership fields supplied in the body', async () => {
    const {deps,input} = await setup();
    await expect(addConnection('owner',{...input,userId:'other'},deps)).rejects.toMatchObject({code:'INVALID_ONBOARDING'});
    expect(deps.verifyToken).not.toHaveBeenCalled();
  });
  it('adds a second different bot without disturbing the first connection', async () => {
    const { db, deps, input } = await setup();
    await addConnection('owner', input, deps);
    deps.verifyToken.mockResolvedValue({provider:'telegram',providerBotId:'bot-2',displayName:'Second bot',handle:null,accountType:null,canJoinGroups:false});
    await addConnection('owner', {...input,token:'98765432:second-synthetic-fixture'},deps);
    expect(db.sqlite.prepare('SELECT provider_bot_id,state,user_id FROM bot_connections ORDER BY provider_bot_id').all()).toEqual([
      {provider_bot_id:'bot-1',state:'ACTIVE_UNBOUND',user_id:'owner'},
      {provider_bot_id:'bot-2',state:'ACTIVE_UNBOUND',user_id:'owner'},
    ]);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM connect_codes').get()).toEqual({n:2});
  });
  it('rejects provider identity mismatch before persistence', async () => {
    const {db,deps,input} = await setup();
    deps.verifyToken.mockResolvedValue({...await deps.verifyToken(),provider:'zalo'});
    await expect(addConnection('owner',input,deps)).rejects.toMatchObject({code:'INVALID_PROVIDER_RESPONSE'});
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM bot_connections').get()).toEqual({n:0});
    expect(deps.registerWebhook).not.toHaveBeenCalled();
  });
  it('rolls back the connection if its audit cannot commit', async () => {
    const {db,deps,input} = await setup();
    db.sqlite.exec("CREATE TRIGGER reject_connection_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'CONNECTION_ADDED' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END");
    await expect(addConnection('owner',input,deps)).rejects.toThrow('synthetic audit failure');
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM bot_connections').get()).toEqual({n:0});
    expect(deps.registerWebhook).not.toHaveBeenCalled();
  });
  it('returns no code and keeps VALIDATING if final activation cannot commit', async () => {
    const {db,deps,input} = await setup();
    db.sqlite.exec("CREATE TRIGGER reject_connect_code BEFORE INSERT ON connect_codes BEGIN SELECT RAISE(ABORT, 'synthetic code failure'); END");
    await expect(addConnection('owner',input,deps)).rejects.toThrow('synthetic code failure');
    expect(db.sqlite.prepare('SELECT state FROM bot_connections').get()).toEqual({state:'VALIDATING'});
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM connect_codes').get()).toEqual({n:0});
    expect(deps.registerWebhook).toHaveBeenCalledTimes(1);
  });

  it('allows only one concurrent duplicate to register the webhook', async () => {
    const {db,deps,input} = await setup();
    const outcomes = await Promise.allSettled([addConnection('owner',input,deps),addConnection('other',input,deps)]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect(deps.registerWebhook).toHaveBeenCalledTimes(1);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM bot_connections').get()).toEqual({n:1});
  });

});
