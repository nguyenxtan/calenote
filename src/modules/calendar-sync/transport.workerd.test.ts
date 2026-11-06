// @vitest-environment node
import { createRequire } from 'node:module';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { expect, it } from 'vitest';

const require=createRequire(import.meta.url);
// Reuse Wrangler's installed bundler; no new dependency or generated fixture source.
const {buildSync}=require(require.resolve('esbuild',{paths:[require.resolve('wrangler')]})) as {buildSync(options:Record<string,unknown>):{outputFiles:{text:string}[]}};

it('actual Workerd accepts provider request options and never follows credential-bearing redirects',async()=>{
 const script=buildSync({stdin:{contents:`
  import {GoogleCalendarProvider} from './src/modules/calendar-sync/google-provider';
  import {executeProviderRequest,postSecretProviderJson} from './src/modules/connections/providers/secret-provider-transport';
  export default {async fetch(request){
   const path=new URL(request.url).pathname;
   if(path==='/probe'){
    let errorRejected=false;try{new Request('https://local.invalid/',{redirect:'error'});}catch(error){errorRejected=error instanceof TypeError;}
    return Response.json({errorRejected,manual:new Request('https://local.invalid/',{redirect:'manual'}).redirect});
   }
   try{
    if(path==='/telegram'){
     const result=await executeProviderRequest({provider:'telegram',hostname:'api.telegram.org',path:'/botfixture/getMe',operation:'getMe'},(url,init)=>fetch(new Request(url,init)));
     return Response.json({ok:result.statusCode===200});
    }
    if(path==='/telegram-redirect'){
     await postSecretProviderJson({provider:'telegram',hostname:'api.telegram.org',path:'/botfixture/sendMessage',operation:'sendMessage'},input=>executeProviderRequest(input,(url,init)=>fetch(new Request(url,init))));
     return Response.json({ok:true});
    }
    const p=new GoogleCalendarProvider({clientId:'fixture-client',clientSecret:'fixture-secret',appOrigin:'https://calenote.test'},(url,init)=>fetch(new Request(url,init)));
    if(path==='/google-token')await p.exchangeCode('fixture-code',1000);else await p.createCalendar('fixture-access');
    return Response.json({ok:true});
   }catch(error){return Response.json({ok:false,kind:error.kind??error.code??'OTHER'});}
  }};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false}).outputFiles[0].text;
 const calls:{hostname:string;path:string;method:string;authorization:boolean}[]=[];let redirect=false;
 const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-09-03',port:0,
  outboundService:async(request:Request)=>{
   const url=new URL(request.url);calls.push({hostname:url.hostname,path:url.pathname,method:request.method,authorization:request.headers.has('authorization')});
   // All egress terminates in this local Node handler. No unmocked network is possible.
   if(redirect)return new Response(null,{status:302,headers:{location:'https://redirect-target.invalid/never-follow'}});
   if(url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token')return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,token_type:'Bearer',scope:'https://www.googleapis.com/auth/calendar.app.created'});
   if(url.hostname==='www.googleapis.com'&&url.pathname==='/calendar/v3/calendars')return Response.json({id:'fixture-calendar'});
   if(url.hostname==='api.telegram.org')return Response.json({ok:true});
   throw new Error('Unexpected local mock request');
  }}));
 try{
  expect(await (await runtime.dispatchFetch('https://local.invalid/probe')).json()).toEqual({errorRejected:true,manual:'manual'});
  expect(await (await runtime.dispatchFetch('https://local.invalid/google-token')).json()).toEqual({ok:true});
  expect(await (await runtime.dispatchFetch('https://local.invalid/google-calendar')).json()).toEqual({ok:true});
  expect(await (await runtime.dispatchFetch('https://local.invalid/telegram')).json()).toEqual({ok:true});
  redirect=true;
  expect(await (await runtime.dispatchFetch('https://local.invalid/google-calendar')).json()).toEqual({ok:false,kind:'UNKNOWN'});
  expect(await (await runtime.dispatchFetch('https://local.invalid/telegram-redirect')).json()).toEqual({ok:false,kind:'UNCERTAIN'});
  expect(calls).toEqual([
   {hostname:'oauth2.googleapis.com',path:'/token',method:'POST',authorization:false},
   {hostname:'www.googleapis.com',path:'/calendar/v3/calendars',method:'POST',authorization:true},
   {hostname:'api.telegram.org',path:'/botfixture/getMe',method:'POST',authorization:false},
   {hostname:'www.googleapis.com',path:'/calendar/v3/calendars',method:'POST',authorization:true},
   {hostname:'api.telegram.org',path:'/botfixture/sendMessage',method:'POST',authorization:false},
  ]);
 }finally{await runtime.dispose();}
},30000);
