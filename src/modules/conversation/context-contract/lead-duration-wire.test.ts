// @vitest-environment node
import {expect,it} from 'vitest';
import {ContextInputSchema,ConversationInterpretationV3Schema} from './contracts';
import {encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {date,time} from './resolution-test-support';
import {proposal} from './service-test-support';
it('roundtrips the new duration through selected keyed owners and keeps legacy codes fixed',()=>{
 const input=ContextInputSchema.parse({schemaVersion:'calenote-context-input-2',reference:{instant:'2026-09-28T03:00:00Z',localDate:'2026-09-28',timezone:'Asia/Ho_Chi_Minh'},turns:[{role:'USER',text:'Ngày10/11/2026 lúc15h họp QA, nhắc trước 90 phút.'}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:'capabilities-3',supported:['ONCE','HOUR_OFFSET'],unsupported:['YEARLY'],calendars:['GREGORIAN'],limits:{dailyCount:30,horizonDays:366}}});
 const canonical=ConversationInterpretationV3Schema.parse(proposal({title:'họp QA',eventDate:date(10,11,2026),eventTime:time(15),leadOffsetMinutes:90,eventRelation:'BEFORE_EVENT'})(input));
 const wire=encodeKeyedSmallComparison(canonical,input);
 const decoded=decodeKeyedSmallComparison(wire,input);
 expect(decoded).toMatchObject({status:'PARSED',value:{semantic:{changes:expect.arrayContaining([{...canonical.changes.find(c=>c.field==='leadOffsetMinutes')}])}}});
});
