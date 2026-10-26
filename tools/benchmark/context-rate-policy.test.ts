import {expect,it} from 'vitest';
import {parseRateHint,planRateCooldown,checkRateClock,ratePacingDelay,RATE_POLICY} from './context-rate-policy';
const receipt=Date.UTC(2026,9,26,10),clock={wall:receipt,mono:1000};
it('parses whole decimal or calendar-valid IMF date without echoing unsafe header',()=>{
 for(const raw of ['1200','0001200',' \t1200\t '])expect(parseRateHint(raw,receipt)).toEqual({state:'DELTA',notBeforeWall:receipt+1200000});
 expect(parseRateHint('Mon, 26 Oct 2026 10:20:00 GMT',receipt)).toEqual({state:'HTTP_DATE',notBeforeWall:receipt+1200000});
 for(const raw of ['', '-1','1.5','1e3','1200,1500','9'.repeat(129),'9007199254740992','Mon, 30 Feb 2026 10:00:00 GMT','Tue, 26 Oct 2026 10:20:00 GMT','Mon, 26 Oct 2026 10:20:60 GMT','1200\r\nX','１２'])expect(()=>parseRateHint(raw,receipt)).toThrow('RATE_HINT_INVALID');
 expect(()=>parseRateHint('2',Number.MAX_SAFE_INTEGER-1000)).toThrow('RATE_HINT_INVALID');
});
it('labels missing/notCaptured and never renews elapsed receipt cooldown',()=>{
 expect(parseRateHint(null,receipt).state).toBe('MISSING_POLICY_FALLBACK');expect(parseRateHint(undefined,receipt).state).toBe('NOT_CAPTURED_POLICY_FALLBACK');
 expect(planRateCooldown(receipt,parseRateHint('1200',receipt),clock,receipt+10800000)).toMatchObject({wall:receipt+1200000,mono:1201000});
 expect(planRateCooldown(receipt,parseRateHint('1200',receipt),{wall:receipt+3600000,mono:3601000},receipt+10800000)).toEqual({wall:receipt+1200000,mono:3601000});
 expect(()=>planRateCooldown(receipt,parseRateHint('1801',receipt),clock,receipt+10800000)).toThrow('RATE_COOLDOWN_LIMIT');
 expect(()=>planRateCooldown(receipt,parseRateHint(null,receipt),clock,receipt+3000000)).toThrow('RATE_BATCH_EXPIRY');
});
it('rejects rollback/skew and respects mono spacing plus additive jitter',()=>{
 expect(checkRateClock(clock,clock,{wall:receipt+1000,mono:2000})).toEqual({wall:receipt+1000,mono:2000});
 for(const c of [{wall:receipt-1,mono:1001},{wall:receipt,mono:999},{wall:receipt+900000,mono:2000},{wall:NaN,mono:1000}])expect(()=>checkRateClock(clock,clock,c)).toThrow('RATE_CLOCK');
 expect(ratePacingDelay(1000,15000,3000)).toBe(4000);expect(ratePacingDelay(1000,19000,3000)).toBe(0);expect(ratePacingDelay(null,1000,0)).toBe(0);
 expect(()=>ratePacingDelay(1000,1000,3001)).toThrow('RATE_JITTER');expect(()=>ratePacingDelay(Number.MAX_SAFE_INTEGER,1000,0)).toThrow();
 expect(RATE_POLICY.reserve).toBe(105472);
});
