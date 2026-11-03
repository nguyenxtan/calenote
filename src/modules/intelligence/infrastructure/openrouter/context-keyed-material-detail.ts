import type {ContextInput} from '../../../conversation/context-contract/contracts';
import {examTitleCoverage,isInitialEventDateOnlySource} from '../../../conversation/context-contract/semantic-completeness';

/** Comparison-only sufficient proof for an initial event followed by a single
 * material-preparation detail. The private primary-clause probe carries no
 * extracted values and is never sent to the model or used as evidence. */
export function keyedMaterialDetailPrimary(input:ContextInput):ContextInput|undefined {
 if(input.currentTurn!==0||input.turns.length!==1||input.turns[0].role!=='USER'
  ||input.activeRequest!==null||input.facts.length||input.pendingQuestion!==null||input.ambiguities.length)return;
 const text=input.turns[0].text;
 if(/[\r\n"'`“”‘’!?]/u.test(text)||text.includes('[CONTROL]'))return;
 const clauses=text.split(/[,;]/u);if(clauses.length!==2)return;
 const detail=clauses[1].trim();
 // A finite positive material grammar proves the entire tail. Arbitrary
 // letter-only text can contain another instruction, so it is insufficient.
 const material='(?:giấy tờ|hộ chiếu|căn cước|thẻ dự thi|thẻ sinh viên|bút|tài liệu|hồ sơ)';
 if(!new RegExp(`^nhớ\\s+(?:mang|đem|chuẩn bị)\\s+${material}(?:\\s+và\\s+${material})*[.]?$`,'iu').test(detail))return;
 const primary={...input,turns:[{...input.turns[0],text:clauses[0].trim()}]};
 if(examTitleCoverage(primary.turns[0].text)===null||!isInitialEventDateOnlySource(primary))return;
 return primary;
}
