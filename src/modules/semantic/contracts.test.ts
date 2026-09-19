import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelSemanticInterpretationJsonSchema, ModelSemanticInterpretationSchema,
  SemanticInterpretationJsonSchema, SemanticInterpretationSchema } from "./contracts";

const modelCreate = { intent: "CREATE_REMINDER", title: "Gọi khách", titleState: "RESOLVED", targetIntent: null };

describe("provider model contract", () => {
  it.each([
    modelCreate,
    { ...modelCreate, title: null, titleState: "MISSING" },
    { ...modelCreate, title: null, titleState: "AMBIGUOUS" },
    ...["LIST_REMINDERS", "HELP", "UNSUPPORTED"].map((intent) => ({ intent, title: null, titleState: "NOT_APPLICABLE", targetIntent: null })),
    { intent: "AMBIGUOUS", title: null, titleState: "NOT_APPLICABLE", targetIntent: null },
    { intent: "AMBIGUOUS", title: null, titleState: "NOT_APPLICABLE", targetIntent: "LIST_REMINDERS" },
    { ...modelCreate, intent: "AMBIGUOUS", targetIntent: "CREATE_REMINDER" },
  ])("accepts semantic-only output %#", (payload) => {
    expect(ModelSemanticInterpretationSchema.safeParse(payload).success).toBe(true);
  });

  it.each(["localDate", "localTime", "rangeKind", "timezone", "epoch", "scheduledAt", "question", "missingFields", "needsClarification", "ownerId", "sql", "id"])("rejects forbidden provider field %s", (field) => {
    expect(ModelSemanticInterpretationSchema.safeParse({ ...modelCreate, [field]: "forbidden" }).success).toBe(false);
  });

  it.each([
    { ...modelCreate, title: null },
    { ...modelCreate, title: "" },
    { ...modelCreate, title: "   " },
    { ...modelCreate, title: "a".repeat(1_801) },
    { ...modelCreate, titleState: "MISSING" },
    { ...modelCreate, titleState: "AMBIGUOUS" },
    { ...modelCreate, titleState: "NOT_APPLICABLE" },
    { ...modelCreate, targetIntent: "CREATE_REMINDER" },
    { ...modelCreate, intent: "LIST_REMINDERS" },
    { ...modelCreate, intent: "HELP" },
    { ...modelCreate, intent: "UNSUPPORTED" },
    { ...modelCreate, intent: "AMBIGUOUS", targetIntent: null },
    { ...modelCreate, intent: "AMBIGUOUS", targetIntent: "LIST_REMINDERS" },
    { ...modelCreate, intent: "AMBIGUOUS", title: null, titleState: "NOT_APPLICABLE", targetIntent: "CREATE_REMINDER" },
    { intent: "HELP" },
  ])("rejects invalid intent/title-state combinations %#", (payload) => {
    expect(ModelSemanticInterpretationSchema.safeParse(payload).success).toBe(false);
  });

  it("emits exactly four required fields in a flat closed JSON schema", () => {
    expect(ModelSemanticInterpretationJsonSchema).toMatchObject({ type: "object", additionalProperties: false,
      required: ["intent", "title", "titleState", "targetIntent"] });
    expect(Object.keys(ModelSemanticInterpretationJsonSchema.properties ?? {})).toEqual(["intent", "title", "titleState", "targetIntent"]);
    expect(ModelSemanticInterpretationJsonSchema).not.toHaveProperty("oneOf");
    expect(ModelSemanticInterpretationJsonSchema).not.toHaveProperty("anyOf");
  });
});

const validCreate = {
  intent: "CREATE_REMINDER",
  title: "Gọi đội thiết kế",
  localDate: "2026-09-17",
  localTime: "09:30",
  timezone: "Asia/Ho_Chi_Minh",
  needsClarification: false,
};

function objectArms(schema: unknown): Array<Record<string, unknown>> {
  if (typeof schema !== "object" || schema === null) return [];
  const value = schema as Record<string, unknown>;
  const branches = ["oneOf", "anyOf"].flatMap((key) => Array.isArray(value[key]) ? value[key] : []);
  return branches.filter((arm): arm is Record<string, unknown> => (
    typeof arm === "object" && arm !== null && arm.type === "object"
  ));
}

