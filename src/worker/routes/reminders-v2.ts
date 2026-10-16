import { parseSessionCredentials, SessionAuthError } from "@/modules/auth/session";
import { ReminderListResponseV2Schema } from "@/contracts/api/reminders-v2";
import { jsonResponse } from "@/modules/http/security";
import type { ContextApiOperations } from "./operations";

export async function handleListRemindersV2(request: Request, createOperations: () => Promise<ContextApiOperations>): Promise<Response> {
  const credentials = parseSessionCredentials(request.headers.get("cookie"));
  if (!credentials) throw new SessionAuthError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const data = await operations.listDetailedReminders(principal);
  return jsonResponse(ReminderListResponseV2Schema.parse({ data }), { headers: { vary: "Cookie" } });
}
