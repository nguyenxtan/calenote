import { describe, expect, it } from "vitest";
import { addressContextReply, composeContextReply, type ReplyOutcome } from "./responses";
import { confirmationFixture } from "./confirmation-test-support";
import { formatPendingFact } from "./responses";

const model = { source: "MODEL_GUIDANCE", text: "Mình đã lưu cho bạn." } as const;
describe("backend reply composition", () => {
  it("known operands are presented as user-facing values, including unresolved qualifiers", () => {
    expect(formatPendingFact("reminderTime", { hour: 9, minute: 5, qualifier: "UNKNOWN" })).toBe("Giờ nhắc: 09:05 (chưa rõ sáng/chiều)");
    expect(formatPendingFact("eventDate", { kind: "CIVIL_DATE", calendar: "LUNAR_VN", day: 11, month: 10, year: null, leapMonth: null })).toBe("Ngày sự kiện: 11/10 (chưa có năm), âm lịch Việt Nam (chưa rõ tháng nhuận)");
  });
  it("monthly query states scope, time, status and partiality without any model prose", () => {
    const result = composeContextReply({ kind: "QUERY", resolution: { status: "RANGE", start: 0, end: 1, label: "Tháng 2026-10 (gồm cả những ngày đã qua)", scopeLabel: "scope" }, result: { status: "RESULTS", rows: [{ id: "row", encryptedTitle: { ciphertext: new ArrayBuffer(0), iv: new ArrayBuffer(0) }, titleKeyVersion: 1, scheduledAt: Date.parse("2026-10-08T01:00:00Z"), status: "FAILED", statusLabel: "wrong label" }], hasMore: true, partialNotice: null, scopeLabel: "scope", calendarNotice: "Lịch dương" }, titles: new Map([["row", "đi thi"]]) }, model);
    expect(result).toMatchObject({ status: "READY", source: "BACKEND" });
    if (result.status !== "READY") throw new Error("render");
    expect(result.text).toContain("cuộc trò chuyện đã liên kết này");
    expect(result.text).toContain("2026-10-08 08:00 — Gửi thất bại");
    expect(result.text).toContain("còn kết quả khác");
    expect(result.text).not.toContain(model.text);
    expect(result.text).not.toContain("wrong label");
  });
  it.each(["PROVIDER", "CONFIG", "BUDGET", "CONTEXT", "SIZE", "SEMANTIC", "STALE", "EXPIRED"] as const)("%s failure never claims save", reason => {
    const result = composeContextReply({ kind: "FAILURE", reason }, model);
    expect(result).toMatchObject({ status: "READY", source: "BACKEND" });
    if (result.status !== "READY") throw new Error("render");
    expect(result.text).not.toContain(model.text);
  });
  it("confirmation uncertainty remains uncertain while recorded commit alone can claim success", () => {
    expect(composeContextReply({ kind: "MUTATION", result: { status: "UNCERTAIN" } }, model)).toMatchObject({ source: "BACKEND", text: expect.stringContaining("Chưa xác định") });
    expect(composeContextReply({ kind: "MUTATION", result: { status: "COMMITTED", childCount: 2, reminderPublicIds: ["one", "two"], seriesPublicId: "series" } }, model)).toMatchObject({ source: "BACKEND", text: "Đã lưu 2 lời nhắc." });
  });
  it("model_query_preview_success_text_discarded", async () => {
    const { preview } = await confirmationFixture();
    const reply = composeContextReply({ kind: "PREVIEW", preview }, model);
    expect(reply).toMatchObject({ status: "READY", source: "BACKEND", kind: "PREVIEW" });
    if (reply.status !== "READY") throw new Error("render");
    expect(reply.text).toContain("2026-10-08 08:00");
    expect(reply.text).not.toContain("đã lưu");
  });
  it("drops optional prose before authoritative details and never clips facts", () => {
    const recap = "🧾".repeat(960);
    const result = composeContextReply({ kind: "QUESTION", question: "Giờ nào?", facts: [recap], field: "reminderTime" }, { source: "MODEL_GUIDANCE", text: "Bạn muốn được nhắc vào thời điểm nào trong ngày để thuận tiện cho mình?".repeat(2) });
    expect(result).toMatchObject({ status: "READY", source: "BACKEND" });
    if (result.status !== "READY") throw new Error("render");
    expect(result.text).toContain(recap);
    expect(result.text.length).toBeLessThanOrEqual(2000);
    expect(composeContextReply({ kind: "QUESTION", question: "Giờ nào?", facts: ["🧾".repeat(1000)], field: "reminderTime" }, model)).toMatchObject({ status: "TOO_LONG" });
  });
  it("unsupported guidance cannot enable capability", () => {
    const result = composeContextReply({ kind: "UNSUPPORTED", capability: "YEARLY" }, model);
    expect(result).toMatchObject({ status: "READY", source: "BACKEND" });
    if (result.status !== "READY") throw new Error("render");
    expect(result.text).toContain("hằng năm");
    expect(result.text).not.toContain("đã lưu");
  });
  it.each(["DOMAIN_LIMIT", "ASSISTANT_SCOPE", "REQUEST_COMBINATION"])("unsupported %s explains the actual application limitation", capability => {
    const reply = composeContextReply({ kind: "UNSUPPORTED", capability }, model);
    expect(reply).toMatchObject({ status: "READY", source: "BACKEND" });
    if (reply.status !== "READY") throw new Error("render");
    expect(reply.text).toContain(capability === "DOMAIN_LIMIT" ? "366" : capability === "ASSISTANT_SCOPE" ? "lịch và lời nhắc" : "từng yêu cầu");
  });
});

