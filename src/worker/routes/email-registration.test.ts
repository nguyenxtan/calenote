import { describe, expect, it, vi } from "vitest";
import { handleRequestEmailRegistration, handleVerifyEmailRegistration } from "./email-registration";

const origin = "https://calenote.example";
const challenge = { challengeId: "challenge-opaque", expiresAt: 1792491000000 };
const binding = "a".repeat(64);
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/auth/register/request`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
function factory() {
  const operations = { requestEmailRegistration: vi.fn().mockResolvedValue(challenge), verifyEmailRegistration: vi.fn().mockResolvedValue({ cookie: "__Host-calenote_session=session; Path=/; HttpOnly; Secure; SameSite=Strict" }) };
  return { operations, create: vi.fn().mockResolvedValue(operations) };
}
describe("email registration route boundaries", () => {
  it.each([{}, { email: "bad", displayName: "Name" }, { email: "a@example.com", displayName: "" }, { email: "a@example.com", displayName: "Name", userId: "owner" }])("rejects invalid request before operations", async (body) => {
    const { create } = factory();
    await expect(handleRequestEmailRegistration(request(body), origin, create)).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects foreign origin before operations", async () => {
    const { create } = factory();
    await expect(handleRequestEmailRegistration(request({}, { origin: "https://evil.example" }), origin, create)).rejects.toMatchObject({ status: 403 });
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects oversized payload before operations", async () => {
    const { create } = factory();
    await expect(handleRequestEmailRegistration(request({ email: "a@example.com", displayName: "a".repeat(3000) }), origin, create)).rejects.toMatchObject({ status: 413 });
    expect(create).not.toHaveBeenCalled();
  });
  it("creates a fresh secure binding, normalizes input, and sends private accepted response", async () => {
    const { operations, create } = factory();
    const response = await handleRequestEmailRegistration(request({ email: " A@Example.com ", displayName: " Name " }, { "CF-Connecting-IP": "192.0.2.1" }), origin, create);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { accepted: true, ...challenge } });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Host-calenote_registration=[a-f0-9]{64}; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Strict$/);
    expect(operations.requestEmailRegistration).toHaveBeenCalledWith({ email: "a@example.com", displayName: "Name", clientIp: "192.0.2.1", browserBinding: cookie.split(";")[0].split("=")[1] });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    const second = await handleRequestEmailRegistration(request({ email: "a@example.com", displayName: "Name" }), origin, create);
    expect(second.headers.get("set-cookie")).not.toBe(cookie);
  });
  it.each([undefined, "__Host-calenote_registration=bad", `__Host-calenote_registration=${binding}; __Host-calenote_registration=${binding}`])("rejects absent, malformed or ambiguous binding before operations", async (cookie) => {
    const { create } = factory();
    await expect(handleVerifyEmailRegistration(request({ ...challenge, expiresAt: undefined, email: "a@example.com", code: "123456" }, cookie ? { cookie } : {}), origin, create)).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });
  it.each([
    { challengeId: "challenge", email: "a@example.com", code: "12345" },
    { challengeId: "challenge", email: "a@example.com", code: "123456", displayName: "Override" },
    { challengeId: "a".repeat(2000), email: "a@example.com", code: "123456" },
  ])("validates verify payload before operations", async (body) => {
    const { create } = factory();
    await expect(handleVerifyEmailRegistration(request(body, { cookie: `__Host-calenote_registration=${binding}` }), origin, create)).rejects.toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects foreign verify origin before operations", async () => {
    const { create } = factory();
    await expect(handleVerifyEmailRegistration(request({}, { origin: "https://evil.example", cookie: `__Host-calenote_registration=${binding}` }), origin, create)).rejects.toMatchObject({ status: 403 });
    expect(create).not.toHaveBeenCalled();
  });
  it("verifies only challenge inputs, issues session and clears binding", async () => {
    const { operations, create } = factory();
    const response = await handleVerifyEmailRegistration(request({ challengeId: challenge.challengeId, email: "A@example.com", code: "123456" }, { cookie: `__Host-calenote_registration=${binding}` }), origin, create);
    expect(operations.verifyEmailRegistration).toHaveBeenCalledWith({ challengeId: challenge.challengeId, email: "a@example.com", code: "123456", browserBinding: binding, clientIp: "unavailable" });
    expect(await response.json()).toEqual({ data: { registered: true, next: "/app/connections" } });
    expect(response.headers.getSetCookie()).toEqual([expect.stringContaining("__Host-calenote_session=session"), expect.stringContaining("__Host-calenote_registration=; Path=/; Max-Age=0;")]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("propagates sender unavailable without issuing binding", async () => {
    const { operations, create } = factory();
    operations.requestEmailRegistration.mockRejectedValue(Object.assign(new Error("Registration unavailable"), { status: 503 }));
    await expect(handleRequestEmailRegistration(request({ email: "a@example.com", displayName: "Name" }), origin, create)).rejects.toMatchObject({ status: 503 });
  });
});
