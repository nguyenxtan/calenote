// @vitest-environment node
import {expect,it,vi} from "vitest";
import {handleContinueEmail} from "./auth-continue";
const origin="https://calenote.example";
function request(body:unknown,requestOrigin=origin) {return new Request(`${origin}/api/auth/continue`,{method:"POST",headers:{origin:requestOrigin,"content-type":"application/json","CF-Connecting-IP":"192.0.2.1"},body:JSON.stringify(body)});}
it("returns only the strict next step and normalized input with no cookie",async()=>{
 const continueEmail=vi.fn(async()=>({next:"SETUP" as const}));
 const response=await handleContinueEmail(request({email:" NEW@example.com "}),origin,async()=>({continueEmail}));
 expect(await response.json()).toEqual({data:{next:"SETUP"}});
 expect(response.headers.get("set-cookie")).toBeNull();
 expect(continueEmail).toHaveBeenCalledWith({email:"new@example.com",clientIp:"192.0.2.1"});
});
it("rejects cross origin, extra fields and oversized bodies before operations",async()=>{
 const factory=vi.fn();
 await expect(handleContinueEmail(request({email:"x@example.com"},"https://evil.example"),origin,factory)).rejects.toMatchObject({status:403});
 await expect(handleContinueEmail(request({email:"x@example.com",userId:"u"}),origin,factory)).rejects.toBeDefined();
 await expect(handleContinueEmail(request({email:"x".repeat(2000)}),origin,factory)).rejects.toBeDefined();
 expect(factory).not.toHaveBeenCalled();
});
