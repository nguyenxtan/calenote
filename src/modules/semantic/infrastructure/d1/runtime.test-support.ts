import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

export const NOW = Date.UTC(2026, 8, 16, 8);

export async function applySemanticMigration(db: D1Database): Promise<void> {
  const sql = readFileSync(resolve(process.cwd(), "migrations/0005_semantic_context_and_budget.sql"), "utf8");
  for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

export async function semanticRuntime(persist?: string) {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-03",
    d1Databases: { DB: "00000000-0000-0000-0000-000000000005" },
    ...(persist ? { resourcePersistencePath: persist } : {}),
    port: 0,
  }));
  const db = await runtime.getD1Database("DB") as unknown as D1Database;
  return { runtime, db };
}

export async function seedSemanticRuntime(db: D1Database) {
  for (const file of ["0001_production_mvp.sql", "0002_onboarding_transition_marker.sql",
    "0003_source_action_foundation.sql", "0004_user_preferences.sql"]) {
    const sql = readFileSync(resolve(process.cwd(), "migrations", file), "utf8");
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  await applySemanticMigration(db);
  for (const owner of ["one", "two"]) {
    await db.batch([
      db.prepare(`INSERT INTO users (id,email,display_name,timezone,created_at,updated_at)
        VALUES (?,?,'Test','Asia/Ho_Chi_Minh',1,1)`).bind(owner, `${owner}@example.test`),
      db.prepare(`INSERT INTO bot_connections (id,user_id,provider,public_id,provider_bot_id,
        display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at)
        VALUES (?,?,'telegram',?,?,'Test',x'01',zeroblob(12),?,1,'ACTIVE_BOUND',1,1)`)
        .bind(`connection-${owner}`, owner, `public-${owner}`, `bot-${owner}`, `fingerprint-${owner}`),
      db.prepare(`INSERT INTO chat_identities (id,connection_id,provider_user_id,private_chat_id,linked_at)
        VALUES (?,?,?, ?,1)`)
        .bind(`chat-${owner}`, `connection-${owner}`, `provider-${owner}`, `private-${owner}`),
    ]);
    for (let index = 0; index < 40; index++) {
      await db.prepare(`INSERT INTO inbound_updates
        (id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,
         message_ciphertext,message_iv,message_key_version,state,received_at,transition_marker)
         VALUES (?,?,'telegram',?,?,?,x'01',zeroblob(12),1,'PROCESSING',?,'claim')`)
        .bind(`${owner}-${index}`, `connection-${owner}`, `${owner}-${index}`,
          `provider-${owner}`, `private-${owner}`, NOW + index).run();
    }
  }
}
