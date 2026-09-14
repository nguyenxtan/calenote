import { describe, expect, it, vi } from "vitest";
import {
  createNullIntelligenceGateway,
  interpretReminderDeterministicallyFirst,
  selectIntelligenceModel,
} from "./service";

const now = Date.UTC(2026, 8, 9, 3, 0, 0);
const input = { text: "nhắc tôi họp", now, timezone: "Asia/Ho_Chi_Minh" as const };

function gateway(result: unknown = {
  status: "PROPOSED" as const,
  title: "Họp với đội",
  scheduledAt: now + 60_000,
  timezone: "Asia/Ho_Chi_Minh" as const,
  confidence: 0.8,
}) {
  return {
    interpretReminder: vi.fn().mockResolvedValue(result),
    extractAction: vi.fn(),
  };
}

describe("optional intelligence foundation", () => {
  it("returns a confident deterministic reminder without invoking the gateway", async () => {
    const optionalGateway = gateway();

    await expect(interpretReminderDeterministicallyFirst(input, {
      mode: "privacy",
      gateway: optionalGateway,
      deterministic: () => ({ status: "CONFIDENT", proposal: {
        status: "PROPOSED", title: "Họp", scheduledAt: now + 60_000, timezone: "Asia/Ho_Chi_Minh", confidence: 1,
      } }),
    })).resolves.toMatchObject({ status: "DETERMINISTIC", proposal: { title: "Họp" } });

    expect(optionalGateway.interpretReminder).not.toHaveBeenCalled();
  });

  it("allows an ambiguous reminder to use an enabled gateway proposal", async () => {
    const optionalGateway = gateway();

    await expect(interpretReminderDeterministicallyFirst(input, {
      mode: "privacy",
      gateway: optionalGateway,
      deterministic: () => ({ status: "AMBIGUOUS" }),
    })).resolves.toMatchObject({ status: "PROPOSED", proposal: { title: "Họp với đội" } });

    expect(optionalGateway.interpretReminder).toHaveBeenCalledWith(input);
  });

  it("never invokes a gateway while intelligence is off", async () => {
    const optionalGateway = gateway();

    await expect(interpretReminderDeterministicallyFirst(input, {
      mode: "off",
      gateway: optionalGateway,
      deterministic: () => ({ status: "AMBIGUOUS" }),
    })).resolves.toEqual({ status: "UNAVAILABLE", reason: "DISABLED" });

    expect(optionalGateway.interpretReminder).not.toHaveBeenCalled();
  });

  it("treats a null gateway as an optional unavailable capability", async () => {
    await expect(interpretReminderDeterministicallyFirst(input, {
      mode: "privacy",
      gateway: createNullIntelligenceGateway(),
      deterministic: () => ({ status: "AMBIGUOUS" }),
    })).resolves.toEqual({ status: "UNAVAILABLE", reason: "UNCONFIGURED" });
  });

  it("fails closed when a gateway throws", async () => {
    const optionalGateway = gateway();
    optionalGateway.interpretReminder.mockRejectedValueOnce(new Error("unavailable"));
    await expect(interpretReminderDeterministicallyFirst(input, { mode: "privacy", gateway: optionalGateway, deterministic: () => ({ status: "AMBIGUOUS" }) }))
      .resolves.toEqual({ status: "UNAVAILABLE", reason: "UNCONFIGURED" });
  });

  it.each([
    ["malformed structured output", { status: "PROPOSED", title: "x" }],
    ["unsupported proposal field", { status: "PROPOSED", title: "x", scheduledAt: now + 60_000, timezone: "Asia/Ho_Chi_Minh", confidence: 0.8, recurrence: "daily" }],
    ["invalid timestamp", { status: "PROPOSED", title: "x", scheduledAt: now, timezone: "Asia/Ho_Chi_Minh", confidence: 0.8 }],
  ])("fails closed for %s", async (_label, result) => {
    const optionalGateway = gateway(result);

    await expect(interpretReminderDeterministicallyFirst(input, {
      mode: "privacy",
      gateway: optionalGateway,
      deterministic: () => ({ status: "AMBIGUOUS" }),
    })).resolves.toEqual({ status: "UNAVAILABLE", reason: "INVALID_PROPOSAL" });
  });

  it("blocks credential-like text before it reaches the gateway", async () => {
    const optionalGateway = gateway();

    await expect(interpretReminderDeterministicallyFirst({ ...input, text: "Authorization: Bearer secret-value" }, {
      mode: "privacy",
      gateway: optionalGateway,
      deterministic: () => ({ status: "AMBIGUOUS" }),
    })).resolves.toEqual({ status: "UNAVAILABLE", reason: "SENSITIVE_INPUT" });

    expect(optionalGateway.interpretReminder).not.toHaveBeenCalled();
  });

  it("blocks a caller-provided known secret before it reaches the gateway", async () => {
    const optionalGateway = gateway();

    await expect(interpretReminderDeterministicallyFirst({ ...input, text: "nhắc tôi token-should-never-leave-core" }, {
      mode: "privacy",
      gateway: optionalGateway,
      deterministic: () => ({ status: "AMBIGUOUS" }),
      sensitiveValues: ["token-should-never-leave-core"],
    })).resolves.toEqual({ status: "UNAVAILABLE", reason: "SENSITIVE_INPUT" });

    expect(optionalGateway.interpretReminder).not.toHaveBeenCalled();
  });

  it("does not select or fall back to a paid model in free mode", () => {
    expect(selectIntelligenceModel("free", [
      { id: "paid", class: "PRIVACY" as const },
    ])).toEqual({ status: "UNAVAILABLE", reason: "UNCONFIGURED" });
  });
});
