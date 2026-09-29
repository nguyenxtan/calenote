// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { fixture } from "./infrastructure/d1/test-support";
import { buildContextInput } from "./context";
import { chat, message } from "./context-test-fixtures";
import { validateEvidence } from "./evidence";
import { selectControl } from "./decisions";
import { transitionConversation, type ConversationTransition } from "./transition";
import type { ContextSnapshotV1 } from "./state";
import { date, time } from "./resolution-test-support";
import { persistedD1Blob } from "@/modules/db/persisted-blob";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); });
async function setup() {
  const f = await fixture(); fixtures.push(f);
  const read = async (i: number, text: string) => {
    const scope = f.scope(i), observed = await f.store.observe(scope);
    if ("failure" in observed) throw new Error(observed.failure);
    const msg = { ...message(text), id: scope.sourceInboundId, receivedAt: scope.now, claimMarker: scope.claimMarker };
    const built = buildContextInput({ message: msg, context: { ...chat, inboundRowId: observed.observation.inbound.rowid }, snapshot: observed.snapshot, observation: observed.observation });
    if (built.status !== "READY") throw new Error(built.reason);
    return { scope, observed, built };
  };
  const persist = async (turn: Awaited<ReturnType<typeof read>>, result: ConversationTransition, delivery: "SENT" | "FAILED" | "UNCERTAIN" = "SENT") => {
    if ("kind" in result) throw new Error(result.reason ?? "reply only");
    expect(await f.store.apply(turn.scope, turn.observed.observation, result)).toMatchObject({ status: "APPLIED" });
    expect(await f.store.recordDelivery(turn.scope, { contextId: result.snapshot.id, contextRevision: result.snapshot.contextRevision, draftRevision: result.snapshot.draftRevision, outboundId: result.snapshot.transcript.at(-1)!.id, decisionId: result.snapshot.pendingDecision?.decisionId ?? null, deliveryState: delivery, messageRef: delivery === "SENT" ? `sent-${turn.scope.sourceInboundId}` : null })).toBe("RECORDED");
    return result;
  };
  const semantic = async (i: number, values: Record<string, unknown>, act: "NEW_REQUEST" | "EDIT" | "CONTINUE" = "NEW_REQUEST", delivery: "SENT" | "FAILED" | "UNCERTAIN" = "SENT") => {
    const text = "nhắc đi thi gọi mẹ giỗ 2026 8h 9h 2 lần", turn = await read(i, text);
    const evidence = [{ kind: "USER_QUOTE", turn: turn.built.input.currentTurn, quote: text, occurrence: 1 }];
    const checked = validateEvidence({ schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: act, continuation: act === "NEW_REQUEST" ? "NO" : "YES", changes: Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence })), query: null, uncertainties: [], controlEvidence: [] }, turn.built);
    if (checked.status !== "VALID") throw new Error(checked.reason);
    const result = await transitionConversation({ snapshot: turn.observed.snapshot, interpretation: checked.patch, control: { kind: "NONE" }, now: turn.scope.now, channel: "TELEGRAM" });
    return persist(turn, result, delivery);
  };
  const control = async (i: number, text: string | ((s: ContextSnapshotV1) => string), replyReference?: string) => {
    const initial = await f.store.observe(f.scope(i));
    if ("failure" in initial || !initial.snapshot) throw new Error("state");
    const actual = typeof text === "string" ? text : text(initial.snapshot);
    const turn = await read(i, actual), authority = { kind: "CHAT", scope: turn.scope } as const;
    const selected = selectControl(actual, turn.observed.snapshot!.pendingDecision, authority, { snapshot: turn.observed.snapshot!, replyReference });
    const result = await transitionConversation({ snapshot: turn.observed.snapshot, received: turn.built.candidateSnapshot, control: selected, authority, now: turn.scope.now, channel: "TELEGRAM" });
    return { turn, authority, result };
  };
  return { f, read, persist, semantic, control };
}
const complete = { title: "đi thi", reminderDate: date(8, 10, 2026), reminderTime: time(), frequency: "ONCE" };
it.each([
  ["direct", "TOKEN"], ["direct", "REPLY"], ["annual one-off", "TOKEN"], ["annual one-off", "REPLY"],
] as const)("replacement binding: %s rejects bare save and permits exact B via %s", async (replacementKind, boundKind) => {
  const h = await setup();
  const a = await h.semantic(0, complete);
  const annual = replacementKind === "annual one-off", title = annual ? "giỗ" : "gọi mẹ";
  await h.semantic(1, { ...complete, title, frequency: annual ? "YEARLY" : "ONCE" });
  let next = 2;
  if (annual) {
    const alternative = await h.control(next++, s => `đồng ý ${s.pendingDecision!.tokenHandle}`);
    const offer = await h.persist(alternative.turn, alternative.result);
    expect(offer.snapshot.pendingDecision?.kind).toBe("REPLACE_PENDING");
  }
  const replacement = await h.control(next++, "Có.");
  const b = await h.persist(replacement.turn, replacement.result);
  const bare = await h.control(next++, "Có.");
  const current = bare.turn.observed.snapshot!, decision = current.pendingDecision!;
  // Test both the pure selector and the durable store guard, without treating
  // the rejected bare input as a delivery or renewal of B's preview.
  expect(bare.result).not.toHaveProperty("confirmationProof");
  expect(await h.f.store.confirm(bare.authority, {
    operationKey: `bare-${bare.turn.scope.sourceInboundId}`, contextId: current.id,
    contextRevision: current.contextRevision, decisionId: decision.decisionId,
    kind: decision.kind, requestId: decision.target.requestId, proposalId: decision.target.proposalId,
    draftRevision: decision.draftRevision, draftHash: current.previewReceipt!.draftHash,
    response: { kind: "BARE", text: "Có." },
  })).toEqual({ status: "REJECTED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(current.draftRevision).toBe(a.snapshot.draftRevision! + 1);
  expect(decision).toMatchObject({ kind: "SAVE_PREVIEW", deliveryState: "SENT", draftRevision: current.draftRevision });
  const save = boundKind === "TOKEN"
    ? await h.control(next, s => `xác nhận ${s.pendingDecision!.tokenHandle}`)
    : await h.control(next, "Có.", decision.replyReference!);
  if (!("confirmationProof" in save.result) || !save.result.confirmationProof) throw new Error("bound save proof");
  expect(save.result.confirmationProof).toMatchObject({ requestId: b.snapshot.requestId, draftRevision: current.draftRevision, response: { kind: boundKind } });
  expect(await h.f.store.confirm(save.authority, save.result.confirmationProof)).toMatchObject({ status: "COMMITTED", childCount: 1 });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  const row = await h.f.db.prepare("SELECT id,source_draft_id,title_ciphertext,title_iv FROM reminders").first<{ id: string; source_draft_id: string; title_ciphertext: unknown; title_iv: unknown }>();
  expect(row!.source_draft_id).toBe(b.snapshot.requestId);
  expect(await h.f.keyring.decryptSensitive("reminder-title", row!.id, 1, { ciphertext: persistedD1Blob(row!.title_ciphertext), iv: persistedD1Blob(row!.title_iv) })).toBe(title);
});
it("standalone initial preview retains valid bare save", async () => {
  const h = await setup();
  const initial = await h.semantic(0, complete);
  expect(initial.snapshot.draftRevision).toBe(1);
  const save = await h.control(1, "Có.");
  if (!("confirmationProof" in save.result) || !save.result.confirmationProof) throw new Error("initial bare proof");
  expect(save.result.confirmationProof.response.kind).toBe("BARE");
  expect(await h.f.store.confirm(save.authority, save.result.confirmationProof)).toMatchObject({ status: "COMMITTED", childCount: 1 });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
});
it("real T5 transition persists, delivers, replaces and separately confirms through T4", async () => {
  const h = await setup();
  await h.semantic(0, complete);
  await h.semantic(1, { ...complete, title: "gọi mẹ" });
  const replacement = await h.control(2, "Có.");
  await h.persist(replacement.turn, replacement.result);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  const save = await h.control(3, s => `xác nhận ${s.pendingDecision!.tokenHandle}`);
  if (!("confirmationProof" in save.result) || !save.result.confirmationProof) throw new Error("save proof");
  expect(await h.f.store.confirm(save.authority, save.result.confirmationProof)).toMatchObject({ status: "COMMITTED", childCount: 1 });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
});
it.each(["FAILED", "UNCERTAIN"] as const)("real T5 %s preview has no save authority and keeps the draft", async delivery => {
  const h = await setup();
  const first = await h.semantic(0, complete, "NEW_REQUEST", delivery);
  const next = await h.control(1, "Có.");
  expect(next.result).not.toHaveProperty("confirmationProof");
  expect(next.turn.observed.snapshot).toMatchObject({ pendingDecision: null, draftExpiresAt: first.snapshot.draftExpiresAt });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("real T5 one-time offer with A requires replacement and new preview even for a series", async () => {
  const h = await setup();
  await h.semantic(0, { ...complete, frequency: "DAILY", occurrenceCount: 2 });
  await h.semantic(1, { ...complete, title: "giỗ", frequency: "YEARLY" });
  const alternative = await h.control(2, s => `đồng ý ${s.pendingDecision!.tokenHandle}`);
  const replace = await h.persist(alternative.turn, alternative.result);
  expect(replace.snapshot.pendingDecision?.kind).toBe("REPLACE_PENDING");
  const accepted = await h.control(3, "Có.");
  const b = await h.persist(accepted.turn, accepted.result);
  expect(b.snapshot.slots.frequency.value).toBe("ONCE");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("delivery of an ambiguous-target notice cannot enable the retained offer", async () => {
  const h = await setup();
  await h.semantic(0, complete);
  await h.semantic(1, { title: "gọi mẹ" });
  const ambiguous = await h.control(2, "Bỏ.");
  await h.persist(ambiguous.turn, ambiguous.result);
  const next = await h.control(3, "Có.");
  expect(next.turn.observed.snapshot?.pendingDecision?.deliveryState).toBe("UNCERTAIN");
  expect(next.result).not.toHaveProperty("decisionProof");
  expect(next.result).not.toHaveProperty("confirmationProof");
  const declined = await h.control(4, "2");
  const result = await h.persist(declined.turn, declined.result);
  expect(result.snapshot.slots.title.value).toBe("đi thi");
  expect(result.snapshot.pendingDecision).toBeNull();
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
