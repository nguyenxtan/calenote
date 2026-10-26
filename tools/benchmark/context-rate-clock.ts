/** Production scheduling clock, separate from every frozen semantic clock.
 * Tests replace this module; live API exposes no clock or wait overrides. */
import {randomInt} from 'node:crypto';import {setTimeout} from 'node:timers/promises';import {RATE_POLICY} from './context-rate-policy';
export const rateSchedulingClock=()=>({wall:Date.now(),mono:Math.floor(performance.now())});
export const rateSchedulingJitter=()=>randomInt(RATE_POLICY.jitter+1);
export async function waitRateScheduler(ms:number,signal:AbortSignal){await setTimeout(ms,undefined,{signal});}
