import {z} from 'zod';
const amount=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const AiUsagePeriodSchema=z.strictObject({
 key:z.string().regex(/^\d{4}-\d{2}(?:-\d{2})?$/u),dispatchedCalls:amount,
 knownCalls:amount,knownCostMicrounits:amount,unknownCalls:amount,unknownMaximumMicrounits:amount,
 pendingCalls:amount,pendingMaximumMicrounits:amount,budgetedCalls:amount,budgetedCostMicrounits:amount,
});
export const AiUsageConfigurationSchema=z.strictObject({runtime:z.enum(['READY','OFF','UNAVAILABLE']),limits:z.strictObject({dailyCalls:amount,monthlyCostMicrounits:amount}).nullable()});
export type AiUsageConfiguration=z.infer<typeof AiUsageConfigurationSchema>;
export const AiUsageSchema=AiUsageConfigurationSchema.extend({schemaVersion:z.literal('ai-usage-1'),asOf:z.iso.datetime(),timezone:z.literal('UTC'),currency:z.literal('USD'),day:AiUsagePeriodSchema,month:AiUsagePeriodSchema});
export type AiUsage=z.infer<typeof AiUsageSchema>;
export const AiUsageResponseSchema=z.strictObject({data:AiUsageSchema});
