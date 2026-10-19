import {expect,it,vi} from 'vitest';
import {handleGetProfile,handleUpdateProfile,handleGetSessions,handleRevokeOtherSessions,type AccountOperations} from './account';
const origin='https://example.test';
const principal={userId:'owner',sessionId:'current'};
const profile={displayName:'Mai',email:'mai@example.test',timezone:'Asia/Ho_Chi_Minh'} as const;
const credentials={cookie:`__Host-calenote_session=${'A'.repeat(43)}`};
function operations():AccountOperations{return {requireUser:vi.fn(async()=>principal),getProfile:vi.fn(async()=>profile),updateProfile:vi.fn(async()=>profile),listSessions:vi.fn(async()=>[]),revokeOtherSessions:vi.fn(async()=>({revoked:2}))};}
it('rejects missing authentication and foreign origins before constructing operations',async()=>{
 const factory=vi.fn(async()=>operations());
 await expect(handleGetProfile(new Request(origin),factory)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 for(const handle of [handleUpdateProfile,handleRevokeOtherSessions]) await expect(handle(new Request(origin,{method:'POST',headers:{...credentials,origin:'https://evil.test'},body:'{}'}),origin,factory)).rejects.toMatchObject({code:'ORIGIN_REJECTED'});
 expect(factory).not.toHaveBeenCalled();
});
it('strictly validates display-name-only profile changes and scopes all actions to principal',async()=>{
 const ops=operations(),factory=async()=>ops;
 const request=(body:unknown)=>new Request(origin,{method:'PATCH',headers:{...credentials,origin,'content-type':'application/json'},body:JSON.stringify(body)});
 await expect(handleUpdateProfile(request({displayName:'Mai',userId:'other'}),origin,factory)).rejects.toMatchObject({code:'INVALID_ACCOUNT_INPUT'});
 expect(ops.updateProfile).not.toHaveBeenCalled();
 const response=await handleUpdateProfile(request({displayName:'  Mai  '}),origin,factory);
 expect(await response.json()).toEqual({data:{user:profile}});expect(response.headers.get('cache-control')).toBe('no-store');
 expect(ops.updateProfile).toHaveBeenCalledWith('owner',{displayName:'Mai'});
 await handleGetSessions(new Request(origin,{headers:credentials}),factory);expect(ops.listSessions).toHaveBeenCalledWith(principal);
 await handleRevokeOtherSessions(request({}),origin,factory);expect(ops.revokeOtherSessions).toHaveBeenCalledWith(principal);
 await expect(handleRevokeOtherSessions(request({userId:'other'}),origin,factory)).rejects.toMatchObject({code:'INVALID_ACCOUNT_INPUT'});
});
