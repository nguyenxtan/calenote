import {CONTEXT_PROTOCOL_V3} from "./protocol";
/** Model transport identity only; canonical/storage versions remain unchanged. */
export const CONTEXT_TYPED_PROTOCOL_V3=Object.freeze({...CONTEXT_PROTOCOL_V3,promptVersion:"calenote-context-typed-objects-105",wireVersion:"google-gemini-2.5-flash-lite-vertex-eu-context-typed-objects-105"} as const);
export type ContextTypedProtocolV3=typeof CONTEXT_TYPED_PROTOCOL_V3;
export function isContextTypedProtocolV3(value:unknown):value is ContextTypedProtocolV3 {
 return !!value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===Object.keys(CONTEXT_TYPED_PROTOCOL_V3).length&&Object.entries(CONTEXT_TYPED_PROTOCOL_V3).every(([key,expected])=>Object.getOwnPropertyDescriptor(value,key)?.value===expected);
}
