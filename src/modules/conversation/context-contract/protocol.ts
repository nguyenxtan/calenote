export type ContextProtocolV3 = {
  canonicalVersion: "calenote-context-3";
  promptVersion: "calenote-context-3";
  inputVersion: "calenote-context-input-2";
  stateVersion: "calenote-context-state-2";
  wireVersion: "google-gemini-2.5-flash-lite-vertex-eu-context-title-presence-37";
  codebookVersion: "context-uncertainty-fields-1";
  storageFenceFamily: 2;
};
export const CONTEXT_PROTOCOL_V3: Readonly<ContextProtocolV3> = Object.freeze({
  canonicalVersion: "calenote-context-3", promptVersion: "calenote-context-3", inputVersion: "calenote-context-input-2",
  stateVersion: "calenote-context-state-2", wireVersion: "google-gemini-2.5-flash-lite-vertex-eu-context-title-presence-37",
  codebookVersion: "context-uncertainty-fields-1", storageFenceFamily: 2,
});
export function isContextProtocolV3(value: unknown): value is ContextProtocolV3 {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === Object.keys(CONTEXT_PROTOCOL_V3).length
    && Object.entries(CONTEXT_PROTOCOL_V3).every(([key, expected]) => Object.hasOwn(value, key) && (value as Record<string, unknown>)[key] === expected);
}
