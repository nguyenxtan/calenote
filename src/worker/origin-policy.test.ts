import { describe, expect, it } from "vitest";
import {
  LOCAL_DEVELOPMENT_APP_ORIGIN,
  PRODUCTION_APP_ORIGIN,
  resolveRuntimeOriginPolicy,
} from "./origin-policy";

const production = { APP_ORIGIN: PRODUCTION_APP_ORIGIN, CALENOTE_RUNTIME_ENVIRONMENT: "production" };
const local = { APP_ORIGIN: LOCAL_DEVELOPMENT_APP_ORIGIN, CALENOTE_RUNTIME_ENVIRONMENT: "local" };

describe("runtime origin policy", () => {
  it("accepts only the canonical HTTPS origin in production", () => {
    expect(resolveRuntimeOriginPolicy(production, new Request(`${PRODUCTION_APP_ORIGIN}/api/health`))).toMatchObject({ mode: "production", appOrigin: PRODUCTION_APP_ORIGIN });
    expect(resolveRuntimeOriginPolicy(production, new Request(`${LOCAL_DEVELOPMENT_APP_ORIGIN}/api/health`))).toBeNull();
    expect(resolveRuntimeOriginPolicy(production, new Request("http://localhost:8787/api/health"))).toBeNull();
  });

  it("accepts exactly local HTTPS only in explicit local mode", () => {
    expect(resolveRuntimeOriginPolicy(local, new Request(`${LOCAL_DEVELOPMENT_APP_ORIGIN}/api/health`))).toMatchObject({ mode: "local", appOrigin: LOCAL_DEVELOPMENT_APP_ORIGIN });
    expect(resolveRuntimeOriginPolicy(local, new Request("http://localhost:8787/api/health"))).toBeNull();
    expect(resolveRuntimeOriginPolicy(local, new Request("https://evil.example/api/health"))).toBeNull();
  });

  it("fails closed for arbitrary origin overrides and missing or unknown runtime modes", () => {
    expect(resolveRuntimeOriginPolicy({ APP_ORIGIN: "https://evil.example", CALENOTE_RUNTIME_ENVIRONMENT: "production" }, new Request("https://evil.example/api/health"))).toBeNull();
    expect(resolveRuntimeOriginPolicy({ APP_ORIGIN: LOCAL_DEVELOPMENT_APP_ORIGIN, CALENOTE_RUNTIME_ENVIRONMENT: "local" }, new Request(`${PRODUCTION_APP_ORIGIN}/api/health`))).toBeNull();
    expect(resolveRuntimeOriginPolicy({ APP_ORIGIN: PRODUCTION_APP_ORIGIN }, new Request(`${PRODUCTION_APP_ORIGIN}/api/health`))).toBeNull();
    expect(resolveRuntimeOriginPolicy({ APP_ORIGIN: PRODUCTION_APP_ORIGIN, CALENOTE_RUNTIME_ENVIRONMENT: "unknown" }, new Request(`${PRODUCTION_APP_ORIGIN}/api/health`))).toBeNull();
  });
});
