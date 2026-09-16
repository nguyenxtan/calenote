import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const specPath = new URL("./2026-09-16-ai-semantic-conversation-v1-design.md", import.meta.url);
const planPath = new URL("../plans/2026-09-16-ai-semantic-conversation-v1.md", import.meta.url);

test("semantic conversation V1 freezes AI authority, strict output, and docs-first boundaries", async () => {
  const [spec, plan] = await Promise.all([
    readFile(specPath, "utf8"),
    readFile(planPath, "utf8"),
  ]);

  for (const intent of ["CREATE_REMINDER", "LIST_REMINDERS", "NEEDS_CLARIFICATION", "HELP", "UNSUPPORTED"]) {
    assert.match(spec, new RegExp(intent, "u"));
  }
  assert.match(spec, /additionalProperties: false/u);
  assert.match(spec, /`AI_MODE` is `off \| semantic`/u);
  assert.match(spec, /at most\s+two calls per inbound/u);
  assert.match(spec, /at least 200/u);
  assert.match(spec, /Implementation migration required: YES, but not in this checkpoint/u);
  assert.match(spec, /Do not cherry-pick/u);
  assert.doesNotMatch(spec, /AI_MODE=privacy is intended/u);
  assert.match(plan, /No model gets D1/u);
  assert.match(plan, /do not deploy, migrate production, rotate secrets, or contact a provider/u);
});
