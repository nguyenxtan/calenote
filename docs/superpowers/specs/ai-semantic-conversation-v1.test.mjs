import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const specPath = new URL("./2026-09-16-ai-semantic-conversation-v1-design.md", import.meta.url);
const planPath = new URL("../plans/2026-09-17-semantic-v1-hybrid-temporal-authority.md", import.meta.url);

test("hybrid temporal authority documents keep application safety and production gates", async () => {
  const [rawSpec, rawPlan] = await Promise.all([readFile(specPath, "utf8"), readFile(planPath, "utf8")]);
  const spec = rawSpec.replace(/\s+/gu, " ");
  const plan = rawPlan.replace(/\s+/gu, " ");

  for (const required of ["Temporal Evidence", "CREATE_REMINDER", "LIST_REMINDERS", "HELP", "UNSUPPORTED", "AMBIGUOUS"]) {
    assert.match(spec, new RegExp(required, "u"));
  }
  assert.match(spec, /supersedes the prior single-shot contract/u);
  assert.match(spec, /old-contract model-selection evidence/u);
  assert.match(spec, /no temporal fields/u);
  assert.match(spec, /forbids `localDate`, `localTime`, `rangeKind`, timezone, epoch/u);
  assert.match(spec, /Temporal Evidence is authoritative/u);
  assert.match(spec, /cannot create missing temporal values/u);
  assert.match(spec, /`LIST_REMINDERS` is always owner-scoped, bounded, and read-only/u);
  assert.match(spec, /sole path from a draft to one reminder mutation/u);
  assert.match(spec, /New evidence may fill only missing slots/u);
  assert.match(spec, /must never silently replace/u);
  assert.match(spec, /Task 1 scanner grammar supplement/u);
  assert.match(spec, /maximal temporal-span consumption/u);
  assert.match(spec, /finite incomplete-starter registry/u);
  assert.match(spec, /one lexical pass plus bounded finite-state grammar processing/u);
  assert.match(spec, /`AI_MODE=privacy`/u);
  assert.match(spec, /`free` is unavailable\/reserved/u);
  assert.match(spec, /50/u);
  assert.match(spec, /500,000 microunits/u);
  assert.match(spec, /2,000,000 microunits/u);
  assert.match(spec, /36-case pilot requires 100% schema and Temporal Evidence accuracy/u);
  assert.match(spec, /216-case full benchmark requires schema at least 99%/u);
  assert.match(spec, /no\s+OpenRouter production secret, D1 migration, master merge, or deployment/u);
  assert.doesNotMatch(spec, /FREE_PRIMARY\s*->\s*CHEAP_PAID_FALLBACK/u);
  assert.doesNotMatch(spec, /`AI_MODE` is `off \| semantic`/u);

  for (const required of ["Task 1", "Task 2", "Task 3", "Task 4", "Task 5", "Task 6"]) {
    assert.match(plan, new RegExp(required, "u"));
  }
  assert.match(plan, /Temporal extraction has zero provider\/DB calls/u);
  assert.match(plan, /no date, time, range, timezone, epoch/u);
  assert.match(plan, /no fallback\/tools\/functions/u);
  assert.match(plan, /exactly-one confirmation mutation/u);
  assert.match(plan, /pilot\/full cross-resume/u);
  assert.match(plan, /No live inference until focused tests, `pnpm check`, diff validation, and review pass/u);
  assert.match(plan, /Implement a finite-state scanner, not prefix guards/u);
});
