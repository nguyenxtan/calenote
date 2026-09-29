import { describe, expect, it } from "vitest";
import { confirmationFixture } from "./confirmation-test-support";
import { selectControl } from "./decisions";
import { transitionConversation, type ConversationTransition } from "./transition";
import { date, now, patch, time } from "./resolution-test-support";
import { ContextSnapshotV1Schema, type ContextSnapshotV1, type ControlAuthority } from "./state";
import { validDecision, validateConfirmation } from "./confirmation";
import { encodeContextSnapshot } from "./state";
import { turn } from "./context-test-fixtures";
import { buildContextInput } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { validateEvidence, validateGuidancePrivacy } from "./evidence";
import { parseInterpretationSections } from "./contracts";
import { mergePatch } from "./merge";
import { resolveRequest } from "./resolve";
import { lunarCalendar } from "../lunar-calendar";
import { computeEffectiveDirective, selectGuidance, validateDirective } from "./guidance";

function stored(result: ConversationTransition) {
  if ("kind" in result) throw new Error(`expected stored transition: ${result.reason}`);
  expect(ContextSnapshotV1Schema.safeParse(result.snapshot).success).toBe(true);
  return result;
}
function delivered(state: ContextSnapshotV1): ContextSnapshotV1 {
  const s = structuredClone(state), ref = `reply-${s.contextRevision}`;
  const last = s.transcript.at(-1)!;
  if (last.role !== "ASSISTANT") throw new Error("missing outbound");
  last.deliveryState = "SENT"; last.messageRef = ref;
  if (s.previewReceipt) { s.previewReceipt.deliveryState = "SENT"; s.previewReceipt.replyReference = ref; }
  if (s.pendingDecision) { s.pendingDecision.deliveryState = "SENT"; s.pendingDecision.replyReference = ref; }
  return ContextSnapshotV1Schema.parse(s);
}
async function semantic(state: ContextSnapshotV1 | null, values: Record<string, unknown>, act?: "EDIT" | "NEW_REQUEST") {
  const interpretation = patch(state, values, { act });
  return transitionConversation({ snapshot: state, interpretation, control: { kind: "NONE" }, now: Date.parse(interpretation.candidateSnapshot.inbound.receivedAt), channel: "TELEGRAM" });
}
async function local(state: ContextSnapshotV1, text: string) {
  const received = patch(state, {}, { text }).candidateSnapshot;
  const authority: ControlAuthority = { kind: "CHAT", scope: { ownerId: state.scope.ownerId, chatIdentityId: state.scope.chatIdentityId, sourceInboundId: received.inbound.id, claimMarker: received.inbound.claimMarker, now: Date.parse(received.inbound.receivedAt) } };
  const control = selectControl(text, state.pendingDecision, authority, { snapshot: state });
  return transitionConversation({ snapshot: state, received, control, authority, now: authority.scope.now, channel: "TELEGRAM" });
}
const complete = { title: "đi thi", reminderDate: date(8, 10, 2026), reminderTime: time(), frequency: "ONCE" };

