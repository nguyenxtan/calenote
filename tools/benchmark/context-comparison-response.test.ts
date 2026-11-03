// @vitest-environment node
import {expect,it} from 'vitest';
import {comparisonGenerationFailure} from './context-comparison-response';
it('distinguishes whitespace saturation from other output-limit failures',()=>{
 const content='{"uncertainties":['+' \n'.repeat(200);expect(comparisonGenerationFailure({choices:[{finish_reason:'length',message:{content}}]})).toBe('GRAMMAR_TRAP_SUSPECTED');expect(comparisonGenerationFailure({choices:[{finish_reason:'length',message:{content:'{"value":"unfinished'}}]})).toBe('OUTPUT_LIMIT');
});
it('does not classify valid stop completions or malformed envelopes as a grammar trap',()=>{
 expect(comparisonGenerationFailure({choices:[{finish_reason:'stop',message:{content:' '.repeat(300)}}]})).toBeNull();for(const value of [null,{}, {choices:[]}])expect(comparisonGenerationFailure(value)).toBeNull();
});
