import { describe, expect, it, vi } from "vitest";
import { loadReminderList } from "./reminder-list";
const row = (index: number) => ({ publicId: `r${String(index).padStart(3, "0")}`, title: `Việc ${index}`, scheduledAt: 1_800_000_000_000 + index, timezone: "Asia/Ho_Chi_Minh", status: "PENDING" });
const json = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });
describe("reminder list traversal", () => {
  it("loads the 101st reminder through bounded authenticated pages", async () => {
    const fetcher = vi.fn(async (path: string | URL | Request) => path === "/api/reminders"
      ? json({ reminders: Array.from({ length: 100 }, (_, index) => row(index)), nextCursor: "r099" })
      : json({ reminders: [row(100)] }));
    vi.stubGlobal("fetch", fetcher);
    const rows = await loadReminderList(vi.fn());
    expect(rows).toHaveLength(101);
    expect(rows[100].title).toBe("Việc 100");
    expect(fetcher).toHaveBeenLastCalledWith("/api/reminders?after=r099", expect.objectContaining({ credentials: "same-origin", method: "GET" }));
  });
  it("follows a byte-limited page with fewer than 100 reminders", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path) => path === "/api/reminders"
      ? json({ reminders: [row(0), row(1)], nextCursor: "r001" })
      : json({ reminders: [row(2)] })));
    expect((await loadReminderList(vi.fn())).map(item => item.publicId)).toEqual(["r000", "r001", "r002"]);
  });
  it("fails rather than showing the first page as complete when a later page fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path) => {
      if (path !== "/api/reminders") throw new TypeError("offline");
      return json({ reminders: Array.from({ length: 100 }, (_, index) => row(index)), nextCursor: "r099" });
    }));
    await expect(loadReminderList(vi.fn())).rejects.toThrow();
  });
  it("rejects a looping cursor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ reminders: [row(1)], nextCursor: "r001" })));
    await expect(loadReminderList(vi.fn())).rejects.toThrow("Invalid reminder page");
  });
});
