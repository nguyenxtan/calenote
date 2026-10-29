import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { PrimaryLoginPanel } from '@/features/final-screens/PrimaryLoginPanel';
import { SqliteD1Database, deterministicRandomBytes } from '@/testing/sqlite-d1.test-support';
import { prepareSession } from '@/modules/auth/session';
import { createKeyring } from '@/modules/security/keyring';
import { createConnectionsOperations } from '@/worker/composition-root';
import { createRouter } from '@/worker/router';
const replace=vi.fn();vi.mock('next/navigation',()=>({useRouter:()=>({replace})}));
it('selects both providers through authenticated routes and SQLite without provider calls',async()=>{
 const db=new SqliteD1Database();const now=Date.now();const master='A'.repeat(43);const keyring=await createKeyring(master);
 try {
 db.sqlite.prepare("INSERT INTO users VALUES (?,?,?,'Asia/Ho_Chi_Minh',?,?)").run('owner','synthetic@example.invalid','Synthetic',now,now);
 for(const [id,provider,name] of [['bot-a','telegram','Telegram local'],['bot-b','zalo','Zalo local']]){
 const encrypted=await keyring.encryptCredential(id,provider as 'telegram'|'zalo',1,'synthetic-local-credential');
 const publicId=Buffer.from(id.padEnd(16,'!')).toString('base64url');
 db.sqlite.prepare(`INSERT INTO bot_connections (id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at,transition_marker) VALUES (?,'owner',?,?,?,?,?,?,?,1,'ACTIVE_BOUND',?,?,'synthetic-marker')`).run(id,provider,publicId,id,name,new Uint8Array(encrypted.ciphertext),new Uint8Array(encrypted.iv),id,now,now);
 db.sqlite.prepare('INSERT INTO chat_identities VALUES (?,?,?,?,NULL,?)').run(`identity-${id}`,id,`user-${id}`,`chat-${id}`,now);
 }
 const session=await prepareSession('owner',{keyring,now:()=>now,randomBytes:deterministicRandomBytes()});
 db.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)').run(session.record.id,'owner',session.record.digest,session.record.expiresAt,null,now);
 const origin='https://calenote.iconiclogs.com';const jobs=vi.fn();
 const env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',CALENOTE_MASTER_KEY:master,DB:db,JOBS:{send:jobs},ASSETS:{fetch:vi.fn()}} as unknown as Env;
 const router=createRouter({connectionsOperations:createConnectionsOperations});
 const fetcher=vi.fn(async(path:string,init?:RequestInit)=>router(new Request(origin+path,{...init,headers:{origin,'content-type':'application/json',cookie:session.cookie.split(';')[0]}}),env,{} as ExecutionContext));
 vi.stubGlobal('fetch',fetcher);const interaction=userEvent.setup();render(<PrimaryLoginPanel/>);
 await screen.findByText('Telegram local · Telegram');
 for(const name of ['Zalo local','Telegram local']){await interaction.click(screen.getByRole('button',{name:`Chọn ${name}`}));await interaction.click(screen.getByRole('button',{name:'Xác nhận đổi bot'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Đã xác nhận'));}
 expect(db.sqlite.prepare("SELECT connection_id FROM primary_login_channels WHERE user_id='owner'").get()).toEqual({connection_id:'bot-a'});
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(2);expect(jobs).not.toHaveBeenCalled();
 }finally{db.close();}
});
