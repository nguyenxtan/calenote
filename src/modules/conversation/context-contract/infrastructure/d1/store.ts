import { z } from "zod";
import type { ConversationScope } from "../../../contracts";
import { ownedInbound, auth as inboundArgs } from "../../../infrastructure/d1/context-store";
import type { Keyring, SensitiveContentPurpose } from "@/modules/security/keyring";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import { randomOpaqueId } from "@/modules/platform/types";
import { CanonicalDetailsV1Schema, ContextObservationBindingSchema, ContextSnapshotV1Schema, decodeContextSnapshot, encodeContextSnapshot, type ContextObservation, type ContextSnapshotV1, type ControlAuthority, type ContextScope } from "../../state";
import { CanonicalPreviewSchema, digest, previewHash, validDecision, validPreview, validPreviewOrder, validateConfirmation } from "../../confirmation";
import type { AppliedTransition, CanonicalPreview, ConfirmationResult, ContextContractStore, DecisionProof, DeliveryReceipt, ObservedContext, StoredTransition } from "../../store";
import { CONTEXT_DETAIL_MAX_BYTES, contextContractEncryptionIdentity as identity } from "../../store";
import { renderReminderDetails } from "@/modules/reminders/detail-presentation";
import { newerConversationOutcomeSql } from "@/modules/semantic/infrastructure/d1/conversation-order";
import { base64UrlToBytes, bytesToBase64Url } from "@/modules/security/encoding";
import type { SessionPrincipal } from "@/modules/auth/session";
import type { PublicPreviewV1, PreviewDecisionRequestV1 } from "@/contracts/api/conversation-previews";
import { ContextSnapshotV2Schema, decodeContextSnapshotV2, encodeContextSnapshotV2, type ContextSnapshotV2 } from "../../state";
import { CONTEXT_PROTOCOL_V3, isContextProtocolV3, type ContextProtocolV3 } from "../../protocol";
import type { ContextContractStoreV3, ObservedContextV2, StoredTransitionV2 } from "../../store";

