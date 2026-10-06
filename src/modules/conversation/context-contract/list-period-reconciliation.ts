import type {ReadyContextV2} from "./context";
import {QueryOperandSchema,parseInterpretationSectionsV3,type InterpretationSectionsV3} from "./contracts";
import {readListTransport,type ContextGatewayInterpretation} from "./list-period-transport";
import {resolveListQuerySourcesV3} from "./evidence";
import {observeDownstream,type DownstreamObserver} from "./downstream";
export function reconcileListPeriodV3(value:ContextGatewayInterpretation,built:ReadyContextV2,observe?:DownstreamObserver):InterpretationSectionsV3 {
 const refused={status:"REFUSED",reason:"SEMANTIC_PATCH_INVALID"} as const;
 try {
  const {core,period,guidance}=readListTransport(value);
  observeDownstream(observe,{stage:"TRANSPORT",result:"PASS",reason:"NONE"});
  if(core.intent!=="LIST_REMINDERS" || core.requestTarget!==null || core.changes.length!==0)return refused;
  const query=QueryOperandSchema.parse({...core.query,period:period.status==="KNOWN"?period.value:null});
  if(query.kind!=="LIST")return refused;
  const source=resolveListQuerySourcesV3(query,core.uncertainties,built,observe);
  if(source.status!=="VALID")return refused;
  const selected=source.deterministicPeriod??query.period;
  const uncertainties=source.deterministicPeriod?core.uncertainties.filter(u=>u.field!=="queryRange"):[...core.uncertainties];
  if(selected===null && !uncertainties.some(u=>u.field==="queryRange"))uncertainties.push({field:"queryRange",reason:"MISSING",alternatives:[]});
  observeDownstream(observe,{stage:"PERIOD_RECONCILIATION",result:selected?"SUPPORTED":"UNSPECIFIED",reason:"NONE",modelPeriodAuthority:period.status==="UNSUPPORTED"?"NONE":"PROPOSAL",...(selected?{candidateRange:selected.kind}:{})});
  // Original fact refs were checked above against the original operand. A
  // replacement period is grounded in already-authenticated current USER
  // evidence, not an old fact whose exact value is no longer this query.
  const evidence=source.deterministicPeriod?query.evidence.filter(ref=>ref.kind==="USER_QUOTE" && ref.turn===built.input.currentTurn):query.evidence;
  return parseInterpretationSectionsV3({...core,query:{...query,period:selected,evidence},uncertainties,...guidance});
 } catch {return refused;}
}
