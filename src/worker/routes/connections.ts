import { ConnectionNotFoundError } from "@/modules/onboarding/service";
import { AddConnectionInputSchema } from "@/modules/connections/add-service";
import { z } from "zod";
import { ConnectionsResponseSchema, PublicConnectionSchema } from "@/contracts/api/connections";
import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from "@/modules/auth/session";
import { base64UrlToBytes } from "@/modules/security/encoding";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import type { ConnectionsOperations } from "./operations";

const MAX_BODY_BYTES = 2_048;
const BODY_TIMEOUT_MS = 5_000;
const emptyObjectSchema = z.object({}).strict();

function sessionCredentials(request: Request): SessionCredentials {
  const credentials = parseSessionCredentials(request.headers.get("cookie"));
  if (!credentials) throw new SessionAuthError();
  return credentials;
}

export class InvalidRequestError extends Error {
  readonly code = "INVALID_REQUEST";
  readonly status = 400;

  constructor() {
    super("Yêu cầu không hợp lệ.");
    this.name = "InvalidRequestError";
  }
}

export async function handleConnectCodeRotation(
  request: Request,
  appOrigin: string,
  publicId: string,
  createOperations: () => Promise<Pick<ConnectionsOperations, "requireUser" | "rotateConnectCode">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = sessionCredentials(request);
  const publicIdBytes = base64UrlToBytes(publicId);
  if (publicId.length !== 22 || publicIdBytes?.byteLength !== 16) throw new InvalidRequestError();
  const parsed = emptyObjectSchema.safeParse(
    await readBoundedJson(request, MAX_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);

  const result = await operations.rotateConnectCode({ userId: principal.userId, publicId });
  return jsonResponse(
    { data: { connectCommand: result.command, expiresAt: result.expiresAt } },
    { headers: { vary: "Cookie" } },
  );
}

export async function handleListConnections(
  request: Request,
  createOperations: () => Promise<Pick<ConnectionsOperations, "requireUser" | "listConnections">>,
): Promise<Response> {
  const credentials = sessionCredentials(request);
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const connections = await operations.listConnections(principal.userId);
  return jsonResponse(
    ConnectionsResponseSchema.parse({ data: { connections } }),
    { headers: { vary: "Cookie" } },
  );
}

export async function handleWebhookRetry(
  request: Request,
  appOrigin: string,
  publicId: string,
  createOperations: () => Promise<Pick<ConnectionsOperations, "requireUser" | "retryWebhook">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = sessionCredentials(request);
  const publicIdBytes = base64UrlToBytes(publicId);
  if (publicId.length !== 22 || publicIdBytes?.byteLength !== 16) throw new InvalidRequestError();
  const parsed = emptyObjectSchema.safeParse(
    await readBoundedJson(request, MAX_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const result = await operations.retryWebhook({ userId: principal.userId, publicId });
  return jsonResponse({ data: result }, { headers: { vary: "Cookie" } });
}

export async function handleAddConnection(
  request: Request,
  appOrigin: string,
  createOperations: () => Promise<Pick<ConnectionsOperations, "requireUser" | "addConnection">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = sessionCredentials(request);
  const parsed = AddConnectionInputSchema.safeParse(
    await readBoundedJson(request, MAX_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const result = await operations.addConnection({ ...parsed.data, userId: principal.userId });
  return jsonResponse({ data: result }, { status: 201, headers: { vary: "Cookie" } });
}

export async function handleGetLoginChannel(request: Request, createOperations: () => Promise<Pick<ConnectionsOperations,"requireUser"|"getLoginChannel">>): Promise<Response> {
  const credentials=sessionCredentials(request);
  const operations=await createOperations();const principal=await operations.requireUser(credentials);
  const connection=await operations.getLoginChannel(principal.userId);
  return jsonResponse({data:{connection:connection?PublicConnectionSchema.parse(connection):null}},{headers:{vary:"Cookie"}});
}
export async function handleSelectLoginChannel(request:Request,appOrigin:string,publicId:string,createOperations:()=>Promise<Pick<ConnectionsOperations,"requireUser"|"selectLoginChannel">>):Promise<Response> {
  requireSameOrigin(request,appOrigin);const credentials=sessionCredentials(request);
  if(publicId.length!==22 || base64UrlToBytes(publicId)?.byteLength!==16) throw new InvalidRequestError();
  if(!emptyObjectSchema.safeParse(await readBoundedJson(request,MAX_BODY_BYTES,{timeoutMs:BODY_TIMEOUT_MS})).success) throw new InvalidRequestError();
  const operations=await createOperations();const principal=await operations.requireUser(credentials);
  const connection=await operations.selectLoginChannel({userId:principal.userId,publicId});
  return jsonResponse({data:{connection:PublicConnectionSchema.parse(connection)}},{headers:{vary:"Cookie"}});
}

const lifecycleCasSchema=z.object({authRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),primary:z.object({revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),generation:z.string().regex(/^[a-f0-9]{32}$/u)}).strict().nullable()}).strict();
export async function handleLifecycle(request:Request,appOrigin:string,publicId:string,paused:boolean|null,createOperations:()=>Promise<Pick<ConnectionsOperations,"requireUser"|"getLifecycle"|"changeLifecycle">>):Promise<Response> {
  if(paused!==null) requireSameOrigin(request,appOrigin);
  const credentials=sessionCredentials(request);
  if(publicId.length!==22 || base64UrlToBytes(publicId)?.byteLength!==16) throw new InvalidRequestError();
  const body=paused===null?null:lifecycleCasSchema.safeParse(await readBoundedJson(request,MAX_BODY_BYTES,{timeoutMs:BODY_TIMEOUT_MS}));
  if(body && !body.success) throw new InvalidRequestError();
  const operations=await createOperations();const principal=await operations.requireUser(credentials);
  const result=paused===null?await operations.getLifecycle(principal.userId,publicId):await operations.changeLifecycle({userId:principal.userId,publicId,paused,expected:body!.data!});
  if(!result) throw new ConnectionNotFoundError();
  return jsonResponse({data:{lifecycle:result}},{headers:{vary:"Cookie"}});
}
