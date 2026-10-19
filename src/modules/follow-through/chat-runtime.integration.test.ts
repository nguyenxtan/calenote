// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fixture } from "@/modules/conversation/context-contract/infrastructure/d1/test-support";
import { createRuntimeOperations } from "@/worker/composition-root";
import * as transport from "@/modules/connections/providers/secret-provider-transport";
import { D1FollowThroughService } from "./service";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(["zalo", "telegram"] as const)("composes migrated %s private-chat actions with real keyring, receipts and no LLM", async provider => {
  const h = await fixture();
  try {
    h.sqlite!.sqlite.exec(readFileSync("migrations/0014_reminder_follow_through.sql", "utf8"));
    await h.db.prepare("DELETE FROM inbound_updates").run();
    const now = Date.now();
    const credential = provider === "telegram" ? "123456789:AAExample_secret-token_123456789" : "synthetic-zalo-token";
    const encrypted = await h.keyring.encryptCredential("connection", provider, 1, credential);
    await h.db.prepare("UPDATE bot_connections SET provider=?,encrypted_token=?,encrypted_token_iv=? WHERE id='connection'").bind(provider, encrypted.ciphertext, encrypted.iv).run();
    const title = await h.keyring.encryptSensitive("reminder-title", "chat-work", 1, "Private work");
    await h.db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES('chat-work','ABCDEF0123456789abcdef','workspace','identity',?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',?,?)").bind(title.ciphertext, title.iv, now + 60_000, now, now).run();
    const network = vi.fn(async () => { throw new Error("No network is authorized in this test"); });
    vi.stubGlobal("fetch", network);
    const requester = vi.spyOn(transport, "postSecretProviderJson").mockImplementation(async request => {
      expect(request.provider).toBe(provider);
      expect(request.operation).toBe("sendMessage");
      expect(request.body).toMatchObject({ chat_id: "chat" });
      return { ok: true, result: { message_id: "fake-provider-reply" } };
    });
    const operations = await createRuntimeOperations({ DB: h.db, CALENOTE_MASTER_KEY: "A".repeat(43), AI_MODE: "off", JOBS: { send: vi.fn() } } as unknown as Env, { contextContract: "calenote-context-2", sourceSha: "a".repeat(40) });
    async function inbound(id: string, text: string) {
      const encrypted = await h.keyring.encryptSensitive("inbound-message", id, 1, text);
      await h.db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at) VALUES(?,'connection',?,?,'provider-user','chat',?,?,1,'PENDING',?)").bind(id, provider, id, encrypted.ciphertext, encrypted.iv, now + 1).run();
    }
    await inbound("chat-command", "xong ABCDEF01");
    expect(await operations.processInbound("chat-command")).toEqual({ status: "FOLLOW_THROUGH_HANDLED" });
    expect(await h.db.prepare("SELECT progress,revision FROM follow_through_items").first()).toMatchObject({ progress: "DONE", revision: 1 });
    expect(await h.db.prepare("SELECT state FROM inbound_updates WHERE id='chat-command'").first()).toEqual({ state: "PROCESSED" });
    const service = new D1FollowThroughService(h.db, h.keyring);
    const scope = { userId: "owner", chatIdentityId: "identity", connectionId: "connection" };
    expect(await service.receipt(scope, "chat-chat-command")).toMatchObject({ progress: "DONE", revision: 1 });
    expect(await operations.processInbound("chat-command")).toEqual({ status: "TERMINAL" });
    expect(requester).toHaveBeenCalledTimes(1);
    // Simulate process loss after the action transaction but before inbound
    // terminalization. Reclaim changes the claim marker; the receipt key stays.
    await h.db.prepare("UPDATE inbound_updates SET state='PENDING',processed_at=NULL,processing_started_at=NULL,transition_marker=NULL WHERE id='chat-command'").run();
    expect(await operations.processInbound("chat-command")).toEqual({ status: "FOLLOW_THROUGH_HANDLED" });
    expect(requester).toHaveBeenCalledTimes(2);
    expect(network).not.toHaveBeenCalled();
    expect(await h.db.prepare("SELECT count(*) AS n FROM follow_through_action_receipts").first()).toEqual({ n: 1 });
    expect(await h.db.prepare("SELECT count(*) AS n FROM semantic_budget_windows").first()).toEqual({ n: 0 });
    expect(await h.db.prepare("SELECT count(*) AS n FROM command_drafts").first()).toEqual({ n: 0 });
  } finally { h.close(); }
});
