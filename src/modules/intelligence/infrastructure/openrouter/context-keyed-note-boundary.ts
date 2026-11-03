import type {ContextInput} from '../../../conversation/context-contract/contracts';

/** A narrow lexical boundary for newly authored, unquoted note clauses. This
 * returns only a language constraint, never a source-derived payload value.
 * Existing notes can participate in SET additions, so they disable this rule. */
export function keyedNoteValuePattern(input:ContextInput):string|undefined {
 const notes=input.activeRequest?.slots.notes;
 if(notes&&(notes.state!=='MISSING'||notes.value!==null||notes.fact!==null))return;
 if(input.facts.some(fact=>fact.scope==='REMINDER'&&fact.field==='notes'))return;
 const turn=input.turns[input.currentTurn];if(turn?.role!=='USER')return;
 const text=turn.text;
 if(text!==text.trim()||/[\r\n"'`“”‘’!?]/u.test(text)||!text.endsWith('.')||text.slice(0,-1).includes('.'))return;
 // Explicit punctuation/literal-text requests and abbreviation-like endings
 // are outside this proof. In particular, quoted and multi-sentence notes
 // retain their full existing language.
 if(/(?:dấu chấm|ký tự|nguyên văn|giữ nguyên)/iu.test(text))return;
 const clause=input.activeRequest?text:text.split(/[,;]/u).at(-1)!.trim();
 if(!/^(?:ghi chú(?: là)?\s*:?\s+\S|nhớ (?:mang|đem|chuẩn bị|gọi|kiểm tra)\s+\S)/iu.test(clause))return;
 const last=clause.slice(0,-1).match(/(?:^|\s)(\p{Ll}{2,})$/u)?.[1];
 if(!last||!/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/u.test(last))return;
 return '^[^.\\r\\n]*[^.\\s]$';
}
