// @vitest-environment node
import { expect, it } from "vitest";
import { harness, proposal, complete, type Proposal } from "./service-test-support";

const operation: Proposal = input => {
  const evidence = [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }];
  return { schemaVersion: "calenote-context-3", intent: "AMBIGUOUS", requestTarget: { kind: "UNRESOLVED", evidence }, changes: [], query: null,
    uncertainties: [{ field: "operation", reason: "AMBIGUOUS", alternatives: ["CURRENT", "NEW"].map(value => ({ value, evidence })) }], conversationDirective: null, replyProposal: null };
};
const list: Proposal = input => ({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [],
  query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] },
  uncertainties: [], conversationDirective: null, replyProposal: null });

it.each(["SENT", "UNCERTAIN"] as const)("sole retained A operation clarification issues non-saving RESUME with %s receipt", async status => {
  const h = await harness([proposal(complete), list, operation]);
  await h.turn(0); const original = (await h.read(1))!;
  await h.turn(1, "Tháng này có lịch gì?"); const queried = (await h.read(2))!;
  h.setDelivery(status === "SENT" ? { status, messageRef: "resume-sent" } : { status });
  expect(await h.turn(2, "Xử lý yêu cầu này thế nào?")).toEqual({ status: "CLARIFICATION_REQUESTED" });
  const resume = (await h.read(3))!;
  if (status === "SENT") expect(resume.pendingDecision).toMatchObject({ kind: "RESUME_PENDING", candidate: null, deliveryState: status, target: { requestId: original.requestId } });
  else expect(resume.pendingDecision).toBeNull(); // actual uncertain decision delivery revokes its authority
  expect(resume.pendingSemanticCandidate).toBeNull(); expect(resume.previewReceipt).toBeNull();
  expect(resume.slots).toEqual(original.slots); expect(resume.ambiguities).toEqual(queried.ambiguities);
  expect(resume.facts.filter(f => f.scope === "QUERY")).toEqual(queried.facts.filter(f => f.scope === "QUERY"));
  expect(resume.draftExpiresAt).toBe(original.draftExpiresAt);
  h.setDelivery({ status: "SENT", messageRef: "new-preview" });
  const result = await h.turn(3, "Có.");
  expect(result).not.toEqual({ status: "CONFIRMED" }); expect(h.inputs).toHaveLength(3);
  if (status === "SENT") {
    expect(result).toEqual({ status: "DRAFT_CREATED" });
    expect((await h.read(4))?.pendingDecision).toMatchObject({ kind: "SAVE_PREVIEW" });
    expect((await h.read(4))?.slots).toEqual(original.slots);
  } else expect((await h.read(4))?.pendingDecision?.kind).not.toBe("SAVE_PREVIEW");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("empty operation clarification preserves a genuinely grounded competing B", async () => {
  const competing: Proposal = input => ({ ...(operation(input) as object), intent: "CREATE_REMINDER", changes: [{ field: "title", operation: "SET", value: "gọi mẹ", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] }] });
  const h = await harness([proposal(complete), competing, operation]);
  await h.turn(0); await h.turn(1, "gọi mẹ hay yêu cầu đang giữ?"); const before = (await h.read(2))!;
  expect(before.pendingSemanticCandidate?.proposal.changes[0].value).toBe("gọi mẹ");
  await h.turn(2, "Xử lý yêu cầu này thế nào?"); const after = (await h.read(3))!;
  expect(after.pendingDecision).toBeNull(); expect(after.previewReceipt).toBeNull();
  expect(after.pendingSemanticCandidate).toEqual({ ...before.pendingSemanticCandidate, baseContextRevision: after.contextRevision });
  expect(after.pendingReminderQuestion?.questionId).toBe(before.pendingReminderQuestion?.questionId);
  expect(after.slots).toEqual(before.slots); expect(after.draftExpiresAt).toBe(before.draftExpiresAt);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("absent A operation ambiguity never invents a resume target", async () => {
  const h = await harness([operation]); await h.turn(0, "Xử lý yêu cầu này thế nào?");
  const s = (await h.read(1))!;
  expect(s.requestId).toBeNull(); expect(s.pendingDecision).toBeNull(); expect(s.previewReceipt).toBeNull();
  expect(s.pendingSemanticCandidate).not.toBeNull();
});

it("empty operation ambiguity suspends but never erases a competing replacement offer", async () => {
  const h = await harness([proposal(complete), proposal({ ...complete, title: "gọi mẹ" }), operation]);
  await h.turn(0); await h.turn(1, "nhắc gọi mẹ 8/10/2026 8h"); const before = (await h.read(2))!;
  await h.turn(2, "Xử lý yêu cầu này thế nào?"); const after = (await h.read(3))!;
  expect(after.pendingDecision?.candidate).toEqual(before.pendingDecision!.candidate);
  expect(after.pendingDecision?.kind).toBe("REPLACE_PENDING");
  expect(after.pendingDecision?.deliveryState).toBe("UNCERTAIN"); expect(after.pendingDecision?.tokenHandle).toBeNull();
  expect(after.pendingSemanticCandidate).toBeNull(); expect(after.slots).toEqual(before.slots);
  expect(after.draftExpiresAt).toBe(before.draftExpiresAt);
  await h.turn(3, "Có.");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("field alternatives alongside operation uncertainty cannot become sole-A RESUME", async () => {
  const factual: Proposal = input => {
    const p = operation(input) as { uncertainties: unknown[] };
    const evidence = [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }];
    return { ...p, uncertainties: [...p.uncertainties, { field: "title", reason: "AMBIGUOUS", alternatives: ["đi thi", "gọi mẹ"].map(value => ({ value, evidence })) }] };
  };
  const h = await harness([proposal(complete), factual]); await h.turn(0); await h.turn(1, "đi thi hay gọi mẹ?");
  const s = (await h.read(2))!;
  expect(s.pendingDecision).toBeNull(); expect(s.pendingSemanticCandidate?.proposal.uncertainties).toHaveLength(2);
  expect(s.slots.title.value).toBe("đi thi"); expect(s.previewReceipt).toBeNull();
});

it("malformed current targeting evidence cannot issue RESUME or save", async () => {
  const invalid: Proposal = input => ({ ...(operation(input) as object), requestTarget: { kind: "UNRESOLVED", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: "nonexistent words", occurrence: 1 }] } });
  const h = await harness([proposal(complete), invalid]); await h.turn(0);
  expect(await h.turn(1, "Xử lý yêu cầu này thế nào?")).toEqual({ status: "REJECTED" });
  expect((await h.read(2))?.pendingDecision).toBeNull();
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it.each(["ONCE", "YEARLY"] as const)("fresh %s NEW replacement offer has its own original TTL independent of A", async frequency => {
  const h = await harness([proposal(complete), proposal({ ...complete, title: "gọi mẹ", frequency })]);
  await h.turn(0); const a = (await h.read(1))!;
  await h.turn(1, "nhắc gọi mẹ 8/10/2026 8h hằng năm"); const offered = (await h.read(2))!;
  expect(offered.slots).toEqual(a.slots); expect(offered.draftExpiresAt).toBe(a.draftExpiresAt);
  expect(offered.pendingDecision?.candidate).toMatchObject({ createdAt: "2026-09-28T03:00:00.001Z", expiresAt: "2026-09-28T03:10:00.001Z" });
  expect(offered.pendingDecision?.kind).toBe(frequency === "ONCE" ? "REPLACE_PENDING" : "ACCEPT_ONE_TIME_ALTERNATIVE");
  await h.turn(2, "Có.");
  const next = (await h.read(3))!;
  if (frequency === "ONCE") expect(next.draftExpiresAt).toBe("2026-09-28T03:10:00.001Z");
  else expect(next.pendingDecision?.candidate?.expiresAt).toBe("2026-09-28T03:10:00.001Z");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
