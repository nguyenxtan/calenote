// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { handleAdminOverview } from '@/worker/routes/admin-overview';
import { vietnamPeriods, readAdminOverview } from './overview';
const bearer='A'.repeat(43);
const request=(cookie=true)=>new Request('https://calenote.example/api/admin/overview',{headers:cookie?{cookie:`__Host-calenote_session=${bearer}`}:{}});
it('denies anonymous, empty and mismatched allowlist before reading aggregate data',async()=>{
 const readOverview=vi.fn();const requireUser=vi.fn(async()=>({userId:'owner'}));
 expect((await handleAdminOverview(request(false),{allowlist:'owner',requireUser,readOverview})).status).toBe(401);
 for(const allowlist of [undefined,'','another','owner,','*','owner\nother'])expect((await handleAdminOverview(request(),{allowlist,requireUser,readOverview})).status).toBe(403);
 expect(readOverview).not.toHaveBeenCalled();
});
it('uses Vietnam day and calendar month across a UTC boundary and leap February',()=>{
 const p=vietnamPeriods(Date.parse('2028-02-29T17:00:00Z'));
 expect(p.day).toBe('2028-03-01');expect(p.month).toBe('2028-03');
 expect(p.dayStart).toBe(Date.parse('2028-02-29T17:00:00Z'));
 expect(vietnamPeriods(Date.parse('2028-02-28T18:00:00Z')).monthEnd).toBe(p.monthStart);
});
it('keeps failed aggregates UNKNOWN and rejects unsafe precision instead of reporting zero',async()=>{
 const db={prepare:()=>({bind(){return this},first:async()=>{throw new Error('private failure')}})} as unknown as D1Database;
 const result=await readAdminOverview(db,Date.parse('2026-10-15T00:00:00Z'));
 expect(result.accounts).toEqual({status:'UNKNOWN'});expect(result.activity.counts).toEqual({status:'UNKNOWN'});expect(result.budget.ledger).toEqual({status:'UNKNOWN'});
 expect(JSON.stringify(result)).not.toContain('private failure');expect(result.providerReportedCost.status).toBe('UNKNOWN');expect(result.cloudflareInvoiceCost.status).toBe('UNKNOWN');
});
it('rejects unsafe aggregate precision while preserving independently valid sources',async()=>{
 const db={prepare:(sql:string)=>({bind(){return this},first:async()=>sql.includes('FROM users')?{count:Number.MAX_SAFE_INTEGER+1}:sql.includes('FROM audit_events')?{dau:0,mau:0}:{reservedOutstanding:0,finalizedInMonth:0}})} as unknown as D1Database;
 const r=await readAdminOverview(db,Date.parse('2026-10-15T00:00:00Z'));
 expect(r.accounts.status).toBe('UNKNOWN');expect(r.activity.counts).toEqual({status:'KNOWN',value:{dau:0,mau:0}});
});
it('returns no raw failures or private fields even if an aggregate dependency violates its contract',async()=>{
 const ops={allowlist:'owner',requireUser:async()=>({userId:'owner'}),readOverview:async()=>({email:'private@example.invalid'}) as never};
 const response=await handleAdminOverview(request(),ops);
 expect(response.status).toBe(503);expect(await response.text()).not.toContain('private@example');
});
it('rejects unsupported methods and query selectors before invoking dependencies',async()=>{
 const ops={allowlist:'owner',requireUser:vi.fn(async()=>({userId:'owner'})),readOverview:vi.fn()};
 expect((await handleAdminOverview(new Request('https://calenote.example/api/admin/overview?userId=other'),ops)).status).toBe(400);
 expect((await handleAdminOverview(new Request('https://calenote.example/api/admin/overview',{method:'POST'}),ops)).status).toBe(405);
 expect(ops.requireUser).not.toHaveBeenCalled();expect(ops.readOverview).not.toHaveBeenCalled();
});
it('reports day/month periods correctly at VN New Year independently of server timezone',()=>{
 const prior=process.env.TZ;
 try{for(const zone of ['America/Los_Angeles','Pacific/Kiritimati']){process.env.TZ=zone;const p=vietnamPeriods(Date.parse('2026-12-31T17:00:00Z'));expect(p.day).toBe('2027-01-01');expect(p.month).toBe('2027-01');expect(p.monthStart).toBe(p.dayStart);expect(p.monthEnd).toBe(Date.parse('2027-01-31T17:00:00Z'));}}finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
