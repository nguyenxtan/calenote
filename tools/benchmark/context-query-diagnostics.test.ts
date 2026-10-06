// @vitest-environment node
import { expect, it } from "vitest";
import * as diagnostics from "./context-query-diagnostics";
import { encodeGoogleLiteEuContextV3 } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";

it("retains canonical prevalidation month shape after rejection without evidence or reply content", () => {
  const canonical = {schemaVersion:"calenote-context-3",intent:"LIST_REMINDERS",requestTarget:null,changes:[],query:{kind:"LIST",period:{kind:"MONTH",offset:0},statusScope:"DEFAULT",evidence:[{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_EVIDENCE_SENTINEL",occurrence:1}]},uncertainties:[],conversationDirective:null,replyProposal:null};
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as Record<string, unknown>;
  // A legal tuple with a conditional canonical failure still reaches the observer.
  wire.uncertainties=[{fieldCode:15,reason:"UNSUPPORTED_COMBINATION",alternatives:[]}];
  const body = JSON.stringify({choices:[{message:{content:JSON.stringify(wire)}}]});
  const result = diagnostics.captureQueryDiagnostics(body);
  expect(result.canonicalPrevalidation).toMatchObject({intent:"LIST_REMINDERS",query:{kind:"LIST",period:{type:"object",kind:"MONTH"}}});
  expect(JSON.stringify(result)).not.toContain("PRIVATE_EVIDENCE_SENTINEL");
});

it.each(["PRIVATE_VALUE", "x".repeat(40000), "{}", "not-json"])("bounded diagnostics reject or sanitize arbitrary input", body => {
  expect(JSON.stringify(diagnostics.captureQueryDiagnostics(body))).not.toContain("PRIVATE_VALUE");
});