describe("SemanticInterpretationSchema", () => {
  it("accepts all documented union arms", () => {
    expect(SemanticInterpretationSchema.parse(validCreate)).toEqual(validCreate);
    expect(SemanticInterpretationSchema.parse({ intent: "LIST_REMINDERS", rangeKind: "DATE", localDate: "2026-09-22" })).toEqual({ intent: "LIST_REMINDERS", rangeKind: "DATE", localDate: "2026-09-22" });
    expect(SemanticInterpretationSchema.parse({ intent: "NEEDS_CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["time"], question: "Bạn muốn nhắc vào lúc nào?" })).toEqual({ intent: "NEEDS_CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["time"], question: "Bạn muốn nhắc vào lúc nào?" });
    expect(SemanticInterpretationSchema.parse({ intent: "HELP" })).toEqual({ intent: "HELP" });
    expect(SemanticInterpretationSchema.parse({ intent: "UNSUPPORTED" })).toEqual({ intent: "UNSUPPORTED" });
  });

  it.each([
    ["extra properties", { ...validCreate, ownerId: "model-must-not-set-this" }],
    ["unknown intent", { intent: "DELETE_REMINDER" }],
    ["non-Vietnam timezone", { ...validCreate, timezone: "UTC" }],
    ["malformed local date", { ...validCreate, localDate: "17/09/2026" }],
    ["malformed local time", { ...validCreate, localTime: "9 giờ 30" }],
    ["unbounded clarification question", { intent: "NEEDS_CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["time"], question: "a".repeat(501) }],
    ["unbounded clarification fields", { intent: "NEEDS_CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["date", "time", "title", "range", "date"], question: "Bạn muốn bổ sung gì?" }],
    ["duplicate clarification fields", { intent: "NEEDS_CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["time", "time"], question: "Bạn muốn nhắc vào lúc nào?" }],
    ["model prose instead of an object", "Tôi sẽ nhắc bạn vào lúc 9 giờ."],
  ])("rejects %s", (_label, payload) => {
    expect(SemanticInterpretationSchema.safeParse(payload).success).toBe(false);
  });

  it("generates closed JSON Schema arms from the Zod contract", () => {
    const arms = objectArms(SemanticInterpretationJsonSchema);
    expect(arms).toHaveLength(5);
    for (const arm of arms) {
      expect(arm.additionalProperties).toBe(false);
    }
  });
});

describe("semantic-v1 synthetic benchmark", () => {
  it("contains at least 200 synthetic Vietnamese cases with fixed expectations", async () => {
    const fixture = JSON.parse(await readFile(resolve(process.cwd(), "src/modules/semantic/benchmark/semantic-v1.json"), "utf8")) as { version: string; cases: Array<Record<string, unknown>> };
    expect(fixture.version).toBe("semantic-v1-synthetic");
    expect(fixture.cases.length).toBeGreaterThanOrEqual(200);
    expect(new Set(fixture.cases.map((item) => item.category)).size).toBeGreaterThanOrEqual(12);
    expect(new Set(fixture.cases.map((item) => (item.expected as { intent: string }).intent))).toEqual(new Set([
      "CREATE_REMINDER",
      "LIST_REMINDERS",
      "NEEDS_CLARIFICATION",
      "HELP",
      "UNSUPPORTED",
    ]));
    for (const item of fixture.cases) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.message).toBe("string");
      expect(typeof item.interpretationReferenceTime).toBe("string");
      expect(item.timezone).toBe("Asia/Ho_Chi_Minh");
      expect(item).toHaveProperty("priorContext");
      expect(typeof item.expected).toBe("object");
      expect(item.expected).not.toBeNull();
      expect(["ACCEPT", "REJECT"]).toContain(item.businessValidation);
      expect(SemanticInterpretationSchema.safeParse(item.expected).success).toBe(true);
    }
  });

  it("keeps Vietnamese time, range, and clarification ground truth internally consistent", async () => {
    const fixture = JSON.parse(await readFile(resolve(process.cwd(), "src/modules/semantic/benchmark/semantic-v1.json"), "utf8")) as {
      cases: Array<{
        id: string;
        message: string;
        expected: Record<string, unknown>;
        businessValidation: "ACCEPT" | "REJECT";
      }>;
    };
    const byId = new Map(fixture.cases.map((item) => [item.id, item]));

    expect(byId.get("synthetic-daypart-055")).toMatchObject({
      message: "buổi chiều lúc 2 giờ nhắc tôi việc tổng hợp 055",
      expected: { intent: "NEEDS_CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["date"] },
    });
    expect(byId.get("synthetic-multi-turn-continuation-199")).toMatchObject({
      message: "4 giờ chiều 08:00 nhắc tôi việc nối tiếp 199",
      expected: { intent: "NEEDS_CLARIFICATION", missingFields: ["time"] },
      businessValidation: "ACCEPT",
    });
    expect(byId.get("synthetic-today-014")?.expected).toEqual({ intent: "LIST_REMINDERS", rangeKind: "TODAY", localDate: null });
    expect(byId.get("synthetic-tomorrow-032")?.expected).toEqual({ intent: "LIST_REMINDERS", rangeKind: "TOMORROW", localDate: null });
    expect(byId.get("synthetic-typo-194")?.expected).toEqual({ intent: "LIST_REMINDERS", rangeKind: "TOMORROW", localDate: null });
    expect(byId.get("synthetic-multi-turn-continuation-209")?.expected).toMatchObject({ intent: "CREATE_REMINDER", localDate: "2026-09-17", localTime: "09:00" });
    for (const item of fixture.cases.filter((item) => item.message.startsWith("xem lich ngay mai"))) {
      expect(item.expected).toMatchObject({ intent: "LIST_REMINDERS", rangeKind: "TOMORROW", localDate: null });
    }
    for (const item of fixture.cases.filter((item) => item.expected.intent === "NEEDS_CLARIFICATION")) {
      expect(item.businessValidation).toBe("ACCEPT");
    }
  });
});
