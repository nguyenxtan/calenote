// @vitest-environment node
import { expect, it } from "vitest";
import { buildLunarMonths } from "./generate-lunar-vn";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import artifact from "../../src/modules/conversation/lunar-vn-months.json";

it("regenerates the complete artifact and its provenance exactly", () => {
  const months = buildLunarMonths(1900, 2100);
  expect(months).toEqual(artifact.months);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  expect(hash(JSON.stringify(months))).toBe(artifact.dataSha256);
  expect(hash(readFileSync(new URL("./generate-lunar-vn.ts", import.meta.url), "utf8"))).toBe(artifact.generatorSha256);
}, 15_000);

it("generates Vietnam's normal 1984 and leap-second-month 2004 from ephemerides", () => {
  const months = buildLunarMonths(1984, 2004);
  expect(months.filter(m => m.year === 1984)).toHaveLength(12);
  expect(months.filter(m => m.year === 2004)).toHaveLength(13);
  expect(months.find(m => m.year === 2004 && m.leap)).toMatchObject({ month: 2, start: "2004-03-21", days: 29 });
  expect(months.every(m => m.days === 29 || m.days === 30)).toBe(true);
});
