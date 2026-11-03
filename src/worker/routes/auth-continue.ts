import { ContinueEmailRequestSchema, ContinueEmailResponseSchema, type AuthNextStep } from "@/contracts/api/auth-continue";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import { InvalidRequestError } from "./connections";
export interface EmailDiscoveryOperations { continueEmail(input:{email:string;clientIp:string}):Promise<{next:AuthNextStep}>; }
export async function handleContinueEmail(request:Request,appOrigin:string,createOperations:()=>Promise<EmailDiscoveryOperations>):Promise<Response> {
 requireSameOrigin(request,appOrigin);
 const parsed=ContinueEmailRequestSchema.safeParse(await readBoundedJson(request,1024,{timeoutMs:5000}));
 if(!parsed.success) throw new InvalidRequestError();
 const operations=await createOperations();
 const result=await operations.continueEmail({email:parsed.data.email,clientIp:request.headers.get("CF-Connecting-IP")??"unavailable"});
 return jsonResponse(ContinueEmailResponseSchema.parse({data:result}));
}
