// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LegacyV2ContextInputSchema as ContextInputSchema, LegacyV2InterpretationJsonSchema as InterpretationJsonSchema } from "../../src/modules/conversation/context-contract/contracts";
import { CONTEXT_CONTRACT_PROMPT } from "../../src/modules/conversation/context-contract/prompt";
import { measureLocalTokenArtifacts } from "./local-tokenizer";
import { createContextContractProbe, runContextFixtureCampaign } from "./context-contract-probe";
import { frozenContextProposal, encodeFixtureV3 } from "./context-pointer-fixtures";
import { admitContextManifest, expandContextCampaign, type ContextManifest } from "./context-contract";
import { ContextInputSchema as SelectedContextInputSchema, ConversationInterpretationSchema as SelectedInterpretationSchema, InterpretationJsonSchema as SelectedInterpretationJsonSchema } from "../../src/modules/conversation/context-contract/contracts";
import {CONTEXT_ORDER_REFERENCE_PROMPT as SELECTED_CONTEXT_PROMPT,googleLiteEuContextWireSchemaV3 as selectedSchema} from "../../src/modules/intelligence/infrastructure/openrouter/context-literal-insertion-wire";
import {serializeWire107ContextRequestReference} from "../../src/modules/conversation/context-contract/wire";
import { serializeContextRequest as serializeSelectedRequest } from "../../src/modules/conversation/context-contract/wire";
import { measureEnvelope as measureSelectedEnvelope } from "../../src/modules/conversation/context-contract/admission";
import { encodeContextSnapshotV2 } from "../../src/modules/conversation/context-contract/state";
import { execFileSync } from "node:child_process";
import { legacyV2GoogleLiteEuContextWireSchema } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";

function schemaMetrics(schema: unknown) {
  let nodes = 0, depth = 0, branches = 0, required = 0, enumArrays = 0, enumValues = 0, largestEnum = 0, nullable = 0, refs = 0, definitions = 0, constants = 0;
  function walk(value: unknown, level: number) {
    if (!value || typeof value !== "object") return;
    nodes++; depth = Math.max(depth, level);
    if (Array.isArray(value)) { value.forEach(v => walk(v, level + 1)); return; }
    const obj = value as Record<string, unknown>;
    for (const key of ["anyOf", "oneOf"]) if (Array.isArray(obj[key])) branches += obj[key].length;
    if (Array.isArray(obj.required)) required += obj.required.length;
    if (Array.isArray(obj.enum)) { enumArrays++; enumValues += obj.enum.length; largestEnum = Math.max(largestEnum, obj.enum.length); }
    if (obj.type === "null" || Array.isArray(obj.type) && obj.type.includes("null")) nullable++;
    if (typeof obj.$ref === "string") refs++;
    for (const key of ["$defs", "definitions"]) if (obj[key] && typeof obj[key] === "object") definitions += Object.keys(obj[key]).length;
    if ("const" in obj) constants++;
    Object.values(obj).forEach(v => walk(v, level + 1));
  }
  walk(schema, 0);
  const root = schema as { properties: object };
  return { utf8Bytes: utf8(JSON.stringify(schema)), rootKeys: Object.keys(root.properties).length, recursiveObjectArrayNodes: nodes, maximumDepth: depth, unionBranches: branches, requiredEntries: required, enumArrays, enumValues, largestEnum, nullableNodes: nullable, references: refs, definitions, constantDiscriminators: constants };
}

