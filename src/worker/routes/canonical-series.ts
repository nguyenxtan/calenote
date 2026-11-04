import { CanonicalSeriesCancelRequestSchema, CanonicalSeriesCancelResponseSchema, CanonicalSeriesListResponseSchema } from "@/contracts/api/canonical-series";
import { parseSessionCredentials, SessionAuthError } from "@/modules/auth/session";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import { InvalidRequestError } from "./connections";
import type { CanonicalSeriesOperations } from "./operations";

/** The selected context-contract runtime is absent; nothing was read or changed. */
export class CanonicalSeriesUnavailableError extends Error {
  readonly code = "SERIES_UNAVAILABLE";
  readonly status = 409;
  constructor() { super("Quản lý chuỗi nhắc hiện chưa khả dụng."); }
}

const statusFor = { CANCELLED: 200, ALREADY_CANCELLED: 200, CONFLICT: 409, NOT_FOUND: 404 } as const;

export async function handleCanonicalSeries(request: Request, appOrigin: string, createOperations: () => Promise<CanonicalSeriesOperations>): Promise<Response> {
  if (request.method === "POST") requireSameOrigin(request, appOrigin);
  const credentials = parseSessionCredentials(request.headers.get("cookie"));
  if (!credentials) throw new SessionAuthError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const headers = { vary: "Cookie" };
  if (request.method === "GET") {
    return jsonResponse(CanonicalSeriesListResponseSchema.parse({ data: { schemaVersion: "canonical-series-1", series: await operations.listSeries(principal) } }), { headers });
  }
  const parsed = CanonicalSeriesCancelRequestSchema.safeParse(await readBoundedJson(request, 512, { timeoutMs: 5000 }));
  if (!parsed.success) throw new InvalidRequestError();
  const result = await operations.cancelSeries(principal, parsed.data);
  return jsonResponse(CanonicalSeriesCancelResponseSchema.parse({ data: result }), { status: statusFor[result.result], headers });
}
