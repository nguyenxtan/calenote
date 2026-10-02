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
import { buildContextInputV2 } from "./context";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import * as successorTransition from "./transition";
import * as successorGuidance from "./guidance";
import { createD1ContextContractStoreV3 } from "./infrastructure/d1/store";
import { CONTEXT_PROTOCOL_V3 } from "./protocol";
import type { ContextSnapshotV2 } from "./state";
import { mergePatchV3 } from "./merge";
import { resolveRequest } from "./resolve";
import { lunarCalendar } from "../lunar-calendar";

async function setupSuccessor() {
  const f = await fixture(); fixtures.push(f);
  const store = createD1ContextContractStoreV3({ db: f.db, keyring: f.keyring, protocol: CONTEXT_PROTOCOL_V3 });
  const read = async (i: number, text: string, receivedAt?: number) => {
    const scope = { ...f.scope(i), ...(receivedAt === undefined ? {} : { now: receivedAt }) };
    if (receivedAt !== undefined) await f.db.prepare("UPDATE inbound_updates SET received_at=? WHERE id=?").bind(receivedAt, scope.sourceInboundId).run();
    const observed = await store.observe(scope);
    if ("failure" in observed) throw new Error(observed.failure);
    const built = buildContextInputV2({ message: { ...message(text), id: scope.sourceInboundId, receivedAt: scope.now, claimMarker: scope.claimMarker }, context: { ...chat, inboundRowId: observed.observation.inbound.rowid }, snapshot: observed.snapshot, observation: observed.observation });
    if (built.status !== "READY") throw new Error(built.reason);
    return { scope, observed, built };
  };
  const semantic = async (i: number, values: Record<string, unknown>, target: "NEW" | "CURRENT" | "UNRESOLVED" = "NEW", operation = "SET", guidance?: Parameters<typeof successorTransition.transitionConversationV3>[0]["guidance"], text = "nhắc đi thi gọi mẹ giỗ 2026 8h 9h 2 lần", receivedAt?: number) => {
    const turn = await read(i, text, receivedAt);
    const evidence = [{ kind: "USER_QUOTE", turn: turn.built.input.currentTurn, quote: text, occurrence: 1 }];
    const proposal = SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: target, evidence }, changes: Object.entries(values).map(([field, value]) => ({ field, operation, value, evidence })), query: null, uncertainties: [] });
    const checked = validateEvidenceV3(proposal, turn.built);
    if (checked.status !== "VALID") throw new Error(checked.reason);
    const merge = mergePatchV3(turn.observed.snapshot, checked.patch);
    expect(successorTransition.transitionConversationV3, "successor must compose state2 through independent semantic authority").toBeTypeOf("function");
    const result = await successorTransition.transitionConversationV3({ snapshot: turn.observed.snapshot, interpretation: checked.patch, merge, control: { kind: "NONE" }, now: turn.scope.now, channel: "TELEGRAM", guidance });
    return { turn, result, patch: checked.patch, merge };
  };
  const persist = async (turn: Awaited<ReturnType<typeof read>>, result: successorTransition.ConversationTransitionV3, delivery: "SENT" | "FAILED" | "UNCERTAIN" = "SENT") => {
    if ("kind" in result) throw new Error(result.reason ?? "reply only");
    expect(await store.apply(turn.scope, turn.observed.observation, result)).toMatchObject({ status: "APPLIED" });
    if (!result.terminal) expect(await store.recordDelivery(turn.scope, { contextId: result.snapshot.id, contextRevision: result.snapshot.contextRevision, draftRevision: result.snapshot.draftRevision, outboundId: result.snapshot.transcript.at(-1)!.id, decisionId: result.snapshot.pendingDecision?.decisionId ?? null, deliveryState: delivery, messageRef: delivery === "SENT" ? `sent-${turn.scope.sourceInboundId}` : null })).toBe("RECORDED");
    return result;
  };
  const control = async (i: number, text: string | ((s: ContextSnapshotV2) => string)) => {
    const initial = await store.observe(f.scope(i));
    if ("failure" in initial || !initial.snapshot) throw new Error("state");
    const actual = typeof text === "string" ? text : text(initial.snapshot), turn = await read(i, actual), authority = { kind: "CHAT", scope: turn.scope } as const;
    const selected = selectControl(actual, initial.snapshot.pendingDecision, authority, { snapshot: initial.snapshot, now: turn.scope.now });
    const result = await successorTransition.transitionConversationV3({ snapshot: initial.snapshot, received: turn.built.candidateSnapshot, control: selected, authority, now: turn.scope.now, channel: "TELEGRAM" });
    return { turn, result, authority };
  };
  return { f, store, read, semantic, persist, control };
}