const active = "status IN ('CLARIFYING','DRAFT_READY')";
const observationProtocols=new WeakMap<object,"calenote-context-2"|"calenote-context-3">();
/** Read-only provenance of a capability minted by the selected store. */
export const contextObservationProtocol=(observation:ContextObservation)=>observationProtocols.get(observation);
/** Explicit application selection. SQL family2 never selects this decoder. */
export function createD1ContextContractStoreV3(args:{db:D1Database;keyring:Keyring;protocol:ContextProtocolV3;clock?:()=>number}):ContextContractStoreV3 {
 if(!isContextProtocolV3(args.protocol))throw new Error("UNSUPPORTED_CONTEXT_PROTOCOL");
 const store=new D1ContextContractStore(args.db,args.keyring,args.clock,CONTEXT_PROTOCOL_V3);
 return Object.freeze({protocol:CONTEXT_PROTOCOL_V3,
  observe:(scope:ConversationScope)=>store.observeSuccessor(scope),
  apply:(scope:ConversationScope,observation:ContextObservation,transition:StoredTransitionV2)=>store.applySuccessor(scope,observation,transition),
  confirm:(authority:ControlAuthority,proof:DecisionProof)=>store.confirm(authority,proof),
  readOutcome:(authority:ControlAuthority,key:string)=>store.readOutcome(authority,key),
  recordDelivery:(scope:ConversationScope,receipt:DeliveryReceipt)=>store.recordDelivery(scope,receipt),
 });
}
const permitted = "EXISTS(SELECT 1 FROM conversation_contract_write_permits WHERE marker=?)";
const resultSchema = z.strictObject({ reminderPublicIds: z.array(z.string().min(1)).min(1).max(30), seriesPublicId: z.string().nullable(), childCount: z.number().int().min(1).max(30) }).refine(v=>v.childCount===v.reminderPublicIds.length && new Set(v.reminderPublicIds).size===v.childCount);
type Row = { id:string; owner_id:string; chat_identity_id:string; contract_version:number; revision:number; status:string; created_at:number; updated_at:number; expires_at:number; last_inbound_id:string; claim_marker:string; payload_ciphertext:unknown; payload_iv:unknown; key_version:number };
type Auth = { authority:ControlAuthority; now:number; owner:string; chat:string };
type Snapshot = ContextSnapshotV1 | ContextSnapshotV2;
type ObservationRecord = { row:Row|null; snapshot:Snapshot|null; history:number; scope:ConversationScope; binding:string };
type WebRow = Row & { workspace_id:string; connection_id:string; private_chat_id:string };
const freeze = <T>(v:T):T => { if(v && typeof v==="object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const bytes = (s:string)=>new TextEncoder().encode(s).length;
function authQuery(a:Auth, mutate:boolean) {
 const base = `SELECT ci.id,ci.connection_id,ci.private_chat_id,w.id workspace_id
 FROM chat_identities ci JOIN bot_connections c ON c.id=ci.connection_id AND c.state='ACTIVE_BOUND'
 JOIN workspaces w ON w.owner_user_id=c.user_id AND w.kind='PERSONAL'
 JOIN memberships m ON m.workspace_id=w.id AND m.user_id=c.user_id AND m.role='OWNER'`;
 if(a.authority.kind==="WEB") return {sql:base+` JOIN sessions s ON s.user_id=c.user_id
 WHERE ci.id=? AND c.user_id=? AND s.id=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.expires_at=?`,
 args:[a.chat,a.owner,a.authority.principal.sessionId,a.now,a.authority.principal.expiresAt]};
 const scope=a.authority.scope;
 return {sql:base+` JOIN inbound_updates i ON i.connection_id=ci.connection_id AND i.provider_user_id=ci.provider_user_id AND i.private_chat_id=ci.private_chat_id
 WHERE ci.id=? AND c.user_id=? AND i.id=? AND i.transition_marker=? AND i.received_at<=?
 ${mutate ? `AND EXISTS(${ownedInbound})` : "AND i.state IN ('PROCESSING','PROCESSED','REJECTED')"}`,
 args:[a.chat,a.owner,scope.sourceInboundId,scope.claimMarker,a.now,...(mutate?inboundArgs(scope):[])]};
}
export class D1ContextContractStore implements ContextContractStore {
 private readonly observations=new WeakMap<object,ObservationRecord>();
 constructor(private readonly db:D1Database,private readonly keyring:Keyring,private readonly clock:()=>number=Date.now, private readonly protocol?: Readonly<ContextProtocolV3>) {
  if(protocol !== undefined && !isContextProtocolV3(protocol))throw new Error("UNSUPPORTED_CONTEXT_PROTOCOL");
 }
 private authority(authority:ControlAuthority):Auth {
  return {authority,now:authority.kind==="CHAT"?authority.scope.now:this.clock(),owner:authority.kind==="CHAT"?authority.scope.ownerId:authority.principal.userId,chat:authority.kind==="CHAT"?authority.scope.chatIdentityId:authority.chat.chatIdentityId};
 }
 private statement(sql:string,args:unknown[]=[]){return this.db.prepare(sql).bind(...args);}
 private webAuthority(principal:SessionPrincipal,row:WebRow):Extract<ControlAuthority,{kind:"WEB"}> {return {kind:"WEB",principal,chat:{ownerId:principal.userId,chatIdentityId:row.chat_identity_id,workspaceId:row.workspace_id,connectionId:row.connection_id,chatId:row.private_chat_id}};}
 private async webRows(principal:SessionPrincipal,limit:number,activeOnly:boolean):Promise<WebRow[]> {
  const now=this.clock();
  if(principal.expiresAt<=now)return [];
  return (await this.statement(`SELECT c.*,w.id workspace_id,ci.connection_id,ci.private_chat_id
    FROM conversation_contexts c
    JOIN chat_identities ci ON ci.id=c.chat_identity_id
    JOIN bot_connections b ON b.id=ci.connection_id AND b.user_id=c.owner_id AND b.state='ACTIVE_BOUND'
    JOIN workspaces w ON w.owner_user_id=c.owner_id AND w.kind='PERSONAL'
    JOIN memberships m ON m.workspace_id=w.id AND m.user_id=c.owner_id AND m.role='OWNER'
    JOIN sessions s ON s.user_id=c.owner_id AND s.id=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.expires_at=?
    WHERE c.owner_id=? AND c.contract_version=2 ${activeOnly?`AND ${active} AND c.expires_at>?`:""}
    ORDER BY c.updated_at DESC,c.id ASC LIMIT ?`,
   [principal.sessionId,now,principal.expiresAt,principal.userId,...(activeOnly?[now]:[]),Math.min(limit,11)]).all<WebRow>()).results;
 }
 private async publicPreviewId(row:WebRow):Promise<string> {
  const digest=await this.keyring.fingerprintToken(JSON.stringify(["calenote-public-context-preview-1",row.owner_id,row.chat_identity_id,row.id]));
  const bytes=base64UrlToBytes(digest);if(!bytes||bytes.length!==32)throw new Error("INVALID_PUBLIC_PREVIEW_ID");
  return bytesToBase64Url(bytes.slice(0,16));
 }
 private async webPreview(principal:SessionPrincipal,row:WebRow):Promise<PublicPreviewV1|null> {
  const authority=this.webAuthority(principal,row),s=await this.decryptState(row,authority.chat);
  const d=s.pendingDecision,p=s.previewReceipt;
  if(s.lifecycle!=="AWAITING_CONFIRMATION"||d?.kind!=="SAVE_PREVIEW"||d.tokenHandle===null||!p||d.deliveryState!=="SENT"||p.deliveryState!=="SENT")return null;
  const preview=await this.loadPreview(s);
  if(!preview)return null;
  const proof:DecisionProof={operationKey:"preview-admission",contextId:s.id,contextRevision:s.contextRevision,decisionId:d.decisionId,kind:"SAVE_PREVIEW",
   requestId:d.target.requestId,proposalId:d.target.proposalId,draftRevision:d.draftRevision,draftHash:p.draftHash,response:{kind:"TOKEN",handle:d.tokenHandle}};
  if(!await validateConfirmation(s,preview,proof,authority,this.clock()))return null;
  return {publicId:await this.publicPreviewId(row),draftRevision:d.draftRevision!,previewHash:p.draftHash,expiresAt:Math.min(Date.parse(d.expiresAt),Date.parse(p.expiresAt)),
   title:preview.title,details:preview.details,occurrences:preview.occurrences,decisionToken:d.tokenHandle};
 }
 async listWebPreviews(principal:SessionPrincipal,limit=11):Promise<{previews:PublicPreviewV1[];hasMore:boolean}> {
  const rows=await this.webRows(principal,limit,true),previews:PublicPreviewV1[]=[];
  for(const row of rows){const preview=await this.webPreview(principal,row);if(preview)previews.push(preview);}
  return {previews:previews.slice(0,10),hasMore:previews.length>10||rows.length>10};
 }
 async decideWebPreview(principal:SessionPrincipal,request:PreviewDecisionRequestV1):Promise<ConfirmationResult|{status:"DECLINED"|"ALREADY_DECLINED"}> {
  const operationKey=await digest(["web-preview-decision-1",request]);
  const activeRows=await this.webRows(principal,11,true);
  const rows=[...activeRows,...(await this.webRows(principal,11,false)).filter(row=>!activeRows.some(active=>active.id===row.id))];
  for(const row of rows){
   if(await this.publicPreviewId(row)!==request.publicId)continue;
   const authority=this.webAuthority(principal,row);
   if(request.action==="DECLINE"){
    const prior=await this.readWebDecline(authority,row,operationKey,request);if(prior)return prior;
   }else{const prior=await this.readOutcome(authority,operationKey);if(prior)return prior;}
   if(!["CLARIFYING","DRAFT_READY"].includes(row.status)||row.expires_at<=this.clock())return {status:"STALE"};
   const publicPreview=await this.webPreview(principal,row);
   if(!publicPreview||publicPreview.draftRevision!==request.draftRevision||publicPreview.previewHash!==request.previewHash
    ||publicPreview.decisionToken!==request.decisionToken)return {status:"STALE"};
   const snapshot=await this.decryptState(row,authority.chat),decision=snapshot.pendingDecision!,receipt=snapshot.previewReceipt!;
   if(request.action==="DECLINE")return this.declineWebPreview(authority,row,snapshot,request,operationKey);
   return this.confirm(authority,{operationKey,contextId:snapshot.id,contextRevision:snapshot.contextRevision,decisionId:decision.decisionId,
    kind:"SAVE_PREVIEW",requestId:decision.target.requestId,proposalId:decision.target.proposalId,draftRevision:decision.draftRevision,
    draftHash:receipt.draftHash,response:{kind:"TOKEN",handle:request.decisionToken}});
  }
  return {status:"STALE"};
 }
 private async readWebDecline(authority:Extract<ControlAuthority,{kind:"WEB"}>,row:WebRow,key:string,request:PreviewDecisionRequestV1):Promise<{status:"ALREADY_DECLINED"|"STALE"}|null>{
  const current=await this.readRow(this.authority(authority),row.id);
  if(!current||!["CLARIFYING","DRAFT_READY"].includes(current.status)||current.expires_at<=this.clock())return null;
  const snapshot=await this.decryptState(current,authority.chat),receipt=snapshot.webDeclineReceipt;
  if(!receipt)return null;
  return receipt.publicId===request.publicId&&receipt.operationKey===key&&receipt.proofHash===await digest(["web-decline-proof",request])
   &&receipt.settledRevision===current.revision?{status:"ALREADY_DECLINED"}:{status:"STALE"};
 }
 private async declineWebPreview(authority:Extract<ControlAuthority,{kind:"WEB"}>,row:WebRow,s:Snapshot,request:PreviewDecisionRequestV1,key:string):Promise<{status:"DECLINED"|"ALREADY_DECLINED"|"STALE"|"UNCERTAIN"}> {
  const a=this.authority(authority),prior=await this.readWebDecline(authority,row,key,request);if(prior)return prior;
  const next=structuredClone(s);next.contextRevision++;next.lifecycle="CLARIFYING";next.pendingDecision=null;next.previewReceipt=null;
  next.webDeclineReceipt={publicId:request.publicId,operationKey:key,proofHash:await digest(["web-decline-proof",request]),settledRevision:next.contextRevision,settledAt:new Date(a.now).toISOString()};
  let encrypted:Awaited<ReturnType<Keyring["encryptSensitive"]>>;
  try{const encoded=next.schemaVersion==="calenote-context-state-2"?encodeContextSnapshotV2(next):encodeContextSnapshot(next);if(bytes(encoded)>16384)return {status:"STALE"};encrypted=await this.keyring.encryptSensitive("context-contract-state",identity(next.scope,next.id,this.protocol),1,encoded);}
  catch{return {status:"STALE"};}
  const marker=randomOpaqueId(),cas=this.rowCas(row);
  const statements=[this.permit(a,s.id,marker,"APPLY",cas.sql+" AND EXISTS(SELECT 1 FROM conversation_contract_ownership WHERE context_id=? AND chat_identity_id=? AND owner_id=?)",
   [...cas.args,a.now,s.id,a.chat,a.owner]),
   this.statement(`UPDATE conversation_contexts SET revision=?,status='CLARIFYING',updated_at=?,payload_ciphertext=?,payload_iv=?,write_marker=? WHERE id=? AND ${permitted}`,
    [next.contextRevision,a.now,encrypted.ciphertext,encrypted.iv,marker,s.id,marker]),
   this.statement(`UPDATE command_drafts SET status='CANCELLED',updated_at=?,write_marker=? WHERE chat_identity_id=? AND contract_version=2 AND status='PENDING' AND ${permitted}`,
    [a.now,marker,a.chat,marker]),
   this.statement(`UPDATE reminder_series_proposals SET status='INVALID',transaction_marker=? WHERE chat_identity_id=? AND contract_version=2 AND status='PENDING' AND ${permitted}`,
    [marker,a.chat,marker]),
   this.release(marker)];
  try{
   const result=await this.db.batch(statements);
   if(result[0].meta.changes===1)return {status:"DECLINED"};
   return await this.readWebDecline(authority,row,key,request)??{status:"STALE"};
  }catch{
   try{return await this.readWebDecline(authority,row,key,request)??{status:"UNCERTAIN"};}catch{return {status:"UNCERTAIN"};}
  }
 }
 private expiry(s:Snapshot){return Math.min(Date.parse(s.idleExpiresAt),Date.parse(s.absoluteExpiresAt),s.draftExpiresAt?Date.parse(s.draftExpiresAt):Infinity);}
 private async decryptSelectedState(row:Row,scope:{ownerId:string;chatIdentityId:string}):Promise<Snapshot> {
  const encoded=await this.keyring.decryptSensitive("context-contract-state",identity(scope,row.id,this.protocol),row.key_version,{ciphertext:persistedD1Blob(row.payload_ciphertext),iv:persistedD1Blob(row.payload_iv)});
  const snapshot=this.protocol?decodeContextSnapshotV2(encoded):decodeContextSnapshot(encoded);
  if(snapshot.id!==row.id || snapshot.contextRevision!==row.revision || snapshot.scope.ownerId!==row.owner_id || snapshot.scope.chatIdentityId!==row.chat_identity_id
   || Date.parse(snapshot.createdAt)!==row.created_at || this.expiry(snapshot)!==row.expires_at
   || snapshot.inbound.id!==row.last_inbound_id || snapshot.inbound.claimMarker!==row.claim_marker
   || (snapshot.lifecycle==="AWAITING_CONFIRMATION"?"DRAFT_READY":"CLARIFYING")!==row.status) throw new Error("INVALID");
  if(!validPreviewOrder(snapshot))throw new Error("INVALID");
  return snapshot;
 }
 private async isOtherProtocol(row:Row,scope:{ownerId:string;chatIdentityId:string}):Promise<boolean> {
  try {
   const encoded=await this.keyring.decryptSensitive("context-contract-state",identity(scope,row.id,this.protocol?undefined:CONTEXT_PROTOCOL_V3),row.key_version,{ciphertext:persistedD1Blob(row.payload_ciphertext),iv:persistedD1Blob(row.payload_iv)});
   if(this.protocol)decodeContextSnapshot(encoded);else decodeContextSnapshotV2(encoded);
   return true;
  }catch{return false;}
 }
 private async decryptState(row:Row,scope:{ownerId:string;chatIdentityId:string}) {
  return this.decryptSelectedState(row,scope);
 }
 private async history(chat:string){return (await this.statement("SELECT coalesce(max(o.rowid),0) n FROM conversation_context_outcomes o JOIN conversation_contexts c ON c.id=o.context_id WHERE c.chat_identity_id=?",[chat]).first<number>("n"))!;}
 async observe(scope:ConversationScope):Promise<ObservedContext>{
  if(this.protocol)return {failure:"OTHER_CONTRACT"};
  const result=await this.observeSelected(scope);
  if("failure"in result)return result;
  return {observation:result.observation,snapshot:result.snapshot===null?null:ContextSnapshotV1Schema.parse(result.snapshot)};
 }
 async observeSuccessor(scope:ConversationScope):Promise<ObservedContextV2>{
  if(!this.protocol)return {failure:"OTHER_CONTRACT"};
  const result=await this.observeSelected(scope);
  if("failure"in result)return result;
  return {observation:result.observation,snapshot:result.snapshot===null?null:ContextSnapshotV2Schema.parse(result.snapshot)};
 }
 private async observeSelected(scope:ConversationScope):Promise<{observation:ContextObservation;snapshot:Snapshot|null}|Extract<ObservedContext,{failure:string}>>{
  try{
   const a=this.authority({kind:"CHAT",scope}), auth=authQuery(a,true);
   const binding=await this.statement(auth.sql,auth.args).first<{id:string;connection_id:string;private_chat_id:string;workspace_id:string}>();
   if(!binding)return {failure:"UNAUTHORIZED"};
   const inbound=await this.statement("SELECT received_at,rowid FROM inbound_updates WHERE id=?",[scope.sourceInboundId]).first<{received_at:number;rowid:number}>();
   if(!inbound)return {failure:"UNAUTHORIZED"};
   const rows=await this.statement(`SELECT c.*,(SELECT coalesce(max(o.rowid),0) FROM conversation_context_outcomes o JOIN conversation_contexts h ON h.id=o.context_id WHERE h.chat_identity_id=?) history
    FROM (SELECT 1) seed LEFT JOIN conversation_contexts c ON c.id=(SELECT id FROM conversation_contexts WHERE chat_identity_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1)`,[scope.chatIdentityId,scope.chatIdentityId]).first<Row & {history:number}>();
   const row=rows?.id?rows:null;
   const owner=await this.statement("SELECT context_id,owner_id,contract_version FROM conversation_contract_ownership WHERE chat_identity_id=?",[scope.chatIdentityId]).first<{context_id:string;owner_id:string;contract_version:number}>();
   if(owner&&(!row||owner.context_id!==row.id||owner.owner_id!==scope.ownerId||owner.contract_version!==2))return {failure:"OTHER_CONTRACT"};
   if(row && row.owner_id!==scope.ownerId)return {failure:"INVALID"};
   const isActive=!!row && ["CLARIFYING","DRAFT_READY"].includes(row.status);
   if(isActive && row.contract_version!==2)return {failure:"OTHER_CONTRACT"};
   if(isActive && row.expires_at<=scope.now)return {failure:"EXPIRED"};
   let snapshot:Snapshot|null=null;
   if(isActive){try{snapshot=await this.decryptSelectedState(row!,scope);}catch{return {failure:await this.isOtherProtocol(row!,scope)?"OTHER_CONTRACT":"INVALID"};}}
   const contextScope:ContextScope={ownerId:scope.ownerId,chatIdentityId:scope.chatIdentityId,workspaceId:binding.workspace_id,connectionId:binding.connection_id,chatId:binding.private_chat_id};
   if(snapshot && JSON.stringify(snapshot.scope)!==JSON.stringify(contextScope))return {failure:"INVALID"};
   const terminal=row&&!isActive?await this.statement("SELECT received_at,rowid FROM inbound_updates WHERE id=?",[row.last_inbound_id]).first<{received_at:number;rowid:number}>():null;
   const parsed=ContextObservationBindingSchema.parse({scope:contextScope,inbound:{id:scope.sourceInboundId,receivedAt:new Date(inbound.received_at).toISOString(),rowid:inbound.rowid,claimMarker:scope.claimMarker},
    observed:snapshot?{presence:"PRESENT",contextId:snapshot.id,contextRevision:snapshot.contextRevision}:{presence:"ABSENT"},
    lastTerminalOutcome:row&&terminal&&!isActive?{outcomeId:row.id+":"+row.revision,status:row.status,contextId:row.id,contextRevision:row.revision,inboundId:row.last_inbound_id,order:{receivedAt:new Date(terminal.received_at).toISOString(),rowid:terminal.rowid}}:null});
   const observation=freeze(parsed) as ContextObservation;
   observationProtocols.set(observation,this.protocol?.canonicalVersion??"calenote-context-2");
   this.observations.set(observation,{row:isActive?row:null,snapshot:structuredClone(snapshot),history:rows?.history??0,scope:{...scope},binding:JSON.stringify(parsed)});
   return {observation,snapshot};
  }catch{return {failure:"UNAVAILABLE"};}
 }
 private permit(a:Auth,id:string,marker:string,operation:string,condition:string,args:unknown[],mutation=true){
  const auth=authQuery(a,mutation);
  return this.statement(`INSERT INTO conversation_contract_write_permits(chat_identity_id,context_id,marker,operation,source_inbound_id,web_session_id)
   SELECT ?,?,?,?,?,? WHERE EXISTS(${auth.sql}) AND NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits WHERE chat_identity_id=?)
   AND ${condition}`,[a.chat,id,marker,operation,a.authority.kind==="CHAT"?a.authority.scope.sourceInboundId:null,a.authority.kind==="WEB"?a.authority.principal.sessionId:null,...auth.args,a.chat,...args]);
 }
 private release(marker:string){return this.statement("DELETE FROM conversation_contract_write_permits WHERE marker=?",[marker]);}
 private rowCas(row:Row){return {sql:"EXISTS(SELECT 1 FROM conversation_contexts WHERE id=? AND revision=? AND contract_version=2 AND payload_iv=? AND payload_ciphertext=? AND "+active+" AND expires_at>?)",args:[row.id,row.revision,persistedD1Blob(row.payload_iv),persistedD1Blob(row.payload_ciphertext)]};}
 private async existingApply(scope:ConversationScope,key:string,hash:string):Promise<AppliedTransition|null>{
  const auth=authQuery(this.authority({kind:"CHAT",scope}),false);
  const row=await this.statement(`SELECT o.context_id,o.revision,o.proof_hash FROM conversation_context_outcomes o JOIN conversation_contexts c ON c.id=o.context_id WHERE o.operation_key=? AND c.owner_id=? AND c.chat_identity_id=? AND EXISTS(${auth.sql})`,[key,scope.ownerId,scope.chatIdentityId,...auth.args]).first<{context_id:string;revision:number;proof_hash:string}>();
  return row?row.proof_hash===hash?{status:"IDEMPOTENT",contextId:row.context_id,contextRevision:row.revision}:{status:"STALE"}:null;
 }
 async apply(scope:ConversationScope,observation:ContextObservation,t:StoredTransition):Promise<AppliedTransition>{
  if(this.protocol)return {status:"INVALID"};
  return this.applySelected(scope,observation,t);
 }
 async applySuccessor(scope:ConversationScope,observation:ContextObservation,t:StoredTransitionV2):ReturnType<ContextContractStoreV3["apply"]>{
  if(!this.protocol)return {status:"INVALID"};
  const parsed=ContextSnapshotV2Schema.safeParse(t.snapshot);if(!parsed.success)return {status:"INVALID"};
  return this.applySelected(scope,observation,t);
 }
 private async applySelected(scope:ConversationScope,observation:ContextObservation,t:StoredTransition|StoredTransitionV2):Promise<AppliedTransition>{
  let key="",hash="";
  try{
   key=await digest(["apply",scope.ownerId,scope.chatIdentityId,scope.sourceInboundId]);hash=await digest(t);
   const existing=await this.existingApply(scope,key,hash);if(existing)return existing;
   const observed=this.observations.get(observation);
   if(!observed || JSON.stringify(observation)!==observed.binding || JSON.stringify(scope)!==JSON.stringify(observed.scope))return {status:"STALE"};
   if(await this.history(scope.chatIdentityId)!==observed.history)return {status:"STALE"};
   const parsed=(this.protocol?ContextSnapshotV2Schema:ContextSnapshotV1Schema).safeParse(t.snapshot);if(!parsed.success)return {status:"INVALID"};
   const s=parsed.data, prior=observed.snapshot;
   if(prior?.webDeclineReceipt)s.webDeclineReceipt=null;
   if(!validPreviewOrder(s))return {status:"INVALID"};
   if(t.expectedContextRevision!==(prior?.contextRevision??null)||t.expectedDraftRevision!==(prior?.draftRevision??null))return {status:"STALE"};
   if(s.contextRevision!==(prior?.contextRevision??0)+1 || (prior&&s.id!==prior.id)
    || JSON.stringify(s.scope)!==JSON.stringify(observation.scope) || JSON.stringify(s.inbound)!==JSON.stringify(observation.inbound)
    || s.createdAt!==(prior?.createdAt??observation.inbound.receivedAt)
    || (prior&&s.absoluteExpiresAt!==prior.absoluteExpiresAt) || this.expiry(s)<=scope.now
    || (t.terminal ? s.lifecycle!==t.terminal || !prior : !["NONE","CLARIFYING","AWAITING_CONFIRMATION"].includes(s.lifecycle)))return {status:"INVALID"};
   if(prior&&s.requestId===prior.requestId){
    if(s.draftCreatedAt!==prior.draftCreatedAt||s.draftExpiresAt!==prior.draftExpiresAt)return {status:"INVALID"};
    const changed=JSON.stringify(s.slots)!==JSON.stringify(prior.slots);
    if(changed ? s.draftRevision!==(prior.draftRevision??0)+1 : s.draftRevision!==prior.draftRevision&&s.draftRevision!==(prior.draftRevision??0)+1)return {status:"INVALID"};
   }
   if(t.decisionProof&&(!prior||!validDecision(prior,t.decisionProof,{kind:"CHAT",scope},scope.now)||t.decisionProof.kind==="SAVE_PREVIEW"))return {status:"INVALID"};
   if(t.decisionProof&&s.pendingDecision?.decisionId===t.decisionProof.decisionId)return {status:"INVALID"};
   if(prior?.requestId && s.requestId!==prior.requestId && !t.terminal && !["REPLACE_PENDING","RESTART_PENDING"].includes(t.decisionProof?.kind??""))return {status:"INVALID"};
   if(t.preview && (!validPreview(s,t.preview,scope.now)||!s.previewReceipt||await previewHash(t.preview)!==s.previewReceipt.draftHash))return {status:"INVALID"};
   if(s.lifecycle==="AWAITING_CONFIRMATION"&&!t.preview)return {status:"INVALID"};
   const encoded=s.schemaVersion==="calenote-context-state-2"?encodeContextSnapshotV2(s):encodeContextSnapshot(s);if(bytes(encoded)>16384)return {status:"INVALID"};
   const encrypted=await this.keyring.encryptSensitive("context-contract-state",identity(s.scope,s.id,this.protocol),1,encoded);
   const a=this.authority({kind:"CHAT",scope}),marker=randomOpaqueId(),cas=observed.row?this.rowCas(observed.row):null;
   const condition=(cas?cas.sql:"NOT EXISTS(SELECT 1 FROM conversation_contexts WHERE chat_identity_id=? AND "+active+")")
    +" AND (SELECT coalesce(max(o.rowid),0) FROM conversation_context_outcomes o JOIN conversation_contexts c ON c.id=o.context_id WHERE c.chat_identity_id=?)=?"
    +" AND NOT EXISTS(SELECT 1 FROM command_drafts WHERE chat_identity_id=? AND status='PENDING' AND contract_version=1)"
    +" AND NOT EXISTS(SELECT 1 FROM reminder_series_proposals WHERE chat_identity_id=? AND status='PENDING' AND contract_version=1)"
    +" AND NOT EXISTS(SELECT 1 FROM semantic_contexts WHERE chat_identity_id=? AND status='PENDING')";
   const statements=[this.permit(a,s.id,marker,"APPLY",condition,[...(cas?[...cas.args,scope.now]:[a.chat]),a.chat,observed.history,a.chat,a.chat,a.chat])];
   const status=t.terminal??(s.lifecycle==="AWAITING_CONFIRMATION"?"DRAFT_READY":"CLARIFYING");
   if(prior)statements.push(this.statement(`UPDATE conversation_contexts SET revision=?,last_inbound_id=?,claim_marker=?,status=?,updated_at=?,expires_at=?,payload_ciphertext=?,payload_iv=?,key_version=?,write_marker=? WHERE id=? AND ${permitted}`,
    [s.contextRevision,scope.sourceInboundId,scope.claimMarker,status,scope.now,this.expiry(s),t.terminal?null:encrypted.ciphertext,t.terminal?null:encrypted.iv,t.terminal?null:1,marker,s.id,marker]));
   else statements.push(this.statement(`INSERT INTO conversation_contexts(id,owner_id,chat_identity_id,source_inbound_id,last_inbound_id,claim_marker,revision,status,created_at,updated_at,expires_at,payload_ciphertext,payload_iv,key_version,contract_version,write_marker)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,1,2,? WHERE ${permitted}`,[s.id,a.owner,a.chat,scope.sourceInboundId,scope.sourceInboundId,scope.claimMarker,s.contextRevision,status,Date.parse(s.createdAt),scope.now,this.expiry(s),encrypted.ciphertext,encrypted.iv,marker,marker]));
   statements.push(this.statement(`INSERT INTO conversation_contract_ownership(chat_identity_id,owner_id,context_id,contract_version) SELECT ?,?,?,2 WHERE ${permitted} ON CONFLICT(chat_identity_id) DO NOTHING`,[a.chat,a.owner,s.id,marker]),
    this.statement(`UPDATE command_drafts SET status='CANCELLED',resolution_inbound_id=NULL,updated_at=?,write_marker=? WHERE chat_identity_id=? AND status='PENDING' AND contract_version=2 AND ${permitted}`,[scope.now,marker,a.chat,marker]),
    this.statement(`UPDATE reminder_series_proposals SET status='INVALID',transaction_marker=? WHERE chat_identity_id=? AND status='PENDING' AND contract_version=2 AND ${permitted}`,[marker,a.chat,marker]));
   if(t.preview&&!t.terminal)await this.preparePreview(statements,s,CanonicalPreviewSchema.parse(t.preview),marker,scope.now);
   statements.push(this.statement(`INSERT INTO conversation_context_outcomes(context_id,revision,source_inbound_id,operation,created_at,operation_key,proof_hash) SELECT ?,?,?,?,?,?,? WHERE ${permitted}`,
    [s.id,s.contextRevision,scope.sourceInboundId,t.terminal?"FINISH":"SAVE",scope.now,key,hash,marker]),
    this.statement(`UPDATE inbound_updates SET state=?,processed_at=? WHERE id=? AND ${permitted}`,[t.inboundOutcome,scope.now,scope.sourceInboundId,marker]));
   if(t.terminal)statements.push(...this.terminalCleanup(a,s.id,marker));
   statements.push(this.release(marker));
   const results=await this.db.batch(statements);
   return results[0].meta.changes===1?{status:"APPLIED",contextId:s.id,contextRevision:s.contextRevision}:{status:"STALE"};
  }catch{
   try{return await this.existingApply(scope,key,hash)??{status:"UNCERTAIN"};}catch{return {status:"UNCERTAIN"};}
  }
 }
 private async detail(purpose:SensitiveContentPurpose,scope:ContextScope,id:string,details:unknown){
  const plain=JSON.stringify(CanonicalDetailsV1Schema.parse(details));
  if(bytes(plain)>CONTEXT_DETAIL_MAX_BYTES)throw new Error("DETAIL_TOO_LARGE");
  return this.keyring.encryptSensitive(purpose,identity(scope,id),1,plain);
 }
 private async preparePreview(statements:D1PreparedStatement[],s:Snapshot,p:CanonicalPreview,marker:string,now:number){
  if(p.occurrences.length===1){
   const id=s.requestId!,title=await this.keyring.encryptSensitive("draft-title",id,1,p.title);
   const details=await this.detail("context-contract-draft-details",s.scope,id,p.details);
   statements.push(this.statement(`INSERT INTO command_drafts(id,chat_identity_id,source_inbound_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,expires_at,created_at,updated_at,contract_version,write_marker)
    SELECT ?,?,?,?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',?,?,?,2,? WHERE ${permitted}
    ON CONFLICT(id) DO UPDATE SET source_inbound_id=excluded.source_inbound_id,title_ciphertext=excluded.title_ciphertext,title_iv=excluded.title_iv,scheduled_at=excluded.scheduled_at,status='PENDING',resolution_inbound_id=NULL,updated_at=excluded.updated_at,write_marker=excluded.write_marker WHERE command_drafts.contract_version=2 AND command_drafts.status='CANCELLED'`,
    [id,s.scope.chatIdentityId,s.inbound.id,title.ciphertext,title.iv,p.occurrences[0].scheduledAt,Date.parse(s.draftExpiresAt!),Date.parse(s.draftCreatedAt!),now,marker,marker]),
    this.statement(`INSERT INTO command_draft_context_details(draft_id,owner_id,chat_identity_id,encryption_entity_id,payload_version,payload_ciphertext,payload_iv,key_version)
    SELECT ?,?,?,?,'calenote-reminder-details-1',?,?,1 WHERE ${permitted} ON CONFLICT(draft_id) DO UPDATE SET payload_ciphertext=excluded.payload_ciphertext,payload_iv=excluded.payload_iv`,
    [id,s.scope.ownerId,s.scope.chatIdentityId,id,details.ciphertext,details.iv,marker]));
  }else{
   const id=s.pendingDecision?.target.proposalId??s.requestId;
   if(!id)throw new Error("MISSING_PROPOSAL_ID");
   const encrypted=await this.keyring.encryptSensitive("context-contract-proposal",identity(s.scope,id,this.protocol),1,JSON.stringify(p));
   if(encrypted.ciphertext.byteLength>32784)throw new Error("PROPOSAL_TOO_LARGE");
   statements.push(this.statement(`INSERT INTO reminder_series_proposals(id,owner_id,chat_identity_id,context_id,context_revision,revision,source_inbound_id,action,status,payload_ciphertext,payload_iv,key_version,created_at,expires_at,contract_version,transaction_marker)
    SELECT ?,?,?,?,?,?,?,'CREATE','PENDING',?,?,1,?,?,2,? WHERE ${permitted}
    ON CONFLICT(id) DO UPDATE SET context_revision=excluded.context_revision,revision=excluded.revision,source_inbound_id=excluded.source_inbound_id,status='PENDING',payload_ciphertext=excluded.payload_ciphertext,payload_iv=excluded.payload_iv,transaction_marker=excluded.transaction_marker WHERE reminder_series_proposals.contract_version=2 AND reminder_series_proposals.status='INVALID'`,
    [id,s.scope.ownerId,s.scope.chatIdentityId,s.id,s.contextRevision,s.draftRevision,s.inbound.id,encrypted.ciphertext,encrypted.iv,Date.parse(s.draftCreatedAt!),Date.parse(s.draftExpiresAt!),marker,marker]));
  }
 }
 private terminalCleanup(a:Auth,id:string,marker:string){
  return [this.statement(`DELETE FROM command_draft_context_details WHERE chat_identity_id=? AND ${permitted}`,[a.chat,marker]),
   this.statement(`UPDATE reminder_series_proposals SET transaction_marker=?,payload_ciphertext=zeroblob(16),payload_iv=zeroblob(12) WHERE chat_identity_id=? AND contract_version=2 AND status IN ('INVALID','CANCELLED','EXPIRED') AND ${permitted}`,[marker,a.chat,marker]),
   this.statement(`DELETE FROM conversation_contract_ownership WHERE chat_identity_id=? AND context_id=? AND ${permitted}`,[a.chat,id,marker])];
 }
 private async readRow(a:Auth,id:string){const auth=authQuery(a,false);return this.statement(`SELECT * FROM conversation_contexts WHERE id=? AND owner_id=? AND chat_identity_id=? AND contract_version=2 AND EXISTS(${auth.sql})`,[id,a.owner,a.chat,...auth.args]).first<Row>();}
 private confirmationOperationKey(a:Auth,key:string){
  // Terminal payloads are cleared. Keep replay/result authority bound to the
  // application-selected protocol after that cleanup, without changing SQL family.
  return digest(this.protocol?["confirm",a.owner,a.chat,key,this.protocol.canonicalVersion]:["confirm",a.owner,a.chat,key]);
 }
 private async operation(a:Auth,key:string){
  const auth=authQuery(a,false),op=await this.confirmationOperationKey(a,key);
  return this.statement(`SELECT o.result_json,o.proof_hash FROM conversation_context_outcomes o JOIN conversation_contexts c ON c.id=o.context_id WHERE o.operation_key=? AND c.owner_id=? AND c.chat_identity_id=? AND EXISTS(${auth.sql})`,[op,a.owner,a.chat,...auth.args]).first<{result_json:string|null;proof_hash:string}>();
 }
 async readReminderDetails(authority:ControlAuthority,id:string):Promise<import("../../state").CanonicalDetailsV1|null>{
  const a=this.authority(authority),auth=authQuery(a,false);
  const web=authority.kind==="WEB";
  const sql=web?`SELECT r.id,d.* FROM reminders r
   JOIN workspaces w ON w.id=r.workspace_id AND w.kind='PERSONAL'
   JOIN memberships m ON m.workspace_id=w.id AND m.user_id=w.owner_user_id AND m.role='OWNER'
   JOIN chat_identities ci ON ci.id=r.chat_identity_id
   JOIN bot_connections c ON c.id=ci.connection_id AND c.user_id=w.owner_user_id
   JOIN sessions s ON s.user_id=w.owner_user_id AND s.id=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.expires_at=?
   LEFT JOIN reminder_context_details d ON d.reminder_id=r.id
   WHERE r.public_id=? AND r.chat_identity_id=? AND w.id=? AND w.owner_user_id=? AND c.id=? AND ci.private_chat_id=?`
   :`SELECT r.id,d.* FROM reminders r JOIN workspaces w ON w.id=r.workspace_id LEFT JOIN reminder_context_details d ON d.reminder_id=r.id
   WHERE r.public_id=? AND r.chat_identity_id=? AND w.owner_user_id=? AND EXISTS(${auth.sql})`;
  const args=web?[authority.principal.sessionId,a.now,authority.principal.expiresAt,id,a.chat,authority.chat.workspaceId,a.owner,authority.chat.connectionId,authority.chat.chatId]
   :[id,a.chat,a.owner,...auth.args];
  const row=await this.statement(sql,args)
   .first<{id:string;reminder_id:string|null;owner_id:string;chat_identity_id:string;encryption_entity_id:string;payload_version:string;payload_ciphertext:unknown;payload_iv:unknown;key_version:number}>();
  if(!row||row.reminder_id===null)return null;
  if(row.owner_id!==a.owner||row.chat_identity_id!==a.chat||row.encryption_entity_id!==row.id||row.payload_version!=="calenote-reminder-details-1")throw new Error("INVALID_CONTEXT_DETAILS");
  try{return CanonicalDetailsV1Schema.parse(JSON.parse(await this.keyring.decryptSensitive("context-contract-reminder-details",identity({ownerId:a.owner,chatIdentityId:a.chat},row.id),row.key_version,{ciphertext:persistedD1Blob(row.payload_ciphertext),iv:persistedD1Blob(row.payload_iv)})));}
  catch{throw new Error("INVALID_CONTEXT_DETAILS");}
 }
 async readOutcome(authority:ControlAuthority,key:string):Promise<ConfirmationResult|null>{
  try{const row=await this.operation(this.authority(authority),key);if(!row)return null;const parsed=resultSchema.safeParse(row.result_json?JSON.parse(row.result_json):null);return parsed.success?{status:"IDEMPOTENT",...parsed.data}:{status:"UNCERTAIN"};}catch{return {status:"UNCERTAIN"};}
 }
 private async recoverConfirmation(authority:ControlAuthority,proof:DecisionProof):Promise<ConfirmationResult|null>{
  const row=await this.operation(this.authority(authority),proof.operationKey);
  if(!row)return null;
  if(row.proof_hash!==await digest(proof))return {status:"STALE"};
  const parsed=resultSchema.safeParse(row.result_json?JSON.parse(row.result_json):null);
  return parsed.success?{status:"IDEMPOTENT",...parsed.data}:{status:"UNCERTAIN"};
 }
 private async loadPreview(s:Snapshot):Promise<CanonicalPreview|null>{
  if(s.pendingDecision?.target.proposalId){
   const p=await this.statement("SELECT * FROM reminder_series_proposals WHERE id=? AND owner_id=? AND chat_identity_id=? AND context_id=? AND context_revision=? AND revision=? AND contract_version=2 AND status='PENDING'",
    [s.pendingDecision.target.proposalId,s.scope.ownerId,s.scope.chatIdentityId,s.id,s.contextRevision,s.draftRevision]).first<{id:string;payload_ciphertext:unknown;payload_iv:unknown;key_version:number}>();
   if(!p)return null;
   return CanonicalPreviewSchema.parse(JSON.parse(await this.keyring.decryptSensitive("context-contract-proposal",identity(s.scope,p.id,this.protocol),p.key_version,{ciphertext:persistedD1Blob(p.payload_ciphertext),iv:persistedD1Blob(p.payload_iv)})));
  }
  const d=await this.statement("SELECT d.*,f.payload_ciphertext,f.payload_iv,f.key_version,f.encryption_entity_id,f.payload_version,f.owner_id FROM command_drafts d JOIN command_draft_context_details f ON f.draft_id=d.id WHERE d.id=? AND d.chat_identity_id=? AND d.contract_version=2 AND d.status='PENDING'",[s.requestId,s.scope.chatIdentityId]).first<{id:string;title_ciphertext:unknown;title_iv:unknown;title_key_version:number;scheduled_at:number;payload_ciphertext:unknown;payload_iv:unknown;key_version:number;encryption_entity_id:string;payload_version:string;owner_id:string}>();
  if(!d||d.owner_id!==s.scope.ownerId||d.encryption_entity_id!==d.id||d.payload_version!=="calenote-reminder-details-1")return null;
  const title=await this.keyring.decryptSensitive("draft-title",d.id,d.title_key_version,{ciphertext:persistedD1Blob(d.title_ciphertext),iv:persistedD1Blob(d.title_iv)});
  const details=CanonicalDetailsV1Schema.parse(JSON.parse(await this.keyring.decryptSensitive("context-contract-draft-details",identity(s.scope,d.id),d.key_version,{ciphertext:persistedD1Blob(d.payload_ciphertext),iv:persistedD1Blob(d.payload_iv)})));
  const localDate=new Date(d.scheduled_at+7*3600000).toISOString().slice(0,10);
  const occurrences=[{index:0,scheduledAt:d.scheduled_at,localDate}],render=renderReminderDetails(title,details,occurrences);
  if(render.status!=="COMPLETE")return null;
  const outbound=s.transcript.filter(t=>t.role==="ASSISTANT"&&t.kind==="PREVIEW").at(-1);
  const text=outbound?.text??render.text,position=text.indexOf(render.text);
  if(position<0||text.indexOf(render.text,position+1)>=0)return null;
  return {schemaVersion:"calenote-context-preview-1",title,details,occurrences,prefix:text.slice(0,position),suffix:text.slice(position+render.text.length)};
 }
 async confirm(authority:ControlAuthority,proof:DecisionProof):Promise<ConfirmationResult>{
  const a=this.authority(authority);
  try{
   const prior=await this.operation(a,proof.operationKey),proofHash=await digest(proof);
   if(prior){if(prior.proof_hash!==proofHash)return {status:"STALE"};return await this.readOutcome(authority,proof.operationKey)??{status:"UNCERTAIN"};}
   const row=await this.readRow(a,proof.contextId);
   if(!row||!["CLARIFYING","DRAFT_READY"].includes(row.status))return {status:"STALE"};
   if(row.expires_at<=a.now)return {status:"EXPIRED"};
   let s:Snapshot,preview:CanonicalPreview|null;
   try { s=await this.decryptState(row,{ownerId:a.owner,chatIdentityId:a.chat}); preview=await this.loadPreview(s); }
   catch { return {status:"REJECTED"}; }
   if(!preview||!await validateConfirmation(s,preview,proof,authority,a.now))return {status:"REJECTED"};
   const marker=randomOpaqueId(),cas=this.rowCas(row);
   const after=authority.kind==="CHAT"?` AND EXISTS(SELECT 1 FROM inbound_updates WHERE id=?
    AND (received_at>? OR (received_at=? AND rowid>?))
    AND (received_at>? OR (received_at=? AND rowid>?)))`:"";
   const order=s.pendingDecision!.issuedAfterInbound,previewOrder=s.previewReceipt!.issuedAfterOrder;
   const statements=[this.permit(a,s.id,marker,"CONFIRM",cas.sql+" AND EXISTS(SELECT 1 FROM conversation_contract_ownership WHERE context_id=? AND chat_identity_id=? AND owner_id=?)"+after,
    [...cas.args,a.now,s.id,a.chat,a.owner,...(authority.kind==="CHAT"?[authority.scope.sourceInboundId,Date.parse(order.receivedAt),Date.parse(order.receivedAt),order.rowid,Date.parse(previewOrder.receivedAt),Date.parse(previewOrder.receivedAt),previewOrder.rowid]:[])])];
   const proposalId=s.pendingDecision!.target.proposalId,seriesId=proposalId?randomOpaqueId():null,seriesPublicId=proposalId?randomOpaqueId():null;
   const inbound=authority.kind==="CHAT"?authority.scope.sourceInboundId:s.inbound.id;
   if(proposalId){
    statements.push(this.statement(`UPDATE reminder_series_proposals SET status='CONFIRMED',transaction_marker=?,resolution_inbound_id=? WHERE id=? AND ${permitted}`,[marker,authority.kind==="CHAT"?inbound:null,proposalId,marker]),
     this.statement(`INSERT INTO reminder_series(id,public_id,owner_id,chat_identity_id,proposal_id,revision,status,created_at,updated_at) SELECT ?,?,?,?,?,1,'ACTIVE',?,? WHERE ${permitted}`,[seriesId,seriesPublicId,a.owner,a.chat,proposalId,a.now,a.now,marker]));
    const detail=await this.detail("context-contract-series-details",s.scope,seriesId!,preview.details);
    statements.push(this.statement(`INSERT INTO reminder_series_context_details(series_id,owner_id,chat_identity_id,encryption_entity_id,payload_version,payload_ciphertext,payload_iv,key_version) SELECT ?,?,?,?,'calenote-reminder-details-1',?,?,1 WHERE ${permitted}`,[seriesId,a.owner,a.chat,seriesId,detail.ciphertext,detail.iv,marker]));
   }
   const reminderPublicIds:string[]=[],reminders:unknown[][]=[],details:unknown[][]=[],occurrences:unknown[][]=[];
   for(const occurrence of preview.occurrences){
    const id=randomOpaqueId(),publicId=randomOpaqueId();reminderPublicIds.push(publicId);
    const title=await this.keyring.encryptSensitive("reminder-title",id,1,preview.title);
    const detail=await this.detail("context-contract-reminder-details",s.scope,id,preview.details);
    reminders.push([id,publicId,s.scope.workspaceId,a.chat,proposalId?null:s.requestId,title.ciphertext,title.iv,occurrence.scheduledAt,a.now,a.now,marker,marker]);
    details.push([id,a.owner,a.chat,id,detail.ciphertext,detail.iv,marker]);
    if(seriesId)occurrences.push([seriesId,occurrence.index,id,marker]);
   }
   this.appendRows(statements,"INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,source_draft_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at,context_write_marker)","SELECT ?,?,?,?,?,?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',?,?,?",reminders);
   if(seriesId)this.appendRows(statements,"INSERT INTO reminder_series_occurrences(series_id,occurrence_index,reminder_id)","SELECT ?,?,?",occurrences);
   this.appendRows(statements,"INSERT INTO reminder_context_details(reminder_id,owner_id,chat_identity_id,encryption_entity_id,payload_version,payload_ciphertext,payload_iv,key_version)","SELECT ?,?,?,?,'calenote-reminder-details-1',?,?,1",details);
   if(!proposalId)statements.push(this.statement(`UPDATE command_drafts SET status='CONFIRMED',resolution_inbound_id=?,updated_at=?,write_marker=? WHERE id=? AND ${permitted}`,[authority.kind==="CHAT"?inbound:null,a.now,marker,s.requestId,marker]));
   const result={reminderPublicIds,seriesPublicId,childCount:reminderPublicIds.length};
   statements.push(this.statement(`UPDATE conversation_contexts SET status='COMPLETED',revision=revision+1,last_inbound_id=?,claim_marker=?,updated_at=?,payload_ciphertext=NULL,payload_iv=NULL,key_version=NULL,write_marker=? WHERE id=? AND ${permitted}`,[inbound,authority.kind==="WEB"?"web:"+authority.principal.sessionId:authority.scope.claimMarker,a.now,marker,s.id,marker]),
    this.statement(`INSERT INTO conversation_context_outcomes(context_id,revision,source_inbound_id,operation,created_at,operation_key,proof_hash,result_json,web_session_id) SELECT ?,?,?,'FINISH',?,?,?,?,? WHERE ${permitted}`,[s.id,s.contextRevision+1,inbound,a.now,await this.confirmationOperationKey(a,proof.operationKey),proofHash,JSON.stringify(result),authority.kind==="WEB"?authority.principal.sessionId:null,marker]));
   if(authority.kind==="CHAT")statements.push(this.statement(`UPDATE inbound_updates SET state='PROCESSED',processed_at=? WHERE id=? AND ${permitted}`,[a.now,inbound,marker]));
   statements.push(...this.terminalCleanup(a,s.id,marker),this.release(marker));
   const results=await this.db.batch(statements);
   if(results[0].meta.changes===1)return {status:"COMMITTED",...result};
   return await this.recoverConfirmation(authority,proof)??{status:"STALE"};
  }catch{
   try{return await this.recoverConfirmation(authority,proof)??{status:"UNCERTAIN"};}catch{return {status:"UNCERTAIN"};}
  }
 }
 private appendRows(statements:D1PreparedStatement[],prefix:string,select:string,rows:unknown[][]){
  const size=Math.floor(95/rows[0].length);
  for(let offset=0;offset<rows.length;offset+=size){
   const group=rows.slice(offset,offset+size),columns=group[0].map((_,i)=>"c"+i);let column=0;
   const projection=(select+" FROM data WHERE "+permitted).replace(/\?/gu,()=>"data.c"+column++);
   statements.push(this.statement(`WITH data(${columns.join(",")}) AS (VALUES ${group.map(()=>`(${columns.map(()=>"?").join(",")})`).join(",")}) ${prefix} ${projection}`,group.flat()));
  }
 }
 async recordDelivery(scope:ConversationScope,receipt:DeliveryReceipt):Promise<"RECORDED"|"STALE">{
  try{
   const a=this.authority({kind:"CHAT",scope}),row=await this.readRow(a,receipt.contextId);
   if(!row||row.revision!==receipt.contextRevision||row.expires_at<=scope.now||!["CLARIFYING","DRAFT_READY"].includes(row.status))return "STALE";
   const s=await this.decryptState(row,scope);
   if(s.inbound.id!==scope.sourceInboundId||s.inbound.claimMarker!==scope.claimMarker||s.draftRevision!==receipt.draftRevision
    ||(s.pendingDecision?.decisionId??null)!==receipt.decisionId||!["SENT","FAILED","UNCERTAIN"].includes(receipt.deliveryState)
    ||(receipt.messageRef!==null&&receipt.messageRef.length>512))return "STALE";
   const outbound=s.transcript.find(t=>t.id===receipt.outboundId&&t.role==="ASSISTANT");
   if(!outbound||outbound.role!=="ASSISTANT"||s.transcript.filter(t=>t.role==="ASSISTANT").at(-1)?.id!==outbound.id)return "STALE";
   if(outbound.deliveryState!=="UNCERTAIN")return outbound.deliveryState===receipt.deliveryState&&outbound.messageRef===receipt.messageRef?"RECORDED":"STALE";
   outbound.deliveryState=receipt.deliveryState;outbound.messageRef=receipt.messageRef;
   if(s.pendingReminderQuestion?.questionId===receipt.outboundId)s.pendingReminderQuestion.deliveryState=receipt.deliveryState;
   if(s.pendingQueryQuestion?.questionId===receipt.outboundId)s.pendingQueryQuestion.deliveryState=receipt.deliveryState;
   if(s.previewReceipt?.previewId===receipt.outboundId){s.previewReceipt.deliveryState=receipt.deliveryState;s.previewReceipt.replyReference=receipt.messageRef;}
   if(s.pendingDecision&&(s.pendingDecision.previewId===receipt.outboundId||s.pendingDecision.questionId===receipt.outboundId)){
    if(receipt.deliveryState!=="SENT")s.pendingDecision=null;
    else {s.pendingDecision.deliveryState="SENT";s.pendingDecision.replyReference=receipt.messageRef;}
   }
   const encoded=s.schemaVersion==="calenote-context-state-2"?encodeContextSnapshotV2(s):encodeContextSnapshot(s);if(bytes(encoded)>16384)return "STALE";
   const encrypted=await this.keyring.encryptSensitive("context-contract-state",identity(s.scope,s.id,this.protocol),1,encoded);
   const marker=randomOpaqueId(),cas=this.rowCas(row);
   const result=await this.db.batch([
    this.permit(a,s.id,marker,"DELIVERY",cas.sql+` AND EXISTS(SELECT 1 FROM inbound_updates i WHERE i.id=? AND NOT ${newerConversationOutcomeSql("i",true)})`,[...cas.args,scope.now,scope.sourceInboundId],false),
    this.statement(`UPDATE conversation_contexts SET payload_ciphertext=?,payload_iv=?,write_marker=? WHERE id=? AND ${permitted}`,[encrypted.ciphertext,encrypted.iv,marker,s.id,marker]),
    this.release(marker)]);
   return result[0].meta.changes===1?"RECORDED":"STALE";
  }catch{return "STALE";}
 }
 async purgeExpired(now:number,limit:number):Promise<number>{
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(limit)||limit<1)throw new TypeError("Invalid purge bounds");
  const rows=(await this.statement("SELECT * FROM conversation_contexts WHERE contract_version=2 AND "+active+" AND expires_at<=? ORDER BY expires_at,id LIMIT ?",[now,Math.min(limit,100)]).all<Row>()).results;
  let count=0;
  for(const row of rows){
   const marker=randomOpaqueId();
   const statements=[this.statement(`INSERT INTO conversation_contract_write_permits(chat_identity_id,context_id,marker,operation) SELECT ?,?,?,'PURGE'
    WHERE NOT EXISTS(SELECT 1 FROM conversation_contract_write_permits WHERE chat_identity_id=?)
    AND EXISTS(SELECT 1 FROM conversation_contexts WHERE id=? AND revision=? AND contract_version=2 AND ${active} AND expires_at<=?)`,[row.chat_identity_id,row.id,marker,row.chat_identity_id,row.id,row.revision,now]),
    this.statement(`UPDATE conversation_contexts SET status='EXPIRED',revision=revision+1,updated_at=?,payload_ciphertext=NULL,payload_iv=NULL,key_version=NULL,write_marker=? WHERE id=? AND ${permitted}`,[now,marker,row.id,marker]),
    this.statement(`UPDATE command_drafts SET status='EXPIRED',updated_at=?,write_marker=? WHERE chat_identity_id=? AND contract_version=2 AND status='PENDING' AND ${permitted}`,[now,marker,row.chat_identity_id,marker]),
    this.statement(`UPDATE reminder_series_proposals SET status='EXPIRED',transaction_marker=?,payload_ciphertext=zeroblob(16),payload_iv=zeroblob(12) WHERE chat_identity_id=? AND contract_version=2 AND status='PENDING' AND ${permitted}`,[marker,row.chat_identity_id,marker]),
    this.statement(`INSERT INTO conversation_context_outcomes(context_id,revision,source_inbound_id,operation,created_at) SELECT ?,?,?,'FINISH',? WHERE ${permitted}`,[row.id,row.revision+1,row.last_inbound_id,now,marker]),
    this.statement(`DELETE FROM command_draft_context_details WHERE chat_identity_id=? AND ${permitted}`,[row.chat_identity_id,marker]),
    this.statement(`DELETE FROM conversation_contract_ownership WHERE context_id=? AND ${permitted}`,[row.id,marker]),this.release(marker)];
   count+=(await this.db.batch(statements))[0].meta.changes===1?1:0;
  }
  return count;
 }
}