describe("pure T5 lifecycle over real T2/T3 data", () => {
  it("the retained pending question is the actually selected natural wording", async () => {
    const interpretation = patch(null, { title: "đi thi" });
    const result = stored(await transitionConversation({ snapshot: null, interpretation, control: { kind: "NONE" }, now, guidance: { source: "MODEL_GUIDANCE", text: "Bạn muốn mình nhắc vào giờ nào?" } }));
    expect(result.reply.source).toBe("MODEL_GUIDANCE");
    expect(result.snapshot.pendingReminderQuestion?.text).toBe("Bạn muốn mình nhắc vào giờ nào?");
    expect(result.snapshot.transcript.at(-1)?.text).toBe(result.reply.text);
  });
  it.each(["SAVE_PREVIEW", "REPLACE_PENDING", "ACCEPT_ONE_TIME_ALTERNATIVE", "RESUME_PENDING", "RESTART_PENDING"] as const)("%s decline and escape have distinct effects on real lifecycle state", async kind => {
    let s: ContextSnapshotV1;
    if (kind === "ACCEPT_ONE_TIME_ALTERNATIVE") s = delivered(stored(await semantic(null, { ...complete, frequency: "YEARLY" })).snapshot);
    else if (kind === "RESTART_PENDING") {
      s = delivered(stored(await semantic(null, { title: "đi thi" })).snapshot);
      for (let i = 0; i < 3; i++) s = delivered(stored(await semantic(s, {})).snapshot);
    } else {
      s = delivered(stored(await semantic(null, complete)).snapshot);
      if (kind === "REPLACE_PENDING") s = delivered(stored(await semantic(s, { title: "gọi mẹ" }, "NEW_REQUEST")).snapshot);
      if (kind === "RESUME_PENDING") {
        const interpretation = patch(s, {}, { act: "AMBIGUOUS" });
        s = delivered(stored(await transitionConversation({ snapshot: s, interpretation, control: { kind: "NONE" }, now: now + 60000 })).snapshot);
      }
    }
    expect(s.pendingDecision?.kind).toBe(kind);
    const declined = stored(await local(s, "Không."));
    expect(declined.terminal).toBeNull();
    expect(declined.snapshot.slots).toEqual(s.slots);
    expect(declined.snapshot.draftExpiresAt).toBe(s.draftExpiresAt);
    expect(declined.snapshot.pendingDecision).toBeNull();
    const escaped = await local(s, "Huỷ!");
    if (kind === "REPLACE_PENDING") { const retained = stored(escaped); expect(retained.terminal).toBeNull(); expect(retained.snapshot.pendingDecision?.candidate).toEqual(s.pendingDecision?.candidate); }
    else expect(stored(escaped).terminal).toBe("CANCELLED");
  });
  it("a repeated unrelated unsupported request never replaces a valid draft", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const result = stored(await semantic(a, { ...complete, title: "gọi mẹ", frequency: "WEEKLY" }, "NEW_REQUEST"));
    expect(result.snapshot.slots).toEqual(a.slots);
    expect(result.snapshot.pendingDecision).toBeNull();
    expect(result.reply.text).toContain("chưa được hỗ trợ");
  });
  it("rejects a stale received context before an escape can use it", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const b = delivered(stored(await semantic(a, { reminderTime: time(9) }, "EDIT")).snapshot);
    const received = patch(a, {}, { text: "Bỏ" }).candidateSnapshot;
    const authority: ControlAuthority = { kind: "CHAT", scope: { ownerId: b.scope.ownerId, chatIdentityId: b.scope.chatIdentityId, sourceInboundId: received.inbound.id, claimMarker: received.inbound.claimMarker, now: now + 120000 } };
    const result = await transitionConversation({ snapshot: b, received, control: selectControl("Bỏ", b.pendingDecision, authority, { snapshot: b }), authority, now: now + 120000 });
    expect(result).toHaveProperty("kind", "REPLY_ONLY");
    expect(result).not.toHaveProperty("terminal");
  });
  it("ambiguous escape and model abandonment preserve the offer but suspend approval of the old question", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const offer = delivered(stored(await semantic(a, { title: "gọi mẹ" }, "NEW_REQUEST")).snapshot);
    const ambiguous = stored(await local(offer, "Bỏ."));
    expect(ambiguous.snapshot.pendingDecision?.candidate).toEqual(offer.pendingDecision?.candidate);
    expect(ambiguous.snapshot.pendingDecision?.deliveryState).toBe("UNCERTAIN");
    const authority: ControlAuthority = { kind: "CHAT", scope: { ownerId: a.scope.ownerId, chatIdentityId: a.scope.chatIdentityId, sourceInboundId: "later", claimMarker: "claim", now: now + 180000 } };
    expect(selectControl("Có.", ambiguous.snapshot.pendingDecision, authority)).toEqual({ kind: "NONE" });
    expect(selectControl("2", ambiguous.snapshot.pendingDecision, authority)).toMatchObject({ kind: "DECLINE" });
    const interpretation = patch(offer, {}, { act: "ABANDON_PENDING" });
    const modelAbandon = stored(await transitionConversation({ snapshot: offer, interpretation, control: { kind: "NONE" }, now: now + 120000 }));
    expect(modelAbandon.snapshot.pendingDecision?.candidate).toEqual(offer.pendingDecision?.candidate);
    expect(modelAbandon.terminal).toBeNull();
  });
  it("valid-context failure records actual wording and suspends save without counting nonprogress", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const received = patch(a, {}, { text: "thử lại" }).candidateSnapshot;
    const result = stored(await transitionConversation({ snapshot: a, received, control: { kind: "NONE" }, failure: "PROVIDER", now: now + 60000 }));
    expect(result.snapshot.pendingDecision).toBeNull();
    expect(result.snapshot.slots).toEqual(a.slots);
    expect(result.snapshot.draftExpiresAt).toBe(a.draftExpiresAt);
    expect(result.snapshot.pendingReminderQuestion).toEqual(a.pendingReminderQuestion);
    expect(result.snapshot.transcript.at(-1)?.text).toBe(result.reply.text);
  });
  it("assistant rollover keeps candidate quote references bound to the original USER turn", async () => {
    let s = delivered(stored(await semantic(null, complete)).snapshot);
    for (let i = 0; i < 4; i++) s = delivered(stored(await semantic(s, {})).snapshot);
    s.transcript.splice(s.transcript.length - 1, 0, { ...turn("Thông báo", "notice"), role: "ASSISTANT", kind: "NOTICE", deliveryState: "SENT", receivedAt: s.inbound.receivedAt });
    s = ContextSnapshotV1Schema.parse(s);
    const candidate = patch(s, { title: "gọi mẹ" }, { act: "NEW_REQUEST" });
    const result = stored(await transitionConversation({ snapshot: s, interpretation: candidate, control: { kind: "NONE" }, now: Date.parse(candidate.candidateSnapshot.inbound.receivedAt) }));
    expect(result.snapshot.transcript.filter(t => t.role === "ASSISTANT")).toHaveLength(6);
    const refs = result.snapshot.pendingDecision!.candidate!.proposal.changes[0].evidence;
    const ref = refs[0];
    if (ref.kind !== "USER_QUOTE") throw new Error("quote");
    expect(result.snapshot.transcript[ref.turn].id).toBe(result.snapshot.inbound.id);
  });
  it("bad guidance retains accepted facts and persists only the actual backend question", async () => {
    const initial = delivered(stored(await semantic(null, { title: "đi thi" })).snapshot);
    const msg = { ...message("ở Quang Trung"), id: "place" };
    const built = buildContextInput({ message: msg, context: chat, snapshot: initial, observation: observation(initial, msg) });
    if (built.status !== "READY") throw new Error(built.reason);
    const raw = { schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: "CONTINUE", continuation: "YES", changes: [{ field: "location", operation: "SET", value: "Quang Trung", evidence: [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: "Quang Trung", occurrence: 1 }] }], query: null, uncertainties: [], controlEvidence: [], conversationDirective: { kind: "ASK_FOR_FIELD", field: "notes" }, replyProposal: { text: "Đã lưu lịch cho bạn." } };
    const sections = parseInterpretationSections(raw);
    if (sections.status !== "PARSED") throw new Error(sections.reason);
    const validated = validateEvidence(sections.value.semantic, built);
    if (validated.status !== "VALID") throw new Error(validated.reason);
    const merge = mergePatch(initial, validated.patch);
    if (merge.status !== "MERGED") throw new Error(merge.reason);
    const resolution = resolveRequest(merge.candidate, msg.receivedAt, lunarCalendar);
    const effective = computeEffectiveDirective({ semantic: validated.patch, merge, resolution });
    const guidance = selectGuidance({ effectiveDirective: effective, directiveValidation: validateDirective(sections.value.directive, effective), replyProposal: sections.value.reply, privacyValidation: validateGuidancePrivacy(raw, built), language: "vi" });
    const result = stored(await transitionConversation({ snapshot: initial, interpretation: validated.patch, merge, resolution, control: { kind: "NONE" }, now: msg.receivedAt, guidance }));
    expect(result.snapshot.slots.location.value).toBe("Quang Trung");
    expect(result.snapshot.slots.title.value).toBe("đi thi");
    expect(result.reply.source).toBe("BACKEND");
    expect(result.reply.text).not.toContain("Đã lưu lịch");
    expect(result.snapshot.transcript.at(-1)?.text).toBe(result.reply.text);
  });
  it("model abandonment never deletes and progress resets clarification recovery", async () => {
    let s = delivered(stored(await semantic(null, { title: "đi thi" })).snapshot);
    s = delivered(stored(await semantic(s, {})).snapshot);
    const interpretation = patch(s, {}, { act: "ABANDON_PENDING" });
    const escaped = stored(await transitionConversation({ snapshot: s, interpretation, control: { kind: "NONE" }, now: Date.parse(interpretation.candidateSnapshot.inbound.receivedAt) }));
    expect(escaped.terminal).toBeNull();
    expect(escaped.snapshot.slots.title.value).toBe("đi thi");
    expect(escaped.reply.text).toContain("Bỏ");
    const progressed = stored(await semantic(delivered(escaped.snapshot), { reminderTime: time() }));
    expect(progressed.snapshot.pendingReminderQuestion?.noProgressCount).toBe(0);
  });
  it("incomplete replacement preserves candidate facts for the next actual T2 input", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const offer = delivered(stored(await semantic(a, { title: "gọi mẹ" }, "NEW_REQUEST")).snapshot);
    const adopted = stored(await local(offer, "Có."));
    expect(adopted.snapshot.facts).toContainEqual(expect.objectContaining({ scope: "REMINDER", field: "title", value: "gọi mẹ" }));
    expect(adopted.snapshot.slots.notes.value).toBeNull();
  });
  it("replacement keeps a grounded candidate uncertainty until a later clarification", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const interpretation = patch(a, { title: "gọi mẹ" }, { act: "NEW_REQUEST", uncertainties: [{ field: "reminderTime", reason: "MISSING", alternatives: [] }] });
    const offer = stored(await transitionConversation({ snapshot: a, interpretation, control: { kind: "NONE" }, now: now + 60000 }));
    expect(offer.snapshot.pendingDecision?.kind).toBe("REPLACE_PENDING");
    const adopted = stored(await local(delivered(offer.snapshot), "Có."));
    expect(adopted.snapshot.pendingReminderQuestion?.field).toBe("reminderTime");
    expect(adopted.snapshot.ambiguities).toContainEqual({ field: "reminderTime", reason: "MISSING", alternatives: [] });
  });
  it("refuses a state above 16KiB without evicting retained user evidence", async () => {
    const a = delivered(stored(await semantic(null, { title: "đi thi" })).snapshot);
    const received = structuredClone(patch(a, {}, { text: "Bỏ" }).candidateSnapshot);
    for (let i = 0; i < 4; i++) received.transcript.splice(1, 0, { ...turn(Array.from({ length: 1600 }, (_, j) => String.fromCodePoint(0x4e00 + i * 1700 + j)).join(""), `large-${i}`), receivedAt: a.inbound.receivedAt });
    expect(ContextSnapshotV1Schema.safeParse(received).success).toBe(true);
    expect(new TextEncoder().encode(encodeContextSnapshot(received)).length).toBeGreaterThan(16384);
    const authority: ControlAuthority = { kind: "CHAT", scope: { ownerId: a.scope.ownerId, chatIdentityId: a.scope.chatIdentityId, sourceInboundId: received.inbound.id, claimMarker: received.inbound.claimMarker, now: now + 60000 } };
    const result = await transitionConversation({ snapshot: a, received, control: selectControl("Bỏ", a.pendingDecision, authority, { snapshot: a }), authority, now: now + 60000 });
    expect(result).toHaveProperty("reason", "CONTEXT_SNAPSHOT_TOO_LARGE");
    expect(received.transcript.filter(t => t.role === "USER")).toHaveLength(6);
  });
  it("uncertain continuation offers RESUME and approval only reissues a question", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const interpretation = patch(a, {}, { act: "AMBIGUOUS" });
    const offer = stored(await transitionConversation({ snapshot: a, interpretation, control: { kind: "NONE" }, now: now + 60000, channel: "TELEGRAM" }));
    expect(offer.snapshot.pendingDecision?.kind).toBe("RESUME_PENDING");
    const resumed = stored(await local(delivered(offer.snapshot), "Có."));
    expect(resumed.decisionProof?.kind).toBe("RESUME_PENDING");
    expect(resumed.snapshot.pendingDecision?.kind).toBe("SAVE_PREVIEW");
    expect(resumed.snapshot.draftExpiresAt).toBe(a.draftExpiresAt);
    expect(resumed).not.toHaveProperty("confirmationProof");
  });
  it("query clarification has its own strict question and cannot become a create", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const interpretation = patch(a, {}, { query: { kind: "LIST", period: null, statusScope: "DEFAULT", evidence: [] }, uncertainties: [{ field: "queryRange", reason: "MISSING", alternatives: [] }] });
    const query = stored(await transitionConversation({ snapshot: a, interpretation, control: { kind: "NONE" }, now: now + 60000 }));
    expect(query.snapshot.pendingQueryQuestion).toMatchObject({ field: "queryRange", scope: "QUERY" });
    expect(query.snapshot.requestId).toBe(a.requestId);
    expect(query.snapshot.draftRevision).toBe(a.draftRevision);
    expect(query.snapshot.pendingDecision).toBeNull();
  });
  it("annual offer token approval uses local acceptance evidence without copying a control", async () => {
    const offer = delivered(stored(await semantic(null, { ...complete, frequency: "YEARLY" })).snapshot);
    const accepted = stored(await local(offer, `đồng ý ${offer.pendingDecision!.tokenHandle}`));
    expect(accepted.snapshot.slots.frequency.value).toBe("ONCE");
    expect(accepted.snapshot.slots.frequency.evidence[0].quote).not.toContain("CN-");
    expect(accepted.decisionProof?.response.kind).toBe("TOKEN");
  });
  it("unsupported edit retains otherwise valid A and its expiry", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const result = stored(await semantic(a, { frequency: "YEARLY" }, "EDIT"));
    expect(result.snapshot.slots).toEqual(a.slots);
    expect(result.snapshot.draftRevision).toBe(a.draftRevision);
    expect(result.snapshot.draftExpiresAt).toBe(a.draftExpiresAt);
    expect(result.snapshot.pendingDecision).toBeNull();
  });
  it("refuses same-order control and does not invent a preview channel", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const received = structuredClone(patch(a, {}, { text: "Có" }).candidateSnapshot);
    received.inbound.receivedAt = a.inbound.receivedAt; received.inbound.rowid = a.inbound.rowid;
    received.transcript.at(-1)!.receivedAt = a.inbound.receivedAt;
    const authority: ControlAuthority = { kind: "CHAT", scope: { ownerId: a.scope.ownerId, chatIdentityId: a.scope.chatIdentityId, sourceInboundId: received.inbound.id, claimMarker: received.inbound.claimMarker, now } };
    const selected = selectControl("Có", a.pendingDecision, authority);
    const result = await transitionConversation({ snapshot: a, received, control: selected, authority, now });
    expect(result).not.toHaveProperty("confirmationProof");
    const interpretation = patch(null, complete);
    expect(await transitionConversation({ snapshot: null, interpretation, control: { kind: "NONE" }, now })).toHaveProperty("reason", "PREVIEW_CHANNEL_REQUIRED");
  });
  it("prepares an inert store-valid complete preview and real save proof", async () => {
    const initial = stored(await semantic(null, complete));
    expect(initial.snapshot.pendingDecision).toMatchObject({ kind: "SAVE_PREVIEW", deliveryState: "UNCERTAIN" });
    expect(initial.preview).not.toBeNull();
    const before = await local(initial.snapshot, "Có.");
    expect("confirmationProof" in before).toBe(false);
    const state = delivered(initial.snapshot), result = await local(state, "Có.");
    expect(result).toHaveProperty("confirmationProof.kind", "SAVE_PREVIEW");
    if (!("confirmationProof" in result) || !result.confirmationProof) throw new Error("proof");
    const authority: ControlAuthority = { kind: "CHAT", scope: { ownerId: state.scope.ownerId, chatIdentityId: state.scope.chatIdentityId, sourceInboundId: "approve", claimMarker: "claim", now: now + 60000 } };
    expect(await validateConfirmation(state, initial.preview!, result.confirmationProof, authority, now + 60000)).toBe(true);
  });
  it("replacement_yes_never_saves_A_or_B", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const offer = stored(await semantic(a, { ...complete, title: "gọi mẹ" }, "NEW_REQUEST"));
    expect(offer.snapshot.slots.title.value).toBe("đi thi");
    expect(offer.snapshot.pendingDecision?.kind).toBe("REPLACE_PENDING");
    const b = stored(await local(delivered(offer.snapshot), "Có."));
    expect(b.snapshot.slots.title.value).toBe("gọi mẹ");
    expect(b.snapshot.requestId).not.toBe(a.requestId);
    expect(b.decisionProof?.kind).toBe("REPLACE_PENDING");
    expect(b.snapshot.pendingDecision).toMatchObject({ kind: "SAVE_PREVIEW", deliveryState: "UNCERTAIN" });
    expect(b.terminal).toBeNull();
  });
  it("one_time_offer_yes_is_not_save and competing A needs separate replacement", async () => {
    for (const competing of [false, true]) {
      const a = competing ? delivered(stored(await semantic(null, complete)).snapshot) : null;
      const offer = stored(await semantic(a, { ...complete, title: "giỗ", frequency: "YEARLY" }, "NEW_REQUEST"));
      expect(offer.snapshot.pendingDecision?.kind).toBe("ACCEPT_ONE_TIME_ALTERNATIVE");
      const accepted = stored(await local(delivered(offer.snapshot), "Có."));
      expect(accepted.decisionProof?.kind).toBe("ACCEPT_ONE_TIME_ALTERNATIVE");
      expect(accepted.snapshot.pendingDecision?.kind).toBe(competing ? "REPLACE_PENDING" : "SAVE_PREVIEW");
      expect(accepted.snapshot.slots.title.value).toBe(competing ? "đi thi" : "giỗ");
      expect(accepted).not.toHaveProperty("confirmationProof");
    }
  });
  it("decline_is_not_abandon and ambiguous offer escape preserves both", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const offer = delivered(stored(await semantic(a, { ...complete, title: "gọi mẹ" }, "NEW_REQUEST")).snapshot);
    const ambiguous = await local(offer, "Bỏ.");
    expect(ambiguous.reply.text).toContain("Chưa bỏ");
    const declined = stored(await local(offer, "2"));
    expect(declined.terminal).toBeNull();
    expect(declined.snapshot.slots.title.value).toBe("đi thi");
    expect(declined.snapshot.pendingDecision).toBeNull();
    const abandoned = stored(await local(declined.snapshot, "Bỏ."));
    expect(abandoned.terminal).toBe("CANCELLED");
  });
  it("query_return_requires_reissued_decision without draft revision or TTL renewal", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const interpretation = patch(a, {}, { query: { kind: "CAPABILITY", topic: "LUNAR", evidence: [] } });
    const query = stored(await transitionConversation({ snapshot: a, interpretation, control: { kind: "NONE" }, now: now + 60000, queryResolution: { status: "CAPABILITY", topic: "LUNAR", supported: true } }));
    expect(query.snapshot.pendingDecision).toBeNull();
    expect(query.snapshot.draftRevision).toBe(a.draftRevision);
    expect(query.snapshot.draftExpiresAt).toBe(a.draftExpiresAt);
    expect(await local(delivered(query.snapshot), "Có.")).not.toHaveProperty("confirmationProof");
    const resumed = stored(await semantic(delivered(query.snapshot), {}));
    expect(resumed.snapshot.pendingDecision?.kind).toBe("SAVE_PREVIEW");
    expect(resumed.snapshot.pendingDecision?.decisionId).not.toBe(a.pendingDecision?.decisionId);
  });
  it("edited previews reject bare yes and invalidate old handles", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const edited = stored(await semantic(a, { reminderTime: time(9) }, "EDIT"));
    expect(edited.snapshot.draftRevision).toBe(2);
    expect(edited.snapshot.pendingDecision?.tokenHandle).not.toBe(a.pendingDecision?.tokenHandle);
    expect(await local(delivered(edited.snapshot), "Có.")).not.toHaveProperty("confirmationProof");
    const accepted = await local(delivered(edited.snapshot), `xác nhận ${edited.snapshot.pendingDecision!.tokenHandle}`);
    expect(accepted).toHaveProperty("confirmationProof.kind", "SAVE_PREVIEW");
  });
  it("third_nonprogress_preserves_draft and failure does not count", async () => {
    let s = delivered(stored(await semantic(null, { title: "đi thi" })).snapshot);
    const expires = s.draftExpiresAt;
    const failure = await transitionConversation({ snapshot: s, control: { kind: "NONE" }, now: now + 1000, failure: "PROVIDER" });
    expect(failure).toHaveProperty("kind", "REPLY_ONLY");
    for (const count of [1, 2, 3]) {
      const result = stored(await semantic(s, {}));
      expect(result.snapshot.pendingReminderQuestion?.noProgressCount).toBe(count);
      expect(result.snapshot.draftExpiresAt).toBe(expires);
      expect(result.snapshot.slots.title.value).toBe("đi thi");
      if (count === 2) expect(result.reply.text).toContain("đi thi");
      if (count === 3) { expect(result.snapshot.pendingDecision?.kind).toBe("RESTART_PENDING"); expect(result.reply.text).not.toMatch(/https?:/u); }
      s = delivered(result.snapshot);
    }
    const restart = stored(await local(s, "Có."));
    expect(restart.terminal).toBe("CANCELLED");
    expect(restart.decisionProof?.kind).toBe("RESTART_PENDING");
  });
  it("non-save approvals carry a T4-compatible proof", async () => {
    const a = delivered(stored(await semantic(null, complete)).snapshot);
    const offer = delivered(stored(await semantic(a, { title: "gọi mẹ" }, "NEW_REQUEST")).snapshot);
    const accepted = stored(await local(offer, "Có."));
    const authority: ControlAuthority = { kind: "CHAT", scope: { ownerId: a.scope.ownerId, chatIdentityId: a.scope.chatIdentityId, sourceInboundId: accepted.snapshot.inbound.id, claimMarker: accepted.snapshot.inbound.claimMarker, now: now + 120000 } };
    expect(validDecision(offer, accepted.decisionProof!, authority, now + 120000)).toBe(true);
  });
});

