// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRouter } from "./router";
import { D1EmailDiscoveryStore } from "@/modules/auth/email-discovery";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { EmailRegistrationError } from "@/modules/auth/email-registration";

const origin = "https://calenote.iconiclogs.com";
function setup() {
  const database = { prepare: vi.fn(), batch: vi.fn() };
  const jobs = { send: vi.fn() };
  const onboardingOperations = vi.fn();
  const operations = {
    requestEmailRegistration: vi.fn(async () => ({ challengeId: "challenge", expiresAt: 1_800_000_600_000 })),
    verifyEmailRegistration: vi.fn(async () => ({ cookie: "__Host-calenote_session=verified-session; Path=/; HttpOnly; Secure; SameSite=Strict" })),
  };
  const emailRegistrationOperations = vi.fn(async () => operations);
  const route = createRouter({ emailRegistrationOperations, onboardingOperations });
  const env = { DB: database, JOBS: jobs, APP_ORIGIN: origin, CALENOTE_RUNTIME_ENVIRONMENT: "production", ASSETS: { fetch: vi.fn() } } as unknown as Env;
  const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  const call = (path: string, body?: unknown, headers: Record<string, string> = {}, method = "POST") => route(new Request(origin + path, {
    method, headers: { origin, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, context);
  return { call, database, jobs, onboardingOperations, operations, emailRegistrationOperations };
}
describe("public email registration router", () => {
  it("retires public bot-token onboarding without preparing dependencies or invoking providers", async () => {
    const s = setup();
    const response = await s.call("/api/onboarding", { token: "untrusted", email: "owner@example.com" });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: { code: "EMAIL_VERIFICATION_REQUIRED" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(s.onboardingOperations).not.toHaveBeenCalled();
    expect(s.emailRegistrationOperations).not.toHaveBeenCalled();
    expect(s.database.prepare).not.toHaveBeenCalled();
    expect(s.database.batch).not.toHaveBeenCalled();
    expect(s.jobs.send).not.toHaveBeenCalled();
  });
  it.each(["", "https://foreign.example"])("rejects missing or foreign origin on retired onboarding", async (requestOrigin) => {
    const s = setup();
    const response = await s.call("/api/onboarding", {}, { origin: requestOrigin });
    expect(response.status).toBe(403);
    expect(s.onboardingOperations).not.toHaveBeenCalled();
    expect(s.database.prepare).not.toHaveBeenCalled();
  });
  it("wires request and verification with both secure cookies", async () => {
    const s = setup();
    const requested = await s.call("/api/auth/register/request", { email: "owner@example.com", displayName: "Owner" });
    expect(requested.status).toBe(202);
    expect(await requested.json()).toEqual({ data: { accepted: true, challengeId: "challenge", expiresAt: 1_800_000_600_000 } });
    const cookie = requested.headers.get("set-cookie")!.split(";")[0];
    const verified = await s.call("/api/auth/register/verify", { challengeId: "challenge", email: "owner@example.com", code: "123456" }, { cookie });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ data: { registered: true, next: "/app/connections" } });
    expect(verified.headers.getSetCookie()).toEqual([expect.stringContaining("__Host-calenote_session=verified-session"), expect.stringContaining("__Host-calenote_registration=; Path=/; Max-Age=0")]);
    expect(s.database.prepare).not.toHaveBeenCalled();
    expect(s.jobs.send).not.toHaveBeenCalled();
  });
  it.each(["/api/auth/register/request", "/api/auth/register/verify"])("rejects GET %s", async (path) => {
    const s = setup();
    expect((await s.call(path, undefined, {}, "GET")).status).toBe(404);
    expect(s.emailRegistrationOperations).not.toHaveBeenCalled();
  });
  it("returns sender unavailable as generic private 503", async () => {
    const s = setup();
    s.operations.requestEmailRegistration.mockRejectedValue(new EmailRegistrationError("DELIVERY_UNAVAILABLE"));
    const response = await s.call("/api/auth/register/request", { email: "owner@example.com", displayName: "Owner" });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(s.database.prepare).not.toHaveBeenCalled();
  });
  it.each(["/api/auth/register/request", "/api/auth/register/verify"])("makes errors private for %s", async (path) => {
    const s = setup();
    const response = await s.call(path, {}, { origin: "https://foreign.example" });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(s.emailRegistrationOperations).not.toHaveBeenCalled();
  });
});
it("classifies an email-verified account with no bot as SETUP without issuing session or bot", async () => {
  const db = new SqliteD1Database();
  try {
    db.sqlite.exec("CREATE TABLE IF NOT EXISTS email_verified_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),verified_at INTEGER NOT NULL)");
    db.sqlite.exec("INSERT INTO users VALUES('verified','verified@example.com','Owner','Asia/Ho_Chi_Minh',1,1); INSERT INTO email_verified_accounts VALUES('verified',1)");
    expect(await new D1EmailDiscoveryStore(db as unknown as D1Database).classify("VERIFIED@example.com")).toBe("SETUP");
    for (const table of ["bot_connections", "sessions"]) expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 });
  } finally { db.close(); }
});
