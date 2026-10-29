import { ConnectionNotFoundError, ConnectionStateError, RateLimitExceededError } from "@/modules/onboarding/service";
import { consumeRateLimit, type RateLimitStore } from "@/modules/rate-limit/service";
import { randomOpaqueId, cryptoRandomBytes, systemClock, type Clock, type RandomBytes } from "@/modules/platform/types";
import type { Keyring } from "@/modules/security/keyring";
import type { D1ConnectionLifecycleStore, LifecycleCas, LifecycleSnapshot } from "./store";

export async function changeConnectionLifecycle(input:{userId:string;publicId:string;paused:boolean;expected:LifecycleCas},deps:{
  store:D1ConnectionLifecycleStore;rateLimitStore:RateLimitStore;keyring:Pick<Keyring,"digestCode">;now?:Clock;randomBytes?:RandomBytes;
}):Promise<LifecycleSnapshot> {
  const now=(deps.now??systemClock)();
  const subjectDigest=await deps.keyring.digestCode(`rate-limit:lifecycle:${input.userId}`);
  const rate=await consumeRateLimit({subjectDigest,scope:"connection-lifecycle",limit:6,windowMs:600_000},{store:deps.rateLimitStore,now:()=>now});
  if(!rate.allowed) throw new RateLimitExceededError(Math.max(1,Math.ceil((rate.resetAt-now)/1000)));
  if(!await deps.store.get(input.userId,input.publicId)) throw new ConnectionNotFoundError();
  if(!await deps.store.change({...input,marker:randomOpaqueId(deps.randomBytes??cryptoRandomBytes),now})) throw new ConnectionStateError();
  const result=await deps.store.get(input.userId,input.publicId);
  if(!result) throw new ConnectionNotFoundError();
  return result;
}
