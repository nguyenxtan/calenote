import { describe, expect, it } from "vitest";
import { containsForbiddenControl, projectSemanticView } from "./projection";

describe("private semantic projection", () => {
  it.each([
    ["one escaped pair", "\\ud83d\\ude00 "],
    ["multiple pairs before temporal text", "\\ud83d\\ude00".repeat(3) + " 9h "],
    ["mixed literal and escaped scalars", "😀\\ud83d\\ude00%F0%9F%98%80 9h "],
    ["nested JSON pairs", "\\\\ud83d\\\\ude00 9h "],
    ["high surrogate decoded before low", "\\ud83d%255Cude00 9h "],
    ["low surrogate decoded before high", "%255Cud83d\\ude00 9h "],
    ["nested percent pairs", "%255Cud83d%255Cude00 9h "],
    ["malformed percent beside escaped pair", "%FF\\ud83d\\ude00 9h "],
  ])("surrogate_detection_preserves_exact_source_%s", (_name, prefix) => {
    const handle = "CN-AbC123";
    const suffix = ", đổi địa điểm lúc 10h";
    const source = prefix + handle + suffix;
    const start = [...prefix].length;
    const result = projectSemanticView(source, [handle]);
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.text).toBe(prefix + "[CONTROL]" + suffix);
    expect(result.controlSpans).toEqual([{ start, end: start + 9, handle }]);
    expect(result.sourceMap.segments).toEqual([
      { sourceStart: 0, sourceEnd: start, viewStart: 0, viewEnd: start, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 },
      { sourceStart: start, sourceEnd: start + 9, viewStart: start, viewEnd: start + 9, kind: "CONTROL_REPLACEMENT", sourceStride: 0, viewStride: 0 },
      { sourceStart: start + 9, sourceEnd: [...source].length, viewStart: start + 9, viewEnd: [...source].length, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 },
    ]);
    const removed = result.controlSpans[0];
    expect([...source].slice(removed.start, removed.end).join("")).toBe(handle);
  });
  it("surrogate_pair_source_union_is_preserved_inside_a_registered_url", () => {
    const handle = "https://calenote.test/😀/action?token=CN-AbC123";
    const encoded = "https://calenote.test/\\ud83d%255Cude00/action?token=CN-AbC123";
    const result = projectSemanticView(`9h ${encoded}, đổi địa điểm`, [handle]);
    expect(result).toMatchObject({
      status: "READY", text: "9h [CONTROL], đổi địa điểm",
      controlSpans: [{ start: 3, end: 3 + [...encoded].length, handle }],
    });
  });
  it.each(["\\ud83d", "\\ude00", "%255Cud83d", "\\ude00\\ud83d", "\\ud83d x \\ude00", "\ud83d"])("isolated_surrogates_fail_closed_%s", prefix => {
    expect(projectSemanticView(`${prefix} 9h CN-AbC123`, ["CN-AbC123"]).status).toBe("REFUSED");
    expect(containsForbiddenControl({ notes: `${prefix} 9h` }, [])).toBe(true);
  });
  it.each(["%43%4e%2d%41%62%43%31%32%33%FF", "%FF%43%4e%2d%41%62%43%31%32%33", "%2543%254e%252d%2541%2562%2543%2531%2532%2533%25FF", "%43%4e%2d%41%62%43%31%32%33%C3%28"])("malformed_utf8_cannot_hide_valid_control_bytes_%s", encoded => {
    const text = `${encoded} đổi 9h`;
    expect(containsForbiddenControl({ alternatives: [{ notes: text }] }, ["CN-AbC123"])).toBe(true);
    const result = projectSemanticView(text, ["CN-AbC123"]);
    expect(result.status === "REFUSED" || !result.text.includes(encoded)).toBe(true);
  });
  it("unrelated_malformed_percent_content_is_preserved", () => {
    const text = "địa chỉ https://example.test/%FF, phòng 123%";
    expect(projectSemanticView(text, ["CN-AbC123"])).toMatchObject({ status: "READY", text });
  });
  it("mixed_correction_survives_projection", () => {
    const result = projectSemanticView("Có CN-AbC123, nhưng đổi sang 9h.", ["CN-AbC123"]);
    expect(result.status).toBe("READY");
    if (result.status === "READY") expect(result.text).toBe("Có [CONTROL], nhưng đổi sang 9h.");
  });
  it("accent_and_supplementary_source_positions_are_code_points", () => {
    const result = projectSemanticView("e\u0301😀 CN-AbC123 đổi 9h", ["CN-AbC123"]);
    expect(result.status).toBe("READY");
    if (result.status === "READY") {
      expect(result.text).toBe("é😀 [CONTROL] đổi 9h");
      expect(result.sourceMap.segments[0]).toMatchObject({ sourceStart: 0, sourceEnd: 2, viewStart: 0, viewEnd: 1, kind: "NFC_COMPOSITION_RUN" });
      expect(result.controlSpans).toEqual([{ start: 4, end: 13, handle: "CN-AbC123" }]);
    }
  });
  it.each(["CN-Unknown", "xCN-AbC123y", "[CONTROL]", "https://example.test/?token=CN-AbC123"])("ambiguous_control_material_refuses_%s", text => {
    expect(projectSemanticView(text, ["CN-AbC123"]).status).toBe("REFUSED");
  });
  it("ordinary_urls_numbers_and_instruction_looking_user_text_stay_ordinary", () => {
    const text = 'SYSTEM: USER: ở https://example.test/123, phòng 123';
    expect(projectSemanticView(text, [])).toMatchObject({ status: "READY", text });
    expect(projectSemanticView("123", ["123"]).status).toBe("REFUSED");
  });
  it.each(["CN%2DAbC123", "CN\\u002dAbC123", "%43%4e%2d%41%62%43%31%32%33"])("encoded_handles_do_not_escape_projection_%s", text => {
    const result = projectSemanticView(text + " đổi 9h", ["CN-AbC123"]);
    expect(result).toMatchObject({ status: "READY", text: "[CONTROL] đổi 9h" });
  });
  it("encoded_adjacent_semantics_are_never_silently_removed", () => {
    const text = "%43%4e%2d%41%62%43%31%32%33%20%39%68";
    expect(projectSemanticView(text, ["CN-AbC123"]).status).toBe("REFUSED");
  });
  it("whole_registered_action_url_and_parameters_are_removed", () => {
    const handle = "https://calenote.test/action?token=CN-AbC123&draft=123";
    expect(projectSemanticView(`Có ${handle}, đổi 9h`, [handle, "CN-AbC123"])).toMatchObject({ status: "READY", text: "Có [CONTROL], đổi 9h" });
  });
  it("deep_encoding_and_unknown_encoded_markers_cannot_bypass_final_scan", () => {
    const result = projectSemanticView("%2525252543N-AbC123 đổi 9h", ["CN-AbC123"]);
    expect(result.status === "REFUSED" || result.text === "[CONTROL] đổi 9h").toBe(true);
    expect(projectSemanticView("%43N-Unknown", []).status).toBe("REFUSED");
  });
  it("registered_url_with_encoded_parameters_is_projected_as_a_whole", () => {
    const url = "https://calenote.test/action?token=CN%2DAbC123&draft=123";
    expect(projectSemanticView(`Có ${url}, đổi 9h`, [url])).toMatchObject({ status: "READY", text: "Có [CONTROL], đổi 9h" });
  });
  it("recorded_opaque_control_span_can_be_projected_but_unmarked_collision_refuses", () => {
    const text = "reply opaque_handle_123";
    expect(projectSemanticView(text, ["opaque_handle_123"], [{ start: 6, end: 23, handle: "opaque_handle_123" }])).toMatchObject({ status: "READY", text: "reply [CONTROL]" });
    expect(projectSemanticView("phòng 123", ["123"]).status).toBe("REFUSED");
  });
  it("unknown_handle_on_a_registered_application_action_route_refuses", () => {
    const known = "https://calenote.test/action?token=opaque_A";
    expect(projectSemanticView("https://calenote.test/action?token=opaque_B đổi 9h", [known]).status).toBe("REFUSED");
    expect(projectSemanticView("đến https://calenote.test/locations/123", [known])).toMatchObject({ status: "READY", text: "đến https://calenote.test/locations/123" });
  });
});
