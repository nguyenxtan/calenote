import { requireSession, type SessionCredentials } from '@/modules/auth/session';
import { D1SessionStore } from '@/modules/db/session-store';
import { createKeyring } from '@/modules/security/keyring';
import { readAdminOverview } from './overview';
import type { AdminOverviewOperations } from '@/worker/routes/admin-overview';
export type AdminRuntimeEnv=Pick<Env,'DB'|'CALENOTE_MASTER_KEY'> & {CALENOTE_ADMIN_USER_IDS?:string};
/** No identity is set here or in Wrangler; enabling persistent access requires explicit approval. */
export function createAdminOverviewOperations(env:AdminRuntimeEnv):AdminOverviewOperations{
 return {allowlist:env.CALENOTE_ADMIN_USER_IDS,requireUser:async(credentials:SessionCredentials)=>requireSession(credentials,{store:new D1SessionStore(env.DB),keyring:await createKeyring(env.CALENOTE_MASTER_KEY)}),readOverview:()=>readAdminOverview(env.DB,Date.now())};
}
