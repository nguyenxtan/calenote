import {expect,it} from 'vitest';
import {buildContextInputV2} from './context';
import {chat,message,observation} from './context-test-fixtures';
import {composeContextReply} from './responses';
it('advertises finite Gregorian weekly/monthly execution separately from unsupported yearly recurrence',()=>{
 const msg=message('Nhắc kiểm tra QA mỗi tuần lúc9h từ ngày09/11/2026 trong 4 tuần.');
 const built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg)});
 expect(built.status).toBe('READY');if(built.status!=='READY')return;
 expect(built.candidateSnapshot.capabilityVersion).toBe('capabilities-3');
 expect(built.input.capabilities).toMatchObject({version:'capabilities-3',supported:expect.arrayContaining(['FINITE_WEEKLY','FINITE_MONTHLY']),unsupported:['YEARLY']});
});
it('capability answer explains finite weekly/monthly scope and horizon without claiming infinite recurrence',()=>{
 const r=composeContextReply({kind:'QUERY',resolution:{status:'CAPABILITY',topic:'FINITE_SERIES',supported:true}});
 expect(r.status).toBe('READY');if(r.status!=='READY')return;
 for(const text of ['mỗi tuần','mỗi tháng','dương lịch','366','30'])expect(r.text).toContain(text);
});
it.each([
 ['LUNAR_RECURRENCE','âm lịch'],['PERIODIC_EVENT_RELATION','ngày bắt đầu'],['MULTIPLE_PER_PERIOD','mỗi kỳ'],['MULTIPLE_WEEKDAYS','nhiều thứ'],['MONTHLY_WEEKDAY_PATTERN','thứ trong tháng'],
])('unsupported periodic pattern%s has a specific bounded explanation',(capability,expected)=>{
 const r=composeContextReply({kind:'UNSUPPORTED',capability});expect(r.status).toBe('READY');if(r.status==='READY')expect(r.text).toContain(expected);
});
