// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions,Response as LocalResponse,type V4FetchHandler} from 'miniflare';

const require=createRequire(import.meta.url);
const {buildSync}=createRequire(require.resolve('wrangler'))('esbuild');
const bundled=buildSync({bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:*'],tsconfig:resolve('tsconfig.json'),logLevel:'silent',
  stdin:{resolveDir:process.cwd(),sourcefile:'context-http-worker.ts',loader:'ts',contents:`
    import {createContextHttpTransport} from './src/modules/intelligence/infrastructure/openrouter/semantic-gateway';
    export default {async fetch(){
      try{
        const result=await createContextHttpTransport('synthetic-workerd-key')({
          model:'synthetic/model',stream:false,messages:[{role:'system',content:'synthetic'},{role:'user',content:'{"turns":[]}'}],
          response_format:{type:'json_schema',json_schema:{name:'synthetic',strict:true,schema:{type:'object',properties:{},additionalProperties:false}}},
          provider:{only:['azure/swedencentral'],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true,max_price:{prompt:.275,completion:2.2}}
        },{signal:new AbortController().signal});
        return Response.json({status:result.status,body:result.body,httpStatus:result.failureDiagnostics?.httpStatus??null});
      }catch(error){return Response.json({failure:error.name});}
    }};
  `}}) as {outputFiles:Array<{text:string}>};
const runtimes:Miniflare[]=[];
afterEach(async()=>{await Promise.all(runtimes.splice(0).map(runtime=>runtime.dispose()));});

async function runtime(status:number){
  const requests:Array<{url:string;method:string;authorization:string|null}>=[];
  const outbound:V4FetchHandler=async request=>{
    requests.push({url:request.url,method:request.method,authorization:request.headers.get('authorization')});
    return new LocalResponse(status===200?'{}':'', {status,headers:{'content-type':'application/json',...(status>=300&&status<400?{location:'https://unexpected.example.test/redirect-target'}:{})}});
  };
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-03',compatibilityFlags:['nodejs_compat'],outboundService:outbound,port:0}));
  runtimes.push(mf);return {mf,requests};
}

it('the actual Cloudflare transport sends one request successfully under workerd',async()=>{
  const {mf,requests}=await runtime(200);
  const response=await(await mf.dispatchFetch('https://local.example.test/')).json();
  expect({response,requests}).toEqual({response:{status:200,body:'{}',httpStatus:null},requests:[{url:'https://openrouter.ai/api/v1/chat/completions',method:'POST',authorization:'Bearer synthetic-workerd-key'}]});
});

it.each([301,302,307,308])('returns HTTP%i without following the redirect or forwarding credentials',async status=>{
  const {mf,requests}=await runtime(status);
  expect(await(await mf.dispatchFetch('https://local.example.test/')).json()).toEqual({status,body:'',httpStatus:status});
  expect(requests).toEqual([{url:'https://openrouter.ai/api/v1/chat/completions',method:'POST',authorization:'Bearer synthetic-workerd-key'}]);
});
