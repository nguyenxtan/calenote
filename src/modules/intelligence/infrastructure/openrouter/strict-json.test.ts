// @vitest-environment node
import { expect, it } from "vitest";
import { parseJsonWithoutDuplicateMembers as parse } from "./strict-json";

it.each([
  '{"changes":{"eventDate":null,"eventDate":{}}}',
  '{"changes":{"eventDate":null,"\\u0065ventDate":{}}}',
  '{"changes":{"title":{"rank":0,"rank":1}}}',
  '{"rows":[{"private-key":0,"private-key":1}]}',
  '{"usage":{"cost":0,"cost":1}}',
])("refuses duplicate member scope without exposing authored names (%#)", source => {
  expect(() => parse(source)).toThrow(/^DUPLICATE_JSON_MEMBER$/);
});
it("preserves separate scopes, escaped values and syntax controls", () => {
  const source = '{"rows":[{"rank":0},{"rank":1}],"text":"comma, brace} quote\\\"","empty":{}}';
  expect(parse(source)).toEqual(JSON.parse(source));
  expect(parse('[[{"x":0}],{"x":1}]')).toEqual([[{ x: 0 }], { x: 1 }]);
});
it.each(['{"private":"unterminated', '{"x":1,}', '{"x" 1}', '[}', 'undefined']) (
  "reports malformed syntax without retaining source (%#)", source => {
    expect(() => parse(source)).toThrow(/^INVALID_JSON$/);
  });
it("scans deeply nested input without recursive traversal", () => {
  const source = "[".repeat(10000) + "0" + "]".repeat(10000);
  expect(Array.isArray(parse(source))).toBe(true);
});
