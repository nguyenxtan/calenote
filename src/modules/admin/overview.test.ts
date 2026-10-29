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
