import { describe, expect, it, vi } from "vitest";
import { createRouter } from "../router";
import { createCanonicalSeriesOperations } from "../composition-root";
import type { CanonicalSeriesOperations } from "./operations";
import type { CanonicalSeriesView } from "@/contracts/api/canonical-series";
import {encodeCanonicalSeriesCursor} from '@/contracts/api/canonical-series';
const origin = "https://calenote.iconiclogs.com";
const cookie = `__Host-calenote_session=${"A".repeat(43)}`;
const principal = { userId: "owner", sessionId: "session", expiresAt: 9999999999999 };
const env = { APP_ORIGIN: origin, CALENOTE_RUNTIME_ENVIRONMENT: "production" } as Env;
const series = { publicId: "A".repeat(22), revision: 1, state: "ACTIVE", title: "kiểm tra QA", calendar: "GREGORIAN", eventDate: null, eventTime: null,
  occurrences: [{ localDate: "2026-11-09", localTime: "09:00", status: "PENDING" }] } satisfies CanonicalSeriesView;

describe("canonical series routes", () => {
  function fixture(result: Awaited<ReturnType<CanonicalSeriesOperations["cancelSeries"]>> = { result: "CONFLICT" }) {
    const ops = { requireUser: vi.fn(async () => principal), listSeries: vi.fn(async () => ({series:[series],hasMore:false,nextCursor:null,skipped:0})), cancelSeries: vi.fn(async () => result) };
    const legacy = { requireUser: vi.fn(), listSeries: vi.fn(), decideSeries: vi.fn() };
    const route = createRouter({ canonicalSeriesOperations: async () => ops, seriesOperations: async () => legacy as never });
    return { ops, legacy, request: (method: string, body?: unknown, headers: HeadersInit = { cookie, origin }) => route(new Request(`${origin}/api/v2/reminder-series`, {
      method, headers: { "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
    }), env, {} as ExecutionContext) };
  }
  it("requires a session and same-origin POST before any canonical operation", async () => {
    const h = fixture();
    expect((await h.request("GET", undefined, {})).status).toBe(401);
    expect((await h.request("POST", { publicId: "A".repeat(22), expectedRevision: 1 }, { cookie, origin: "https://evil.test" })).status).toBe(403);
    expect((await h.request("PUT", {})).status).toBe(404);
    expect(h.ops.listSeries).not.toHaveBeenCalled(); expect(h.ops.cancelSeries).not.toHaveBeenCalled();
    expect(h.legacy.listSeries).not.toHaveBeenCalled();
  });
  it("lists for the session principal with private no-store responses", async () => {
    const h = fixture(); const response = await h.request("GET");
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ data: { schemaVersion: "canonical-series-1", series: [series],hasMore:false,nextCursor:null,skipped:0 } });
    expect(h.ops.listSeries).toHaveBeenCalledWith(principal,undefined);
  });
  it("accepts only strict {publicId,expectedRevision} and maps outcomes", async () => {
    const h = fixture();
    const body = { publicId: "A".repeat(22), expectedRevision: 1 };
    expect((await h.request("POST", { ...body, ownerId: "other" })).status).toBe(400);
    expect((await h.request("POST", { publicId: "A".repeat(22), revision: 1 })).status).toBe(400);
    const conflict = await h.request("POST", body);
    expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ data: { result: "CONFLICT" } });
    expect(h.ops.cancelSeries).toHaveBeenCalledWith(principal, body);
    const missing = fixture({ result: "NOT_FOUND" });
    expect((await missing.request("POST", body)).status).toBe(404);
    const done = fixture({ result: "CANCELLED", revision: 2, cancelledReminders: 3, cancelledDeliveries: 1, stoppedTasks: 4, preservedUnchanged: 1 });
    const ok = await done.request("POST", body);
    expect(ok.status).toBe(200); expect(((await ok.json()) as { data: unknown }).data).toMatchObject({ result: "CANCELLED", preservedUnchanged: 1 });
  });
  it("default runtime without the selected context contract reads and mutates nothing", async () => {
    const prepare = vi.fn(() => { throw new Error("database must not be touched"); });
    const ops = await createCanonicalSeriesOperations({ DB: { prepare, batch: prepare } } as unknown as Env, {});
    await expect(ops.listSeries(principal)).rejects.toMatchObject({ code: "SERIES_UNAVAILABLE", status: 409 });
    await expect(ops.cancelSeries(principal, { publicId: "A".repeat(22), expectedRevision: 1 })).rejects.toMatchObject({ code: "SERIES_UNAVAILABLE" });
    expect(prepare).not.toHaveBeenCalled();
  });
  it('validates the bounded cursor before listing and forwards a valid cursor only with the session principal',async()=>{
    const cursor=encodeCanonicalSeriesCursor([0,1,'A'.repeat(22)]);
    const ops={requireUser:vi.fn(async()=>principal),listSeries:vi.fn(async()=>({series:[],hasMore:false,nextCursor:null,skipped:0})),cancelSeries:vi.fn()};
    const route=createRouter({canonicalSeriesOperations:async()=>ops});
    expect((await route(new Request(origin+'/api/v2/reminder-series?cursor=bad',{headers:{cookie}}),env,{} as ExecutionContext)).status).toBe(400);expect(ops.listSeries).not.toHaveBeenCalled();
    expect((await route(new Request(origin+'/api/v2/reminder-series?cursor='+cursor,{headers:{cookie}}),env,{} as ExecutionContext)).status).toBe(200);expect(ops.listSeries).toHaveBeenCalledWith(principal,cursor);
  });
});
