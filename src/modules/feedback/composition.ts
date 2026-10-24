import {requireSession} from '@/modules/auth/session';
import {D1SessionStore} from '@/modules/db/session-store';
import {createKeyring} from '@/modules/security/keyring';
import type {FeedbackOperations} from '@/worker/routes/feedback';
import {D1FeedbackStore} from './store';
export async function createFeedbackOperations(env:Pick<Env,'DB'|'CALENOTE_MASTER_KEY'>&{CALENOTE_ADMIN_USER_IDS?:string}):Promise<FeedbackOperations>{
 const keyring=await createKeyring(env.CALENOTE_MASTER_KEY);
 return{requireUser:credentials=>requireSession(credentials,{store:new D1SessionStore(env.DB),keyring}),allowlist:env.CALENOTE_ADMIN_USER_IDS,readerId:(owner,sessionId)=>keyring.digestCode(JSON.stringify(['feedback-reader',owner,sessionId])),store:new D1FeedbackStore(env.DB,keyring)};
}
