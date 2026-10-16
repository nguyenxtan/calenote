import { auditCampaignAccountRoot, readCampaignLedger } from "./context-contract-live";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
/** Opt-in owner-authorized debug policy. UNKNOWN stays UNKNOWN; its full
 * recorded upper bound consumes headroom instead of a one-UNKNOWN veto.
 * Include all historical exposure as well, conservatively, without rebasing
 * accounting or creating money under a new execution identity. */
export function inspectConservativeDebugCost(accountRoot:string,capMicrounits:number,maximumRequestExposureMicrounits:number,enforce=true) {
  const state=inspectConfirmedCampaignCost(accountRoot,capMicrounits,maximumRequestExposureMicrounits,false,true);
  const unknownExposureMicrounits=state.historicalUnknownExposureMicrounits+state.prospectiveUnknownExposureBoundMicrounits;
  const conservativeRetainedMicrounits=state.confirmedMicrounits+unknownExposureMicrounits;
  if(!Number.isSafeInteger(conservativeRetainedMicrounits))throw Error("DEBUG_COST_INVALID_ACCOUNTING");
  const remainingConservativeMicrounits=capMicrounits-conservativeRetainedMicrounits;
  const hardCapReady=remainingConservativeMicrounits>=maximumRequestExposureMicrounits;
  if(enforce&&!hardCapReady)throw Error("DEBUG_COST_HARD_CAP");
  return {...state,policy:"CONSERVATIVE_DEBUG_V1" as const,unknownExposureMicrounits,conservativeRetainedMicrounits,remainingConservativeMicrounits,hardCapReady};
}
function historicalReportedCosts(directory:string,runId:string,singletonReservationId?:string) {
  const path=join(directory,"responses.json"),costs=new Map<string,number>();
  if(!existsSync(path))return costs;
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4194304)throw new Error("CONFIRMED_COST_RESPONSE_BINDING");
  let raw:unknown;try{raw=JSON.parse(readFileSync(path,"utf8"));}catch{throw new Error("CONFIRMED_COST_RESPONSE_BINDING");}
  if(!Array.isArray(raw)) {
    if(!singletonReservationId||!raw||typeof raw!=="object"||!("usage" in raw))return costs;
    const usage=raw.usage as {reportedCostUsd?:unknown,costMicrounits?:unknown}|null;
    if(!usage||usage.reportedCostUsd===undefined)return costs;
    const usd=usage.reportedCostUsd;
    if(typeof usd!=="number"||!Number.isFinite(usd)||usd<0||Math.ceil(usd*1000000)!==usage.costMicrounits)throw new Error("CONFIRMED_COST_RESPONSE_BINDING");
    costs.set(singletonReservationId,usd);return costs;
  }
  if(raw.length>2000)throw new Error("CONFIRMED_COST_RESPONSE_BINDING");
  for(const value of raw) {
    if(!value||typeof value!=="object"||value.runId!==runId||!Number.isSafeInteger(value.call)||value.call<=0)continue;
    const usd=value.usage?.reportedCostUsd;
    if(usd===undefined)continue;
    if(typeof usd!=="number"||!Number.isFinite(usd)||usd<0||Math.ceil(usd*1000000)!==value.usage.costMicrounits)throw new Error("CONFIRMED_COST_RESPONSE_BINDING");
    const key=`call-${value.call}`;
    if(costs.has(key))throw new Error("CONFIRMED_COST_RESPONSE_BINDING");
    costs.set(key,usd);
  }
  return costs;
}
/** Prospective policy: legacy UNKNOWN stays immutable/visible. One unresolved
 * new claim (including a pre-dispatch crash) blocks every later run in this
 * account namespace, independently of authorization/run identifiers. */
