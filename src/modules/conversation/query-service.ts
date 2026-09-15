import type { Keyring } from "@/modules/security/keyring";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import type { ReminderQueryRangeKind } from "./contracts";
import type { D1ConversationStore } from "./infrastructure/d1/store";
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1_000;
const DAY_MS=86_400_000, MAX_LISTED_REMINDERS=50;

export function canonicalQueryRange(
  kind: ReminderQueryRangeKind,
  referenceTime: number,
  localDate?:string,
): { from: number; to: number } {
  if (!Number.isSafeInteger(referenceTime)) throw new TypeError("Invalid query reference time");
  if(kind==="UPCOMING")return{from:referenceTime,to:referenceTime+7*DAY_MS}; let from:number;
  if(kind==="DATE"){if(!/^\d{4}-\d{2}-\d{2}$/u.test(localDate??""))throw new TypeError("Invalid local date");const[y,m,d]=localDate!.split("-").map(Number),v=new Date(Date.UTC(y,m-1,d));if(v.getUTCFullYear()!==y||v.getUTCMonth()!==m-1||v.getUTCDate()!==d)throw new TypeError("Invalid local date");from=Date.UTC(y,m-1,d)-VIETNAM_OFFSET_MS;}else{const l=new Date(referenceTime+VIETNAM_OFFSET_MS);from=Date.UTC(l.getUTCFullYear(),l.getUTCMonth(),l.getUTCDate())-VIETNAM_OFFSET_MS;if(kind==="TOMORROW")from+=DAY_MS;}return{from,to:from+DAY_MS};
}
export async function listConversationReminders(input:{userId:string;rangeKind:ReminderQueryRangeKind;referenceTime:number;localDate?:string},deps:{store:Pick<D1ConversationStore,"listActiveScheduled">;keyring:Pick<Keyring,"decryptSensitive">}):Promise<Array<{title:string;scheduledAt:number}>>{if(!input.userId)throw new TypeError("Invalid conversation reminder query");const range=canonicalQueryRange(input.rangeKind,input.referenceTime,input.localDate);return Promise.all((await deps.store.listActiveScheduled({userId:input.userId,...range,limit:MAX_LISTED_REMINDERS})).map(async r=>({scheduledAt:r.scheduledAt,title:await deps.keyring.decryptSensitive("reminder-title",r.id,r.titleKeyVersion,{ciphertext:persistedD1Blob(r.titleCiphertext),iv:persistedD1Blob(r.titleIv)})})));}
