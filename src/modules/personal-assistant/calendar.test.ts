import { describe, expect, it } from "vitest";
import { initialPersonalAssistantDocument, PersonalAssistantDocumentSchema, type PersonalLifeEvent } from "../../contracts/api/personal-assistant";
import { planLifeEvents } from "./calendar";

const event = (overrides: Partial<PersonalLifeEvent> = {}): PersonalLifeEvent => ({
  id: "birthday", title: "Sinh nhật", kind: "BIRTHDAY", calendar: "SOLAR", month: 2, day: 29,
  time: "09:00", leapPolicy: "REGULAR", missingDayPolicy: "SKIP", leadDays: [0], enabled: true, ...overrides,
});
const document = (...events: PersonalLifeEvent[]) => ({ ...initialPersonalAssistantDocument(), events });
describe("annual Vietnam life calendar", () => {
  it("skips non-leap solar dates and resolves leap dates in UTC+7", () => {
    expect(planLifeEvents(document(event()), Date.parse("2025-01-01T00:00:00Z"))).toEqual([]);
    const result = planLifeEvents(document(event()), Date.parse("2024-01-01T00:00:00Z"));
    expect(result[0]).toMatchObject({ eventDate: "2024-02-29", scheduledAt: Date.parse("2024-02-29T02:00:00Z"), leadDays: 0 });
  });
  it("uses explicit last-day handling without normalizing a missing date", () => {
    expect(planLifeEvents(document(event({ missingDayPolicy: "LAST_DAY" })), Date.parse("2025-01-01T00:00:00Z"))[0].eventDate).toBe("2025-02-28");
  });
  it("selects a lunar leap month when present and regular month otherwise", () => {
    const leapEvent = event({ calendar: "LUNAR", month: 2, day: 1, leapPolicy: "LEAP_OR_REGULAR" });
    expect(planLifeEvents(document(leapEvent), Date.parse("2004-01-01T00:00:00Z"), 180)[0].eventDate).toBe("2004-03-21");
    expect(planLifeEvents(document({ ...leapEvent, leapPolicy: "REGULAR" }), Date.parse("2004-01-01T00:00:00Z"), 180)[0].eventDate).toBe("2004-02-20");
    expect(planLifeEvents(document(leapEvent), Date.parse("2026-01-01T00:00:00Z"), 180)[0].eventDate).toBe("2026-03-19");
  });
  it("applies lunar month-end policy", () => {
    const lunarEvent = event({ calendar: "LUNAR", month: 2, day: 30 });
    const start = Date.parse("2026-01-01T00:00:00Z");
    expect(planLifeEvents(document(lunarEvent), start, 120)).toEqual([]);
    expect(planLifeEvents(document({ ...lunarEvent, missingDayPolicy: "LAST_DAY" }), start, 120)[0].eventDate).toBe("2026-04-16");
  });
  it("includes next-year events whose lead reminder falls inside the horizon", () => {
    const result = planLifeEvents(document(event({ month: 1, day: 1, leadDays: [0, 7, 365] })), Date.parse("2026-12-20T00:00:00Z"), 20);
    expect(result.map(item => item.leadDays)).toEqual([7, 0, 365]);
    expect(result.map(item => item.occurrenceKey)).toEqual(["birthday:2027-01-01:7", "birthday:2027-01-01:0", "birthday:2028-01-01:365"]);
  });
  it("excludes exact-now and disabled reminders, and remains deterministic", () => {
    const input = document(event({ month: 1, day: 1 }), event({ id: "disabled", enabled: false }));
    expect(planLifeEvents(input, Date.parse("2026-01-01T02:00:00Z"), 1)).toEqual([]);
    expect(planLifeEvents(input, Date.parse("2025-12-31T00:00:00Z"), 2)).toEqual(planLifeEvents(input, Date.parse("2025-12-31T00:00:00Z"), 2));
    expect(planLifeEvents(input, Date.parse("2101-01-01T00:00:00Z"))).toEqual([]);
    expect(() => planLifeEvents(input, 0, 367)).toThrow(RangeError);
  });
  it("rejects oversized, duplicate and malformed persisted input", () => {
    expect(PersonalAssistantDocumentSchema.safeParse(document(event({ leadDays: [0, 0] }))).success).toBe(false);
    expect(PersonalAssistantDocumentSchema.safeParse(document(event(), event())).success).toBe(false);
    expect(PersonalAssistantDocumentSchema.safeParse(document(event({ calendar: "LUNAR", day: 31 }))).success).toBe(false);
    expect(PersonalAssistantDocumentSchema.safeParse(document(event({ time: "24:00" }))).success).toBe(false);
    expect(PersonalAssistantDocumentSchema.safeParse(document(...Array.from({ length: 101 }, (_, i) => event({ id: String(i) })))).success).toBe(false);
    const first = initialPersonalAssistantDocument(); first.daily.morningEnabled = true;
    expect(initialPersonalAssistantDocument().daily.morningEnabled).toBe(false);
  });
});

it("plans one-off expiry offsets across New Year without annual repetition", () => {
  const expiry = event({ id: "passport", kind: "RENEWAL", title: "Hộ chiếu hết hạn", year: 2027, month: 1, day: 10, leadDays: [30, 7, 1] });
  const result = planLifeEvents(document(expiry), Date.parse("2026-12-01T00:00:00Z"), 50);
  expect(result.map(item => [item.eventDate, item.leadDays, new Date(item.scheduledAt).toISOString()])).toEqual([
    ["2027-01-10", 30, "2026-12-11T02:00:00.000Z"],
    ["2027-01-10", 7, "2027-01-03T02:00:00.000Z"],
    ["2027-01-10", 1, "2027-01-09T02:00:00.000Z"],
  ]);
  expect(planLifeEvents(document(expiry), Date.parse("2027-01-11T00:00:00Z"))).toEqual([]);
  expect(planLifeEvents(document(expiry), Date.parse("2028-01-01T00:00:00Z"))).toEqual([]);
});
it("interprets an explicit lunar year in its own calendar and validates year coverage", () => {
  const lunar = event({ calendar: "LUNAR", year: 2004, month: 2, day: 1, leapPolicy: "LEAP_OR_REGULAR" });
  expect(planLifeEvents(document(lunar), Date.parse("2004-01-01T00:00:00Z"), 180)[0].eventDate).toBe("2004-03-21");
  expect(planLifeEvents(document(lunar), Date.parse("2005-01-01T00:00:00Z"))).toEqual([]);
  expect(PersonalAssistantDocumentSchema.safeParse(document(event({ year: 2101 }))).success).toBe(false);
});

it("bounds the full UTF-8 document even when Vietnamese fields fit individual quotas", () => {
  const input = initialPersonalAssistantDocument();
  input.memories = Array.from({ length: 30 }, (_, index) => ({ id: `memory-${index}`, label: "Ghi nhớ", value: "ệ".repeat(1900) }));
  expect(input.memories.every(item => item.value.length < 2000)).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeGreaterThan(100 * 1024);
  expect(PersonalAssistantDocumentSchema.safeParse(input).success).toBe(false);
  input.memories = input.memories.slice(0, 5);
  expect(PersonalAssistantDocumentSchema.safeParse(input).success).toBe(true);
});
