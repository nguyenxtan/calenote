import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import axe from "axe-core";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("accessibility guardrails", () => {
  it("has no automatically detectable onboarding violations", async () => {
    const { container } = render(<OnboardingWizard />);
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(result.violations).toEqual([]);
  });

  it("keeps the faint text token at WCAG AA contrast on every app surface", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const faint = css.match(/--ink-faint:\s*(#[0-9a-f]{6})/i)?.[1];

    expect(faint).toBeDefined();
    for (const background of [
      "#fffefa",
      "#f6f4ed",
      "#f4f1e8",
      "#f8f6f0",
      "#ebe6da",
      "#dce9df",
    ]) {
      expect(contrastRatio(faint!, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
