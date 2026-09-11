import { ActivityResponseSchema } from "@/contracts/api/activity";
import { parseSessionCredentials, SessionAuthError } from "@/modules/auth/session";
import { jsonResponse } from "@/modules/http/security";
import type { ActivityOperations } from "./operations";
export async function handleListActivity(request:Request,create:()=>Promise<ActivityOperations>):Promise<Response>{const credentials=parseSessionCredentials(request.headers.get("cookie"));if(!credentials)throw new SessionAuthError();const ops=await create();const principal=await ops.requireUser(credentials);return jsonResponse(ActivityResponseSchema.parse({data:{activities:await ops.listActivity(principal.userId)}}),{headers:{vary:"Cookie"}})}
