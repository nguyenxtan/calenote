import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const currentStatePath = new URL("./current-state.md", import.meta.url);

test("current-state records proven Zalo production evidence without reviving retired diagnostics", async () => {
  const document = await readFile(currentStatePath, "utf8");

  for (const status of ["IMPLEMENTED", "WIRED", "TESTED", "PROVEN_IN_PRODUCTION", "DEPLOYED", "OPEN_INCIDENT", "PLANNED", "RETIRED_INCIDENT_DIAGNOSTIC"]) {
    assert.match(document, new RegExp(`\\b${status}\\b`, "u"));
  }

  for (const lane of ["PROCESS_INBOUND", "DELIVER_REMINDER", "DELIVER_LOGIN_CODE"]) {
    assert.match(document, new RegExp(`\\b${lane}\\b`, "u"));
  }

  assert.match(document, /Production origin.*DEPLOYED/iu);
  assert.match(document, /D1\/SQLite is canonical persistence/iu);
  assert.match(document, /Zalo webhook configuration and reachability.*PROVEN_IN_PRODUCTION/iu);
  assert.match(document, /testWebhook.*not an end-to-end message-delivery guarantee/iu);
  assert.match(document, /ZALO_REAL_INBOUND_PATH = PROVEN_IN_PRODUCTION/iu);
  assert.match(document, /FLAT_REAL_WEBHOOK_PARSING = PROVEN_IN_PRODUCTION/iu);
  assert.match(document, /D1_PERSISTED_BLOB_NORMALIZATION = PROVEN_IN_PRODUCTION/iu);
  assert.match(document, /BOUND_PRIVATE_CHAT_REMINDER_FLOW = PROVEN_IN_PRODUCTION/iu);
  assert.doesNotMatch(document, /Zalo real inbound message path \| OPEN_INCIDENT/iu);
  assert.match(document, /TELEGRAM_PRODUCTION_BEHAVIOR = PLANNED/iu);
  assert.match(document, /CONVERSATIONAL_CORE_V1 = NOT_IMPLEMENTED_ON_MASTER/iu);
  assert.match(document, /LLM_SEMANTIC_FALLBACK = NOT_PRODUCTION_ENABLED/iu);
  assert.match(document, /RETIRED_INCIDENT_DIAGNOSTIC/iu);
  assert.match(document, /no production route or Worker configuration can activate those probes/iu);
  assert.match(document, /Telegram production behavior.*PLANNED/iu);
});
