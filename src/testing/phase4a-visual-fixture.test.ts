import { describe, expect, it } from "vitest";
import { ActionsResponseSchema } from "@/contracts/api/actions";
import { RemindersResponseSchema } from "@/contracts/api/reminders";
import { SessionResponseSchema } from "@/contracts/api/session";
import { phase4aVisualFixture } from "./phase4a-visual-fixture";

describe("Phase 4A visual fixture", () => {
  it("uses public contracts for the populated authenticated Today scenario", () => {
    const fixture = phase4aVisualFixture("populated");

    expect(SessionResponseSchema.parse(fixture.session)).toBeDefined();
    expect(RemindersResponseSchema.parse(fixture.reminders)).toBeDefined();
    expect(ActionsResponseSchema.parse(fixture.actions)).toBeDefined();
    expect(fixture.reminders.data.reminders).toHaveLength(3);
  });

  it("keeps an ActionCandidate distinct from a Reminder", () => {
    const fixture = phase4aVisualFixture("action-candidate");

    expect(fixture.reminders.data.reminders).toEqual([]);
    expect(ActionsResponseSchema.parse(fixture.actions).data.actions[0]?.status).toBe("PENDING");
  });

  it("has an authenticated empty scenario without personal reminders or candidates", () => {
    const fixture = phase4aVisualFixture("empty");

    expect(fixture.reminders.data.reminders).toEqual([]);
    expect(fixture.actions.data.actions).toEqual([]);
  });

  it("models a local Actions failure without failing the reminder response", () => {
    const fixture = phase4aVisualFixture("partial-failure");

    expect(RemindersResponseSchema.parse(fixture.reminders).data.reminders).toHaveLength(3);
    expect(fixture.actionsFailure).toEqual({ status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Không thể tải đề xuất." } } });
  });

  it("provides explicit fictional fixtures for each Phase 4B screen state", () => {
    expect(phase4aVisualFixture("calendar-populated").reminders.data.reminders).toHaveLength(3);
    expect(phase4aVisualFixture("calendar-empty").reminders.data.reminders).toEqual([]);
    expect(phase4aVisualFixture("calendar-error").remindersFailure?.status).toBe(500);
    expect(phase4aVisualFixture("inbox-populated").actions.data.actions).toHaveLength(1);
    expect(phase4aVisualFixture("inbox-empty").actions.data.actions).toEqual([]);
    expect(phase4aVisualFixture("inbox-error").actionsFailure?.status).toBe(500);
    expect(phase4aVisualFixture("reminders-populated").reminders.data.reminders).toHaveLength(3);
    expect(phase4aVisualFixture("reminders-empty").reminders.data.reminders).toEqual([]);
    expect(phase4aVisualFixture("reminders-error").remindersFailure?.status).toBe(500);
  });
});
