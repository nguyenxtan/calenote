import { parseGoogleLiteEuContextSectionsV3 } from "../../src/modules/intelligence/infrastructure/openrouter/context-literal-insertion-wire";
import { CONTEXT_PROTOCOL_V3 } from "../../src/modules/conversation/context-contract/protocol";
import {ContextInputSchema,type ContextInput} from "../../src/modules/conversation/context-contract/contracts";
import {materializeProviderEvidence,expandPrimaryEvidenceSourceCodes} from "../../src/modules/intelligence/infrastructure/openrouter/evidence-pointer";

const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const type = (v: unknown) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
const control = (v: unknown, approved: readonly string[]) => typeof v === "string" && approved.includes(v) ? v : "INVALID_OR_ABSENT";
const kinds = ["LIST","CALENDAR_DATE","CAPABILITY","INACTIVE","NONE"];
const periods = ["DAY","DATE_BOUNDS","WEEK","WEEKEND","MONTH","REST_OF_MONTH","NEXT_7_DAYS","UPCOMING","INACTIVE","NONE"];
function query(v: unknown) {
  const q = object(v), period = q?.period;
  return {type:type(v),kind:control(q?.kind,kinds),state:control(q?.state,["ACTIVE","INACTIVE"]),period:{type:type(period),kind:control(object(period)?.kind,periods)}};
}
/** Only closed finite control literals and JSON types leave this boundary.
 * Never retains evidence, titles, dates, notes, reply text or arbitrary keys. */
export function captureQueryDiagnostics(body: string,input?:ContextInput) {
  let wire: ReturnType<typeof query> | null = null;
  let canonicalPrevalidation: {intent:string;query:ReturnType<typeof query>} | null = null;
  if(Buffer.byteLength(body)>32768)return {wire,canonicalPrevalidation};
  try {
    const envelope=JSON.parse(body),content=envelope?.choices?.[0]?.message?.content;
    if(typeof content!=="string"||Buffer.byteLength(content)>32768)return {wire,canonicalPrevalidation};
    const raw=JSON.parse(content),root=object(raw);
    wire=query(root?.query);
    let canonicalInput:ContextInput|undefined;
    if(input){const plain={...input} as Record<string,unknown>;for(const key of ["evidenceSources","numericOwnership","fieldCapability"])delete plain[key];canonicalInput=ContextInputSchema.parse(plain);}
    parseGoogleLiteEuContextSectionsV3(canonicalInput?materializeProviderEvidence(expandPrimaryEvidenceSourceCodes(raw,canonicalInput),canonicalInput,true):raw,CONTEXT_PROTOCOL_V3,undefined,undefined,decoded=>{
      const canonical=object(decoded);
      canonicalPrevalidation={intent:control(canonical?.intent,["CREATE_REMINDER","LIST_REMINDERS","CALENDAR_QUERY","HELP","UNSUPPORTED","ABANDON"]),query:query(canonical?.query)};
    });
  } catch { /* Malformed input is evidence, never a diagnostic exception. */ }
  return {wire,canonicalPrevalidation};
}
