// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { handleCalendarSyncStatus, handleCalendarSyncBegin, handleCalendarSyncCode, handleCalendarSyncDisconnect, type CalendarSyncOperations } from './calendar-sync';
const origin='https://calenote.test';const bearer='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
function fixture(){
 const principal={userId:'owner',sessionId:'live-session',expiresAt:99999999};
 const operations:CalendarSyncOperations={requireUser:vi.fn(async()=>principal),getCalendarSyncStatus:vi.fn(async()=>({available:false,state:'UNAVAILABLE',lastSyncedAt:null,error:null} as const)),beginCalendarSync:vi.fn(async()=>({nonce:bearer,clientId:'public-client-id',expiresAt:10})),completeCalendarSync:vi.fn(async()=>({connectionId:'internal-only',state:'PENDING'} as const)),disconnectCalendarSync:vi.fn(async()=>({disconnected:true,remoteEventsKept:true,revocation:'SUCCEEDED'} as const))};
 const create=vi.fn(async()=>operations);return {operations,create,principal};
}
function req(path:string,body?:unknown,headers:Record<string,string>={}){return new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie:`__Host-calenote_session=${bearer}`,origin,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});}
it('requires the canonical session even if a token is supplied in the URL',async()=>{
 const h=fixture();await expect(handleCalendarSyncStatus(new Request(origin+'/api/calendar/sync?token=private'),h.create)).rejects.toMatchObject({status:401});expect(h.create).not.toHaveBeenCalled();
});
it('returns content-free unavailable status with private cache headers',async()=>{
 const h=fixture();const response=await handleCalendarSyncStatus(req('/api/calendar/sync'),h.create);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('vary')).toBe('Cookie');expect(await response.json()).toEqual({data:{available:false,state:'UNAVAILABLE',lastSyncedAt:null,error:null}});expect(h.operations.getCalendarSyncStatus).toHaveBeenCalledWith('owner');
});
it('binds begin to the authenticated principal and requires exact Origin',async()=>{
 const h=fixture();await expect(handleCalendarSyncBegin(req('/api/calendar/sync/begin',{}, {origin:'https://other.test'}),origin,h.create)).rejects.toMatchObject({status:403});expect(h.create).not.toHaveBeenCalled();
 await handleCalendarSyncBegin(req('/api/calendar/sync/begin',{}),origin,h.create);expect(h.operations.beginCalendarSync).toHaveBeenCalledWith(h.principal);
});
it('requires popup CSRF header and strict code POST body, never accepts owner selectors',async()=>{
 const h=fixture();const body={nonce:bearer,code:'fixture-code'};
 await expect(handleCalendarSyncCode(req('/api/calendar/sync/code',body),origin,h.create)).rejects.toMatchObject({status:403});
 await expect(handleCalendarSyncCode(req('/api/calendar/sync/code',{...body,userId:'victim'},{'x-requested-with':'XmlHttpRequest'}),origin,h.create)).rejects.toMatchObject({status:400});expect(h.create).not.toHaveBeenCalled();
 const response=await handleCalendarSyncCode(req('/api/calendar/sync/code',body,{'x-requested-with':'XmlHttpRequest'}),origin,h.create);
 expect(await response.json()).toEqual({data:{state:'PENDING'}});expect(h.operations.completeCalendarSync).toHaveBeenCalledWith(h.principal,body);
});
it('disconnect is authenticated, same origin and leaves remote events by default',async()=>{
 const h=fixture();const response=await handleCalendarSyncDisconnect(req('/api/calendar/sync/disconnect',{}),origin,h.create);expect(h.operations.disconnectCalendarSync).toHaveBeenCalledWith('owner');expect(await response.json()).toEqual({data:{disconnected:true,remoteEventsKept:true,revocation:'SUCCEEDED'}});
});
