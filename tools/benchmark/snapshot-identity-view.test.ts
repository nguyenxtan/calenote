// @vitest-environment node
import { expect, it } from "vitest";
import { encodeIdentityViews, decodeIdentityViews } from "./snapshot-identity-view";

it("elides only exact source/view duplication and restores every field", () => {
  const raw = JSON.stringify({ transcript: [
    { text: "ế".repeat(900), semanticView: "ế".repeat(900), sourceMap: { kind: "UNCHANGED", start: 0, end: 900 } },
    { text: "e\u0302\u0301", semanticView: "ế", sourceMap: { kind: "NFC" } },
    { text: "CN-HANDLE đổi 9h", semanticView: "[CONTROL] đổi 9h", sourceMap: { kind: "CONTROL" } },
  ], facts: [{ value: "ế".repeat(900) }], expiresAt: "2026-09-28T03:30:00.000Z" });
  const encoded = encodeIdentityViews(raw);
  expect(Buffer.byteLength(raw) - Buffer.byteLength(encoded)).toBeGreaterThan(2600);
  expect(JSON.parse(decodeIdentityViews(encoded))).toEqual(JSON.parse(raw));
  expect(JSON.parse(raw).transcript[0].semanticView).toHaveLength(900);
});

it("rejects malformed identity references rather than manufacturing a semantic view", () => {
  expect(() => decodeIdentityViews('{"encoding":"identity-view-v1","snapshot":{"transcript":[{"viewFromSource":true}]}}')).toThrow();
  for (const turn of [
    { text: "ordinary", semanticView: "ordinary", viewFromSource: true },
    { text: "ordinary", viewFromSource: false },
    { text: "ordinary", semanticView: { nested: "ordinary" } },
  ]) {
    expect(() => encodeIdentityViews(JSON.stringify({ transcript: [turn] }))).toThrow();
    expect(() => decodeIdentityViews(JSON.stringify({ encoding: "identity-view-v1", snapshot: { transcript: [turn] } }))).toThrow();
  }
  expect(() => encodeIdentityViews("[]")).toThrow();
  expect(() => decodeIdentityViews('{"encoding":"unknown","snapshot":{}}')).toThrow();
  expect(() => decodeIdentityViews('{"encoding":"identity-view-v1","extra":"must-not-be-lost","snapshot":{"transcript":[]}}')).toThrow();
});
