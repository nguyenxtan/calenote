import type { ContextInput } from "./contracts";

/** Input-level shape check only. The context builder derives this metadata
 * from privately retained receipts; a model response can never supply it. */
export function currentBurstTurnIndexes(input: ContextInput): readonly number[] {
  const turns = input.currentBurstTurns, references = input.currentBurstReferences;
  if (!Array.isArray(turns) || turns.length < 2 || turns.length > 3
    || !Array.isArray(references) || references.length !== turns.length
    || input.activeRequest !== null || input.facts.length || input.pendingQuestion !== null || input.ambiguities.length
    || turns.length !== input.turns.length || turns[0] !== 0
    || input.currentTurn !== input.turns.length - 1 || turns.at(-1) !== input.currentTurn) return [];
  for (const [ordinal, index] of turns.entries()) {
    const reference = references[ordinal];
    if (!Number.isSafeInteger(index) || index < 0 || input.turns[index]?.role !== "USER"
      || ordinal > 0 && index !== turns[ordinal - 1] + 1
      || !reference || reference.turn !== index || !Number.isFinite(Date.parse(reference.instant))) return [];
    const instant = Date.parse(reference.instant);
    const local = new Date(instant + 7 * 3600000);
    if (!Number.isFinite(local.getTime()) || new Date(instant).toISOString() !== reference.instant
      || local.toISOString().slice(0, 10) !== reference.localDate
      || ordinal > 0 && instant < Date.parse(references[ordinal - 1].instant)) return [];
  }
  if (references.at(-1)!.instant !== input.reference.instant
    || Date.parse(references.at(-1)!.instant) - Date.parse(references[0].instant) > 10000) return [];
  return turns;
}

/** NEW admission only; CURRENT edits and controls keep currentTurn authority. */
export function currentRequestTurnIndexes(input: ContextInput): readonly number[] {
  const members = currentBurstTurnIndexes(input);
  return members.length ? members : [input.currentTurn];
}

const BURST_ADDENDUM = `
Deferred USER burst: the application-owned currentBurstTurns identifies the separate USER messages belonging to this one fresh request. For NEW targeting and NEW operands only, exact existing USER evidence from any listed member is eligible; the newest fragment need not repeat the task. Read every member for its authored task, venue, notes, dates, clocks, cadence and distances. Preserve genuine ambiguity or independent tasks; never choose a convenient subset. Do not concatenate messages, invent quotes or evidence codes, or borrow any USER outside currentBurstTurns or any retained fact into NEW. Existing U/S source codes still select their individual original source. CURRENT targeting, REPLACE, CLEAR, controls and query authority remain restricted by the existing currentTurn rules. currentBurstReferences gives each member's original receipt instant and local date: keep relative operands tied to their actual source receipt, including across midnight, rather than recomputing them from the tail's date. Metadata and schema availability supply no semantic operand or control authority.
An event date in one member plus a notification clock in another does not author a notification date. An event phrase such as "Ngày 11/11 đi thi" or "Mai đi thi" supplies eventDate only; a later "Nhắc lúc 8h" supplies reminderTime only. Keep reminderDate unchanged unless a member independently authors the notification's date or start. Never duplicate an event's absolute or relative date into reminderDate to complete the schedule; missing scheduling relationships belong to the application. These examples explain ownership only and supply no operands for another source. Exclude exterior sentence punctuation from a venue: the final full stop in "đi thi ở Trường A." terminates the instruction, while the venue is "Trường A". Preserve punctuation inside an explicitly quoted venue, an abbreviation or an actual venue name.
`;

/** Single-message prompts remain byte-identical, including their whitespace. */
export function contextPromptForInput(basePrompt: string, input: ContextInput): string {
  return currentBurstTurnIndexes(input).length ? basePrompt + BURST_ADDENDUM : basePrompt;
}
