// @vitest-environment node
import { expect,it } from 'vitest';
import { AdminOverviewSchema } from './admin-overview';
const data={generatedAt:1,period:{day:'2026-10-15',month:'2026-10',timezone:'Asia/Ho_Chi_Minh'},accounts:{status:'KNOWN',value:0},activity:{coverage:'PARTIAL',retention:'UNKNOWN',passiveWebIncluded:false,qualifyingEvents:['LOGIN_VERIFIED'],counts:{status:'UNKNOWN'}},budget:{unit:'USD_MICROUNITS',month:'2026-02',timezone:'UTC',ledger:{status:'UNKNOWN'},finalizedMayIncludeCeilings:true},providerReportedCost:{status:'UNKNOWN'},estimatedCost:{status:'UNKNOWN'},cloudflareInvoiceCost:{status:'UNKNOWN'}};
it('rejects private fields at every aggregate boundary and unsupported invoice provenance',()=>{
 expect(AdminOverviewSchema.safeParse(data).success).toBe(true);
 for(const payload of [{...data,email:'private@example.invalid'},{...data,accounts:{status:'KNOWN',value:0,userId:'private'}},{...data,activity:{...data.activity,actors:['private']}},{...data,budget:{...data.budget,ledger:{status:'KNOWN',value:{reservedOutstanding:0,finalizedInMonth:0,token:'private'}}}},{...data,cloudflareInvoiceCost:{status:'KNOWN',value:0}}])expect(AdminOverviewSchema.safeParse(payload).success).toBe(false);
});
