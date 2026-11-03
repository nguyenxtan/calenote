import {it,expect,vi} from 'vitest';
import {runScheduledWork} from './index';
it('finishes bounded follow-through materialization before claiming due runs',async()=>{
 const events:string[]=[];
 const operations={processFollowThrough:vi.fn(async()=>{events.push('follow');}),claimDueReminders:vi.fn(async()=>{events.push('claim');}),redriveInboundOrphans:vi.fn(async()=>{}),redriveLoginCodes:vi.fn(async()=>{})};
 await runScheduledWork({scheduledTime:1800000000000} as ScheduledController,operations);
 expect(events).toEqual(['follow','claim']);
 expect(operations.processFollowThrough).toHaveBeenCalledExactlyOnceWith(1800000000000,5);
});
it('keeps recovery tasks running when follow-through materialization fails',async()=>{
 const claim=vi.fn(async()=>{}),redrive=vi.fn(async()=>{});
 await runScheduledWork({scheduledTime:1800000000000} as ScheduledController,{processFollowThrough:async()=>{throw Error('schema unavailable');},claimDueReminders:claim,redriveInboundOrphans:redrive,redriveLoginCodes:redrive});
 expect(claim).not.toHaveBeenCalled();
 expect(redrive).toHaveBeenCalledTimes(2);
});