describe("exact scoped decision controls", () => {
  it.each(["SAVE_PREVIEW", "REPLACE_PENDING", "ACCEPT_ONE_TIME_ALTERNATIVE", "RESUME_PENDING", "RESTART_PENDING"] as const)("accepts only the current delivered %s", async kind => {
    const { snapshot, authority } = await confirmationFixture();
    const decision = { ...snapshot.pendingDecision!, kind, acceptedReplies: kind === "SAVE_PREVIEW" ? ["có", "ok", "1", "xác nhận"] as const : ["có", "ok", "1"] as const };
    for (const text of [" Có. ", "OK!", "1"]) expect(selectControl(text, { ...decision, acceptedReplies: [...decision.acceptedReplies] }, authority)).toMatchObject({ kind: "APPROVE", decisionKind: kind });
    for (const text of ["Có, nhưng đổi sang 9h", "có!!", "Đừng bỏ.", '"bỏ"', "ghi chú bỏ", "có\u200b"]) expect(selectControl(text, { ...decision, acceptedReplies: [...decision.acceptedReplies] }, authority)).toEqual({ kind: "NONE" });
    expect(selectControl("Có", { ...decision, acceptedReplies: [...decision.acceptedReplies], deliveryState: "UNCERTAIN" }, authority)).toEqual({ kind: "NONE" });
    if (authority.kind !== "CHAT") throw new Error("fixture");
    expect(selectControl("Có", { ...decision, acceptedReplies: [...decision.acceptedReplies] }, { ...authority, scope: { ...authority.scope, chatIdentityId: "other" } })).toEqual({ kind: "NONE" });
  });
  it("separates save tokens from non-save tokens and decline from abandon", async () => {
    const { snapshot, authority } = await confirmationFixture();
    const save = { ...snapshot.pendingDecision!, tokenHandle: "CN-token" };
    expect(selectControl("xác nhận CN-token", save, authority)).toMatchObject({ kind: "APPROVE", response: { kind: "TOKEN", handle: "CN-token" } });
    expect(selectControl("đồng ý CN-token", save, authority)).toEqual({ kind: "NONE" });
    const replace = { ...save, kind: "REPLACE_PENDING" as const, acceptedReplies: ["có" as const] };
    expect(selectControl("đồng ý CN-token", replace, authority)).toMatchObject({ kind: "APPROVE", decisionKind: "REPLACE_PENDING" });
    expect(selectControl("xác nhận CN-token", replace, authority)).toEqual({ kind: "NONE" });
    for (const text of ["không", "2"]) expect(selectControl(text, replace, authority)).toMatchObject({ kind: "DECLINE" });
    expect(selectControl("Bỏ.", replace, authority)).toMatchObject({ kind: "AMBIGUOUS_TARGET" });
    expect(selectControl("Bỏ.", { ...save, target: { ...save.target, proposalId: null } }, authority)).toMatchObject({ kind: "ABANDON" });
  });
  it("unknown reply references cannot fall back to bare approval", async () => {
    const { snapshot, authority } = await confirmationFixture();
    expect(selectControl("Có", snapshot.pendingDecision, authority, { replyReference: "unknown" })).toEqual({ kind: "NONE" });
    expect(selectControl("Có", snapshot.pendingDecision, authority, { replyReference: "reply" })).toMatchObject({ kind: "APPROVE", response: { kind: "REPLY", reference: "reply" } });
    expect(selectControl("Có", snapshot.pendingDecision, authority, { now: now + 600000 })).toEqual({ kind: "NONE" });
  });
});
