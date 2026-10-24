import {CONTEXT_PROTOCOL_V3} from './protocol';
/** Transport-only identity. Canonical, storage and business authority unchanged. */
export const CONTEXT_SMALL_PROTOCOL_V3=Object.freeze({...CONTEXT_PROTOCOL_V3,promptVersion:'calenote-context-small-tables-106-numeric-capability-9',wireVersion:'google-gemini-2.5-flash-lite-vertex-eu-context-small-tables-106-numeric-capability-9'} as const);
export type ContextSmallProtocolV3=typeof CONTEXT_SMALL_PROTOCOL_V3;
export function isContextSmallProtocolV3(value:unknown):value is ContextSmallProtocolV3 {
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===Object.keys(CONTEXT_SMALL_PROTOCOL_V3).length&&Object.entries(CONTEXT_SMALL_PROTOCOL_V3).every(([key,expected])=>Object.getOwnPropertyDescriptor(value,key)?.value===expected);
}
