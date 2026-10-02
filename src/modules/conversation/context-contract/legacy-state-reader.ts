import { decodeContextSnapshot } from "./state";

declare const legacyRecordBrand: unique symbol;
/** Inspection capability only: no snapshot, candidate or executable proof. */
export type LegacyContextRecord = Readonly<{ readonly [legacyRecordBrand]: true }>;
export type LegacyContextReadResult = { status: "VALID"; record: LegacyContextRecord } | { status: "INVALID" };
export function readLegacyContextState(encoded: string): LegacyContextReadResult {
  try {
    decodeContextSnapshot(encoded);
    const record = Object.freeze({}) as LegacyContextRecord;
    return { status: "VALID", record };
  } catch { return { status: "INVALID" }; }
}
