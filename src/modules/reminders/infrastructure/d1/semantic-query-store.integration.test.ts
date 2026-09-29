// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeContextHarness, NOW } from "@/modules/conversation/infrastructure/d1/test-support";
import { D1SemanticReminderQueryStore } from "./semantic-query-store";

let h: Awaited<ReturnType<typeof makeContextHarness>>;
beforeEach(async () => {
  h = await makeContextHarness();
  for (const owner of ["one", "two"]) await h.db.batch([
    h.db.prepare("INSERT INTO workspaces(id,kind,owner_user_id,created_at,updated_at) VALUES(?,'PERSONAL',?,1,1)").bind(`space-${owner}`, owner),
    h.db.prepare("INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES(?,?,'OWNER',1)").bind(`space-${owner}`, owner),
  ]);
}, 20000);
afterEach(async () => { await h?.dispose(); });
const start = Date.parse("2026-10-01T00:00:00+07:00"), end = Date.parse("2026-11-01T00:00:00+07:00");
function input() { return { message: { id: "one-0", connectionId: "connection-one", providerUserId: "provider-one", privateChatId: "private-one", claimMarker: "claim", text: "tháng này", receivedAt: NOW }, context: { userId: "one", chatIdentityId: "chat-one", workspaceId: "space-one", timezone: "Asia/Ho_Chi_Minh", inboundRowId: 1 }, range: { start, end }, referenceTime: NOW }; }
async function insert(id: string, status = "PENDING", scheduledAt = start, chat = "chat-one", owner = "one") {
  await h.db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES(?,?,?,?,x'01',zeroblob(12),1,?,'Asia/Ho_Chi_Minh',?,1,1)").bind(id, `public-${id}`, `space-${owner}`, chat, scheduledAt, status).run();
}
describe("successor scoped read-only D1 list", () => {
  it("month_31_days_includes_sent_and_all_six_statuses_fetch6_show5_stable_order", async () => {
    for (const [i, status] of ["SENT", "PENDING", "CLAIMED", "RETRYABLE", "FAILED", "UNCERTAIN"].entries()) await insert(`r${i}`, status, start + i * 86400000);
    await insert("excluded", "CANCELLED");
    await insert("outside", "SENT", end);
    const store = new D1SemanticReminderQueryStore(h.db);
    const receipt = Date.parse("2026-10-16T10:00:00+07:00");
    await h.db.prepare("UPDATE inbound_updates SET received_at=received_at+?").bind(receipt - NOW).run();
    const args = { ...input(), message: { ...input().message, receivedAt: receipt }, referenceTime: receipt };
    const result = await store.listContext(args);
    expect(result).toMatchObject({ status: "RESULTS", hasMore: true, partialNotice: "5 kết quả đầu; còn kết quả khác", rows: [{ id: "r0", status: "SENT" }, { id: "r1", status: "PENDING" }, { id: "r2", status: "CLAIMED" }, { id: "r3", status: "RETRYABLE" }, { id: "r4", status: "FAILED" }] });
    await h.db.prepare("DELETE FROM reminders WHERE id='r0'").run();
    expect(await store.listContext(args)).toMatchObject({ status: "RESULTS", hasMore: false, rows: expect.arrayContaining([expect.objectContaining({ status: "UNCERTAIN" })]) });
    expect(await store.list(input())).toEqual([]); // Legacy 30-day guard remains.
  });
  it("list_never_writes_reminders_proposals_or_TTL_and_tie_order_is_id", async () => {
    await h.store.save(h.scope(), null, h.initial);
    await insert("b"); await insert("a");
    const tables = ["reminders", "command_drafts", "semantic_contexts", "conversation_contexts", "inbound_updates"];
    const read = () => Promise.all(tables.map(t => h.db.prepare(`SELECT * FROM ${t}`).all()));
    const before = await read();
    const result = await new D1SemanticReminderQueryStore(h.db).listContext(input());
    expect(result).toMatchObject({ status: "RESULTS", hasMore: false, rows: [{ id: "a" }, { id: "b" }] });
    expect((await read()).map(r => r.results)).toEqual(before.map(r => r.results));
  });
  it("same_owner_other_chat_and_cross_owner_rows_are_excluded", async () => {
    await h.db.prepare("INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES('other-connection','one','telegram','other-public','other-bot','Test',x'01',zeroblob(12),'other-fingerprint',1,'ACTIVE_BOUND',1,1)").run();
    await h.db.prepare("INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('other-chat','other-connection','other-user','other-private',1)").run();
    await insert("mine"); await insert("other-chat-row", "SENT", start, "other-chat"); await insert("other-owner", "SENT", start, "chat-two", "two");
    expect(await new D1SemanticReminderQueryStore(h.db).listContext(input())).toMatchObject({ status: "RESULTS", rows: [{ id: "mine" }], hasMore: false });
  });
  it("invalid_unauthorized_stale_and_empty_are_distinct", async () => {
    const store = new D1SemanticReminderQueryStore(h.db), args = input();
    expect(await store.listContext(args)).toMatchObject({ status: "RESULTS", rows: [], hasMore: false });
    for (const range of [{ start, end: start }, { start, end: start + 367 * 86400000 }, { start: NaN, end }]) expect(await store.listContext({ ...args, range })).toMatchObject({ status: "INVALID" });
    for (const context of [{ ...args.context, userId: "two" }, { ...args.context, chatIdentityId: "chat-two" }, { ...args.context, workspaceId: "space-two" }]) expect(await store.listContext({ ...args, context })).toMatchObject({ status: "UNAUTHORIZED" });
    expect(await store.listContext({ ...args, message: { ...args.message, claimMarker: "wrong" } })).toMatchObject({ status: "STALE" });
    await h.db.prepare("UPDATE inbound_updates SET state='PROCESSED' WHERE id='one-1'").run();
    expect(await store.listContext(args)).toMatchObject({ status: "STALE" });
  });
  it("durable_later_context_outcome_fences_even_before_terminal_inbound", async () => {
    expect(await h.store.save(h.scope(1), null, { ...h.initial, id: "newer" })).toBe("SAVED");
    // Existing shared SQL fences semantic outcomes; Conversation V2 has its own
    // durable table and must also be visible to successor reads.
    expect(await new D1SemanticReminderQueryStore(h.db).listContext(input())).toMatchObject({ status: "STALE" });
  });
  it("NULL_lost_claim_is_stale_never_an_empty_success", async () => {
    await h.db.prepare("UPDATE inbound_updates SET transition_marker=NULL WHERE id='one-0'").run();
    expect(await new D1SemanticReminderQueryStore(h.db).listContext(input())).toMatchObject({ status: "STALE" });
  });
  it("query_storage_failure_is_categorical_not_empty", async () => {
    await h.db.prepare("DROP TABLE reminders").run();
    expect(await new D1SemanticReminderQueryStore(h.db).listContext(input())).toMatchObject({ status: "UNAVAILABLE" });
  });
});
