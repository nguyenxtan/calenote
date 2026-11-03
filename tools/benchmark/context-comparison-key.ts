import {z} from 'zod';
const capped=z.object({is_provisioning_key:z.literal(false),limit:z.number().finite().positive().max(2),limit_remaining:z.number().finite().min(0),limit_reset:z.null(),include_byok_in_limit:z.literal(true)});
export function admitComparisonKey(value:unknown,minimumRemainingUsd=.116759,approvedLifetimeLimitUsd=1):{limit:number;remaining:number}{
 const parsed=capped.safeParse(value);
 if(![1,2].includes(approvedLifetimeLimitUsd)||!Number.isFinite(minimumRemainingUsd)||minimumRemainingUsd<=0||!parsed.success||parsed.data.limit>approvedLifetimeLimitUsd||parsed.data.limit_remaining>parsed.data.limit||parsed.data.limit_remaining<minimumRemainingUsd)throw Error('CAPPED_INFERENCE_KEY_REQUIRED');
 return {limit:parsed.data.limit,remaining:parsed.data.limit_remaining};
}
