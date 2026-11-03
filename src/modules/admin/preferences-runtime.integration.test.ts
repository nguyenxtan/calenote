// @vitest-environment node
import { expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRouter } from '@/worker/router';
import { createKeyring } from '@/modules/security/keyring';
import { prepareSession } from '@/modules/auth/session';
import { SqliteD1Database } from '@/testing/sqlite-d1.test-support';
it('persists the owner confirmation policy through actual session and Worker preferences routes',async()=>{
 const db=new SqliteD1Database({conversationV2:true});
 try{
 if(!(db.sqlite.prepare('PRAGMA table_info(user_preferences)').all() as {name:string}[]).some(c=>c.name==='reminder_confirmation')) db.sqlite.exec(readFileSync('migrations/0012_user_preferences_reminder_confirmation.sql','utf8'));
 const now=Date.now(),master='A'.repeat(43),keyring=await createKeyring(master);
 db.sqlite.prepare("INSERT INTO users VALUES ('policy-owner','fixture@example.invalid','Fixture','Asia/Ho_Chi_Minh',?,?)").run(now,now);
 const session=await prepareSession('policy-owner',{keyring,now:()=>now});
 db.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?,NULL,?)').run(session.record.id,'policy-owner',session.record.digest,session.record.expiresAt,now);
 const env={APP_ORIGIN:'https://calenote.iconiclogs.com',CALENOTE_RUNTIME_ENVIRONMENT:'production',DB:db,JOBS:{send:async()=>{}},ASSETS:{fetch:async()=>new Response('fixture')},CALENOTE_MASTER_KEY:master} as unknown as Env;
 const router=createRouter(),cookie=session.cookie.split(';')[0],url='https://calenote.iconiclogs.com/api/preferences';
 const read=()=>router(new Request(url,{headers:{cookie}}),env,{} as ExecutionContext);
 expect(await (await read()).json()).toMatchObject({data:{preferences:{reminderConfirmation:'auto'}}});
 const write=await router(new Request(url,{method:'PATCH',headers:{cookie,origin:'https://calenote.iconiclogs.com','content-type':'application/json'},body:JSON.stringify({reminderConfirmation:'preview'})}),env,{} as ExecutionContext);
 expect(write.status).toBe(200);expect(await write.json()).toMatchObject({data:{preferences:{reminderConfirmation:'preview'}}});
 expect(await (await read()).json()).toMatchObject({data:{preferences:{reminderConfirmation:'preview'}}});
 const other=await router(new Request(url),env,{} as ExecutionContext);expect(other.status).toBe(401);
 }finally{db.close();}
});
