import type {SemanticReminderQuery,QueriedReminder} from '../reminders/semantic-query';
export type LocalReadOnlyCommand='LUNAR_TODAY'|'MONTH'|'HELP';
/** Vietnamese read-only question grammar; normalization grants no write authority.
 * Full utterance matching rejects quoted, conditional and compound instructions.
 */
export function localReadOnlyCommand(text: string): LocalReadOnlyCommand | null {
  let value = text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/gu, 'd')
    .trim().toLowerCase().replace(/\s+/gu, ' ');
  // Delimiters cannot smuggle another task, quoted content or control markup.
  if (/["'“”‘’«»;:<>{}\[\]|]/u.test(value)) return null;
  value = value.replace(/[.!?]+$/u, '').trim()
    .replace(/ (?:nhe|nha|a|voi|giup (?:minh|toi)|duoc (?:khong|ko))$/u, '')
    .replace(/^(?:ban )?(?:cho (?:(?:minh|toi|em) )?(?:hoi|biet|xem)|giup (?:minh|toi)(?: xem)?) /u, '')
    .replace(/^(?:xem|liet ke) /u, '');
  const today = '(?:hom nay|nay)';
  const lunar = '(?:am lich|lich am|am)';
  const number = '(?:ngay )?(?:may|bao nhieu)';
  const lunarForms = [
    `${today} (?:la )?${number} ${lunar}`,
    `${today} (?:la )?${lunar} (?:la )?${number}`,
    `${today} ngay ${lunar} (?:la )?${number}`,
    `(?:ngay )?${lunar} (?:cua )?${today}(?: (?:la )?${number})?`,
  ];
  if (lunarForms.some(form => new RegExp(`^${form}$`, 'u').test(value))) return 'LUNAR_TODAY';

  const owner = '(?:minh|toi|em|tui)';
  const entries = '(?:lich|loi nhac|viec|su kien|cuoc hen)';
  const plural = '(?:(?:cac|nhung) )?';
  const month = '(?:trong )?thang nay';
  const monthForms = [
    `${plural}${entries}(?: cua ${owner})? ${month}(?: cua ${owner})?(?: co (?:nhung )?(?:gi|${entries} nao)(?: (?:khong|ko|k))?)?`,
    `thang nay (?:${owner} )?co ${plural}${entries} (?:gi|nao)(?: (?:khong|ko|k))?`,
    `(?:${owner} )?co ${plural}${entries} (?:gi|nao) ${month}(?: (?:khong|ko|k))?`,
  ];
  if (monthForms.some(form => new RegExp(`^${form}$`, 'u').test(value))) return 'MONTH';

  const helpForms = [
    '(?:cu phap|cach dung(?: bot)?) (?:nhu (?:the )?nao|la gi)',
    '(?:huong dan(?: su dung| dung(?: bot)?)?|tro giup|/help|help)',
    '(?:lam sao|lam the nao) de (?:tao loi nhac|nhac lich)',
    'nhac lich (?:nhu (?:the )?nao|the nao)',
    `(?:${owner} )?can gui cu phap gi`,
  ];
  return helpForms.some(form => new RegExp(`^${form}$`, 'u').test(value)) ? 'HELP' : null;
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
export const LOCAL_HELP='Không cần cú pháp cố định. Bạn cứ nói tự nhiên, ví dụ: “mai 9h nhắc mình gọi mẹ”. Mình sẽ hỏi nếu thiếu hoặc mơ hồ về nội dung, ngày giờ và gửi đề xuất để bạn xác nhận trước khi tạo lời nhắc. Hỏi “hôm nay là ngày mấy âm lịch?” để xem ngày âm; “tháng này có lịch gì ko” để xem lời nhắc trong tháng. Gửi “có” để xác nhận đề xuất hoặc “hủy” để bỏ đề xuất. Các câu hỏi xem lịch không tạo hay thay đổi lời nhắc.';
export const LOCAL_MONTH_STATUSES={PENDING:'Chờ gửi',CLAIMED:'Đang xử lý',RETRYABLE:'Chờ thử lại',SENT:'Đã gửi',FAILED:'Gửi lỗi',UNCERTAIN:'Chưa rõ kết quả'} as const;
export type LocalMonthQuery=SemanticReminderQuery;
export type LocalMonthResult={status:'RESULTS';rows:Array<QueriedReminder&{status:keyof typeof LOCAL_MONTH_STATUSES}>;hasMore:boolean}|{status:'INVALID'|'UNAUTHORIZED'|'STALE'|'UNAVAILABLE'};
export function isLocalMonthQuery(input:LocalMonthQuery):boolean{
 const expected=localCalendarMonth(input.message.receivedAt);return !!expected&&input.context.timezone==='Asia/Ho_Chi_Minh'&&localReadOnlyCommand(input.message.text)==='MONTH'
  &&Number.isSafeInteger(input.context.inboundRowId)&&input.range.start===expected.start&&input.range.end===expected.end;
}
