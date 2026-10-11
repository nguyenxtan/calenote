// @vitest-environment node
import { expect, it } from "vitest";
import { InterpretationJsonSchemaV3 } from "./contracts";
import { googleLiteEuContextWireSchemaV3 } from "../../intelligence/infrastructure/openrouter/context-provider-wire";
import * as authority from "./output-authority";
import {UNCERTAINTY_FIELD_WIRE_CODE_V1} from "../../intelligence/infrastructure/openrouter/context-provider-wire";
it("wire66 catalogue reuses first13 field identities without granting model authority",()=>{
 expect(authority.CHANGE_ORDER_FIELDS_V3).toEqual(["title","location","notes","eventDate","eventTime","reminderDate","reminderTime","calendar","frequency","occurrenceCount","eventRelation","leadOffsetDays","endDate"]);
 expect(Object.isFrozen(authority.CHANGE_ORDER_FIELDS_V3)).toBe(true);
 authority.CHANGE_ORDER_FIELDS_V3.forEach((field,code)=>expect(UNCERTAINTY_FIELD_WIRE_CODE_V1[field]).toBe(code));
 for(const path of ["changeOrder","changeOrder[]"] as const)expect(authority.classifyOutputPathV3(path)).toMatchObject({class:"SEMANTIC_UNTRUSTED",applicationDerivable:false,canAuthorizeRead:false,canAuthorizeWrite:false});
 expect(authority.classifyOutputPathV3("transport.codebookMapping").class).toBe("APPLICATION_OWNED");
 for(const root of ["titleChange","reminderTimeChange","locationChange"])expect(()=>authority.classifyOutputPathV3(`${root}.index` as Parameters<typeof authority.classifyOutputPathV3>[0])).toThrow("OUTPUT_AUTHORITY_UNCLASSIFIED");
});
it("alternative evidence carrier selections remain closed semantic-untrusted paths",()=>{
 for(const path of ["uncertainties[].alternatives[].evidence.primaryEvidence","uncertainties[].alternatives[].evidence.additionalEvidenceJson"] as const)expect(authority.classifyOutputPathV3(path)).toMatchObject({class:"SEMANTIC_UNTRUSTED",applicationDerivable:false,canAuthorizeRead:false,canAuthorizeWrite:false});
});
it("wire68 all rank and wrapped payload paths remain closed untrusted ordering controls",()=>{
 for(const root of ["titleChange","reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange","locationChange","changes[]"]){
  for(const suffix of ["rank","change.field","change.operation","change.value","change.evidence.primaryEvidence"]){const path=`${root}.${suffix}` as Parameters<typeof authority.classifyOutputPathV3>[0];expect(authority.classifyOutputPathV3(path)).toMatchObject({class:"SEMANTIC_UNTRUSTED",applicationDerivable:false,canAuthorizeRead:false,canAuthorizeWrite:false});}
  expect(()=>authority.classifyOutputPathV3(`${root}.PRIVATE_MODEL_CONTROL` as Parameters<typeof authority.classifyOutputPathV3>[0])).toThrow("OUTPUT_AUTHORITY_UNCLASSIFIED");
 }
});
it("bound typed civil discriminator and all authored date slots remain semantic untrusted",()=>{
 for(const path of ["eventDateChange.change.value{kind=CIVIL_DATE}","eventDateChange.change.value.kind","eventDateChange.change.value.calendar","eventDateChange.change.value.day","eventDateChange.change.value.month","eventDateChange.change.value.year","eventDateChange.change.value.leapMonth"] as const)expect(authority.classifyOutputPathV3(path)).toMatchObject({class:"SEMANTIC_UNTRUSTED",applicationDerivable:false,canAuthorizeRead:false,canAuthorizeWrite:false});
});
it("year-source capability is application owned and cannot authorize a read or write",()=>{
 expect(authority.classifyOutputPathV3("fieldCapability.eventDateYearNullRequired")).toMatchObject({class:"APPLICATION_OWNED",applicationDerivable:true,canAuthorizeRead:false,canAuthorizeWrite:false});
});
it("primary source codes remain untrusted while exact source mapping remains application owned",()=>{
 for(const path of ["requestTarget.evidence.primaryEvidence","query.evidence.primaryEvidence","changes[].evidence.primaryEvidence"] as const)expect(authority.classifyOutputPathV3(path)).toMatchObject({class:"SEMANTIC_UNTRUSTED",canAuthorizeRead:false,canAuthorizeWrite:false});
 expect(authority.classifyOutputPathV3("transport.codebookMapping")).toMatchObject({class:"APPLICATION_OWNED",applicationDerivable:true,canAuthorizeRead:false,canAuthorizeWrite:false});
});

