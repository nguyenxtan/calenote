import {parseFollowThroughChatCommand} from '@/modules/follow-through/chat-adapter';
import {parsePersonalMemoryChatCommand} from '@/modules/personal-assistant/chat';
import type {ContextSnapshotV2,TranscriptEntry} from './state';

export const BURST_MAX_TURNS=3;
export const BURST_SPAN_MS=10_000;
export const BURST_QUIET_SECONDS=2;
/** A timing/eligibility policy only; no parsed reminder operands or authority. */
export function isBurstFragment(text:string):boolean {
 if(!text.isWellFormed()||text.normalize('NFC').length>1800)return false;
 const normalized=text.normalize('NFC').trim().replace(/\s+/gu,' '),control=normalized.toLocaleLowerCase('vi').replace(/[.!]$/u,'');
 return normalized.length>0&&!normalized.startsWith('/')&&!/\[CONTROL\]/u.test(normalized)
  &&!parseFollowThroughChatCommand(normalized)&&!parsePersonalMemoryChatCommand(normalized)
  &&! /^(?:có|ok|okay|xác nhận|không|bỏ|hủy|huỷ|help|trợ giúp|hướng dẫn|\d+)(?:\s*[:#].*)?$/iu.test(control)
  &&! /^(?:xác nhận|có|ok|okay|không|bỏ|hủy|huỷ)\s+\S{8,}$/iu.test(control)
  &&! /^(?:chào(?: bạn| calenote)?|xin chào(?: bạn| calenote)?|hello|hi)[!.\s]*$/iu.test(normalized);
}
export function isFreshBurstContext(snapshot:ContextSnapshotV2|null):boolean {
 return snapshot===null||snapshot.lifecycle==='NONE'&&snapshot.requestId===null&&snapshot.pendingSemanticCandidate===null
  &&snapshot.pendingDecision===null&&snapshot.pendingReminderQuestion===null&&snapshot.pendingQueryQuestion===null&&snapshot.previewReceipt===null
  &&snapshot.facts.length===0&&snapshot.ambiguities.length===0&&snapshot.controlRegistry.length===0;
}
/** Derives membership from the protected individual receipts, never model output. */
export function burstMemberIndexes(snapshot:ContextSnapshotV2|null,turns:readonly TranscriptEntry[]):number[]|undefined {
 if(!isFreshBurstContext(snapshot)||turns.length<2||turns.length>BURST_MAX_TURNS
  ||turns.some(t=>t.role!=='USER'||!isBurstFragment(t.text)))return;
 const times=turns.map(t=>Date.parse(t.receivedAt));
 if(times.some((t,i)=>!Number.isSafeInteger(t)||i>0&&t<times[i-1])||times.at(-1)!-times[0]>BURST_SPAN_MS)return;
 return turns.map((_,i)=>i);
}
