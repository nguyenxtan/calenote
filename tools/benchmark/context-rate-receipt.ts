import {createHash} from 'node:crypto';
import {parseJsonWithoutDuplicateMembers} from '../../src/modules/intelligence/infrastructure/openrouter/strict-json';
import {parseRateHint,rateNatural,RATE_POLICY,type RateHint} from './context-rate-policy';
export interface RateReceipt {status:number;receivedAt:number;complete:boolean;capturedBytes:number;capturedSha256:string|null;matchedPool:boolean;hint:RateHint|null}
/** Harness-only bounded clone. Raw body/header text never enters its result.
 * No status probe or extra HTTP request. Incomplete prefixes are ineligible. */
export async function captureRateReceipt(response:Response,receivedAt:number):Promise<RateReceipt>{
 if(!rateNatural(receivedAt))throw Error('RATE_CLOCK');
 const out:RateReceipt={status:response.status,receivedAt,complete:false,capturedBytes:0,capturedSha256:null,matchedPool:false,hint:null};
 if(response.status!==429)return out;
 try{const hint=parseRateHint(response.headers.get('retry-after'),receivedAt);if(Math.max(RATE_POLICY.cooldown,hint.notBeforeWall-receivedAt)<=RATE_POLICY.maxCooldown)out.hint=hint;}catch{/* present invalid remains null, never fallback */}
 const reader=response.clone().body?.getReader();if(!reader)return out;
 const chunks:Uint8Array[]=[];let bytes=0,done=false,timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('RATE_CAPTURE_TIMEOUT')),5000);});
 try{
  while(true){const part=await Promise.race([reader.read(),timeout]);if(part.done){done=true;break;}bytes+=part.value.byteLength;if(bytes>8192)break;chunks.push(part.value);}
  if(!done)return out;
  const body=Buffer.concat(chunks);out.complete=true;out.capturedBytes=body.length;out.capturedSha256=createHash('sha256').update(body).digest('hex');
  const raw=parseJsonWithoutDuplicateMembers(new TextDecoder('utf-8',{fatal:true}).decode(body));
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||'choices' in raw||!('error'in raw))return out;
  const e=raw.error as {code?:unknown;metadata?:{provider_name?:unknown;limit_source?:unknown;is_byok?:unknown}};
  out.matchedPool=e?.code===429&&e.metadata?.provider_name==='Google AI Studio'&&e.metadata.limit_source==='upstream_provider_shared_pool'&&e.metadata.is_byok===false;
  return out;
 }catch{return out;}finally{if(timer)clearTimeout(timer);if(!done)void reader.cancel().catch(()=>{});}
}
