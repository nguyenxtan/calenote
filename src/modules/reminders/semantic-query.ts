import type { SemanticValidationResult } from "@/modules/semantic/validation";
import type { EncryptedValue } from "@/modules/security/keyring";
import type { BoundChatContext, BoundChatMessage } from "./command-service";

const DAY_MS = 86_400_000;
const OFFSET_MS = 7 * 3_600_000;
export const SEMANTIC_QUERY_LIMIT = 5;
export interface ReminderQueryRange { start: number; end: number }
export interface SemanticReminderQuery {
  message: BoundChatMessage;
  context: BoundChatContext;
  range: ReminderQueryRange;
}
export interface QueriedReminder {
  id: string;
  encryptedTitle: EncryptedValue;
  titleKeyVersion: number;
  scheduledAt: number;
}

/** Local calendar ranges are application-owned and relative to inbound receipt. */
export function semanticQueryRange(
  query: Extract<SemanticValidationResult, { kind: "QUERY" }>, referenceTime: number,
): ReminderQueryRange | null {
  if (!Number.isSafeInteger(referenceTime) || referenceTime < 0) return null;
  const today = Math.floor((referenceTime + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
  switch (query.rangeKind) {
    case "TODAY": return { start: today, end: today + DAY_MS };
    case "TOMORROW": return { start: today + DAY_MS, end: today + 2 * DAY_MS };
    case "NEXT_7_DAYS": return { start: today, end: today + 7 * DAY_MS };
    case "UPCOMING": return { start: referenceTime, end: referenceTime + 30 * DAY_MS };
    case "THIS_WEEK": {
      const weekday = new Date(today + OFFSET_MS).getUTCDay();
      const start = today - ((weekday + 6) % 7) * DAY_MS;
      return { start, end: start + 7 * DAY_MS };
    }
    case "DATE": {
      if (!query.localDate || !/^\d{4}-\d{2}-\d{2}$/u.test(query.localDate)) return null;
      const start = Date.parse(`${query.localDate}T00:00:00+07:00`);
      if (!Number.isSafeInteger(start) || Math.abs(start - today) > 366 * DAY_MS) return null;
      if (new Date(start + OFFSET_MS).toISOString().slice(0, 10) !== query.localDate) return null;
      return { start, end: start + DAY_MS };
    }
  }
}
