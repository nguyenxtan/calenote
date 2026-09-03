import { z } from "zod";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import { OnboardingInputError } from "@/modules/onboarding/service";
import type { WorkerOperations } from "../router";

const MAX_BODY_BYTES = 2_048;
const emptyObjectSchema = z.object({}).strict();

export async function handleConnectCodeRotation(
  request: Request,
  appOrigin: string,
  publicId: string,
  operations: WorkerOperations,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const principal = await operations.requireUser(request);
  const parsed = emptyObjectSchema.safeParse(await readBoundedJson(request, MAX_BODY_BYTES));
  if (!parsed.success) throw new OnboardingInputError();

  const result = await operations.rotateConnectCode({ userId: principal.userId, publicId });
  return jsonResponse({ data: { connectCommand: result.command, expiresAt: result.expiresAt } });
}
