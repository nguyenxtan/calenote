import { expect, it } from "vitest";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { D1AccountService } from "./service";

it("updates real profile name, validates input and preserves email and other owner", async () => {
 const db=new SqliteD1Database();try {
 db.sqlite.exec("INSERT INTO users(id,email,display_name,timezone,created_at,updated_at) VALUES('a','a@example.test','A','Asia/Ho_Chi_Minh',1,1),('b','b@example.test','B','Asia/Ho_Chi_Minh',1,1)");
 const service=new D1AccountService(db as unknown as D1Database,()=>100);
 expect(await service.updateProfile('a',{displayName:'  Mai  '})).toEqual({displayName:'Mai',email:'a@example.test',timezone:'Asia/Ho_Chi_Minh'});
 expect((await service.getProfile('b')).displayName).toBe('B');
 for(const input of [{displayName:' '},{displayName:'a'.repeat(81)},{displayName:'Name',email:'new@example.test'}]) await expect(service.updateProfile('a',input)).rejects.toMatchObject({code:'INVALID_ACCOUNT_INPUT'});
 }finally{db.close();}
});
it("lists bounded active safe sessions and atomically revokes other owned sessions preserving current", async()=>{
 const db=new SqliteD1Database();try{
 db.sqlite.exec("INSERT INTO users(id,email,display_name,timezone,created_at,updated_at) VALUES('a','a@example.test','A','Asia/Ho_Chi_Minh',1,1),('b','b@example.test','B','Asia/Ho_Chi_Minh',1,1)");
 const insert=db.sqlite.prepare('INSERT INTO sessions(id,user_id,digest,expires_at,revoked_at,created_at) VALUES(?,?,?,?,?,?)');
 for(const [id,owner,expires,revoked] of [['current','a',200,null],['other','a',200,null],['foreign','b',200,null],['expired','a',100,null],['revoked','a',200,50]] as const)insert.run(id,owner,'digest-'+id,expires,revoked,1);
 const service=new D1AccountService(db as unknown as D1Database,()=>100);const principal={userId:'a',sessionId:'current'};
 expect(await service.listSessions(principal)).toEqual([{id:'current',createdAt:1,expiresAt:200,current:true},{id:'other',createdAt:1,expiresAt:200,current:false}]);
 expect(await service.revokeOtherSessions(principal)).toEqual({revoked:1});
 expect(await service.revokeOtherSessions(principal)).toEqual({revoked:0});
 expect(await service.listSessions(principal)).toHaveLength(1);
 expect(db.sqlite.prepare("SELECT revoked_at FROM sessions WHERE id='foreign'").get()).toEqual({revoked_at:null});
 db.sqlite.exec("UPDATE sessions SET revoked_at=99 WHERE id='current'; INSERT INTO sessions VALUES('new','a','newdigest',200,NULL,1)");
 await expect(service.revokeOtherSessions(principal)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 expect(db.sqlite.prepare("SELECT revoked_at FROM sessions WHERE id='new'").get()).toEqual({revoked_at:null});
 }finally{db.close();}
});
it('keeps the current session in a bounded list and never revokes on an expired or foreign current session',async()=>{
 const db=new SqliteD1Database();try{
 db.sqlite.exec("INSERT INTO users(id,email,display_name,timezone,created_at,updated_at) VALUES('a','a@example.test','A','Asia/Ho_Chi_Minh',1,1),('b','b@example.test','B','Asia/Ho_Chi_Minh',1,1)");
 const insert=db.sqlite.prepare('INSERT INTO sessions(id,user_id,digest,expires_at,revoked_at,created_at) VALUES(?,?,?,?,NULL,?)');
 insert.run('current','a','current-digest',1000,1);
 for(let i=0;i<110;i++)insert.run('session-'+i,'a','digest-'+i,1000,10+i);
 insert.run('expired','a','expired-digest',100,1);insert.run('foreign','b','foreign-digest',1000,1);
 const service=new D1AccountService(db as unknown as D1Database,()=>100);
 const listed=await service.listSessions({userId:'a',sessionId:'current'});expect(listed).toHaveLength(100);expect(listed[0]).toEqual({id:'current',createdAt:1,expiresAt:1000,current:true});
 expect(JSON.stringify(listed)).not.toMatch(/digest|foreign|expired/);
 for(const sessionId of ['expired','foreign','missing'])await expect(service.revokeOtherSessions({userId:'a',sessionId})).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 expect(db.sqlite.prepare("SELECT count(*) AS count FROM sessions WHERE user_id='a' AND revoked_at IS NOT NULL").get()).toEqual({count:0});
 expect(await service.revokeOtherSessions({userId:'a',sessionId:'current'})).toEqual({revoked:110});
 }finally{db.close();}
});
