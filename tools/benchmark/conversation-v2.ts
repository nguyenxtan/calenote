import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ConversationModelSchema, ConversationModelJsonSchema, ConversationSnapshotSchema, type ConversationSnapshot } from "../../src/modules/conversation/contracts";
import { CONVERSATION_PROMPT } from "../../src/modules/conversation/prompt";
import { lunarCalendar } from "../../src/modules/conversation/lunar-calendar";
import { extractConversationTemporalEvidence, type Evidence } from "../../src/modules/conversation/temporal";
import { reconcileConversation } from "../../src/modules/conversation/reconcile";
import { expandFiniteSeries } from "../../src/modules/reminders/series";

const corpusPath = "src/modules/conversation/benchmark/conversation-v2.json";
const textOrNull = z.string().nullable().default(null);
const projection = z.object({ calendar: z.string().nullable(), eventDate: textOrNull, date: textOrNull, time: textOrNull,
  count: z.union([z.number(), z.literal("AMBIGUOUS")]).nullable().default(null), relation: textOrNull }).strict();
const expected = z.object({ evidence: projection, outcome: z.string(), field: textOrNull,
  state: z.enum(["NONE", "CLARIFYING", "DRAFT_READY", "CANCELLED"]), mutationCount: z.literal(0),
  request: projection.extend({ title: textOrNull }).optional(),
  occurrenceDates: z.array(z.string()).optional(), expansionRejection: z.string().optional(),
}).strict();
const corpusSchema = z.object({ version: z.literal("conversation-v2-offline-1"), transport: z.literal("MOCK"),
  referenceNow: z.number().int().nonnegative(), models: z.record(z.string(), ConversationModelSchema),
  cases: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/u),
    turns: z.array(z.object({ text: z.string().min(1).max(1800), model: z.string(),
      delayMs: z.number().int().nonnegative().default(0), expected }).strict()).min(1).max(6),
  }).strict()).min(1),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.cases.map(item => item.id)).size !== value.cases.length
    || value.cases.some(item => item.turns.some(turn => !Object.hasOwn(value.models, turn.model)))) {
    ctx.addIssue({ code: "custom", message: "Duplicate case or unknown model fixture" });
  }
});

export function summarizeConversationRun(input: { transport: "MOCK"; total: number; passed: number; safetyFailures: number }) {
  const valid = input.transport === "MOCK" && [input.total, input.passed, input.safetyFailures].every(Number.isSafeInteger)
    && input.total > 0 && input.passed >= 0 && input.passed <= input.total && input.safetyFailures >= 0;
  return { ...input, offlinePass: valid && input.total === input.passed && input.safetyFailures === 0,
    liveModelAccepted: false as const, deploymentAuthorized: false as const };
}
function fact<T>(value: Evidence<T>, project: (input: T) => string | number = input => String(input)) {
  return value.state === "AMBIGUOUS" ? "AMBIGUOUS" : value.state === "MISSING" ? null : project(value.value);
}

/** Pure decision corpus, not a database simulator or live-model runner.
 * Canonical mutation/encryption acceptance is deliberately a separate real D1 suite.
 * No transport, credential, fetch or database dependency exists here.
 */
