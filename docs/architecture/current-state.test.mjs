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

  assert.match(document, /chưa.*deploy|not deployed/iu);
  assert.match(document, /chưa.*E2E|not.*E2E/iu);
});
