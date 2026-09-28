/** Synthetic local D1 only; actual inbound service/stores, no provider messaging. */
import { readFileSync } from "node:fs";
import { makeContextHarness } from "../../src/modules/conversation/infrastructure/d1/test-support";
import { D1ConversationRuntimeStore } from "../../src/modules/conversation/infrastructure/d1/runtime-store";
import { D1SeriesStore } from "../../src/modules/reminders/infrastructure/d1/series-store";
import { D1ReminderCommandStore } from "../../src/modules/reminders/infrastructure/d1/command-store";
import { D1SemanticReminderQueryStore } from "../../src/modules/reminders/infrastructure/d1/semantic-query-store";
import { D1SemanticBudgetStore } from "../../src/modules/semantic/infrastructure/d1/budget-store";
import { createConversationService } from "../../src/modules/conversation/service";
import { createConversationGateway, type SemanticGatewayConfig, type SemanticTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import type { SemanticAttemptResult } from "../../src/modules/intelligence/semantic-gateway";
import { processBoundChatMessage } from "../../src/modules/reminders/command-service";
import { lunarCalendar } from "../../src/modules/conversation/lunar-calendar";
import { extractConversationTemporalEvidence, type Evidence } from "../../src/modules/conversation/temporal";
import { evaluateConversationTurn } from "../../src/modules/conversation/turn";
import { ConversationSnapshotSchema, type ConversationModel, type ConversationSnapshot } from "../../src/modules/conversation/contracts";
import { persistedD1Blob } from "../../src/modules/db/persisted-blob";

const fact = <T>(e: Evidence<T>, project: (v:T)=>unknown = String): unknown => e.state === "MISSING" ? null : e.state === "AMBIGUOUS" ? "AMBIGUOUS" : project(e.value);
export async function createConversationProbe(config: SemanticGatewayConfig, transport: SemanticTransport, referenceNow: number) {
  const h = await makeContextHarness();
  try {
    for (const sql of readFileSync("migrations/0008_finite_reminder_series.sql","utf8").split(/;\s*(?=CREATE|--|$)/u).map(s=>s.trim()).filter(Boolean)) await h.db.prepare(sql).run();
    await h.db.batch([
      h.db.prepare("INSERT INTO workspaces (id,kind,owner_user_id,created_at,updated_at) VALUES ('space-one','PERSONAL','one',1,1)"),
      h.db.prepare("INSERT INTO memberships (workspace_id,user_id,role,created_at) VALUES ('space-one','one','OWNER',1)"),
    ]);
    let now = referenceNow;
    const gateway = createConversationGateway(config,transport);
    let attempt: SemanticAttemptResult<ConversationModel> | undefined;
    const store = new D1ReminderCommandStore(h.db);
    const service = createConversationService({contextStore:h.store, runtimeStore:new D1ConversationRuntimeStore(h.db),
      seriesStore:new D1SeriesStore(h.db,h.keyring), commandStore:store, keyring:h.keyring, calendar:lunarCalendar,
      now:()=>now, reply:async()=>{}, list:input=>new D1SemanticReminderQueryStore(h.db).list(input),
      budgetStore:new D1SemanticBudgetStore(h.db,{ownerDailyFallbackLimit:50,ownerMonthlyCostMicrounits:500000,
        globalDailyCostMicrounits:2000000,reservationTtlMs:60000,maxInputTokens:config.maxInputTokens,maxOutputTokens:config.maxOutputTokens,
        promptPriceMicrounitsPerMillionTokens:100000,completionPriceMicrounitsPerMillionTokens:400000}),
      gateway:{prepare(tier,input){const prepared=gateway.prepare(tier,input); if(prepared.status!=="READY") {attempt=prepared;return prepared;}
        return {...prepared,dispatch:async()=>{attempt=await prepared.dispatch();return attempt;}};}},
    });
    const snapshot = async (): Promise<ConversationSnapshot|null> => {
      const row = await h.db.prepare("SELECT id,payload_ciphertext,payload_iv,key_version FROM conversation_contexts WHERE owner_id='one' AND chat_identity_id='chat-one' AND status IN ('CLARIFYING','DRAFT_READY') AND expires_at > ?").bind(now).first<{id:string;payload_ciphertext:unknown;payload_iv:unknown;key_version:number}>();
      if(!row) return null;
      return ConversationSnapshotSchema.parse(JSON.parse(await h.keyring.decryptSensitive("conversation-context",JSON.stringify(["one","chat-one",row.id]),row.key_version,
        {ciphertext:persistedD1Blob(row.payload_ciphertext),iv:persistedD1Blob(row.payload_iv)})));
    };
    const drafts=async()=>{
      const rows=await h.db.prepare("SELECT d.id,d.title_ciphertext,d.title_iv,d.title_key_version,d.scheduled_at,d.timezone,f.payload_ciphertext,f.payload_iv,f.key_version FROM command_drafts d LEFT JOIN command_draft_calendar_facts f ON f.draft_id=d.id WHERE d.chat_identity_id='chat-one' AND d.status='PENDING' ORDER BY d.id").all<{
        id:string;title_ciphertext:unknown;title_iv:unknown;title_key_version:number;scheduled_at:number;timezone:string;payload_ciphertext:unknown;payload_iv:unknown;key_version:number;
      }>();
      return await Promise.all(rows.results.map(async row=>({
        title:await h.keyring.decryptSensitive("draft-title",row.id,row.title_key_version,{ciphertext:persistedD1Blob(row.title_ciphertext),iv:persistedD1Blob(row.title_iv)}),
        scheduledAt:row.scheduled_at,timezone:row.timezone,
        calendarFacts:row.payload_ciphertext?JSON.parse(await h.keyring.decryptSensitive("reminder-calendar",JSON.stringify(["one","chat-one",row.id]),row.key_version,{ciphertext:persistedD1Blob(row.payload_ciphertext),iv:persistedD1Blob(row.payload_iv)})):null,
      })));
    };
    const proposals=async()=>{
      const rows=await h.db.prepare("SELECT id,payload_ciphertext,payload_iv,key_version FROM reminder_series_proposals WHERE owner_id='one' AND chat_identity_id='chat-one' AND status='PENDING' ORDER BY id").all<{id:string;payload_ciphertext:unknown;payload_iv:unknown;key_version:number}>();
      return await Promise.all(rows.results.map(async row=>JSON.parse(await h.keyring.decryptSensitive("series-proposal",JSON.stringify(["one","chat-one",row.id]),row.key_version,
        {ciphertext:persistedD1Blob(row.payload_ciphertext),iv:persistedD1Blob(row.payload_iv)}))));
    };
    return {dispose:h.dispose, async turn(text:string,index:number,delayMs=0) {
      now+=delayMs+1; attempt=undefined;
      const previous=await snapshot();
      const beforeDrafts=await drafts(),beforeProposals=await proposals();
      await h.db.prepare("UPDATE inbound_updates SET received_at=? WHERE id=?").bind(now,`one-${index}`).run();
      const result=await processBoundChatMessage({id:`one-${index}`,connectionId:"connection-one",providerUserId:"provider-one",privateChatId:"private-one",text,receivedAt:now,claimMarker:"claim"},
        {store,keyring:h.keyring,now:()=>now,reply:async()=>{},conversation:service});
      const observed=attempt as SemanticAttemptResult<ConversationModel>|undefined;
      const model=observed?.status==="SUCCESS" ? observed.interpretation : undefined;
      const evaluated=model?evaluateConversationTurn({model,text,previous,now,receivedAt:now,sourceInboundId:`one-${index}`},lunarCalendar):undefined;
      const temporal=evaluated?.temporal??extractConversationTemporalEvidence({text,receivedAt:now,sourceInboundId:`one-${index}`,currentCalendar:"GREGORIAN"},lunarCalendar);
      const decision=evaluated?.decision;
      const next=await snapshot();
      const state=await h.db.prepare("SELECT status FROM conversation_contexts WHERE owner_id='one' AND chat_identity_id='chat-one'").first<string>("status")??"NONE";
      const afterProposals=await proposals();
      const occurrences=afterProposals.length===1?afterProposals[0].occurrences:null;
      return {status:result.status,attempt:observed,decision,next,previous,state,occurrences,beforeDrafts,drafts:await drafts(),beforeProposals,proposals:afterProposals,
        evidence:{calendar:fact(temporal.calendar),eventDate:fact(temporal.eventDate,v=>v.solarDate),date:fact(temporal.reminderDate,v=>v.solarDate),time:fact(temporal.time),count:fact(temporal.count,v=>v),relation:fact(temporal.relation)},
        reminders:await h.db.prepare("SELECT count(*) n FROM reminders").first<number>("n"),
      };
    }};
  } catch(error) {await h.dispose();throw error;}
}
