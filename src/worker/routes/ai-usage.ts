import {AiUsageResponseSchema} from '@/contracts/api/ai-usage';
import {parseSessionCredentials,SessionAuthError} from '@/modules/auth/session';
import {jsonResponse} from '@/modules/http/security';
import type {AiUsageOperations} from './operations';
export async function handleAiUsage(request:Request,createOperations:()=>Promise<AiUsageOperations>):Promise<Response>{
 const credentials=parseSessionCredentials(request.headers.get('cookie'));if(!credentials)throw new SessionAuthError();
 const operations=await createOperations(),principal=await operations.requireUser(credentials);
 return jsonResponse(AiUsageResponseSchema.parse({data:await operations.readUsage(principal)}),{headers:{vary:'Cookie'}});
}
