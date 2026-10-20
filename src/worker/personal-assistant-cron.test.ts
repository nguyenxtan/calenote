import { expect, it, vi } from 'vitest';
import { runScheduledWork } from './index';
const now=1800000000000;
it('materializes personal assistant work before follow-through and due reminder claims',async()=>{
 const events:string[]=[];
 const operations={processPersonalAssistant:vi.fn(async()=>{events.push('assistant');}),processFollowThrough:vi.fn(async()=>{events.push('follow');}),claimDueReminders:vi.fn(async()=>{events.push('claim');}),redriveInboundOrphans:vi.fn(async()=>{}),redriveLoginCodes:vi.fn(async()=>{})};
 await runScheduledWork({scheduledTime:now} as ScheduledController,operations);
 expect(events).toEqual(['assistant','follow','claim']);expect(operations.processPersonalAssistant).toHaveBeenCalledExactlyOnceWith(now,20);expect(operations.claimDueReminders).toHaveBeenCalledExactlyOnceWith(now,5);
});
it('preserves existing reminder claims and recovery when the new scheduler phase fails',async()=>{
 const claim=vi.fn(async()=>{}),follow=vi.fn(async()=>{}),inbound=vi.fn(async()=>{}),login=vi.fn(async()=>{});
 await runScheduledWork({scheduledTime:now} as ScheduledController,{processPersonalAssistant:async()=>{throw new Error('missing assistant schema');},processFollowThrough:follow,claimDueReminders:claim,redriveInboundOrphans:inbound,redriveLoginCodes:login});
 expect(follow).toHaveBeenCalledExactlyOnceWith(now,5);expect(claim).toHaveBeenCalledExactlyOnceWith(now,5);expect(inbound).toHaveBeenCalledTimes(1);expect(login).toHaveBeenCalledTimes(1);
});
