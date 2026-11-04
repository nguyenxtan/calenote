import { z } from "zod";
import type { SeriesOccurrence } from "@/modules/reminders/series";
export const AdvanceReminderPolicySchema = z.strictObject({
  days: z.number().int().min(1).max(7).nullable(),
  hours: z.number().int().min(1).max(24).nullable(),
});
export type AdvanceReminderPolicy = z.infer<typeof AdvanceReminderPolicySchema>;
/** Backend-owned offsets. Every selected instant must still be in the future. */
export function planAdvanceReminders(eventAt: number, policy: AdvanceReminderPolicy, now: number):
  {status:"READY";occurrences:SeriesOccurrence[]} | {status:"INVALID"|"PAST"|"DISABLED"} {
  if (!AdvanceReminderPolicySchema.safeParse(policy).success || !Number.isSafeInteger(eventAt) || !Number.isSafeInteger(now)) return {status:"INVALID"};
  const instants = [...new Set([
    ...(policy.days === null ? [] : [eventAt-policy.days*86_400_000]),
    ...(policy.hours === null ? [] : [eventAt-policy.hours*3_600_000]),
  ])].sort((a,b)=>a-b);
  if (!instants.length) return {status:"DISABLED"};
  if (instants.some(at=>at<=now)) return {status:"PAST"};
  if (instants.some(at=>!Number.isFinite(new Date(at+7*3_600_000).getTime()))) return {status:"INVALID"};
  return {status:"READY",occurrences:instants.map((scheduledAt,index)=>({index,scheduledAt,localDate:new Date(scheduledAt+7*3_600_000).toISOString().slice(0,10)}))};
}