export function runConversationCorpus(raw: unknown) {
  const corpus = corpusSchema.parse(raw);
  const failures: { caseId: string; turn: number; categories: string[] }[] = [];
  let total = 0, temporalPassed = 0, dialoguePassed = 0, safetyFailures = 0;
  for (const scenario of corpus.cases) {
    let previous: ConversationSnapshot | null = null;
    let state = "NONE";
    let now = corpus.referenceNow;
    for (const [index, turn] of scenario.turns.entries()) {
      now += turn.delayMs;
      const model = corpus.models[turn.model];
      const continuing = previous !== null && previous.expiresAt > now && model.dialogueAct !== "NEW_REQUEST" && model.continuation === "YES";
      const temporal = extractConversationTemporalEvidence({ text: turn.text, receivedAt: now,
        sourceInboundId: `synthetic-${index}`, currentCalendar: continuing ? previous!.request.calendar : "GREGORIAN",
        ...(continuing ? { previousRequest: previous!.request } : {}) }, lunarCalendar);
      const decision = reconcileConversation({ model, temporal, previous, now,
        editRequested: /^(?:đổi|sửa|chuyển|điều chỉnh)(?:\s|$)/u.test(turn.text.normalize("NFC").trim().toLocaleLowerCase("vi-VN")) });
      const categories: string[] = [];
      total++;
      const actualEvidence = { calendar: fact(temporal.calendar), eventDate: fact(temporal.eventDate, value => value.solarDate),
        date: fact(temporal.reminderDate, value => value.solarDate), time: fact(temporal.time),
        count: fact(temporal.count, value => value), relation: fact(temporal.relation) };
      if (isDeepStrictEqual(actualEvidence, turn.expected.evidence)) temporalPassed++; else categories.push("TEMPORAL");
      if (decision.kind === turn.expected.outcome && (decision.kind === "CLARIFY" ? decision.field : null) === turn.expected.field) dialoguePassed++;
      else categories.push("DIALOGUE");
      // This is a projected conversation state only, never persisted or counted
      // as proof of a canonical mutation. Real service/D1 tests own that proof.
      if (decision.kind === "CLARIFY" || decision.kind === "PROPOSE") {
        state = decision.kind === "CLARIFY" ? "CLARIFYING" : "DRAFT_READY";
        const createdAt = continuing ? previous!.createdAt : now;
        previous = ConversationSnapshotSchema.parse({ id: "synthetic-context", revision: (previous?.revision ?? 0) + 1,
          status: state, createdAt, expiresAt: Math.min(createdAt + 7_200_000, now + (state === "DRAFT_READY" ? 600_000 : 1_800_000)),
          request: decision.request, turns: [...(continuing ? previous!.turns : []), { userText: turn.text, receivedAt: now, outcomeCode: decision.kind }] });
      } else if (decision.kind === "ABANDON_PENDING") { state = "CANCELLED"; previous = null; }
      if (state !== turn.expected.state) categories.push("STATE");
      if (turn.expected.request) {
        const request = "request" in decision ? decision.request : null;
        const projected = request ? { calendar: request.calendar, title: request.title, eventDate: request.eventDate?.solarDate ?? null,
          date: request.reminderDate?.solarDate ?? null, time: request.reminderTime, count: request.count, relation: request.relation } : null;
        if (!isDeepStrictEqual(projected, turn.expected.request)) categories.push("REQUEST");
      }
      if (turn.expected.occurrenceDates || turn.expected.expansionRejection) {
        const expansion = "request" in decision ? expandFiniteSeries(decision.request, now) : null;
        if (turn.expected.occurrenceDates && (expansion?.status !== "READY"
          || !isDeepStrictEqual(expansion.occurrences.map(item => item.localDate), turn.expected.occurrenceDates))) categories.push("EXPANSION");
        if (turn.expected.expansionRejection && (expansion?.status !== "REJECTED" || expansion.reason !== turn.expected.expansionRejection)) categories.push("EXPANSION");
      }
      if (categories.some(category => category !== "DIALOGUE")) safetyFailures++;
      if (categories.length) failures.push({ caseId: scenario.id, turn: index + 1, categories });
    }
  }
  return { ...summarizeConversationRun({ transport: "MOCK", total, passed: total - failures.length, safetyFailures }),
    cases: corpus.cases.length, temporalPassed, dialoguePassed, failures,
    persistenceAcceptance: "SEPARATE_D1_SUITE_REQUIRED" as const };
}

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function treeDigest(root: string, directory: string): string {
  const entries: [string, string][] = [];
  function walk(path: string) {
    for (const entry of readdirSync(resolve(root, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (!/\.(test|spec)\./u.test(entry.name)) entries.push([child, digest(readFileSync(resolve(root, child)))]);
    }
  }
  walk(directory);
  return digest(JSON.stringify(entries));
}
export function buildConversationProvenance(root: string) {
  const file = (path: string) => digest(readFileSync(resolve(root, path)));
  return { profile: "conversation-v2-offline-1", transport: "MOCK", digests: {
    corpus: file(corpusPath), prompt: digest(CONVERSATION_PROMPT), schema: digest(JSON.stringify(ConversationModelJsonSchema)),
    calendar: file("src/modules/conversation/lunar-vn-months.json"), reconciliation: file("src/modules/conversation/reconcile.ts"),
    scorer: file("tools/benchmark/conversation-v2.ts"), runtime: treeDigest(root, "src"),
    migrations: treeDigest(root, "migrations"), config: file("wrangler.jsonc"),
  } as Record<string, string> };
}
export function verifyConversationProvenance(root: string, recorded: unknown): boolean {
  return isDeepStrictEqual(buildConversationProvenance(root), recorded);
}
