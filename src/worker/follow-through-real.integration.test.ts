// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {fixture} from '@/modules/conversation/context-contract/infrastructure/d1/test-support';
import {prepareSession} from '@/modules/auth/session';
import {createRouter} from './router';
it('runs follow-through through the actual Worker session, keyring and migrated SQLite with safe retry and scope',async()=>{
 const h=await fixture();try {
 h.sqlite!.sqlite.exec(readFileSync('migrations/0014_reminder_follow_through.sql','utf8'));
 const now=Date.now(),session=await prepareSession('owner',{keyring:h.keyring});
 await h.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,NULL,?)').bind(session.record.id,'owner',session.record.digest,session.record.expiresAt,now).run();
 const title=await h.keyring.encryptSensitive('reminder-title','route-root',1,'Private work');
 await h.db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES('route-root','route-public','workspace','identity',?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',?,?)").bind(title.ciphertext,title.iv,now+60000,now,now).run();
 const origin='https://calenote.iconiclogs.com',send=vi.fn(),route=createRouter(),ctx={waitUntil:vi.fn()} as unknown as ExecutionContext;
 const env={DB:h.db,CALENOTE_MASTER_KEY:'A'.repeat(43),APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',JOBS:{send},ASSETS:{fetch:vi.fn()}} as unknown as Env;
 const req=(path:string,body?:unknown)=>new Request(origin+path,{method:body?'POST':'GET',headers:{origin,cookie:session.cookie.split(';')[0],'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 let r=await route(req('/api/v1/follow-through'),env,ctx);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');
 const listed=await r.json() as {data:{items:{publicId:string;progress:string;revision:number}[]}};expect(listed.data.items[0]).toMatchObject({publicId:'route-public',progress:'OPEN',revision:0});
 r=await route(req('/api/v1/follow-through/history?publicId=route-public'),env,ctx);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({data:{history:[{publicId:'route-public'}]}});
 r=await route(req('/api/v1/follow-through/history?publicId=foreign'),env,ctx);expect(r.status).toBe(404);
 r=await route(req('/api/v1/follow-through/history?publicId=route-public&cursor=bad'),env,ctx);expect(r.status).toBe(400);
 const action={action:'DONE',publicId:'route-public',expectedRevision:0,idempotencyKey:'route-done'};
 r=await route(req('/api/v1/follow-through/actions',action),env,ctx);expect(r.status).toBe(200);const result=await r.json();expect(result).toMatchObject({data:{item:{progress:'DONE',revision:1}}});
 r=await route(req('/api/v1/follow-through/actions',action),env,ctx);expect(r.status).toBe(200);expect(await r.json()).toEqual(result);
 r=await route(req('/api/v1/follow-through/actions',{...action,action:'STOP'}),env,ctx);expect(r.status).toBe(409);
 r=await route(req('/api/v1/follow-through/actions',{...action,publicId:'foreign',idempotencyKey:'other'}),env,ctx);expect(r.status).toBe(404);
 // Rate limiting is evaluated after session ownership and before mutation.
 let limited:Response|undefined;
 for(let index=0;index<61;index++) {limited=await route(req('/api/v1/follow-through/actions',action),env,ctx);if(limited.status===429)break;}
 expect(limited?.status).toBe(429);expect(limited?.headers.has('retry-after')).toBe(true);
 expect(await h.db.prepare('SELECT count(*) FROM follow_through_action_receipts').first('count(*)')).toBe(1);
 expect(send).not.toHaveBeenCalled();
 }finally{h.close();}
});
