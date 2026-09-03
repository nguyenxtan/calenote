import { describe, expect, it } from "vitest";
import {
  MAX_REMINDER_TITLE_CODE_UNITS,
  parseVietnameseReminder,
} from "./parse-vietnamese";

const timezone = "Asia/Ho_Chi_Minh";
// 02/09/2026 10:15 in Vietnam (UTC+07).
const receivedAt = Date.UTC(2026, 8, 2, 3, 15);

describe("parseVietnameseReminder", () => {
  it.each([
    {
      text: "mai 8h nhắc tui gọi cho mẹ",
      title: "gọi cho mẹ",
      scheduledAt: Date.UTC(2026, 8, 3, 1),
    },
    {
      text: "hôm nay 15:30 nhắc tôi gửi báo cáo",
      title: "gửi báo cáo",
      scheduledAt: Date.UTC(2026, 8, 2, 8, 30),
    },
    {
      text: "ngày 10/09 lúc 9h nhắc mình đóng tiền điện",
      title: "đóng tiền điện",
      scheduledAt: Date.UTC(2026, 8, 10, 2),
    },
    {
      text: "nhắc tôi mai 20h uống thuốc",
      title: "uống thuốc",
      scheduledAt: Date.UTC(2026, 8, 3, 13),
    },
    {
      text: "10/09/2026 09:45 nhắc tôi thanh toán hóa đơn",
      title: "thanh toán hóa đơn",
      scheduledAt: Date.UTC(2026, 8, 10, 2, 45),
    },
  ])("parses the documented command: $text", ({ text, title, scheduledAt }) => {
    expect(parseVietnameseReminder(text, receivedAt, timezone)).toEqual({
      ok: true,
      candidate: { title, scheduledAt, timezone },
    });
  });

  it("chooses next year for an earlier DD/MM but never for a same-day past time", () => {
    const december31 = Date.UTC(2026, 11, 31, 3);
    expect(parseVietnameseReminder(
      "01/01 9h nhắc tôi chúc mừng năm mới",
      december31,
      timezone,
    )).toEqual({
      ok: true,
      candidate: {
        title: "chúc mừng năm mới",
        scheduledAt: Date.UTC(2027, 0, 1, 2),
        timezone,
      },
    });

    expect(parseVietnameseReminder(
      "ngày 02/09 10h nhắc tôi việc cũ",
      receivedAt,
      timezone,
    )).toEqual({ ok: false, code: "PAST_TIME" });
  });

  it("accepts a leap day and rejects impossible calendar dates", () => {
    const leapReference = Date.UTC(2024, 1, 28, 3);
    expect(parseVietnameseReminder(
      "29/02 12h nhắc mình kiểm tra lịch",
      leapReference,
      timezone,
    )).toEqual({
      ok: true,
      candidate: {
        title: "kiểm tra lịch",
        scheduledAt: Date.UTC(2024, 1, 29, 5),
        timezone,
      },
    });

    for (const text of [
      "29/02/2023 12h nhắc mình kiểm tra lịch",
      "31/04/2026 12h nhắc mình kiểm tra lịch",
      "00/09/2026 12h nhắc mình kiểm tra lịch",
    ]) {
      expect(parseVietnameseReminder(text, receivedAt, timezone)).toEqual({
        ok: false,
        code: "INVALID_DATE",
      });
    }
  });

  it.each([
    ["mai nhắc tôi gửi báo cáo", "MISSING_TIME"],
    ["8h nhắc tôi gửi báo cáo", "MISSING_DATE"],
    ["mai 8h nhắc tôi", "MISSING_TITLE"],
    ["mai 8h gửi báo cáo", "INVALID_COMMAND"],
    ["hôm nay mai 15h nhắc tôi gửi báo cáo", "AMBIGUOUS_DATE"],
    ["mai 8h 9h nhắc tôi gửi báo cáo", "AMBIGUOUS_TIME"],
    ["mai 25h nhắc tôi gửi báo cáo", "INVALID_TIME"],
  ] as const)("returns %s as a stable failure", (text, code) => {
    expect(parseVietnameseReminder(text, receivedAt, timezone)).toEqual({ ok: false, code });
  });

  it("rejects commands scheduled more than 366 days after the provider timestamp", () => {
    expect(parseVietnameseReminder(
      "04/09/2027 11h nhắc tôi quá xa",
      receivedAt,
      timezone,
    )).toEqual({ ok: false, code: "TOO_FAR" });
  });

  it("supports only Asia/Ho_Chi_Minh", () => {
    expect(parseVietnameseReminder(
      "mai 8h nhắc tôi họp",
      receivedAt,
      "UTC",
    )).toEqual({ ok: false, code: "UNSUPPORTED_TIMEZONE" });
  });

  it("normalizes NFC, line endings, and whitespace before exact title extraction", () => {
    const decomposed = "nga\u0300y kia\r\nlúc 08:30\t nhắc tôi   gọi cho me\u0323";
    expect(parseVietnameseReminder(decomposed, receivedAt, timezone)).toEqual({
      ok: true,
      candidate: {
        title: "gọi cho mẹ",
        scheduledAt: Date.UTC(2026, 8, 4, 1, 30),
        timezone,
      },
    });
  });

  it("accepts the exact shared UTF-16 title bound and rejects one code unit more", () => {
    const exact = "a".repeat(MAX_REMINDER_TITLE_CODE_UNITS - 2) + "💊";
    expect(exact.length).toBe(MAX_REMINDER_TITLE_CODE_UNITS);
    expect(parseVietnameseReminder(
      `mai 8h nhắc tôi ${exact}`,
      receivedAt,
      timezone,
    )).toMatchObject({ ok: true, candidate: { title: exact } });

    expect(parseVietnameseReminder(
      `mai 8h nhắc tôi ${exact}b`,
      receivedAt,
      timezone,
    )).toEqual({ ok: false, code: "TITLE_TOO_LONG" });
  });
});
