import { parseSessionCredentials, SessionAuthError } from "@/modules/auth/session";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import { PreviewDecisionRequestV1Schema, PreviewDecisionResponseV1Schema, PreviewResponseV1Schema } from "@/contracts/api/conversation-previews";
import type { ContextApiOperations } from "./operations";
import { InvalidRequestError } from "./connections";

export class PreviewUnavailableError extends Error {
  readonly code = "PREVIEW_UNAVAILABLE";
  readonly status = 409;
  constructor() { super("Xác nhận bản xem trước hiện chưa khả dụng."); }
}

export async function handleConversationPreviews(request: Request, appOrigin: string, createOperations: () => Promise<ContextApiOperations>): Promise<Response> {
  if (request.method === "POST") requireSameOrigin(request, appOrigin);
  const credentials = parseSessionCredentials(request.headers.get("cookie"));
  if (!credentials) throw new SessionAuthError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  if (request.method === "GET") {
    const listed = await operations.listPreviews(principal);
    return jsonResponse(PreviewResponseV1Schema.parse({ data: { schemaVersion: "conversation-previews-1", ...listed } }), { headers: { vary: "Cookie" } });
  }
  const parsed = PreviewDecisionRequestV1Schema.safeParse(await readBoundedJson(request, 2048, { timeoutMs: 5000 }));
  if (!parsed.success) throw new InvalidRequestError();
  const result = await operations.decidePreview(principal, parsed.data);
  if (!["COMMITTED", "IDEMPOTENT", "DECLINED", "ALREADY_DECLINED"].includes(result.status)) {
    return jsonResponse({ error: { code: `PREVIEW_${result.status}`, message: "Bản xem trước đã thay đổi hoặc chưa thể xác nhận. Vui lòng tải lại." } },
      { status: 409, headers: { vary: "Cookie" } });
  }
  return jsonResponse(PreviewDecisionResponseV1Schema.parse({ data: { result: result.status,
    ...("reminderPublicIds" in result ? { reminderPublicIds: result.reminderPublicIds, seriesPublicId: result.seriesPublicId, childCount: result.childCount } : {}) } }),
    { headers: { vary: "Cookie" } });
}
