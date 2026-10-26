/** Fixed future-owner policy. Constants and parsing are not paid authority. */
export const RATE_POLICY=Object.freeze({version:'RATE_AWARE_FRESH_V2' as const,scopeDigest:'b1e65bab69808e635c52137d29926afd13951514dbb0f5f0321ffc7e29147e7d',app:'13804ae8962852cc1e9108d0d166e4ade90e511d',reserve:105472,baseline:7767153,unknown:64,cap:10000000,subcap:500000,runs:2,requests:76,batchRequests:152,spacing:15000,jitter:3000,cooldown:900000,maxCooldown:1800000,runMs:2700000,batchMs:10800000,skew:5000});
export interface RateClock {wall:number;mono:number}
export interface RateHint {state:'DELTA'|'HTTP_DATE'|'MISSING_POLICY_FALLBACK'|'NOT_CAPTURED_POLICY_FALLBACK';notBeforeWall:number}
export function rateNatural(v:unknown):v is number{return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;}
export function rateSum(a:number,b:number){if(!rateNatural(a)||!rateNatural(b)||!rateNatural(a+b))throw Error('RATE_OVERFLOW');return a+b;}
export function checkRateClock(origin:RateClock,last:RateClock,now:RateClock){
 for(const c of [origin,last,now])if(!c||!rateNatural(c.wall)||!rateNatural(c.mono))throw Error('RATE_CLOCK');
 if(last.wall<origin.wall||last.mono<origin.mono||now.wall<last.wall||now.mono<last.mono)throw Error('RATE_CLOCK');
 for(const c of [last,now])if(Math.abs((c.wall-origin.wall)-(c.mono-origin.mono))>RATE_POLICY.skew)throw Error('RATE_CLOCK');
 return {...now};
}
export function parseRateHint(raw:string|null|undefined,receipt:number):RateHint{
 if(!rateNatural(receipt))throw Error('RATE_HINT_INVALID');
 if(raw===null||raw===undefined)return {state:raw===null?'MISSING_POLICY_FALLBACK':'NOT_CAPTURED_POLICY_FALLBACK',notBeforeWall:receipt};
 if(typeof raw!=='string'||raw.length>128||!/^[\x20-\x7e\t]*$/u.test(raw))throw Error('RATE_HINT_INVALID');
 const v=raw.replace(/^[ \t]+|[ \t]+$/gu,'');
 if(/^\d+$/u.test(v)){const ms=BigInt(v)*1000n;if(ms>BigInt(Number.MAX_SAFE_INTEGER)||!rateNatural(receipt+Number(ms)))throw Error('RATE_HINT_INVALID');return {state:'DELTA',notBeforeWall:receipt+Number(ms)};}
 if(!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?:19[7-9]\d|[2-9]\d{3}) \d{2}:\d{2}:[0-5]\d GMT$/u.test(v))throw Error('RATE_HINT_INVALID');
 const n=Date.parse(v);if(!rateNatural(n)||new Date(n).toUTCString()!==v)throw Error('RATE_HINT_INVALID');return {state:'HTTP_DATE',notBeforeWall:n};
}
export function planRateCooldown(receipt:number,hint:RateHint,now:RateClock,expiry:number):RateClock{
 if(!rateNatural(receipt)||!rateNatural(expiry)||!rateNatural(now.wall)||!rateNatural(now.mono)||!rateNatural(hint.notBeforeWall)||now.wall<receipt)throw Error('RATE_CLOCK');
 const wall=Math.max(rateSum(receipt,RATE_POLICY.cooldown),hint.notBeforeWall);
 if(wall-receipt>RATE_POLICY.maxCooldown)throw Error('RATE_COOLDOWN_LIMIT');
 if(rateSum(Math.max(wall,now.wall),RATE_POLICY.runMs)>expiry)throw Error('RATE_BATCH_EXPIRY');
 return {wall,mono:rateSum(now.mono,Math.max(0,wall-now.wall))};
}
export function ratePacingDelay(previous:number|null,mono:number,jitter:number){
 if(!rateNatural(jitter)||jitter>RATE_POLICY.jitter)throw Error('RATE_JITTER');
 if(!rateNatural(mono))throw Error('RATE_CLOCK');if(previous===null)return 0;
 const end=rateSum(previous,RATE_POLICY.spacing+jitter);if(mono<previous)throw Error('RATE_CLOCK');return Math.max(0,end-mono);
}
