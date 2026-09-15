import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { persistedD1Blob } from "./persisted-blob";

describe("persistedD1Blob", () => {
  it.each([
    { label: "ArrayBuffer", value: Uint8Array.from([1, 2, 3]).buffer, expected: [1, 2, 3] },
    { label: "ArrayBufferView", value: Uint8Array.from([1, 2, 3]), expected: [1, 2, 3] },
    { label: "D1 byte array", value: [1, 2, 3], expected: [1, 2, 3] },
    { label: "empty blob", value: [], expected: [] },
  ])("copies a valid $label", ({ value, expected }) => {
    const normalized = persistedD1Blob(value);
    expect([...new Uint8Array(normalized)]).toEqual(expected);
    expect(normalized).not.toBe(value);
  });

  it("accepts a cross-realm-like ArrayBuffer", () => {
    const crossRealm = runInNewContext("Uint8Array.from([1, 2, 3]).buffer") as ArrayBuffer;
    expect([...new Uint8Array(persistedD1Blob(crossRealm))]).toEqual([1, 2, 3]);
  });

  it.each([
    -1,
    256,
    1.5,
    "1",
    {},
    null,
    [1, -1],
    [1, 256],
    [1, 1.5],
    [1, "2"],
  ])("rejects invalid persisted BLOB data %#", (value) => {
    expect(() => persistedD1Blob(value)).toThrow("Malformed persisted D1 BLOB");
  });
});