export function inspectConfirmedCampaignCost(accountRoot: string, capMicrounits: number, maximumRequestExposureMicrounits: number, enforce = true, includeFull = false) {
  const audit = auditCampaignAccountRoot(accountRoot);
  const costs: number[] = [], exactUsd: number[] = [];
  let unknownCount = 0, prospectiveUnknownCount = 0, historicalUnknownExposureMicrounits = 0, prospectiveUnknownExposureBoundMicrounits = 0, roundedOnlyCount = 0;
  for (const binding of audit.bindings.filter(b => includeFull || b.account === "PILOT")) {
    const rows = readCampaignLedger(binding.directory), first = rows[0];
    const prospective = first?.event === "BEGIN" && first.accountingPolicy === "CONFIRMED_COST_V1";
    const claims=rows.filter(r=>r.event==="RESERVE");
    const singleton=claims.length===1&&rows.filter(r=>r.event==="DISPATCH").length===1&&rows.filter(r=>r.event==="FINISH").length===1?claims[0].reservationId:undefined;
    const reported=first?.event==="BEGIN"?historicalReportedCosts(binding.directory,first.runId,singleton):new Map<string,number>();
    for (const claim of rows.filter(r => r.event === "RESERVE")) {
      const finish = rows.find(r => r.event === "FINISH" && r.reservationId === claim.reservationId);
      if (finish?.event === "FINISH" && finish.observedMicrounits != null) {
        const usd=finish.reportedCostUsd??reported.get(claim.reservationId);
        if(usd!==undefined&&Math.ceil(usd*1000000)!==finish.observedMicrounits)throw new Error("CONFIRMED_COST_RESPONSE_BINDING");
        costs.push(finish.observedMicrounits); exactUsd.push(usd ?? finish.observedMicrounits / 1000000);
        if(usd===undefined)roundedOnlyCount++;
      } else { unknownCount++; if (prospective && first?.event === "BEGIN") {prospectiveUnknownCount++;prospectiveUnknownExposureBoundMicrounits+=first.requestExposureBoundMicrounits!;} else historicalUnknownExposureMicrounits += claim.maximumMicrounits; }
    }
  }
  costs.sort((a,b)=>a-b); exactUsd.sort((a,b)=>a-b);
  const confirmedMicrounits = costs.reduce((a,b)=>a+b,0);
  if (![capMicrounits, maximumRequestExposureMicrounits, confirmedMicrounits, historicalUnknownExposureMicrounits,prospectiveUnknownExposureBoundMicrounits].every(v=>Number.isSafeInteger(v)&&v>=0)
    || capMicrounits===0 || maximumRequestExposureMicrounits===0) throw new Error("CONFIRMED_COST_INVALID_ACCOUNTING");
  // Headroom is a one-request safety bound, NOT spend or a durable financial
  // debit. Settlement alone contributes money; claims always carry zero dollars.
  const hardCapReady = confirmedMicrounits + maximumRequestExposureMicrounits <= capMicrounits;
  const unknownSafetyReady = prospectiveUnknownCount < 1;
  if (enforce && !hardCapReady) throw new Error("CONFIRMED_COST_HARD_CAP");
  if (enforce && !unknownSafetyReady) throw new Error("CONFIRMED_COST_UNKNOWN_SAFETY_LIMIT");
  const percentile = (values:number[],p:number)=>values.length?values[Math.ceil(values.length*p)-1]:null;
  const confirmedTotalCostUsd = exactUsd.reduce((a,b)=>a+b,0);
  return { policy: "CONFIRMED_COST_V1" as const, capMicrounits, confirmedCount: costs.length, confirmedMicrounits,
    confirmedTotalCostUsd, roundedOnlyCount, costPrecision:"EXACT_WHERE_RECORDED_OTHERWISE_LEDGER_MICROUNIT_CEILING" as const, averageConfirmedCostUsd: costs.length?confirmedTotalCostUsd/costs.length:null,
    minConfirmedCostUsd: exactUsd[0]??null,maxConfirmedCostUsd:exactUsd.at(-1)??null,p50ConfirmedCostUsd:percentile(exactUsd,.5),p95ConfirmedCostUsd:percentile(exactUsd,.95),
    averageMicrounits:costs.length?confirmedMicrounits/costs.length:null,minMicrounits:costs[0]??null,maxMicrounits:costs.at(-1)??null,p50Microunits:percentile(costs,.5),p95Microunits:percentile(costs,.95),
    unknownCount,prospectiveUnknownCount,historicalUnknownExposureMicrounits,
    prospectiveUnknownExposureBoundMicrounits,
    unknownSafetyLimit:1,hardCapReady,unknownSafetyReady,executionClaimMicrounits:0 as const,
    remainingConfirmedAllowanceMicrounits:capMicrounits-confirmedMicrounits,inventoryDigest:audit.inventoryDigest,ledgerHashChain:"PASS" as const };
}