it.each((["PROVIDER", "BUDGET", "SIZE"] as const).flatMap(failure => (["SENT", "UNCERTAIN"] as const).map(delivery => ({ failure, delivery }))))("A4 $failure refusal preserves $delivery grounded targeting candidate for valid retry", async ({ failure, delivery }) => {
  const h = await setupSuccessor(), pending = await h.semantic(0, { title: "đi thi" }, "UNRESOLVED");
  await h.persist(pending.turn, pending.result, delivery);
  const turn = await h.read(1, "tạo yêu cầu mới");
  const original = turn.observed.snapshot!;
  const failed = await successorTransition.transitionConversationV3({ snapshot: original, received: turn.built.candidateSnapshot, control: { kind: "NONE" }, failure, now: turn.scope.now, channel: "TELEGRAM" });
  if ("kind" in failed) throw new Error("persisted refusal");
  expect(failed.snapshot.pendingSemanticCandidate).toEqual({ ...original.pendingSemanticCandidate, baseContextRevision: failed.snapshot.contextRevision });
  expect(failed.snapshot.pendingReminderQuestion).toEqual(original.pendingReminderQuestion);
  expect(failed.snapshot.slots).toEqual(original.slots);
  expect(failed.snapshot.draftExpiresAt).toEqual(original.draftExpiresAt);
  expect(failed.snapshot.pendingDecision).toBeNull(); expect(failed.preview).toBeNull();
  expect(failed).not.toHaveProperty("confirmationProof"); expect(failed.terminal).toBeNull();
  // Delivering the refusal is not delivery of the earlier operation question.
  await h.persist(turn, failed);
  const retained = await h.store.observe(h.f.scope(2));
  if ("failure" in retained) throw new Error(retained.failure);
  expect(retained.snapshot?.pendingReminderQuestion).toEqual(original.pendingReminderQuestion);
  expect(retained.snapshot?.pendingSemanticCandidate).toEqual(failed.snapshot.pendingSemanticCandidate);
  const retry = await h.semantic(2, {}, delivery === "SENT" ? "NEW" : "CURRENT", "SET", undefined, "tạo yêu cầu mới");
  const next = await h.persist(retry.turn, retry.result, "UNCERTAIN");
  if (delivery === "SENT") {
    expect(next.snapshot.pendingSemanticCandidate).toBeNull();
    expect(next.snapshot.slots.title).toMatchObject({ value: "đi thi", evidence: [{ sourceTurnId: "old" }] });
    expect(next.snapshot.draftCreatedAt).toBe(original.pendingSemanticCandidate!.createdAt);
    expect(next.snapshot.draftExpiresAt).toBe(original.pendingSemanticCandidate!.expiresAt);
  } else {
    expect(next.snapshot.slots.title.value).toBeNull();
    expect(next.snapshot.pendingSemanticCandidate?.proposalId).toBe(original.pendingSemanticCandidate!.proposalId);
    expect(next.snapshot.pendingReminderQuestion?.questionId).toBe(original.pendingReminderQuestion!.questionId);
    expect(next.snapshot.pendingReminderQuestion?.deliveryState).toBe("UNCERTAIN");
    expect(await h.store.recordDelivery(retry.turn.scope, { contextId: next.snapshot.id, contextRevision: next.snapshot.contextRevision, draftRevision: next.snapshot.draftRevision, outboundId: next.snapshot.pendingReminderQuestion!.questionId, decisionId: null, deliveryState: "SENT", messageRef: "delivered-operation-question" })).toBe("RECORDED");
    const afterDelivery = await h.semantic(3, {}, "NEW", "SET", undefined, "tạo yêu cầu mới");
    const adopted = await h.persist(afterDelivery.turn, afterDelivery.result);
    expect(adopted.snapshot.slots.title).toMatchObject({ value: "đi thi", evidence: [{ sourceTurnId: "old" }] });
    expect(adopted.snapshot.draftExpiresAt).toBe(original.pendingSemanticCandidate!.expiresAt);
  }
  expect(next.preview).toBeNull(); expect(next.snapshot.pendingDecision).toBeNull();
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it.each([599999, 600000])("A4 selected D1 confirmation at original candidate age %i never renews adoption TTL", async age => {
  const h = await setupSuccessor(), pending = await h.semantic(0, complete, "UNRESOLVED");
  const initial = await h.persist(pending.turn, pending.result);
  const origin = initial.snapshot.pendingSemanticCandidate!;
  const adopted = await h.semantic(1, {}, "NEW", "SET", undefined, "tạo yêu cầu mới", h.f.scope(0).now + 300000);
  const preview = await h.persist(adopted.turn, adopted.result);
  expect(preview.snapshot.draftCreatedAt).toBe(origin.createdAt);
  expect(preview.snapshot.draftExpiresAt).toBe(origin.expiresAt);
  expect(preview.snapshot.pendingDecision?.kind).toBe("SAVE_PREVIEW");
  const d = preview.snapshot.pendingDecision!, p = preview.snapshot.previewReceipt!;
  const proof = { operationKey: `expiry-${age}`, contextId: preview.snapshot.id, contextRevision: preview.snapshot.contextRevision, decisionId: d.decisionId, kind: d.kind, requestId: d.target.requestId, proposalId: d.target.proposalId, draftRevision: d.draftRevision, draftHash: p.draftHash, response: { kind: "TOKEN" as const, handle: d.tokenHandle! } };
  const scope = { ...h.f.scope(2), now: h.f.scope(0).now + age };
  await h.f.db.prepare("UPDATE inbound_updates SET received_at=? WHERE id=?").bind(scope.now, scope.sourceInboundId).run();
  const before = await h.f.db.prepare("SELECT revision,status FROM conversation_contexts").first();
  const outcomesBefore = await h.f.db.prepare("SELECT count(*) n FROM conversation_context_outcomes").first("n");
  const draftsBefore = await h.f.db.prepare("SELECT status FROM command_drafts").all();
  const proposalsBefore = await h.f.db.prepare("SELECT status FROM reminder_series_proposals").all();
  const outcomeBefore = await h.store.readOutcome({ kind: "CHAT", scope }, proof.operationKey);
  const result = await h.store.confirm({ kind: "CHAT", scope }, proof);
  if (age < 600000) expect(result).toMatchObject({ status: "COMMITTED", childCount: 1 });
  else {
    expect(result).toEqual({ status: "EXPIRED" });
    expect(await h.f.db.prepare("SELECT revision,status FROM conversation_contexts").first()).toEqual(before);
    expect(await h.f.db.prepare("SELECT count(*) n FROM conversation_context_outcomes").first("n")).toBe(outcomesBefore);
    expect(await h.f.db.prepare("SELECT status FROM command_drafts").all()).toEqual(draftsBefore);
    expect(await h.f.db.prepare("SELECT status FROM reminder_series_proposals").all()).toEqual(proposalsBefore);
    expect(outcomeBefore).toBeNull();
    expect(await h.store.readOutcome({ kind: "CHAT", scope }, proof.operationKey)).toEqual(outcomeBefore);
  }
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(age < 600000 ? 1 : 0);
});

it.each(["PROVIDER", "BUDGET", "SIZE"] as const)("A4 %s refusal retains accepted draft but invalidates old save proof", async failure => {
  const h = await setupSuccessor(), a = await h.semantic(0, complete), preview = await h.persist(a.turn, a.result);
  const d = preview.snapshot.pendingDecision!, p = preview.snapshot.previewReceipt!;
  const proof = { operationKey: "refused-old-preview", contextId: preview.snapshot.id, contextRevision: preview.snapshot.contextRevision, decisionId: d.decisionId, kind: d.kind, requestId: d.target.requestId, proposalId: d.target.proposalId, draftRevision: d.draftRevision, draftHash: p.draftHash, response: { kind: "TOKEN" as const, handle: d.tokenHandle! } };
  const turn = await h.read(1, "Có, nhưng đổi giờ");
  const refusal = await successorTransition.transitionConversationV3({ snapshot: turn.observed.snapshot, received: turn.built.candidateSnapshot, control: { kind: "NONE" }, failure, now: turn.scope.now, channel: "TELEGRAM" });
  const retained = await h.persist(turn, refusal);
  expect(retained.snapshot.slots).toEqual(preview.snapshot.slots);
  expect(retained.snapshot.draftRevision).toBe(preview.snapshot.draftRevision);
  expect(retained.snapshot.draftExpiresAt).toBe(preview.snapshot.draftExpiresAt);
  expect(retained.snapshot.pendingDecision).toBeNull(); expect(retained.snapshot.previewReceipt).toBeNull();
  expect(retained.preview).toBeNull(); expect(retained).not.toHaveProperty("confirmationProof");
  expect(await h.store.confirm({ kind: "CHAT", scope: h.f.scope(2) }, proof)).toEqual({ status: "REJECTED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("A4 new_request_yes_only_replaces_pending; fresh bound save is exactly once", async () => {
  const h = await setupSuccessor();
  const a = await h.semantic(0, complete); await h.persist(a.turn, a.result);
  const b = await h.semantic(1, { ...complete, title: "gọi mẹ" });
  if ("kind" in b.result) throw new Error("replacement transition");
  expect(b.result.snapshot).toMatchObject({ slots: { title: { value: "đi thi" } }, pendingDecision: { kind: "REPLACE_PENDING", candidate: { proposal: { changes: expect.arrayContaining([{ field: "title", operation: "SET", value: "gọi mẹ", evidence: expect.any(Array) }]) } } } });
  await h.persist(b.turn, b.result);
  const replacement = await h.control(2, "Có."); const preview = await h.persist(replacement.turn, replacement.result);
  expect(preview.snapshot.pendingDecision?.kind).toBe("SAVE_PREVIEW");
  expect(preview.snapshot.slots.title.value).toBe("gọi mẹ");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  const bare = await h.control(3, "Có."); expect(bare.result).not.toHaveProperty("confirmationProof");
  const save = await h.control(4, s => `xác nhận ${s.pendingDecision!.tokenHandle}`);
  if (!("confirmationProof" in save.result) || !save.result.confirmationProof) throw new Error("fresh save proof");
  expect(await h.store.confirm(save.authority, save.result.confirmationProof)).toMatchObject({ status: "COMMITTED", childCount: 1 });
  expect(await h.store.confirm(save.authority, save.result.confirmationProof)).toMatchObject({ status: "IDEMPOTENT", childCount: 1 });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
});

it("A4 unresolved_target_without_prior_draft_clarifies exact candidate/question/revision and real delivery", async () => {
  const h = await setupSuccessor(), pending = await h.semantic(0, { title: "đi thi" }, "UNRESOLVED");
  if ("kind" in pending.result) throw new Error("operation clarification");
  const s = pending.result.snapshot;
  expect(s.pendingDecision).toBeNull(); expect(pending.result.preview).toBeNull();
  expect(s.pendingSemanticCandidate?.proposal.changes[0].value).toBe("đi thi");
  expect(s.pendingReminderQuestion).toMatchObject({ field: "operation", questionId: s.pendingSemanticCandidate?.questionId, deliveryState: "UNCERTAIN" });
  expect(s.pendingSemanticCandidate?.baseContextRevision).toBe(s.contextRevision);
  expect(pending.result.reply.text).toContain(s.pendingReminderQuestion!.text);
  await h.persist(pending.turn, pending.result, "UNCERTAIN");
  const observed = await h.store.observe(h.f.scope(1));
  if ("failure" in observed) throw new Error(observed.failure);
  expect(observed.snapshot?.pendingReminderQuestion?.deliveryState).toBe("UNCERTAIN");
});

it("A4 one_time_acceptance_then_replacement_then_save remains three distinct decisions", async () => {
  const h = await setupSuccessor(); const a = await h.semantic(0, complete); await h.persist(a.turn, a.result);
  const b = await h.semantic(1, { ...complete, title: "giỗ", frequency: "YEARLY" }); const annual = await h.persist(b.turn, b.result);
  expect(annual.snapshot.pendingDecision?.kind).toBe("ACCEPT_ONE_TIME_ALTERNATIVE");
  const alternative = await h.control(2, "Có."); const replace = await h.persist(alternative.turn, alternative.result);
  expect(replace.snapshot.pendingDecision?.kind).toBe("REPLACE_PENDING");
  const accepted = await h.control(3, "Có."); const preview = await h.persist(accepted.turn, accepted.result);
  expect(preview.snapshot.slots.frequency.value).toBe("ONCE"); expect(preview.snapshot.pendingDecision?.kind).toBe("SAVE_PREVIEW");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("A4 mixed yes replace invalidates old preview without confirmation", async () => {
  const h = await setupSuccessor(), a = await h.semantic(0, complete), first = await h.persist(a.turn, a.result);
  const edit = await h.semantic(1, { reminderTime: { ...time(), hour: 9 } }, "CURRENT", "REPLACE", undefined, "Có, nhưng đổi sang 9h."), next = await h.persist(edit.turn, edit.result);
  expect(next).not.toHaveProperty("confirmationProof");
  expect(next.snapshot.previewReceipt?.draftHash).not.toBe(first.snapshot.previewReceipt?.draftHash);
  expect(next.snapshot.draftRevision).toBe(2);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("A4 advisory variations retain valid facts and backend preview", async () => {
  const h = await setupSuccessor(), a = await h.semantic(0, complete, "NEW", "SET", { source: "MODEL_GUIDANCE", text: "Bỏ yêu cầu này nhé?" });
  if ("kind" in a.result) throw new Error("preview");
  expect(a.result.reply.text).toContain("đi thi"); expect(a.result.reply.text).not.toContain("Bỏ yêu cầu này nhé?");
  expect(successorGuidance.computeEffectiveDirectiveV3).toBeTypeOf("function");
  expect(a.merge.status).toBe("MERGED");
  if (a.merge.status !== "MERGED") throw new Error("merge");
  expect(successorGuidance.computeEffectiveDirectiveV3({ semantic: a.patch, merge: a.merge, resolution: resolveRequest(a.merge.candidate, a.turn.scope.now, lunarCalendar) })).toEqual({ kind: "PRESENT_PREVIEW" });
});

it("A4 exact abandon cancels an unresolved candidate with no accepted draft", async () => {
  const h = await setupSuccessor(), pending = await h.semantic(0, { title: "đi thi" }, "UNRESOLVED");
  await h.persist(pending.turn, pending.result);
  const cancel = await h.control(1, "Bỏ.");
  expect(cancel.result.reply.text).toContain("Đã bỏ yêu cầu chưa lưu.");
  if ("kind" in cancel.result) throw new Error("bound cancellation transition");
  expect(cancel.result.terminal).toBe("CANCELLED");
  expect(cancel.result.snapshot.pendingSemanticCandidate).toBeNull();
  await h.persist(cancel.turn, cancel.result);
  expect(await h.f.db.prepare("SELECT count(*) n FROM conversation_contract_ownership").first("n")).toBe(0);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("A4 repeating an undelivered operation question preserves one stable outbound identity", async () => {
  const h = await setupSuccessor(), pending = await h.semantic(0, { title: "đi thi" }, "UNRESOLVED");
  const original = await h.persist(pending.turn, pending.result, "UNCERTAIN");
  const answer = await h.semantic(1, {}, "CURRENT");
  expect(answer.result, JSON.stringify(answer.result)).not.toHaveProperty("kind", "REPLY_ONLY");
  if ("kind" in answer.result) throw new Error(answer.result.reason ?? "retained clarification");
  const q = answer.result.snapshot.pendingReminderQuestion!;
  expect(q.questionId).toBe(original.snapshot.pendingReminderQuestion!.questionId);
  expect(answer.result.snapshot.transcript.filter(t => t.id === q.questionId)).toHaveLength(1);
  await h.persist(answer.turn, answer.result);
  const next = await h.store.observe(h.f.scope(2));
  if ("failure" in next) throw new Error(next.failure);
  expect(next.snapshot?.pendingReminderQuestion?.deliveryState).toBe("SENT");
  expect(next.snapshot?.pendingSemanticCandidate?.baseContextRevision).toBe(next.snapshot?.contextRevision);
  const adopted = await h.semantic(2, {}, "NEW");
  const accepted = await h.persist(adopted.turn, adopted.result);
  expect(accepted.snapshot.pendingSemanticCandidate).toBeNull();
  expect(accepted.snapshot.slots.title).toMatchObject({ value: "đi thi", evidence: [{ sourceTurnId: "old" }] });
  expect(accepted.snapshot.pendingReminderQuestion?.field).toBe("reminderTime");
  expect(accepted.preview).toBeNull();
});

it.each([1, 2])( "A4 successor %i occurrence preview rejects stale proof and legacy replay", async count => {
  const h = await setupSuccessor();
  const a = await h.semantic(0, { ...complete, frequency: count === 1 ? "ONCE" : "DAILY", ...(count === 2 ? { occurrenceCount: 2, eventRelation: "STARTING_ON" } : {}) });
  const first = await h.persist(a.turn, a.result);
  const receipt = first.snapshot.previewReceipt!, d = first.snapshot.pendingDecision!;
  const stale = { operationKey: "old-preview", contextId: first.snapshot.id, contextRevision: first.snapshot.contextRevision, decisionId: d.decisionId, kind: d.kind, requestId: d.target.requestId, proposalId: d.target.proposalId, draftRevision: d.draftRevision, draftHash: receipt.draftHash, response: { kind: "TOKEN" as const, handle: d.tokenHandle! } };
  const edited = await h.semantic(1, { reminderTime: { ...time(), hour: 9 } }, "CURRENT", "REPLACE");
  await h.persist(edited.turn, edited.result);
  expect(await h.store.confirm({ kind: "CHAT", scope: h.f.scope(2) }, stale)).toEqual({ status: "REJECTED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  const save = await h.control(2, s => `xác nhận ${s.pendingDecision!.tokenHandle}`);
  if (!("confirmationProof" in save.result) || !save.result.confirmationProof) throw new Error("current proof");
  expect(await h.store.confirm(save.authority, save.result.confirmationProof)).toMatchObject({ status: "COMMITTED", childCount: count });
  expect(await h.f.store.confirm(save.authority, save.result.confirmationProof)).not.toMatchObject({ status: "IDEMPOTENT" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(count);
});

it.each(["FAILED", "UNCERTAIN"] as const)("A4 successor %s delivery cannot authorize confirmation", async delivery => {
  const h = await setupSuccessor(), a = await h.semantic(0, complete);
  const first = await h.persist(a.turn, a.result, delivery);
  const save = await h.control(1, `xác nhận ${first.snapshot.pendingDecision!.tokenHandle}`);
  expect(save.result).not.toHaveProperty("confirmationProof");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("A4 ambiguous abandon preserves both accepted draft and unresolved proposal", async () => {
  const h = await setupSuccessor(), a = await h.semantic(0, complete); await h.persist(a.turn, a.result);
  const b = await h.semantic(1, { title: "gọi mẹ" }, "UNRESOLVED"); const retained = await h.persist(b.turn, b.result);
  const cancel = await h.control(2, "Bỏ.");
  if ("kind" in cancel.result) throw new Error("ambiguous cancellation");
  expect(cancel.result.terminal).toBeNull();
  expect(cancel.result.snapshot.slots.title.value).toBe("đi thi");
  expect(cancel.result.snapshot.pendingSemanticCandidate?.proposalId).toBe(retained.snapshot.pendingSemanticCandidate?.proposalId);
  const stored = await h.persist(cancel.turn, cancel.result);
  expect(stored.reply.text).toContain("Chưa bỏ yêu cầu nào.");
  expect(stored.reply.text).not.toContain("Trả lời 2");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it.each(["Đừng bỏ.", "Ghi chú: đừng bỏ quên giấy tờ."])("A4 negated or quoted note cancellation keeps the draft (%s)", async text => {
  const h = await setupSuccessor(), a = await h.semantic(0, complete); await h.persist(a.turn, a.result);
  const turn = await h.read(1, text), authority = { kind: "CHAT", scope: turn.scope } as const;
  expect(selectControl(text, turn.observed.snapshot!.pendingDecision, authority, { snapshot: turn.observed.snapshot!, now: turn.scope.now })).toEqual({ kind: "NONE" });
  const note = await h.semantic(1, { notes: text }, "CURRENT", "SET", undefined, text), kept = await h.persist(note.turn, note.result);
  expect(kept.terminal).toBeNull(); expect(kept.snapshot.slots.title.value).toBe("đi thi");
  expect(kept.snapshot.slots.notes.value).toBe(text);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("A4 backend query result ignores guidance and preserves independent reminder state", async () => {
  const h = await setupSuccessor(), a = await h.semantic(0, complete); const first = await h.persist(a.turn, a.result);
  const text = "Tháng này có lịch gì không?", turn = await h.read(1, text);
  const checked = validateEvidenceV3(SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [], query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: turn.built.input.currentTurn, quote: text, occurrence: 1 }] }, uncertainties: [] }), turn.built);
  if (checked.status !== "VALID") throw new Error(checked.reason);
  const result = await successorTransition.transitionConversationV3({ snapshot: turn.observed.snapshot, interpretation: checked.patch, control: { kind: "NONE" }, now: turn.scope.now, queryResult: { status: "RESULTS", rows: [], hasMore: false, partialNotice: null, scopeLabel: "tháng hiện tại", calendarNotice: "dương lịch" }, guidance: { source: "MODEL_GUIDANCE", text: "Bỏ yêu cầu này nhé?" } });
  const stored = await h.persist(turn, result);
  expect(stored.reply.kind).toBe("QUERY_RESULT"); expect(stored.reply.source).toBe("BACKEND");
  expect(stored.reply.text).not.toContain("Bỏ yêu cầu này nhé?");
  expect(stored.snapshot.slots).toEqual(first.snapshot.slots);
  expect(stored.snapshot.draftRevision).toBe(first.snapshot.draftRevision);
  expect(stored.snapshot.draftExpiresAt).toBe(first.snapshot.draftExpiresAt);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("A4 supplied unbranded merge and ready resolution cannot manufacture preview facts", async () => {
  const h = await setupSuccessor(), ready = await h.semantic(0, complete), incomplete = await h.semantic(0, { title: "đi thi" });
  if (ready.merge.status !== "MERGED") throw new Error("ready merge");
  const result = await successorTransition.transitionConversationV3({ snapshot: null, interpretation: incomplete.patch, merge: ready.merge, resolution: resolveRequest(ready.merge.candidate, ready.turn.scope.now, lunarCalendar), control: { kind: "NONE" }, now: incomplete.turn.scope.now, channel: "TELEGRAM" });
  if ("kind" in result) throw new Error("grounded incomplete question");
  expect(result.preview).toBeNull(); expect(result.snapshot.pendingDecision).toBeNull();
  expect(result.snapshot.slots.reminderTime.value).toBeNull();
  expect(result.snapshot.pendingReminderQuestion?.field).toBe("reminderTime");
});

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
