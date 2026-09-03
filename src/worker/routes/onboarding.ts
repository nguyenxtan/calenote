import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import { parseOnboardingInput, RateLimitExceededError } from "@/modules/onboarding/service";
import type { WorkerOperations } from "../router";

const MAX_BODY_BYTES = 2_048;
const BODY_TIMEOUT_MS = 5_000;

export async function handleOnboarding(
  request: Request,
  appOrigin: string,
  createOperations: () => Promise<WorkerOperations>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const input = parseOnboardingInput(
    await readBoundedJson(request, MAX_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  const operations = await createOperations();
  const subject = request.headers.get("CF-Connecting-IP") ?? "anonymous";
  const subjectDigest = await operations.digestRateLimitSubject(
    `rate-limit:onboarding:${input.provider}:${subject}`,
  );
  const rate = await operations.consumeOnboardingRateLimit(subjectDigest);
  if (!rate.allowed) {
    throw new RateLimitExceededError(
      Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000)),
    );
  }

  const result = await operations.onboard(input);
  return jsonResponse(
    {
      data: {
        bot: result.bot,
        connectCommand: result.connectCommand,
        connectCodeExpiresAt: result.connectCodeExpiresAt,
        activationCode: result.activationCode,
      },
    },
    { status: 201, headers: { "set-cookie": result.sessionCookie } },
  );
}
