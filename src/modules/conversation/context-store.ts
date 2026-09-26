import type { ConversationScope, ConversationSnapshot } from "./contracts";

export interface ConversationStore {
  load(scope: ConversationScope): Promise<ConversationSnapshot | null>;
  save(scope: ConversationScope, expectedRevision: number | null,
    next: ConversationSnapshot): Promise<"SAVED" | "STALE" | "INVALID">;
  finish(scope: ConversationScope, id: string, expectedRevision: number,
    status: "COMPLETED" | "CANCELLED" | "INVALID"): Promise<boolean>;
  purgeExpired(now: number, limit: number): Promise<number>;
}
export class InvalidConversationContextError extends Error {
  constructor() { super("INVALID_CONVERSATION_CONTEXT"); }
}
