/** Diagnostic only. Never trims, completes or accepts generated content. */
export function comparisonGenerationFailure(raw:unknown):'GRAMMAR_TRAP_SUSPECTED'|'OUTPUT_LIMIT'|null {
 if(!raw||typeof raw!=='object'||!('choices' in raw)||!Array.isArray(raw.choices))return null;
 const choice=raw.choices[0];if(!choice||typeof choice!=='object'||choice.finish_reason!=='length')return null;
 const content=choice.message?.content;
 return typeof content==='string'&&content.length>=256&&/^[ \t\r\n]+$/u.test(content.slice(-256))?'GRAMMAR_TRAP_SUSPECTED':'OUTPUT_LIMIT';
}
