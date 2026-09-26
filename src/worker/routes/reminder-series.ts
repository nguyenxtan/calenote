import { SeriesDecisionRequestSchema, SeriesResponseSchema, SeriesDecisionResponseSchema } from "@/contracts/api/reminder-series";
import { parseSessionCredentials, SessionAuthError } from "@/modules/auth/session";
import { readBoundedJson } from "@/modules/http/body";
import { requireSameOrigin, jsonResponse } from "@/modules/http/security";
import { InvalidRequestError } from "./connections";
import type { SeriesOperations } from "./operations";
export async function handleSeries(request: Request, appOrigin: string, createOperations: () => Promise<SeriesOperations>) {
  if (request.method === "POST") requireSameOrigin(request, appOrigin);
  const credentials = parseSessionCredentials(request.headers.get("cookie")); if (!credentials) throw new SessionAuthError();
  const operations = await createOperations(); const principal = await operations.requireUser(credentials);
  const headers = { vary: "Cookie" };
  if (request.method === "GET") return jsonResponse(SeriesResponseSchema.parse({ data: { series: await operations.listSeries(principal) } }), { headers });
  const parsed = SeriesDecisionRequestSchema.safeParse(await readBoundedJson(request, 1024, { timeoutMs: 5000 }));
  if (!parsed.success) throw new InvalidRequestError();
  const result = await operations.decideSeries(principal, parsed.data);
  return jsonResponse(SeriesDecisionResponseSchema.parse({ data: { result } }), { status: result === "STALE" ? 409 : 200, headers });
}
