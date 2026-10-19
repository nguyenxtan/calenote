import { describe, expect, it, vi } from 'vitest';
import { createRouter } from '../router';
import { SessionAuthError } from '@/modules/auth/session';
import type { ConnectionsOperations } from './operations';
const origin = 'https://calenote.iconiclogs.com';
const token = '12345678:synthetic-fixture';
const result = {bot:{publicId:'A'.repeat(22),provider:'telegram' as const,displayName:'Bot',handle:null,state:'ACTIVE_UNBOUND' as const},connectCommand:'/connect fixture',connectCodeExpiresAt:9999,activationCode:null};
function setup() {
  const ops = {getPrimaryLogin:vi.fn(),selectPrimaryLogin:vi.fn(),disconnectConnection:vi.fn(),requireUser: vi.fn(async () => ({userId:'owner'})),listConnections:vi.fn(),rotateConnectCode:vi.fn(),retryWebhook:vi.fn(),addConnection:vi.fn(async () => result)};
  const factory = vi.fn(async () => ops as ConnectionsOperations);
  const router = createRouter({connectionsOperations:factory});
  const env = {APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',ASSETS:{fetch:vi.fn()}} as unknown as Env;
  const run = (body: unknown = {provider:'telegram',token}, cookie = true, requestOrigin = origin) => router(new Request(`${origin}/api/connections`,{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json',...(cookie?{cookie:`__Host-calenote_session=${'A'.repeat(43)}`}:{})},body:JSON.stringify(body)}),env,{} as ExecutionContext);
  return {ops,factory,run};
}
describe('POST /api/connections', () => {
  it('adds to the session owner and returns public access material without replacing the session', async () => {
    const {ops,run}=setup(); const response=await run();
    expect(response.status).toBe(201);
    expect(ops.addConnection).toHaveBeenCalledWith({userId:'owner',provider:'telegram',token});
    expect(await response.json()).toEqual({data:result});
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('rejects unauthenticated requests before constructing operations', async () => {
    const {factory,run}=setup();expect((await run(undefined,false)).status).toBe(401);expect(factory).not.toHaveBeenCalled();
  });
  it('rejects cross-origin requests before constructing operations', async () => {
    const {factory,run}=setup();expect((await run(undefined,true,'https://foreign.example')).status).toBe(403);expect(factory).not.toHaveBeenCalled();
  });
  it.each([{provider:'telegram',token,userId:'other'},{provider:'oa',token},{provider:'telegram',token:'x'.repeat(513)}])('rejects strict invalid payloads without constructing operations', async body => {
    const {factory,run}=setup();expect((await run(body)).status).toBe(400);expect(factory).not.toHaveBeenCalled();
  });
  it('does not add when the session is expired', async () => {
    const {ops,run}=setup();ops.requireUser.mockRejectedValue(new SessionAuthError());expect((await run()).status).toBe(401);expect(ops.addConnection).not.toHaveBeenCalled();
  });
  it('does not reflect internal provider failures or the submitted token', async () => {
    const {ops,run}=setup();ops.addConnection.mockRejectedValue(new Error(token));const response=await run();expect(response.status).toBe(500);expect(await response.text()).not.toContain(token);
  });
});