it.skipIf(process.env.CONTEXT_FIT_LOCAL_TOKENS !== "1")("selected109_actual326_service_envelopes_same_algorithm_fit", async () => {
  const baselineSchema = legacyV2GoogleLiteEuContextWireSchema().schema;
  const targetSchema = selectedSchema().schema;
  expect(digest(JSON.stringify(baselineSchema))).toBe("840ad3ff121dc4a5ad61016ad65a37f37a5f5b0819851e6cdb04952fb12705ab");
  expect(schemaMetrics(baselineSchema)).toMatchObject({ utf8Bytes: 12057, rootKeys: 9, recursiveObjectArrayNodes: 337, unionBranches: 49, enumArrays: 22, enumValues: 100, maximumDepth: 11 });
  expect(Object.keys((targetSchema as { properties: object }).properties)).not.toEqual(expect.arrayContaining(["dialogueAct", "continuation", "controlEvidence"]));
  expect(JSON.stringify(targetSchema)).not.toContain('"PRESENT_PREVIEW"');
  expect(JSON.stringify(targetSchema)).not.toContain('"ANSWER_QUERY"');
  const manifests = ["regressions", "development"].map(name => admitContextManifest(JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`, "utf8"))));
  const selected = manifests.flatMap(m => m.cases).filter(c => ["R02", "R07", "R14", "D01", "D02", "D06", "D07"].includes(c.id));
  const artifacts: Parameters<typeof measureLocalTokenArtifacts>[0] = [];
  const measurements: unknown[] = [];
  for (const script of selected) {
    let count = 0, turnIndex = 0;
    const outputs: string[] = [];
    const probe = await createContextContractProbe({ sourceSha: "68fac9b2b5e95ee57c53f0ac1f491210e153ed01", referenceNow: Date.parse(script.turns[0].receipt) }, value => {
      const proposal = frozenContextProposal(value, script.id, turnIndex); count++;
      const canonical = JSON.stringify(SelectedInterpretationSchema.parse(proposal));
      const wireOutput = JSON.stringify(encodeFixtureV3(proposal));
      const request = serializeSelectedRequest(value);
      const name = `${script.id}_dispatch_${count}`;
      artifacts.push({ case: name, prompt: SELECTED_CONTEXT_PROMPT, inputJson: request.messages[1].content, schemaJson: JSON.stringify(request.response_format.json_schema.schema), wireJson: JSON.stringify(request), outputJson: wireOutput });
      artifacts.push({ case: `${name}_canonical_output`, prompt: SELECTED_CONTEXT_PROMPT, inputJson: request.messages[1].content, schemaJson: JSON.stringify(request.response_format.json_schema.schema), wireJson: JSON.stringify(request), outputJson: canonical });
      outputs.push(canonical);
      return proposal;
    });
    try {
      for (const turn of script.turns) {
        await probe.turn(turn.text.includes("{{ISSUED_TOKEN}}") ? turn.text.replaceAll("{{ISSUED_TOKEN}}", probe.issuedControlToken()) : turn.text, turn.receipt, undefined, turn.processingAt);
        turnIndex++;
        const snapshot = probe.snapshot();
        const value = probe.inputs.at(-1);
        if (snapshot && value) {
          const encoded = encodeContextSnapshotV2(snapshot);
          const measured = measureSelectedEnvelope(value, encoded, outputs.at(-1));
          expect(measured.reasons, script.id).toEqual(["TOKEN_BOUND_UNVERIFIED"]);
          expect(measured.bytes.snapshot).toBeLessThanOrEqual(16384);
          expect(measured.admitted).toBe(false);
          measurements.push({ script: script.id, turn: turn.text, encodedSnapshotSha256: digest(encoded), ...measured });
        }
      }
    } finally { probe.dispose(); }
  }
  expect(artifacts.length).toBeGreaterThan(20);
  const all = ["regressions", "development", "heldout"].map(name => admitContextManifest(JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`, "utf8"))));
  const planned = expandContextCampaign({ version: "context-contract-corpus-1", cases: all.flatMap(m => m.cases) } as ContextManifest, "FULL");
  const candidates = new Map<string, Parameters<typeof measureLocalTokenArtifacts>[0]>();
  const observed = await runContextFixtureCampaign(planned, { sourceSha: "68fac9b2b5e95ee57c53f0ac1f491210e153ed01", referenceNow: Date.parse("2026-09-28T03:00:00Z") }, (value, id, index) => {
    const proposal = frozenContextProposal(value, id, index), parsed = SelectedInterpretationSchema.safeParse(proposal);
    if (parsed.success) {
      const wire = serializeSelectedRequest(value), common = { prompt: SELECTED_CONTEXT_PROMPT, inputJson: wire.messages[1].content, schemaJson: JSON.stringify(wire.response_format.json_schema.schema), wireJson: JSON.stringify(wire) };
      candidates.set(`${id}:${index}`, [{ ...common, case: `FULL_${id}_${index}_wire`, outputJson: JSON.stringify(encodeFixtureV3(parsed.data,value)) }, { ...common, case: `FULL_${id}_${index}_canonical`, outputJson: JSON.stringify(parsed.data) }]);
    }
    return proposal;
  });
  for (const script of observed) for (const [index, actual] of script.turns.entries()) if (actual.fullSchemaValid && actual.status !== "FAILED") artifacts.push(...(candidates.get(`${script.id}:${index}`) ?? []));
  const common = artifacts[0];
  artifacts.push({ ...common, case: "wire9_immutable_schema_same_input", schemaJson: JSON.stringify(baselineSchema), wireJson: JSON.stringify({ ...JSON.parse(common.wireJson), response_format: { type: "json_schema", json_schema: legacyV2GoogleLiteEuContextWireSchema() } }) });
  const long = "ế".repeat(2000);
  const evidence = [quote(0, long), quote(0, long), quote(0, long)];
  const worst = SelectedInterpretationSchema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote(0, long)] }, changes: [{ field: "notes", operation: "SET", value: long, evidence }], query: null, uncertainties: [{ field: "notes", reason: "AMBIGUOUS", alternatives: [{ value: long, evidence }, { value: long, evidence }] }], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: { text: "ế".repeat(400) } });
  artifacts.push({ ...common, case: "schema_maximal_notes_evidence_canonical_not_product_accepted", outputJson: JSON.stringify(worst) });
  artifacts.push({ ...common, case: "schema_maximal_notes_evidence_wire_not_product_accepted", outputJson: JSON.stringify(encodeFixtureV3(worst)) });
  const oversized = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, () => worst);
  try {
    const actual = await oversized.turn("Mai 8h nhắc gọi mẹ", "2026-09-28T03:00:00Z");
    expect(actual).toMatchObject({ status: "REJECTED", dispatches: 1, mutations: 0, fullSchemaValid: false });
    expect(oversized.snapshot()).toBeNull();
    expect(utf8(JSON.stringify(encodeFixtureV3(worst)))).toBeGreaterThan(32768);
  } finally { oversized.dispose(); }
  const evidenceResult = measureLocalTokenArtifacts(artifacts);
  const actualRows=evidenceResult.rows.filter(r=>!r.case.startsWith("schema_maximal")&&r.case!=="wire9_immutable_schema_same_input");
  expect(actualRows).toHaveLength(326);
  const affected=new Map<string,{current:string;historical:string;currentBytes:number;historicalBytes:number;currentUnions:number;historicalUnions:number}>();
  for(const artifact of artifacts.filter(a=>!a.case.startsWith("schema_maximal")&&!a.case.startsWith("wire9_"))){
    const current=JSON.parse(artifact.schemaJson),projected=JSON.parse(artifact.inputJson);
    for(const key of ["fieldCapability","evidenceSources","numericOwnership"])delete projected[key];
    const bound=SelectedContextInputSchema.parse(projected);
    const before=serializeWire107ContextRequestReference(bound).response_format.json_schema.schema;
    const currentMetrics=schemaMetrics(current),historicalMetrics=schemaMetrics(before);
    expect(current).not.toEqual(before);
    const identity=digest(artifact.inputJson);affected.set(identity,{current:digest(artifact.schemaJson),historical:digest(JSON.stringify(before)),currentBytes:currentMetrics.utf8Bytes,historicalBytes:historicalMetrics.utf8Bytes,currentUnions:currentMetrics.unionBranches,historicalUnions:historicalMetrics.unionBranches});
  }
  expect(affected.size).toBeGreaterThan(0);
  if(actualRows.some(row=>row.outputTextTokens===null))throw Error("WIRE109_OUTPUT_MEASUREMENT_MISSING");
  if(process.env.CONTEXT_FIT_WIRE109_REPORT==="1")writeFileSync(".superpowers/sdd/2026-10-13-typed-date-authoring/wire109-offline-metrics.json",JSON.stringify({actualEnvelopeRows:actualRows.length,uniqueAffectedRequests:affected.size,schemaPairs:[...affected.values()],maxConservativeInputTokens:Math.max(...actualRows.map(r=>r.applicationTextTokens+r.rawSchemaDiagnosticTokens)),maxOutputTokens:Math.max(...actualRows.map(r=>r.outputTextTokens!)),networkGuard:evidenceResult.provenance.networkGuardActive,networkAttempts:evidenceResult.provenance.networkAttemptsAfterSelfCheck,providerCompilerAdmission:"UNVERIFIED"},null,2));
  console.log(JSON.stringify({wire109Applicability:{actualEnvelopeRows:actualRows.length,uniqueAffectedRequests:affected.size,schemaPairs:[...affected.values()]},providerCompilerAdmission:"UNVERIFIED"}));

  const actualSchemaMetrics=artifacts.filter(a=>!a.case.startsWith("schema_maximal")&&a.case!=="wire9_immutable_schema_same_input").map(a=>schemaMetrics(JSON.parse(a.schemaJson)));
  console.log(JSON.stringify({actualSchemaMaximumMetrics:Object.fromEntries(Object.keys(actualSchemaMetrics[0]).map(key=>[key,Math.max(...actualSchemaMetrics.map(metrics=>metrics[key as keyof typeof metrics]))])),providerStateAdmission:"UNVERIFIED"}));
  console.log(JSON.stringify({actualRequestRows:actualRows.length,maxApplicationTextTokens:Math.max(...actualRows.map(r=>r.applicationTextTokens)),maxConservativeTextPlusSchemaTokens:Math.max(...actualRows.map(r=>r.applicationTextTokens+r.rawSchemaDiagnosticTokens)),largestRequests:[...actualRows].sort((a,b)=>(b.applicationTextTokens+b.rawSchemaDiagnosticTokens)-(a.applicationTextTokens+a.rawSchemaDiagnosticTokens)).slice(0,4).map(r=>({case:r.case,text:r.applicationTextTokens,schema:r.rawSchemaDiagnosticTokens})),routeFramingTokens:"UNKNOWN",sdkFullStructuredUnavailableRows:actualRows.filter(r=>r.sdkFullStructuredTokens===null).length}));
  for(const row of actualRows)expect(row.applicationTextTokens+row.rawSchemaDiagnosticTokens,row.case).toBeLessThanOrEqual(12000);
  expect(evidenceResult.provenance.networkGuardActive).toBe(true);
  expect(evidenceResult.provenance.networkAttemptsAfterSelfCheck).toEqual([]);
  for (const row of evidenceResult.rows.filter(r => !r.case.startsWith("schema_maximal"))) {
    expect(row.applicationTextTokens, row.case).toBeLessThanOrEqual(12000);
    expect(row.outputTextTokens, row.case).toBeLessThanOrEqual(1536);
    expect(row.routeFramingTokens).toBe("UNKNOWN");
  }
  expect(evidenceResult.rows.find(r => r.case === "schema_maximal_notes_evidence_wire_not_product_accepted")!.outputTextTokens).toBeGreaterThan(1536);
  expect(digest(JSON.stringify(InterpretationJsonSchema))).toBe("8f1b868f606fd39972adc8984666f62960bf6c6f5ad38ff64774997b8765ba2d");
  expect(digest(JSON.stringify(SelectedInterpretationJsonSchema))).toBe("43b6689ce9c4874c4d532652ea212b52aa7d7f222cddd55377e59d483f5c444b");
  const paths = ["src/modules/conversation/context-contract/contracts.ts", "src/modules/conversation/context-contract/prompt.ts", "src/modules/conversation/context-contract/wire.ts", "src/modules/intelligence/infrastructure/openrouter/context-provider-wire.ts", "src/modules/intelligence/infrastructure/openrouter/provider-wire-schema.ts", "src/modules/intelligence/infrastructure/openrouter/semantic-gateway.test.ts"];
  const report = { revision: "context-authority-v3-A6", method: "recursive-all-object-array-v1+pinned-local-tokenizer-offline-1", immutableBaseline: { sourceSha: "899b1f25f38d4d4afcd7429ffbb10c91851c25e3", sourceHashes: Object.fromEntries(paths.map(path => [path, digest(execFileSync("git", ["show", `899b1f25f38d4d4afcd7429ffbb10c91851c25e3:${path}`], { encoding: "utf8" }))])), exactSerializedSchemaSha256: digest(JSON.stringify(baselineSchema)), ...schemaMetrics(baselineSchema) }, target: { sourceBaseSha: "68fac9b2b5e95ee57c53f0ac1f491210e153ed01", sourceHashes: Object.fromEntries(paths.map(path => [path, digest(readFileSync(path, "utf8"))])), exactSerializedSchemaSha256: digest(JSON.stringify(targetSchema)), promptSha256: digest(SELECTED_CONTEXT_PROMPT), ...schemaMetrics(targetSchema) }, routeAdmission: "UNVERIFIED", applicationProviderCalls: 0, providerCountingCalls: 0, caveat: "Same V3 input/prompt isolates schema bytes, not a legacy runtime replay. Maximal output is schema-only, not accepted grounding. No Google private validator-state claim.", evidence: evidenceResult, actualV3EnvelopeMeasurements: measurements, artifacts: artifacts.map(a => ({ case: a.case, inputSha256: digest(a.inputJson), wireSha256: digest(a.wireJson), outputSha256: a.outputJson && digest(a.outputJson), outputUtf8Bytes: a.outputJson && utf8(a.outputJson) })) };
  if (process.env.CONTEXT_FIT_V3_REPORT === "1") writeFileSync(".superpowers/sdd/2026-10-13-typed-date-authoring/wire109-authority-measurements.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ baseline: report.immutableBaseline, target: report.target, ordinaryRows: artifacts.length - 2, actualEnvelopeRows: measurements.length }));
}, 60000);

