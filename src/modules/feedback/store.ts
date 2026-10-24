import {FeedbackCreateSchema,FeedbackFiltersSchema,FeedbackPatchSchema,FeedbackTicketSchema,type FeedbackCreate,type FeedbackFilters,type FeedbackPatch,type FeedbackTicket} from '@/contracts/api/feedback';
import {persistedD1Blob} from '@/modules/db/persisted-blob';
import type {Keyring} from '@/modules/security/keyring';
export class FeedbackError extends Error {
 constructor(readonly code:'NOT_FOUND'|'CONFLICT'|'RATE_LIMITED',readonly status:number,readonly retryAfter?:number){super(code);}
}
interface Row {id:string;owner_user_id:string;payload_digest:string;kind:FeedbackTicket['kind'];status:FeedbackTicket['status'];content_ciphertext:ArrayBuffer;content_iv:ArrayBuffer;content_key_version:number;revision:number;created_at:number;updated_at:number;}
export class D1FeedbackStore {
 constructor(private db:D1Database,private keyring:Keyring){}
 private async decode(row:Row):Promise<FeedbackTicket>{
  const content=JSON.parse(await this.keyring.decryptSensitive('feedback-content',`${row.owner_user_id}:${row.id}`,row.content_key_version,{ciphertext:persistedD1Blob(row.content_ciphertext),iv:persistedD1Blob(row.content_iv)}));
  return FeedbackTicketSchema.parse({...content,id:row.id,kind:row.kind,status:row.status,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at});
 }
 async create(owner:string,raw:FeedbackCreate,now:number):Promise<FeedbackTicket>{
  const input=FeedbackCreateSchema.parse(raw);
  const digest=await this.keyring.digestCode(JSON.stringify(['feedback',owner,input]));
  const existing=()=>this.db.prepare('SELECT * FROM feedback_tickets WHERE owner_user_id=? AND request_id=?').bind(owner,input.requestId).first<Row>();
  const replay=await existing();
  if(replay){if(replay.payload_digest!==digest)throw new FeedbackError('CONFLICT',409);return this.decode(replay);}
  const id=`fb_${now.toString(16).padStart(12,'0')}_${crypto.randomUUID()}`;
  const encrypted=await this.keyring.encryptSensitive('feedback-content',`${owner}:${id}`,1,JSON.stringify({title:input.title,description:input.description,page:input.page,reply:'',disposition:null}));
  await this.db.prepare(`INSERT INTO feedback_tickets(id,owner_user_id,request_id,payload_digest,kind,status,content_ciphertext,content_iv,content_key_version,revision,actor_user_id,created_at,updated_at)
   SELECT ?,?,?,?,?,'NEW',?,?,1,1,?,?,?
   WHERE (SELECT count(*) FROM feedback_tickets WHERE owner_user_id=? AND created_at>?)<3
   AND (SELECT count(*) FROM feedback_tickets WHERE owner_user_id=? AND created_at>?)<20
   ON CONFLICT(owner_user_id,request_id) DO NOTHING`).bind(id,owner,input.requestId,digest,input.kind,encrypted.ciphertext,encrypted.iv,owner,now,now,owner,now-600000,owner,now-86400000).run();
  const row=await existing();
  if(row){if(row.payload_digest!==digest)throw new FeedbackError('CONFLICT',409);return this.decode(row);}
  const reset=await this.db.prepare(`SELECT max(reset_at) AS reset_at FROM (
   SELECT min(created_at)+600000 AS reset_at FROM feedback_tickets WHERE owner_user_id=? AND created_at>? HAVING count(*)>=3
   UNION ALL SELECT min(created_at)+86400000 FROM feedback_tickets WHERE owner_user_id=? AND created_at>? HAVING count(*)>=20
  )`).bind(owner,now-600000,owner,now-86400000).first<number>('reset_at');
  throw new FeedbackError('RATE_LIMITED',429,Math.max(1,Math.ceil(((reset??now+600000)-now)/1000)));
 }
 async get(owner:string|null,id:string):Promise<FeedbackTicket>{
  const row=await this.db.prepare('SELECT * FROM feedback_tickets WHERE id=? AND (? IS NULL OR owner_user_id=?)').bind(id,owner,owner).first<Row>();
  if(!row)throw new FeedbackError('NOT_FOUND',404);return this.decode(row);
 }
 async list(owner:string|null,raw:FeedbackFilters){
  const f=FeedbackFiltersSchema.parse(raw);
  const result=await this.db.prepare(`SELECT * FROM feedback_tickets WHERE (? IS NULL OR owner_user_id=?) AND (? IS NULL OR kind=?) AND (? IS NULL OR status=?) AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT 21`).bind(owner,owner,f.kind??null,f.kind??null,f.status??null,f.status??null,f.after??null,f.after??null).all<Row>();
  const items=await Promise.all(result.results.slice(0,20).map(row=>this.decode(row)));
  return {items:items.map(({id,kind,title,status,revision,createdAt,updatedAt})=>({id,kind,title,status,revision,createdAt,updatedAt})),next:result.results.length>20?items.at(-1)!.id:null};
 }
 async update(actor:string,id:string,raw:FeedbackPatch,now:number):Promise<FeedbackTicket>{
  const patch=FeedbackPatchSchema.parse(raw);
  const row=await this.db.prepare('SELECT * FROM feedback_tickets WHERE id=?').bind(id).first<Row>();
  if(!row)throw new FeedbackError('NOT_FOUND',404);
  if(row.revision!==patch.expectedRevision)throw new FeedbackError('CONFLICT',409);
  const previous=await this.decode(row);
  const encrypted=await this.keyring.encryptSensitive('feedback-content',`${row.owner_user_id}:${id}`,1,JSON.stringify({title:previous.title,description:previous.description,page:previous.page,reply:patch.reply,disposition:patch.disposition}));
  const result=await this.db.prepare(`UPDATE feedback_tickets SET status=?,content_ciphertext=?,content_iv=?,actor_user_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? RETURNING revision`).bind(patch.status,encrypted.ciphertext,encrypted.iv,actor,now,id,patch.expectedRevision).first<{revision:number}>();
  if(result?.revision!==patch.expectedRevision+1)throw new FeedbackError('CONFLICT',409);
  return this.get(null,id);
 }
}
