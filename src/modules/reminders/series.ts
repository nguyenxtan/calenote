import { PendingRequestSchema, type ConversationScope, type PendingRequest } from "../conversation/contracts";
import { lunarCalendar } from "../conversation/lunar-calendar";
import { MAX_SEMANTIC_SCHEDULE_AHEAD_MS } from "../semantic/validation";

export interface SeriesOccurrence { index: number; scheduledAt: number; localDate: string }
export type SeriesExpansion = { status: "READY"; occurrences: SeriesOccurrence[] }
  | { status: "REJECTED"; reason: "MISSING" | "INVALID" | "PAST" | "LIMIT" };
const DAY = 86_400_000;

export function expandFiniteSeries(request: PendingRequest, now: number): SeriesExpansion {
  const reject = (reason: "MISSING" | "INVALID" | "PAST" | "LIMIT"): SeriesExpansion => ({ status: "REJECTED", reason });
  if (!PendingRequestSchema.safeParse(request).success || !Number.isSafeInteger(now) || now < 0) return reject("INVALID");
  if (!request.title || !request.reminderTime || !request.relation || request.count === null || request.missing.length || request.lunarInput) return reject("MISSING");
  if (request.count < 2 || request.count > 30) return reject("LIMIT");
  const anchor = request.relation === "STARTING_ON" ? request.reminderDate : request.eventDate;
  if (!anchor) return reject("MISSING");
  if (anchor.calendar !== request.calendar) return reject("INVALID");
  if (anchor.calendar === "LUNAR_VN") {
    if (!anchor.lunar || anchor.conversionVersion !== lunarCalendar.version) return reject("INVALID");
    const converted = lunarCalendar.toSolar(anchor.lunar);
    if (converted.status !== "RESOLVED" || converted.solarDate !== anchor.solarDate) return reject("INVALID");
  }
  const offset = request.relation === "BEFORE_EVENT" ? -request.count : request.relation === "INCLUDING_EVENT" ? 1 - request.count : 0;
  const start = Date.parse(`${anchor.solarDate}T00:00:00Z`) + offset * DAY;
  const [hour, minute] = request.reminderTime.split(":").map(Number);
  const occurrences: SeriesOccurrence[] = [];
  for (let index = 0; index < request.count; index++) {
    const day = start + index * DAY;
    const scheduledAt = day + ((hour - 7) * 60 + minute) * 60_000;
    if (scheduledAt <= now) return reject("PAST");
    if (scheduledAt - now > MAX_SEMANTIC_SCHEDULE_AHEAD_MS) return reject("LIMIT");
    occurrences.push({ index, scheduledAt, localDate: new Date(day).toISOString().slice(0, 10) });
  }
  return { status: "READY", occurrences };
}

export interface SeriesStore {
  propose(scope: ConversationScope, request: PendingRequest, contextId: string, contextRevision: number): Promise<{ proposalId: string; revision: number } | null>;
  confirm(scope: ConversationScope, proposalId: string, revision: number): Promise<
    { status: "CONFIRMED" | "ALREADY_CONFIRMED"; seriesId: string } | { status: "STALE" | "EXPIRED" | "REJECTED" }>;
  proposeCancellation(scope: ConversationScope, seriesId: string): Promise<{ proposalId: string; revision: number } | null>;
  cancelRemaining(scope: ConversationScope, proposalId: string, revision: number): Promise<"CANCELLED" | "ALREADY_CANCELLED" | "STALE">;
}
