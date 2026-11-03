import { ServingReleaseSchema, type ServingRelease } from '@/contracts/api/product-updates';
import { resolveRuntimeOriginPolicy } from './origin-policy';

export type ReleaseRuntimeEnvironment = {
  APP_ORIGIN?: unknown;
  CALENOTE_RUNTIME_ENVIRONMENT?: unknown;
  CF_VERSION_METADATA?: unknown;
};

/** Reviewed application activation is tied to the serving immutable version.
 * AI_MODE=off still permits deterministic decisions on existing previews. */
export function contextRuntimeCapabilities(env:{CF_VERSION_METADATA?:unknown;OPENROUTER_PRIVACY_MODEL?:unknown;OPENROUTER_PRIVACY_PROVIDER?:unknown}):{contextContract?:'calenote-context-2';sourceSha?:string} {
 if(env.OPENROUTER_PRIVACY_MODEL!=='openai/gpt-5-mini'||env.OPENROUTER_PRIVACY_PROVIDER!=='azure/swedencentral')return {};
 const metadata=env.CF_VERSION_METADATA;
 if(!metadata||typeof metadata!=='object'||!('id'in metadata)||typeof metadata.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(metadata.id)
  ||!('tag'in metadata)||typeof metadata.tag!=='string'||!/^[a-f0-9]{40}$/u.test(metadata.tag))return {};
 return {contextContract:'calenote-context-2',sourceSha:metadata.tag};
}

/** Identity of the Worker answering this request, not upload time or global allocation. */
export function servingRelease(request: Request, env: ReleaseRuntimeEnvironment): ServingRelease {
  try { new URL(String(env.APP_ORIGIN)); } catch { return { status: 'UNKNOWN' }; }
  if (resolveRuntimeOriginPolicy(env,request)?.mode !== 'production') return { status: 'NON_PRODUCTION' };
  const metadata = env.CF_VERSION_METADATA;
  if (!metadata || typeof metadata !== 'object' || !('id' in metadata)
    || typeof metadata.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(metadata.id)) return { status: 'UNKNOWN' };
  const tag = 'tag' in metadata && typeof metadata.tag === 'string' && /^[a-f0-9]{40}$/u.test(metadata.tag) ? metadata.tag : null;
  const result=ServingReleaseSchema.safeParse({status:'SERVING',versionId:metadata.id,tag});
  return result.success?result.data:{status:'UNKNOWN'};
}
