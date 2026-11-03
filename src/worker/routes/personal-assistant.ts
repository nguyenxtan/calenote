import { z } from 'zod';
import { PersonalAssistantDocumentSchema, PersonalAssistantEnvelopeSchema } from '@/contracts/api/personal-assistant';
import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from '@/modules/auth/session';
import { readBoundedJson } from '@/modules/http/body';
import { jsonResponse, requireSameOrigin } from '@/modules/http/security';
import { PersonalAssistantError, type D1PersonalAssistantStore } from '@/modules/personal-assistant/store';

export interface PersonalAssistantOperations {
  requireUser(credentials: SessionCredentials): Promise<{userId: string}>;
  store: Pick<D1PersonalAssistantStore, 'get' | 'put'>;
  consume(userId: string): Promise<void>;
  getBrief?(userId: string): Promise<PersonalAssistantBrief>;
}
type Factory = () => Promise<PersonalAssistantOperations>;
const headers = {vary: 'Cookie'};
const PutSchema = z.object({expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), document: PersonalAssistantDocumentSchema}).strict();
function credentials(request: Request) {
  const auth = parseSessionCredentials(request.headers.get('cookie'));
  if (!auth) throw new SessionAuthError();
  return auth;
}
function failure(error: unknown): Response {
  if (!(error instanceof PersonalAssistantError)) throw error;
  return jsonResponse({error: {code: error.code, message: error.message}}, {status: error.status, headers});
}
export async function handleGetPersonalAssistant(request: Request, create: Factory) {
  const auth = credentials(request), ops = await create(), principal = await ops.requireUser(auth);
  await ops.consume(principal.userId);
  try { return jsonResponse({data: PersonalAssistantEnvelopeSchema.parse(await ops.store.get(principal.userId))}, {headers}); }
  catch (error) { return failure(error); }
}
export async function handlePutPersonalAssistant(request: Request, origin: string, create: Factory) {
  requireSameOrigin(request, origin);
  const auth = credentials(request);
  const parsed = PutSchema.safeParse(await readBoundedJson(request, 128 * 1024, {timeoutMs: 5000}));
  if (!parsed.success) return jsonResponse({error: {code: 'INVALID', message: 'Dữ liệu trợ lý chưa hợp lệ.'}}, {status: 400, headers});
  const ops = await create(), principal = await ops.requireUser(auth);
  await ops.consume(principal.userId);
  try { return jsonResponse({data: PersonalAssistantEnvelopeSchema.parse(await ops.store.put(principal.userId, parsed.data.expectedRevision, parsed.data.document))}, {headers}); }
  catch (error) { return failure(error); }
}

export interface PersonalAssistantBrief {
  date: string;
  openCount: number;
  overdueCount: number;
  doneTodayCount: number;
  next: {title: string; scheduledAt: number}[];
}
const BriefSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  openCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  doneTodayCount: z.number().int().nonnegative(),
  next: z.array(z.object({title: z.string().max(2000), scheduledAt: z.number().int().safe()}).strict()).max(5),
}).strict();
export async function handleGetPersonalAssistantBrief(request: Request, create: Factory) {
  const auth = credentials(request), ops = await create(), principal = await ops.requireUser(auth);
  await ops.consume(principal.userId);
  try {
    if (!ops.getBrief) throw new PersonalAssistantError('BLOCKED');
    const parsed = BriefSchema.safeParse(await ops.getBrief(principal.userId));
    if (!parsed.success) throw new PersonalAssistantError('BLOCKED');
    return jsonResponse({data: parsed.data}, {headers});
  } catch (error) { return failure(error); }
}
