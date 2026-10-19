import { AddConnectionInputSchema } from "@/modules/connections/add-service";
import { z } from "zod";
import { ConnectionsResponseSchema } from "@/contracts/api/connections";
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
  request:Request, appOrigin:string,
  createOperations:()=>Promise<Pick<ConnectionsOperations,"requireUser"|"addConnection">>,
):Promise<Response> {
  requireSameOrigin(request,appOrigin);
  const credentials=sessionCredentials(request);
  const parsed=AddConnectionInputSchema.safeParse(await readBoundedJson(request,MAX_BODY_BYTES,{timeoutMs:BODY_TIMEOUT_MS}));
  if (!parsed.success) throw new InvalidRequestError();
  const operations=await createOperations();
  const principal=await operations.requireUser(credentials);
  const result=await operations.addConnection({userId:principal.userId,...parsed.data});
  return jsonResponse({data:result},{status:201,headers:{vary:"Cookie"}});
}

export async function handleDisconnectConnection(
  request:Request,appOrigin:string,publicId:string,
  createOperations:()=>Promise<Pick<ConnectionsOperations,"requireUser"|"disconnectConnection">>,
):Promise<Response> {
  requireSameOrigin(request,appOrigin);
  const credentials=sessionCredentials(request);
  if (publicId.length!==22 || base64UrlToBytes(publicId)?.byteLength!==16) throw new InvalidRequestError();
  if (!emptyObjectSchema.safeParse(await readBoundedJson(request,MAX_BODY_BYTES,{timeoutMs:BODY_TIMEOUT_MS})).success) throw new InvalidRequestError();
  const operations=await createOperations();
  const principal=await operations.requireUser(credentials);
  const result=await operations.disconnectConnection({userId:principal.userId,publicId});
  return jsonResponse({data:result},{headers:{vary:"Cookie"}});
}

export async function handleGetPrimaryLogin(request:Request,createOperations:()=>Promise<Pick<ConnectionsOperations,"requireUser"|"getPrimaryLogin">>):Promise<Response>{
 const credentials=sessionCredentials(request);const operations=await createOperations();const principal=await operations.requireUser(credentials);
 return jsonResponse({data:await operations.getPrimaryLogin(principal.userId)},{headers:{vary:"Cookie"}});
}
export async function handleSelectPrimaryLogin(request:Request,appOrigin:string,createOperations:()=>Promise<Pick<ConnectionsOperations,"requireUser"|"selectPrimaryLogin">>):Promise<Response>{
 requireSameOrigin(request,appOrigin);const credentials=sessionCredentials(request);
 const parsed=z.object({publicId:z.string().length(22).refine(value=>base64UrlToBytes(value)?.byteLength===16)}).strict().safeParse(await readBoundedJson(request,MAX_BODY_BYTES,{timeoutMs:BODY_TIMEOUT_MS}));
 if(!parsed.success)throw new InvalidRequestError();const operations=await createOperations();const principal=await operations.requireUser(credentials);
 return jsonResponse({data:await operations.selectPrimaryLogin({userId:principal.userId,publicId:parsed.data.publicId})},{headers:{vary:"Cookie"}});
}
