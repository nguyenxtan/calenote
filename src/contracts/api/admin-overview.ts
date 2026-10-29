import { z } from 'zod';
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const unknown=z.object({status:z.literal('UNKNOWN')}).strict();
const known=<T extends z.ZodType>(value:T)=>z.union([z.object({status:z.literal('KNOWN'),value}).strict(),unknown]);
export const AdminOverviewSchema=z.object({
 generatedAt:count,
 period:z.object({day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),month:z.string().regex(/^\d{4}-\d{2}$/),timezone:z.literal('Asia/Ho_Chi_Minh')}).strict(),
 accounts:known(count),
 activity:z.object({coverage:z.literal('PARTIAL'),retention:z.literal('UNKNOWN'),passiveWebIncluded:z.literal(false),qualifyingEvents:z.array(z.enum(['LOGIN_VERIFIED','REMINDER_CREATED','REMINDER_CONFIRMED'])),counts:known(z.object({dau:count,mau:count}).strict())}).strict(),
 budget:z.object({unit:z.literal('USD_MICROUNITS'),month:z.string().regex(/^\d{4}-\d{2}$/),timezone:z.literal('UTC'),ledger:known(z.object({reservedOutstanding:count,finalizedInMonth:count}).strict()),finalizedMayIncludeCeilings:z.literal(true)}).strict(),
 providerReportedCost:unknown,estimatedCost:unknown,cloudflareInvoiceCost:unknown,
}).strict();
export const AdminOverviewResponseSchema=z.object({data:AdminOverviewSchema}).strict();
export type AdminOverview= z.infer<typeof AdminOverviewSchema>;
