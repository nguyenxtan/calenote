// @vitest-environment node
import {expect,it} from 'vitest';
import {buildContextInputV2} from './context';
import {ConversationInterpretationV3Schema} from './contracts';
import {validateEvidenceV3} from './evidence';
import {mergePatchV3} from './merge';
import {resolveRequest} from './resolve';
import {lunarCalendar} from '../lunar-calendar';
import {chat,message,observation} from './context-test-fixtures';
import {encodeKeyedSmallComparison,decodeKeyedSmallComparison} from '../../intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';

const now=Date.parse('2026-11-07T03:00:00.000Z');
function proposal(text:string,quote=text,occurrence=1,roundtrip=true){
 const msg={...message(text),receivedAt:now},built=buildContextInputV2({message:msg,context:chat,snapshot:null,observation:observation(null,msg,chat)});
 if(built.status!=='READY')throw Error(built.reason);
 const evidence=[{kind:'USER_QUOTE',turn:0,quote:text,occurrence:1}];
 const canonical=ConversationInterpretationV3Schema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence},changes:[
  {field:'title',operation:'SET',value:'sửa máy lạnh',evidence},
  {field:'eventDate',operation:'SET',value:{kind:'RELATIVE_MONTH',offsetMonths:4},evidence},
  {field:'reminderDate',operation:'SET',value:{kind:'RELATIVE_DAY',offsetDays:0},evidence:[{kind:'USER_QUOTE',turn:0,quote,occurrence}]},
  {field:'reminderTime',operation:'SET',value:{hour:18,minute:0,qualifier:'H24'},evidence},
 ],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
 let semantic={schemaVersion:canonical.schemaVersion,intent:canonical.intent,requestTarget:canonical.requestTarget,changes:canonical.changes,query:canonical.query,uncertainties:canonical.uncertainties};
 if(roundtrip){const wire=encodeKeyedSmallComparison(canonical,built.input),decoded=decodeKeyedSmallComparison(wire,built.input);expect(decoded.status).toBe('PARSED');if(decoded.status!=='PARSED')throw Error(decoded.reason);if(!('semantic'in decoded.value))throw Error('Expected reminder semantic');semantic=decoded.value.semantic;}
 return {built,checked:validateEvidenceV3(semantic,built)};
}

it('refuses historical today as a notification date beside a same-source future month event',()=>{
 const {checked}=proposal('Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại. Nhắc lúc 18h.');
 expect(checked).toEqual({status:'REFUSED',reason:'REMINDER_DATE_SOURCE_ROLE_NOT_SUPPORTED'});
});

it.each([
 'Nhắc hôm nay lúc 18h về lịch 4 tháng sau sửa máy lạnh.',
 'Hôm nay lúc 18h nhắc về lịch 4 tháng sau sửa máy lạnh.',
 'Nhắc lúc 18h hôm nay về lịch 4 tháng sau sửa máy lạnh.',
])('preserves an independently authored immediate notification instruction: %s',text=>{
 const {checked}=proposal(text);expect(checked.status).toBe('VALID');if(checked.status!=='VALID')return;
 const merged=mergePatchV3(null,checked.patch);expect(merged.status).toBe('MERGED');if(merged.status!=='MERGED')return;
 expect(resolveRequest(merged.candidate,now,lunarCalendar)).toMatchObject({status:'READY',details:{eventDate:'2027-03-07'},occurrences:[{localDate:'2026-11-07',scheduledAt:Date.parse('2026-11-07T18:00:00+07:00')}]});
});

it('a historical quoted today cannot borrow the role of another today instruction',()=>{
 const text='Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại. Nhắc hôm nay lúc 18h.';
 expect(proposal(text,'Hôm nay',1,false).checked).toEqual({status:'REFUSED',reason:'REMINDER_DATE_SOURCE_ROLE_NOT_SUPPORTED'});
 expect(proposal(text,'hôm nay',1,false).checked.status).toBe('VALID');
});

it.each([
 'Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại. Đừng nhắc hôm nay lúc 18h. Nhắc lúc 18h.',
 'Hôm nay sửa máy lạnh. Đặt 4 tháng sau sửa lại. Nhắc hôm nay thì không. Nhắc lúc 18h.',
])('a negated dated instruction does not authorize the historical notification date: %s',text=>{
 expect(proposal(text).checked).toEqual({status:'REFUSED',reason:'REMINDER_DATE_SOURCE_ROLE_NOT_SUPPORTED'});
});
