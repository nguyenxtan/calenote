import type {ParsedInterpretationV3, QueryOperand, SemanticPatchProposalV3} from "./contracts";
import type {CanonicalValidationDiagnostics} from "./validation-diagnostics";
import {ModelDirectiveV3Schema,ReplyProposalSchema} from "./contracts";
type ListQuery = Extract<QueryOperand,{kind:"LIST"}>;
export type ListPeriodProposal = {status:"KNOWN";value:NonNullable<ListQuery["period"]>} | {status:"ABSENT"} | {status:"UNSUPPORTED";diagnostic:CanonicalValidationDiagnostics};
export type DecodedListCore = Omit<SemanticPatchProposalV3,"query"> & {query:Omit<ListQuery,"period">};
declare const transportBrand: unique symbol;
export type UnreconciledListInterpretation = {readonly [transportBrand]:true};
export type ContextGatewayInterpretation = ParsedInterpretationV3 | UnreconciledListInterpretation;
type TransportData = {core:DecodedListCore;period:ListPeriodProposal;guidance:{conversationDirective:unknown;replyProposal:unknown}};
const issued = new WeakMap<object,TransportData>();
export function issueListTransport(data:TransportData):UnreconciledListInterpretation {
 const wrapper=Object.freeze({}) as UnreconciledListInterpretation;
 issued.set(wrapper,structuredClone(data));return wrapper;
}
export function isUnreconciledListInterpretation(value:unknown):value is UnreconciledListInterpretation {
 return !!value && typeof value==="object" && issued.has(value);
}
export function readListTransport(value:ContextGatewayInterpretation):TransportData {
 if(!isUnreconciledListInterpretation(value))throw Error("UNISSUED_LIST_TRANSPORT");
 return structuredClone(issued.get(value)!);
}
export function listTransportGuidanceValid(value:UnreconciledListInterpretation):boolean {
 const {guidance}=readListTransport(value);
 return ModelDirectiveV3Schema.safeParse(guidance.conversationDirective).success && ReplyProposalSchema.safeParse(guidance.replyProposal).success;
}
