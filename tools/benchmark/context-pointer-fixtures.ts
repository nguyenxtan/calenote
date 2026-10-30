import type {ContextInput} from "../../src/modules/conversation/context-contract/contracts";
import {ConversationInterpretationV3Schema,ContextInputSchema,ModelDirectiveV3Schema,ReplyProposalSchema} from "../../src/modules/conversation/context-contract/contracts";
import {encodeGoogleLiteEuContextV3 as encodeWire107} from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import {encodeGoogleLiteEuContextV3} from "../../src/modules/intelligence/infrastructure/openrouter/context-literal-insertion-wire";
import {evidenceSourceCatalogue,primaryEvidenceSourceCodebook} from "../../src/modules/intelligence/infrastructure/openrouter/evidence-pointer";
import {CONTROL_PLACEHOLDER} from "../../src/modules/conversation/context-contract/projection";
import {frozenContextProposal as historicalProposal} from "./context-contract-fixtures";
export {validateContextFixtureCoverage} from "./context-contract-fixtures";
// Test transport adapter only. Immutable historical fixtures remain byte-identical.
const fixtureInputs=new WeakMap<object,ContextInput>();
export function frozenContextProposal(input:ContextInput,executionId:string,turnIndex:number):unknown {
 const result=historicalProposal(input,executionId,turnIndex);
 if(result&&typeof result==="object")fixtureInputs.set(result,structuredClone(input));
 return result;
}
export function encodeFixtureV3(value: unknown,input?:ContextInput): unknown {
 return encodeFixtureWith(value,input,encodeGoogleLiteEuContextV3);
}
export function encodeFixtureWire107Reference(value:unknown,input?:ContextInput):unknown {
 return encodeFixtureWith(value,input,encodeWire107);
}
function encodeFixtureWith(value:unknown,input:ContextInput|undefined,encoder:typeof encodeGoogleLiteEuContextV3):unknown {
  const bound=input??(value&&typeof value==="object"?fixtureInputs.get(value):undefined);
  const encode=(canonical:Parameters<typeof encodeGoogleLiteEuContextV3>[0])=>{
    const wire=encoder(canonical,bound) as Record<string,unknown>;
    if(!bound)return wire; // Explicit historical/schema-only compatibility.
    // Provider input includes three application-owned serialized catalogues;
    // the core codebook validates the canonical dispatch input, not metadata.
    const canonicalInput={...bound} as Record<string,unknown>;
    for(const key of ["evidenceSources","numericOwnership","fieldCapability"])delete canonicalInput[key];
    const sourceCodebook=primaryEvidenceSourceCodebook(ContextInputSchema.parse(canonicalInput));
    const ref=(r:Record<string,unknown>)=>{
      if(r?.kind!=="USER_QUOTE"||typeof r.turn!=="number"||typeof r.quote!=="string"||typeof r.occurrence!=="number")return r;
      const source=bound.turns[r.turn];if(!source||source.role!=="USER"||!r.quote.length)return r;
      let count=0,index=0,selectedStart=-1;for(;;){const start=source.text.indexOf(r.quote,index);if(start<0)break;count++;if(count===r.occurrence){selectedStart=start;break;}index=start+r.quote.length;}
      if(selectedStart<0)return r;
      let offset=0;const spans=source.text.split(CONTROL_PLACEHOLDER).map(text=>{const start=offset;offset+=text.length+CONTROL_PLACEHOLDER.length;return {start,end:start+text.length};});
      const segment=evidenceSourceCatalogue(bound).find(s=>s.turn===r.turn&&spans[s.segment].start<=selectedStart&&spans[s.segment].end>=selectedStart+(r.quote as string).length);
      return segment?{kind:"USER_SEGMENT",turn:r.turn,segment:segment.segment}:{kind:"USER_TURN",turn:r.turn};
    };
    const carrier=(c:Record<string,unknown>)=>{const evidence=c?.evidence as {primaryEvidence:string;additionalEvidenceJson:string}|undefined;if(evidence){const pointer=JSON.stringify(ref(JSON.parse(evidence.primaryEvidence)));evidence.primaryEvidence=sourceCodebook.entries.find(entry=>entry.pointerJson===pointer)?.code??pointer; // Invalid authored specimens remain invalid, never select a replacement source.
      evidence.additionalEvidenceJson=JSON.stringify(JSON.parse(evidence.additionalEvidenceJson).map(ref));}};
    if(wire.requestTarget)carrier(wire.requestTarget as Record<string,unknown>);
    if(wire.query)carrier(wire.query as Record<string,unknown>);
    (wire.changes as Array<{change:Record<string,unknown>}>).forEach(entry=>carrier(entry.change));
    for(const root of ["titleChange","reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange","locationChange"])if(wire[root]){const wrapper=wire[root] as {change:string|Record<string,unknown>};const encoded=typeof wrapper.change==="string";const change=(encoded?JSON.parse(wrapper.change as string):wrapper.change) as Record<string,unknown>;carrier(change);wrapper.change=encoded?JSON.stringify(change):change;}
    for(const issue of wire.uncertainties as Array<{alternatives:string[]}>)issue.alternatives=issue.alternatives.map(text=>{const a=JSON.parse(text);carrier(a);return JSON.stringify(a);});
    return wire;
  };
  const valid = ConversationInterpretationV3Schema.safeParse(value);
  if (valid.success) return encode(valid.data);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  const directive = ModelDirectiveV3Schema.safeParse(object.conversationDirective), reply = ReplyProposalSchema.safeParse(object.replyProposal);
  const core = ConversationInterpretationV3Schema.safeParse({ ...object, conversationDirective: directive.success ? directive.data : null, replyProposal: reply.success ? reply.data : null });
  if (!core.success) return value;
  const wire = encode(core.data) as Record<string, unknown>;
  if (!directive.success) wire.conversationDirective = object.conversationDirective;
  if (!reply.success) wire.replyProposal = object.replyProposal;
  return wire;
}
