import type {SemanticReminderQuery,QueriedReminder} from '../reminders/semantic-query';
export type LocalReadOnlyCommand='LUNAR_TODAY'|'MONTH'|'HELP';
/** Whole utterances only: quoted, negated and compound tasks never borrow a read route. */
export function localReadOnlyCommand(text:string):LocalReadOnlyCommand|null{
 const value=text.normalize('NFC').trim().toLocaleLowerCase('vi-VN').replace(/\s+/gu,' ');
 if(/^hôm nay là ngày mấy âm lịch\s*\?*$/u.test(value))return 'LUNAR_TODAY';
 if(/^tháng này có lịch gì(?: (?:ko|không))?\s*\?*$/u.test(value))return 'MONTH';
 if(/^cú pháp như (?:thế )?nào\s*\?*$/u.test(value))return 'HELP';
 return null;
}
export function vietnamReceiptDate(at:number):string|null{
 if(!Number.isSafeInteger(at)||at<0)return null;const value=new Date(at+7*3600000);if(!Number.isFinite(value.getTime()))return null;
 const year=value.getUTCFullYear();return year>=1900&&year<=9999?value.toISOString().slice(0,10):null;
}
export function localCalendarMonth(at:number):{start:number;end:number;label:string}|null{
 const date=vietnamReceiptDate(at);if(!date)return null;const year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
 const start=Date.UTC(year,month-1,1)-7*3600000,end=Date.UTC(year,month,1)-7*3600000;
 return {start,end,label:`${month}/${year}`};
}
export const LOCAL_HELP='Cú pháp: “nhắc gọi mẹ mai lúc 9h”. Mình sẽ hỏi nếu thiếu thông tin và gửi đề xuất để bạn xác nhận. Hỏi “hôm nay là ngày mấy âm lịch?” để xem ngày âm; “tháng này có lịch gì ko” để xem lời nhắc trong tháng. Gửi “có” để xác nhận đề xuất hoặc “hủy” để bỏ đề xuất. Các câu hỏi xem lịch không tạo hay thay đổi lời nhắc.';
export const LOCAL_MONTH_STATUSES={PENDING:'Chờ gửi',CLAIMED:'Đang xử lý',RETRYABLE:'Chờ thử lại',SENT:'Đã gửi',FAILED:'Gửi lỗi',UNCERTAIN:'Chưa rõ kết quả'} as const;
export type LocalMonthQuery=SemanticReminderQuery;
export type LocalMonthResult={status:'RESULTS';rows:Array<QueriedReminder&{status:keyof typeof LOCAL_MONTH_STATUSES}>;hasMore:boolean}|{status:'INVALID'|'UNAUTHORIZED'|'STALE'|'UNAVAILABLE'};
export function isLocalMonthQuery(input:LocalMonthQuery):boolean{
 const expected=localCalendarMonth(input.message.receivedAt);return !!expected&&input.context.timezone==='Asia/Ho_Chi_Minh'&&localReadOnlyCommand(input.message.text)==='MONTH'
  &&Number.isSafeInteger(input.context.inboundRowId)&&input.range.start===expected.start&&input.range.end===expected.end;
}
