import { expect, it, vi } from 'vitest';
import { initialPersonalAssistantDocument } from '@/contracts/api/personal-assistant';
import { PersonalAssistantError } from '@/modules/personal-assistant/store';
import { handleGetPersonalAssistant, handleGetPersonalAssistantBrief, handlePutPersonalAssistant } from './personal-assistant';
const origin='https://calenote.example';
function request(method='GET', body?:unknown, extra:Record<string,string>={}) {return new Request(origin+'/api/v1/personal-assistant',{method,headers:{cookie:'__Host-calenote_session='+'A'.repeat(43),origin,'content-type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
function operations() {return {requireUser:vi.fn(async()=>({userId:'owned'})),consume:vi.fn(async()=>{}),store:{get:vi.fn(async()=>({revision:0,document:initialPersonalAssistantDocument()})),put:vi.fn(async()=>({revision:1,document:initialPersonalAssistantDocument()}))}};}
it('requires authentication and origin before initializing operations',async()=>{
 const create=vi.fn();
 await expect(handleGetPersonalAssistant(new Request(origin),create)).rejects.toMatchObject({status:401});
 await expect(handlePutPersonalAssistant(request('PUT',{}, {origin:'https://evil.example'}),origin,create)).rejects.toMatchObject({status:403});
 expect(create).not.toHaveBeenCalled();
});
it('bounds and strictly validates writes before accessing storage',async()=>{
 const create=vi.fn();
 await expect(handlePutPersonalAssistant(request('PUT',{x:'a'.repeat(131073)}),origin,create)).rejects.toMatchObject({status:413});
 expect((await handlePutPersonalAssistant(request('PUT',{expectedRevision:0,document:initialPersonalAssistantDocument(),ownerId:'victim'}),origin,create)).status).toBe(400);
 expect(create).not.toHaveBeenCalled();
});
it('uses only authenticated ownership, consumes budget and prevents cached responses',async()=>{
 const ops=operations(),create=async()=>ops;
 const response=await handleGetPersonalAssistant(request(),create);
 expect(ops.store.get).toHaveBeenCalledWith('owned');expect(ops.consume).toHaveBeenCalledWith('owned');
 expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('vary')).toBe('Cookie');
 await handlePutPersonalAssistant(request('PUT',{expectedRevision:0,document:initialPersonalAssistantDocument()}),origin,create);
 expect(ops.store.put).toHaveBeenCalledWith('owned',0,initialPersonalAssistantDocument());
});
it('returns safe conflict and blocked errors',async()=>{
 const ops=operations();ops.store.get.mockRejectedValue(new PersonalAssistantError('BLOCKED'));
 expect((await handleGetPersonalAssistant(request(),async()=>ops)).status).toBe(503);
 ops.store.put.mockRejectedValue(new PersonalAssistantError('CONFLICT'));
 expect((await handlePutPersonalAssistant(request('PUT',{expectedRevision:0,document:initialPersonalAssistantDocument()}),origin,async()=>ops)).status).toBe(409);
});

it('authenticates and rate limits brief access with bounded private output', async () => {
  const create = vi.fn();
  await expect(handleGetPersonalAssistantBrief(new Request(origin), create)).rejects.toMatchObject({status:401});
  expect(create).not.toHaveBeenCalled();
  const brief={date:'2026-10-20',openCount:2,overdueCount:1,doneTodayCount:3,next:[{title:'Private work',scheduledAt:1}]};
  const ops={...operations(),getBrief:vi.fn(async()=>brief)};
  const response=await handleGetPersonalAssistantBrief(request(),async()=>ops);
  expect(await response.json()).toEqual({data:brief});
  expect(ops.getBrief).toHaveBeenCalledWith('owned');expect(ops.consume).toHaveBeenCalledWith('owned');
  expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('vary')).toBe('Cookie');
  ops.getBrief.mockResolvedValue({...brief,next:Array.from({length:6},()=>({title:'x',scheduledAt:1}))});
  expect((await handleGetPersonalAssistantBrief(request(),async()=>ops)).status).toBe(503);
  expect((await handleGetPersonalAssistantBrief(request(),async()=>operations())).status).toBe(503);
});
it('does not read brief after rejected authentication or rate limit', async () => {
  const ops={...operations(),getBrief:vi.fn()};
  ops.requireUser.mockRejectedValueOnce(new Error('session rejected'));
  await expect(handleGetPersonalAssistantBrief(request(),async()=>ops)).rejects.toThrow('session rejected');
  expect(ops.getBrief).not.toHaveBeenCalled();
  ops.consume.mockRejectedValueOnce(new Error('rate limited'));
  await expect(handleGetPersonalAssistantBrief(request(),async()=>ops)).rejects.toThrow('rate limited');
  expect(ops.getBrief).not.toHaveBeenCalled();
});
