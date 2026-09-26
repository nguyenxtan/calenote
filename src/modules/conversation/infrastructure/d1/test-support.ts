import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createKeyring } from "@/modules/security/keyring";
import { NOW, seedSemanticRuntime, semanticRuntime } from "@/modules/semantic/infrastructure/d1/runtime.test-support";
import { D1ConversationStore } from "./context-store";
import type { ConversationSnapshot, ConversationScope } from "../../contracts";

export { NOW };
export async function makeContextHarness() {
  const {db, runtime} = await semanticRuntime();
  try {
    await seedSemanticRuntime(db);
    const migration = readFileSync(resolve(process.cwd(), "migrations/0007_conversation_context_v2.sql"), "utf8");
    for (const sql of migration.split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
    const keyring = await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const store = new D1ConversationStore(db, keyring);
    const scope = (index = 0): ConversationScope => ({ownerId: "one", chatIdentityId: "chat-one",
      sourceInboundId: `one-${index}`, claimMarker: "claim", now: NOW + index});
    const initial: ConversationSnapshot = {id: "conversation-one", revision: 1, status: "CLARIFYING",
      createdAt: NOW, expiresAt: NOW + 30 * 60_000,
      request: {title: "ôn thi bí mật", calendar: "GREGORIAN", eventDate: null, reminderDate: null,
        reminderTime: null, count: null, relation: null, missing: ["time"]},
      turns: [{userText: "mai nhắc ôn thi bí mật", receivedAt: NOW, outcomeCode: "CLARIFY_TIME"}]};
    return {db, runtime, keyring, store, scope, initial, dispose: () => runtime.dispose()};
  } catch (error) { await runtime.dispose(); throw error; }
}