// Inspect active schema branches independently of the registry; adding a leaf
// without an authority rule must fail, rather than inherit a broad prefix.
function schemaPaths(root: unknown): Set<string> {
  const paths = new Set<string>();
  function visit(value: unknown, path: string): void {
    const node = value as Record<string, unknown>;
    if (node.$ref) {
      let target: unknown = root;
      for (const key of String(node.$ref).slice(2).split("/")) target = (target as Record<string, unknown>)[key.replaceAll("~1", "/").replaceAll("~0", "~")];
      visit(target, path); return;
    }
    if (path) paths.add(path);
    const properties = node.properties as Record<string, Record<string, unknown>> | undefined;
    const tags = ["kind", "field", "operation"].flatMap(key => {
      const property = properties?.[key];
      return property && (Object.hasOwn(property, "const") || property.enum) ? [[key, (property.enum ?? [property.const]) as string[]] as const] : [];
    });
    let variants = [""];
    for (const [key, values] of tags) variants = variants.flatMap(prior => values.map(value => `${prior}${prior ? ";" : ""}${key}=${value}`));
    if (tags.length) for (const variant of variants) paths.add(`${path}{${variant}}`);
    for (const [key, child] of Object.entries(node.properties ?? {})) visit(child, path ? `${path}.${key}` : key);
    if (node.items) visit(node.items, `${path}[]`);
    for (const key of ["anyOf", "oneOf", "allOf"]) for (const child of (node[key] ?? []) as unknown[]) visit(child, path);
  }
  visit(root, ""); return paths;
}
it("authority_paths_are_exhaustive_and_nonoverlapping", () => {
  for (const path of new Set([...schemaPaths(InterpretationJsonSchemaV3), ...schemaPaths(googleLiteEuContextWireSchemaV3().schema)])) {
    expect(Object.keys(authority.OUTPUT_AUTHORITY_REGISTRY_V3).filter(key => key === path)).toHaveLength(1);
    const rule = authority.classifyOutputPathV3(path as Parameters<typeof authority.classifyOutputPathV3>[0]);
    expect(rule.canAuthorizeRead).toBe(false); expect(rule.canAuthorizeWrite).toBe(false);
    expect(rule.modelAuthorshipReason.length).toBeGreaterThan(0);
    if (rule.class === "ADVISORY") {
      expect(rule.canAffectMerge).toBe(false); expect(rule.canCauseHardReject).toBe(false); expect(rule.canCauseClarify).toBe(false);
    }
  }
  expect(() => authority.classifyOutputPathV3("changes[].value.newActiveField" as Parameters<typeof authority.classifyOutputPathV3>[0])).toThrow();
});
it("registry_categories_preserve_semantic_and_advisory_boundaries", () => {
  for (const [path, rule] of Object.entries(authority.OUTPUT_AUTHORITY_REGISTRY_V3)) {
    if (path.startsWith("conversationDirective") || path.startsWith("replyProposal")) expect(rule.class).toBe("ADVISORY");
    else if (path === "schemaVersion" || path === "query.statusScope" || path === "fieldCapability.eventDateYearNullRequired" || path.startsWith("protocol.") || path.startsWith("transport.")) expect(rule.class).toBe("APPLICATION_OWNED");
    else expect(rule.class).toBe("SEMANTIC_UNTRUSTED");
  }
});
it("reminder carrier paths are explicitly untrusted and legacy indexes are closed",()=>{
  for(const root of ["reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange","locationChange"]){
    for(const suffix of ["",".change",".change.field",".change.operation",".change.value",".change.evidence",".change.evidence.primaryEvidence",".change.evidence.additionalEvidenceJson"]){
      expect(authority.classifyOutputPathV3((root+suffix) as Parameters<typeof authority.classifyOutputPathV3>[0])).toMatchObject({class:"SEMANTIC_UNTRUSTED",applicationDerivable:false,canAuthorizeRead:false,canAuthorizeWrite:false});
    }
    expect(()=>authority.classifyOutputPathV3(`${root}.change.PRIVATE_USER_FIELD` as Parameters<typeof authority.classifyOutputPathV3>[0])).toThrow("OUTPUT_AUTHORITY_UNCLASSIFIED");
  }
});
it("compact date selections remain untrusted while their mapping is application owned", () => {
  for(const prefix of ["changes[].value","query.date","query.period.date","query.period.from","query.period.through"])for(const kind of ["C","R","W"]){
    expect(authority.classifyOutputPathV3(`${prefix}{kind=${kind}}` as Parameters<typeof authority.classifyOutputPathV3>[0])).toMatchObject({class:"SEMANTIC_UNTRUSTED",canAuthorizeRead:false,canAuthorizeWrite:false,applicationDerivable:false});
  }
  expect(authority.classifyOutputPathV3("transport.codebookMapping").class).toBe("APPLICATION_OWNED");
  for(const prefix of ["eventDateChange.change.value","reminderDateChange.change.value","changes[].value","query.date","query.period.date","query.period.from","query.period.through"])for(const slot of ["kind","calendar","day","month","year","leapMonth","offsetDays","weekday","qualifier"]){
    expect(authority.classifyOutputPathV3(`${prefix}.${slot}` as Parameters<typeof authority.classifyOutputPathV3>[0])).toMatchObject({class:"SEMANTIC_UNTRUSTED",applicationDerivable:false,canAuthorizeRead:false,canAuthorizeWrite:false});
  }
  expect(()=>authority.classifyOutputPathV3("query.date{kind=X}" as Parameters<typeof authority.classifyOutputPathV3>[0])).toThrow("OUTPUT_AUTHORITY_UNCLASSIFIED");
});
it("provider query evidence slots remain untrusted selections without execution authority", () => {
  for (const slot of ["primaryEvidence", "additionalEvidenceJson"]) {
    const prefix = `query.evidence.${slot}`;
    for (const path of [prefix, ...["kind", "turn", "quote", "occurrence", "ref"].map(key => `${prefix}.${key}`), `${prefix}{kind=USER_QUOTE}`, `${prefix}{kind=CONTEXT_FACT}`]) {
      expect(authority.classifyOutputPathV3(path as Parameters<typeof authority.classifyOutputPathV3>[0])).toMatchObject({
        class: "SEMANTIC_UNTRUSTED", canAuthorizeRead: false, canAuthorizeWrite: false, applicationDerivable: false,
      });
    }
  }
  expect(authority.classifyOutputPathV3("query.evidence[]").class).toBe("SEMANTIC_UNTRUSTED");
  expect(authority.classifyOutputPathV3("transport.inactivePadding")).toMatchObject({ class: "APPLICATION_OWNED", canCauseHardReject: false, canAuthorizeRead: false, canAuthorizeWrite: false });
  expect(() => authority.classifyOutputPathV3("query.evidence.fourthEvidence" as Parameters<typeof authority.classifyOutputPathV3>[0])).toThrow("OUTPUT_AUTHORITY_UNCLASSIFIED");
});
