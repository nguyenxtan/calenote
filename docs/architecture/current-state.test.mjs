import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const currentStatePath = new URL("./current-state.md", import.meta.url);

test("current-state records implemented Worker lanes and honest evidence boundaries", async () => {
  const document = await readFile(currentStatePath, "utf8");

  for (const status of ["IMPLEMENTED", "WIRED", "TESTED", "E2E_PROVEN", "DEPLOYED", "PLANNED"]) {
    assert.match(document, new RegExp(`\\b${status}\\b`, "u"));
  }

  for (const lane of ["PROCESS_INBOUND", "DELIVER_REMINDER", "DELIVER_LOGIN_CODE"]) {
    assert.match(document, new RegExp(`\\b${lane}\\b`, "u"));
  }

  assert.match(document, /Production origin.*DEPLOYED/iu);
  assert.match(document, /Zalo production transport.*not E2E_PROVEN/iu);
  assert.match(document, /CALENOTE_REQUEST_INIT_COMBINATION/iu);
  assert.match(document, /Telegram live\s+behavior.*not E2E_PROVEN/iu);
  assert.match(document, /chưa.*E2E|not.*E2E/iu);
  assert.match(document, /Presentation preferences.*IMPLEMENTED, WIRED, TESTED/iu);
  assert.match(document, /V2 authenticated app screens.*IMPLEMENTED, WIRED, TESTED/iu);
  assert.match(document, /Public V2 experience.*IMPLEMENTED, WIRED, TESTED/iu);
  assert.match(document, /\/onboarding.*first-time bootstrap.*\/dashboard.*compatibility/iu);
  assert.match(document, /Google OAuth.*NOT_IMPLEMENTED.*DEFERRED/iu);
  assert.match(document, /V2 web journey is canonical[\s\S]*\/dashboard.*compatibility-only/iu);
});
