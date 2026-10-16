import { expect, it, vi } from "vitest";
import { loadReminderList } from "@/lib/reminder-list";
import { createRouter } from "../router";
import type { RemindersOperations } from "./operations";

it("traverses byte-packed wide Unicode pages through the real Worker router and browser reader", async () => {
  const reminders = Array.from({ length: 101 }, (_, index) => ({ publicId: `r${String(index).padStart(3, "0")}`, title: "漢".repeat(500), scheduledAt: 1_800_000_000_000, timezone: "Asia/Ho_Chi_Minh" as const, status: "PENDING" as const }));
  const operations: RemindersOperations = {
    requireUser: async () => ({ userId: "fixture" }),
    listReminders: async (_, after) => reminders.filter(row => after === undefined || row.publicId > after).slice(0, 101),
    createReminder: vi.fn(), cancelReminder: vi.fn(),
  };
  const router = createRouter({ remindersOperations: async () => operations });
  const pages: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    const response = await router(new Request(`https://calenote.iconiclogs.com${path}`, { headers: { cookie: `__Host-calenote_session=${"A".repeat(43)}` } }), { APP_ORIGIN: "https://calenote.iconiclogs.com", CALENOTE_RUNTIME_ENVIRONMENT: "production" } as Env, { waitUntil: vi.fn() } as unknown as ExecutionContext);
    const body = await response.clone().text();
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(128 * 1024);
    pages.push(JSON.parse(body).data.reminders.length);
    return response;
  }));
  const loaded = await loadReminderList(vi.fn());
  expect(loaded).toEqual(reminders);
  expect(pages[0]).toBeLessThan(100);
  expect(pages.length).toBeGreaterThan(1);
});
