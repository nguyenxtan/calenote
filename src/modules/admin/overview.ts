import { z } from 'zod';
import { AdminOverviewSchema, type AdminOverview } from '@/contracts/api/admin-overview';
const events=['LOGIN_VERIFIED','REMINDER_CREATED','REMINDER_CONFIRMED'] as const;
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Fixed Vietnam civil day/month, independent of the browser/server timezone. */
export function vietnamPeriods(now:number){
 if(!Number.isSafeInteger(now)||now<0)throw new RangeError('Invalid clock');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const month=day.slice(0,7);const [year,m]=month.split('-').map(Number);
 return {day,month,dayStart:Date.parse(`${day}T00:00:00+07:00`),monthStart:Date.parse(`${month}-01T00:00:00+07:00`),monthEnd:Date.UTC(year,m,1)-7*3600000};
}
async function metric<T>(work:()=>Promise<T>){try{return {status:'KNOWN' as const,value:await work()};}catch{return {status:'UNKNOWN' as const};}}
export async function readAdminOverview(db:D1Database,now:number):Promise<AdminOverview>{
 const p=vietnamPeriods(now);
 const [accounts,activity,ledger]=await Promise.all([
  metric(async()=>{const row=await db.prepare('SELECT COUNT(*) AS count FROM users').first<{count:number}>();return count.parse(row?.count);}),
  metric(async()=>{
   const row=await db.prepare(`SELECT COUNT(DISTINCT CASE WHEN created_at>=? THEN actor_user_id END) AS dau,
     COUNT(DISTINCT actor_user_id) AS mau FROM audit_events
     WHERE created_at>=? AND created_at<=? AND result='SUCCESS' AND actor_user_id IS NOT NULL
       AND action IN ('LOGIN_VERIFIED','REMINDER_CREATED','REMINDER_CONFIRMED')`).bind(p.dayStart,p.monthStart,now).first();
   return z.object({dau:count,mau:count}).strict().parse(row);
  }),
  metric(async()=>{
   // One row per reservation; window aggregates overlap and MUST NOT be summed.
   const row=await db.prepare(`SELECT COALESCE(SUM(CASE WHEN state='RESERVED' THEN reserved_maximum_microunits ELSE 0 END),0) AS reservedOutstanding,
     COALESCE(SUM(CASE WHEN state='FINALIZED' AND monthly_window_key=? THEN finalized_microunits ELSE 0 END),0) AS finalizedInMonth
     FROM semantic_budget_reservations WHERE state IN ('RESERVED','FINALIZED') AND created_at<=?`).bind(p.month,now).first();
   return z.object({reservedOutstanding:count,finalizedInMonth:count}).strict().parse(row);
  }),
 ]);
 return AdminOverviewSchema.parse({generatedAt:now,period:{day:p.day,month:p.month,timezone:'Asia/Ho_Chi_Minh'},accounts,
  activity:{coverage:'PARTIAL',retention:'UNKNOWN',passiveWebIncluded:false,qualifyingEvents:events,counts:activity},
  budget:{unit:'USD_MICROUNITS',ledger,finalizedMayIncludeCeilings:true},providerReportedCost:{status:'UNKNOWN'},estimatedCost:{status:'UNKNOWN'},cloudflareInvoiceCost:{status:'UNKNOWN'}});
}
