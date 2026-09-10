import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Today responsive layout", () => {
  it("allows Quick Capture controls to wrap instead of overflowing narrow screens", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/today/TodayExperience.module.css"), "utf8");

    expect(css).toMatch(/@media \(max-width: 430px\)[\s\S]*?\.captureFoot \{[^}]*flex-wrap: wrap;/u);
    expect(css).toMatch(/@media \(max-width: 430px\)[\s\S]*?\.captureFoot input \{[^}]*max-width: 100%;/u);
  });
});
