/** A trusted callback may only acquire Keychain+quota metadata. Give it the
 * owner/deadline signal; unresolved callback work is uncertain and retains lock.
 * Never print callback errors, retry it, or infer approval from credentials. */
import {rateNatural} from './context-rate-policy';
export async function acquireRateCredential(acquire:(signal:AbortSignal)=>Promise<string>,owner:AbortSignal,remainingMs:number):Promise<string>{
 if(!rateNatural(remainingMs)||remainingMs===0)throw Error('RATE_RUN_EXPIRY');owner.throwIfAborted();
 const signal=AbortSignal.any([owner,AbortSignal.timeout(Math.min(30000,remainingMs))]);let settled=false;let interrupted:()=>void=()=>{};
 let work:Promise<string>;try{signal.throwIfAborted();work=acquire(signal);}catch{if(owner.aborted)throw owner.reason;throw Error('RATE_CREDENTIAL_FAILURE');}
 const pending=Promise.resolve(work).then(key=>{settled=true;return key;},()=>{settled=true;throw Error('RATE_CREDENTIAL_FAILURE');});
 const interruption=new Promise<never>((_,reject)=>{interrupted=()=>reject(Error('RATE_CREDENTIAL_INTERRUPTED'));if(signal.aborted)interrupted();else signal.addEventListener('abort',interrupted,{once:true});});
 try{return await Promise.race([pending,interruption]);}catch{if(!settled)throw Error('RATE_CREDENTIAL_UNSETTLED');if(owner.aborted)throw owner.reason;throw Error('RATE_CREDENTIAL_FAILURE');}finally{signal.removeEventListener('abort',interrupted);}
}
