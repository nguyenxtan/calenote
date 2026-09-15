import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const currentStatePath = new URL("./current-state.md", import.meta.url);

test("current-state records deployed Worker lanes and the open Zalo evidence boundary", async () => {
  const document = await readFile(currentStatePath, "utf8");

  for (const status of ["IMPLEMENTED", "WIRED", "TESTED", "PROVEN_IN_PRODUCTION", "DEPLOYED", "OPEN_INCIDENT", "PLANNED"]) {
    assert.match(document, new RegExp(`\\b${status}\\b`, "u"));
  }

  for (const lane of ["PROCESS_INBOUND", "DELIVER_REMINDER", "DELIVER_LOGIN_CODE"]) {
    assert.match(document, new RegExp(`\\b${lane}\\b`, "u"));
  }

  assert.match(document, /Production origin.*DEPLOYED/iu);
  assert.match(document, /D1\/SQLite is canonical persistence/iu);
  assert.match(document, /Zalo webhook configuration and verification.*PROVEN_IN_PRODUCTION/iu);
  assert.match(document, /testWebhook.*not an end-to-end message-delivery guarantee/iu);
  assert.match(document, /Zalo real inbound message path.*OPEN_INCIDENT/iu);
  assert.match(document, /first controlled polling result is inconclusive/iu);
  assert.match(document, /Telegram production behavior.*PLANNED/iu);
});
