import {
  PreferencesResponseSchema,
  UpdatePreferencesSchema,
} from "@/contracts/api/preferences";
import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from "@/modules/auth/session";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import { InvalidUserPreferencesError } from "@/modules/preferences/service";
import type { PreferencesOperations } from "./operations";

const UPDATE_BODY_BYTES = 2_048;
const BODY_TIMEOUT_MS = 5_000;

function authenticatedHeaders(): Headers {
  return new Headers({ vary: "Cookie" });
}

function requireCanonicalSession(request: Request): SessionCredentials {
  const credentials = parseSessionCredentials(request.headers.get("cookie"));
  if (!credentials) throw new SessionAuthError();
  return credentials;
}

export async function handleGetPreferences(
  request: Request,
  createOperations: () => Promise<Pick<PreferencesOperations, "requireUser" | "getPreferences">>,
): Promise<Response> {
  const credentials = requireCanonicalSession(request);
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const preferences = await operations.getPreferences(principal.userId);
  return jsonResponse(
    PreferencesResponseSchema.parse({ data: { preferences } }),
    { headers: authenticatedHeaders() },
  );
}

export async function handleUpdatePreferences(
  request: Request,
  appOrigin: string,
  createOperations: () => Promise<Pick<PreferencesOperations, "requireUser" | "savePreferences">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = requireCanonicalSession(request);
  const parsed = UpdatePreferencesSchema.safeParse(
    await readBoundedJson(request, UPDATE_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidUserPreferencesError("Preferences input is invalid");
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const preferences = await operations.savePreferences({ userId: principal.userId, preferences: parsed.data });
  return jsonResponse(
    PreferencesResponseSchema.parse({ data: { preferences } }),
    { headers: authenticatedHeaders() },
  );
}