const input = ContextInputSchema.parse({
  schemaVersion: "calenote-context-input-1",
  reference: { instant: "2026-09-28T03:00:00.000Z", localDate: "2026-09-28", timezone: "Asia/Ho_Chi_Minh" },
  turns: [{ role: "USER", text: "Mai 8h nhắc gọi mẹ" }], currentTurn: 0,
  activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [],
  capabilities: { version: "context-capabilities-1", supported: ["ONCE", "FINITE_DAILY", "LIST", "CALENDAR_DATE"], unsupported: ["WEEKLY", "MONTHLY", "YEARLY"], calendars: ["GREGORIAN", "LUNAR_VN"], limits: { dailyCount: 30, horizonDays: 366 } },
});
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const utf8=(text:string)=>new TextEncoder().encode(text).byteLength;
const quote=(turn:number,text:string)=>({kind:'USER_QUOTE' as const,turn,quote:text,occurrence:1});
it.skipIf(process.env.CONTEXT_FIT_LOCAL_TOKENS!=='1')('selected109 mandatory900 retained detail fits exact original inputs without reclassification',()=>{
 const at='2026-09-28T03:00:00.000Z',fields=['title','location','notes','eventDate','eventTime','reminderDate','reminderTime','calendar','frequency','occurrenceCount','eventRelation','leadOffsetDays','endDate'];
 const artifacts:Parameters<typeof measureLocalTokenArtifacts>[0]=[];
 for(const field of ['title','notes'] as const){const long='ế'.repeat(900),bound=SelectedContextInputSchema.parse({...input,schemaVersion:'calenote-context-input-2',turns:[{role:'USER',text:long},{role:'ASSISTANT',text:'Bạn muốn được nhắc lúc mấy giờ?'},{role:'USER',text:'Giữ nguyên.'}],currentTurn:2,activeRequest:{lifecycle:'CLARIFYING',slots:Object.fromEntries(fields.map(f=>[f,{state:f===field?'RESOLVED':'MISSING',value:f===field?long:null,fact:f===field?'f1':null}]))},facts:[{alias:'f1',scope:'REMINDER',field,value:long,provenance:{kind:'EXPLICIT_USER'},sourceReferenceTime:at,dependencies:[]}],pendingQuestion:{text:'Bạn muốn được nhắc lúc mấy giờ?',scope:'REMINDER',field:'reminderTime',decisionKind:null,reason:'MISSING'},ambiguities:[]});
  const proposal=SelectedInterpretationSchema.parse({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'CURRENT',evidence:[{kind:'USER_QUOTE',turn:2,quote:'Giữ nguyên.',occurrence:1}]},changes:[{field,operation:'SET',value:long,evidence:[{kind:'CONTEXT_FACT',ref:'f1'}]}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null}),request=serializeSelectedRequest(bound),wire=encodeFixtureV3(proposal,bound);
  expect(bound.turns[0].text).toBe(long);expect(bound.facts[0].value).toBe(long);
  for(const [kind,output] of [['wire',wire],['canonical',proposal]] as const)artifacts.push({case:`required_${field}_900_${kind}`,prompt:SELECTED_CONTEXT_PROMPT,inputJson:request.messages[1].content,schemaJson:JSON.stringify(request.response_format.json_schema.schema),wireJson:JSON.stringify(request),outputJson:JSON.stringify(output)});
 }
 const result=measureLocalTokenArtifacts(artifacts,'TEXT_SCHEMA_DIAGNOSTIC_ONLY');expect(result.provenance.networkGuardActive).toBe(true);expect(result.provenance.networkAttemptsAfterSelfCheck).toEqual([]);
 for(const row of result.rows){expect(row.applicationTextTokens+row.rawSchemaDiagnosticTokens,row.case).toBeLessThanOrEqual(12000);expect(row.outputTextTokens,row.case).toBeLessThanOrEqual(1536);expect(row.sdkFullStructuredTokens).toBeNull();expect(row.sdkFullStructuredUnavailableReason).toBe('NOT_REQUESTED_DIAGNOSTIC_ONLY');expect(row.routeFramingTokens).toBe('UNKNOWN')}
 if(process.env.CONTEXT_FIT_WIRE109_REPORT==='1')writeFileSync('.superpowers/sdd/2026-10-13-typed-date-authoring/wire109-required-detail-installed-metrics.json',JSON.stringify(result,null,2));
},60000);