describe("saved addressing on structured replies", () => {
  it("keeps default plans identical", () => {
    const plan = composeContextReply({ kind: "NOTICE", notice: "HELP" });
    if (plan.status !== "READY") throw new Error("render");
    expect(addressContextReply(plan)).toBe(plan);
    expect(addressContextReply(plan, { addressStyle: "ban", customDisplayName: null })).toBe(plan);
  });
  it("escapes custom addressing once and shifts every UTF-16 span without touching facts or controls", () => {
    const plan = composeContextReply({ kind: "DECISION", decisionKind: "SAVE_PREVIEW", facts: ["Bạn <🧾> tại nhà bạn"], token: "save-token" });
    if (plan.status !== "READY") throw new Error("render");
    const addressed = addressContextReply(plan, { addressStyle: "custom", customDisplayName: "<Sếp 🧾&>" });
    if (addressed.status !== "READY") throw new Error("render");
    expect(addressed.text).toContain("&lt;Sếp 🧾&amp;&gt; xác nhận lưu bản nháp này?");
    expect(addressed.text).not.toContain("&amp;lt;");
    for (let i = 0; i < plan.spans.length; i++) {
      const span = addressed.spans[i];
      const before = plan.spans[i];
      if (span.kind !== "QUESTION") expect(addressed.text.slice(span.start, span.end)).toBe(plan.text.slice(before.start, before.end));
      else expect(addressed.text.slice(span.start, span.end)).not.toContain("Bạn");
    }
  });
  it("preserves preview payload and model guidance verbatim under saved sếp addressing", async () => {
    const { preview } = await confirmationFixture();
    const inputs = [composeContextReply({ kind: "PREVIEW", preview }), composeContextReply({ kind: "QUESTION", question: "Bạn muốn lúc nào?", facts: ["Bạn 🧾"], field: "reminderTime" }, { source: "MODEL_GUIDANCE", text: "Bạn muốn được nhắc vào lúc nào?" })];
    for (const plan of inputs) {
      if (plan.status !== "READY") throw new Error("render");
      const result = addressContextReply(plan, { addressStyle: "sep", customDisplayName: null });
      if (result.status !== "READY") throw new Error("render");
      expect(result.text).toBe("Sếp, " + plan.text);
      expect(result.source).toBe(plan.source);
      for (let i = 0; i < plan.spans.length; i++) expect(result.text.slice(result.spans[i].start, result.spans[i].end)).toBe(plan.text.slice(plan.spans[i].start, plan.spans[i].end));
    }
  });
  it("addresses only exact canonical backend notices and decision questions", () => {
    for (const outcome of [{ kind: "NOTICE", notice: "HELP" }, { kind: "FAILURE", reason: "PROVIDER" }, { kind: "DECISION", decisionKind: "SAVE_PREVIEW", facts: [], token: "handle" }] satisfies ReplyOutcome[]) {
      const plan = composeContextReply(outcome);
      if (plan.status !== "READY") throw new Error("render");
      const result = addressContextReply(plan, { addressStyle: "sep", customDisplayName: null });
      if (result.status !== "READY") throw new Error("render");
      expect(result.text).not.toMatch(/\b[Bb]ạn\b/u);
      expect(result.text.toLocaleLowerCase("vi")).toContain("sếp");
    }
    const question = composeContextReply({ kind: "QUESTION", question: "Bạn xác nhận lưu bản nháp này?", facts: ["Bạn có thể mô tả việc cần nhắc và thời điểm mong muốn."], field: "title" });
    if (question.status !== "READY") throw new Error("render");
    const result = addressContextReply(question, { addressStyle: "sep", customDisplayName: null });
    expect(result).toMatchObject({ text: "Sếp, " + question.text });
  });
  it("refuses addressing overflow without clipping authoritative text", () => {
    const plan = { status: "READY", source: "BACKEND", kind: "NOTICE", text: "🧾".repeat(1000), spans: [{ kind: "FACT", start: 0, end: 2000 }] } as const;
    expect(addressContextReply({ ...plan, spans: [...plan.spans] }, { addressStyle: "sep", customDisplayName: null })).toMatchObject({ status: "TOO_LONG", limit: 2000 });
    expect(plan.text.length).toBe(2000);
  });
});
