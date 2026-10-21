// @vitest-environment node
import { describe, expect, it } from "vitest";
import { projectProviderFailure } from "./failure-diagnostics";

const project = (error: unknown, sensitive: readonly string[] = []) => {
  const bytes = new TextEncoder().encode(JSON.stringify({ error }));
  return projectProviderFailure({ status: 400, length: bytes.length, media: "application/json", bytes, headers: new Headers(), sensitive,
    schema: { properties: { foo: {}, changes: {}, value: {} } } });
};

describe("structural provider causes", () => {
  it("never admits the owner's example property unless the outbound schema defines it", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ error: { path: "response_schema.properties.foo" } }));
    const result = await projectProviderFailure({ status: 400, length: bytes.length, media: "application/json", bytes, headers: new Headers(), sensitive: [] });
    expect(result.errorMetadataSanitized).toBeUndefined();
  });
  it.each(["code", "status", "reason", "message"])("denies a known private value introduced by %s normalization in persisted diagnostics", async field => {
    for (const error of [{ [field]: "INVALID_ARGUMENT" }, { metadata: { raw: JSON.stringify({ error: { [field]: "INVALID_ARGUMENT" } }) } }]) {
      const result = await project(error, ["invalid_argument"]);
      expect(JSON.stringify(result)).not.toContain("invalid_argument");
    }
  });
  // These catch discarding valid causes merely because their sibling prose is private.
  it.each([
    { message: 'unsupported keyword "oneOf" at "response_schema.properties.foo" SYNTHETIC_SECRET', path: "response_schema.properties.foo", keyword: "oneOf", messageCategory: "Unsupported schema keyword" },
    { message: 'field: response_format SYNTHETIC_SECRET', param: "response_format" },
    { message: 'Invalid JSON payload received. Unknown name "maxLength" at \'generation_config.response_schema.properties[changes].items\': Cannot find field. SYNTHETIC_SECRET', path: "generation_config.response_schema.properties[changes].items", keyword: "maxLength", messageCategory: "Unsupported schema construct: maxLength" },
  ])("retains structural labels independently of private prose: $message", async ({ message, messageCategory, ...labels }) => {
    for (const error of [{ status: "INVALID_ARGUMENT", message }, { metadata: { status: "INVALID_ARGUMENT", message } }, { metadata: { raw: JSON.stringify({ error: { status: "INVALID_ARGUMENT", message } }) } }]) {
      const result = await project(error, ["SYNTHETIC_SECRET"]);
      const encoded = JSON.stringify(result.errorMetadataSanitized);
      expect(encoded).toContain("invalid_argument");
      for (const label of Object.values(labels)) expect(encoded).toContain(label);
      if (messageCategory) expect(encoded).toContain(messageCategory);
      expect(encoded).not.toContain("SYNTHETIC_SECRET");
      expect(encoded).not.toContain("Cannot find field");
    }
  });
  it("retains categorical keyword causes without a named keyword", async () => {
    expect((await project({ message: "unsupported keyword" })).errorMessageSanitized).toBe("Unsupported schema keyword");
  });
  it.each([
    ["Schema has too many states SYNTHETIC_SECRET", "Schema state limit exceeded"],
    ["Schema nesting depth exceeded SYNTHETIC_SECRET", "Schema nesting limit exceeded"],
    ["Schema is too complex SYNTHETIC_SECRET", "Schema complexity limit exceeded"],
  ])("retains bounded schema category from %s", async (message, expected) => {
    expect((await project({ message }, ["SYNTHETIC_SECRET"])).errorMessageSanitized).toBe(expected);
  });
  it("extracts categorical status and unquoted parameter/path/keyword labels", async () => {
    const result = await project({ message: "INVALID_ARGUMENT unsupported keyword: pattern path: response_schema.properties.foo parameter: response_format SYNTHETIC_SECRET" }, ["SYNTHETIC_SECRET"]);
    expect(result.errorMetadataSanitized).toMatchObject({ status: "invalid_argument", keyword: "pattern", path: "response_schema.properties.foo", param: "response_format" });
  });
  it("retains safe structured field descriptions and reason enums", async () => {
    const result = await project({ details: [{ reason: "INVALID_ARGUMENT", fieldViolations: [{ field: "response_schema.properties.changes.items.oneOf[0].properties.value.maxLength", description: 'unsupported keyword "maxLength" SYNTHETIC_PRIVATE' }] }] }, ["SYNTHETIC_PRIVATE"]);
    expect(result.errorMetadataSanitized).toMatchObject({ details: [{ reason: "invalid_argument", fieldViolations: [{ field: "response_schema.properties.changes.items.oneOf[0].properties.value.maxLength", description: "Unsupported schema keyword", keyword: "maxLength" }] }] });
  });
  // These catch promoting arbitrary identifiers into schema/parameter authority.
  it.each(["foo", "response_schema.foo", "response_schema.properties.OWNER_ID", "response_schema.properties.foo.OWNER_ID", "response_schema..properties.foo", "response_schema.properties.foo]", "response_schema.properties.response_format", "response_format/OWNER_ID"])("rejects unvalidated structural labels %s", async path => {
    const result = await project({ path, param: path, field: path, keyword: path, message: `field: ${path}` });
    expect(JSON.stringify(result.errorMetadataSanitized)).not.toContain(path);
  });
  it.each(["foo", "changes", "response_format", "maxLength", "INVALID_ARGUMENT"])("denies known private values inside plausible structural labels: %s", async secret => {
    const result = await project({ path: `response_schema.properties.${secret}`, keyword: secret, status: secret, message: `unsupported keyword "${secret}" field: response_format.${secret}` }, [secret]);
    expect(JSON.stringify(result.errorMetadataSanitized)).not.toContain(secret);
  });
});

it.each([
 ["The response schema exceeds the maximum allowed nesting depth. SYNTHETIC_SECRET", "Schema nesting limit exceeded"],
 ["The schema is too deeply nested. SYNTHETIC_SECRET", "Schema nesting limit exceeded"],
 ["The response schema has too many states for serving. SYNTHETIC_SECRET", "Schema state limit exceeded"],
 ["The response schema is too large. SYNTHETIC_SECRET", "Schema size limit exceeded"],
])("retains schema rejection category for %s without provider prose", async(message,expected)=>{
 const result=await project({metadata:{raw:JSON.stringify({error:{code:400,status:"INVALID_ARGUMENT",message}})}},["SYNTHETIC_SECRET"]);
 expect(JSON.stringify(result.errorMetadataSanitized)).toContain(expected);
 expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SECRET");
});

it.each([
 ['No endpoints found for google/gemini-2.5-flash-lite. PRIVATE', 'No matching provider endpoint'],
 ['No endpoints found that can handle the requested parameters PRIVATE','No provider endpoint supports requested parameters'],
 ['No endpoints found matching your data policy PRIVATE','No provider endpoint matches data policy'],
])('retains finite routing category from %s without provider prose',async(message,expected)=>{
 const result=await project({code:404,message},['PRIVATE']);
 expect(result.errorMessageSanitized).toBe(expected);
 expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
