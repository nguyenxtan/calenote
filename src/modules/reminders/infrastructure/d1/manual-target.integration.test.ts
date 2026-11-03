// @vitest-environment node
import { expect,it } from 'vitest';
import { SqliteD1Database } from '@/testing/sqlite-d1.test-support';
import { createKeyring } from '@/modules/security/keyring';
import { createManualReminder } from '../../api-service';
import { D1ReminderApiStore } from './api-store';
it('requires an explicit owned active target for multiple bots and binds intent recovery to that target',async()=>{
 const db=new SqliteD1Database();
 try{
 db.sqlite.exec(`INSERT INTO users VALUES ('u','u@example.invalid','Fixture','Asia/Ho_Chi_Minh',1,1);
 INSERT INTO workspaces(id,kind,owner_user_id,created_at,updated_at) VALUES ('w','PERSONAL','u',1,1); INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES ('w','u','OWNER',1);
 INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES
 ('a','u','zalo','AAAAAAAAAAAAAAAAAAAAAA','ba','Zalo',x'01',x'02','fa',1,'ACTIVE_BOUND',1,1),
 ('b','u','telegram','CCCCCCCCCCCCCCCCCCCCCA','bb','Telegram',x'01',x'02','fb',1,'ACTIVE_BOUND',1,1);
 INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES ('ca','a','pa','pca',1),('cb','b','pb','pcb',1);`);
 const deps={store:new D1ReminderApiStore(db as unknown as D1Database),keyring:await createKeyring('A'.repeat(43)),rateLimitStore:{consume:async()=>({allowed:true,resetAt:100000})},now:()=>1000};
 const input={userId:'u',title:'Fixture',scheduledAt:60000,timezone:'Asia/Ho_Chi_Minh',intentId:'target_intent_12345'};
 await expect(createManualReminder(input,deps)).rejects.toMatchObject({code:'REMINDER_CHANNEL_UNAVAILABLE'});
 const targeted={...input,connectionPublicId:'CCCCCCCCCCCCCCCCCCCCCA'};
 const first=await createManualReminder(targeted,deps);
 expect(await createManualReminder(targeted,deps)).toEqual(first);
 expect(db.sqlite.prepare('SELECT chat_identity_id FROM reminders').get()).toEqual({chat_identity_id:'cb'});
 await expect(createManualReminder({...targeted,connectionPublicId:'AAAAAAAAAAAAAAAAAAAAAA'},deps)).rejects.toMatchObject({code:'REMINDER_INTENT_MISMATCH'});
 await expect(createManualReminder({...targeted,intentId:'missing_target_12345',connectionPublicId:'DDDDDDDDDDDDDDDDDDDDDA'},deps)).rejects.toMatchObject({code:'REMINDER_CHANNEL_UNAVAILABLE'});
 db.sqlite.exec("UPDATE bot_connections SET state='SUSPENDED' WHERE id='b'");
 await expect(createManualReminder({...targeted,intentId:'suspended_target_123'},deps)).rejects.toMatchObject({code:'REMINDER_CHANNEL_UNAVAILABLE'});
 expect(db.sqlite.prepare('SELECT COUNT(*) n FROM reminders').get()).toEqual({n:1});
 }finally{db.close();}
});
