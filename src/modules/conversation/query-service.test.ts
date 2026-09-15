import { describe, expect, it } from "vitest";
import { canonicalQueryRange } from "./query-service";

describe("canonicalQueryRange", () => {
  it("constructs the local Vietnam day rather than accepting a browser timestamp", () => {
    expect(canonicalQueryRange("TODAY", Date.UTC(2027, 0, 14, 17, 30))).toEqual({
      from: Date.UTC(2027, 0, 14, 17),
      to: Date.UTC(2027, 0, 15, 17),
    });
  });
});
