import { describe, expect, it } from "vitest";
import { composeContextReply } from "./responses";
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
