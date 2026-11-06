// @vitest-environment node
import { readFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
import { harness, proposal } from "@/modules/conversation/context-contract/service-test-support";
import { date, now, time } from "@/modules/conversation/context-contract/resolution-test-support";
import { D1FollowThroughService } from "@/modules/follow-through/service";
import { D1SeriesStore } from "./series-store";
import { D1CanonicalSeriesStore } from "./canonical-series-store";
import {D1ReminderDeliveryStore} from './delivery-store';

const principal = { userId: "owner", sessionId: "session", expiresAt: now + 1_000_000 };
const at = now + 10;
const weekly = (title = "kiểm tra QA", day = 9) => proposal({ title, frequency: "WEEKLY", reminderDate: date(day, 11, 2026), reminderTime: time(9), occurrenceCount: 4, eventRelation: "STARTING_ON" });
const monthly = proposal({ title: "kiểm tra QA", frequency: "MONTHLY", reminderDate: date(15, 11, 2026), reminderTime: time(9), occurrenceCount: 3, eventRelation: "STARTING_ON" });
const weeklyText = (day = 9) => `Nhắc kiểm tra QA mỗi tuần lúc9h từ ngày${String(day).padStart(2, "0")}/11/2026 trong 4 tuần.`;

/** Real context-service creation, then the follow-through/settlement migrations
 * that production applies after 0009. */
async function created(proposals = [weekly()], texts = [weeklyText()]) {
  const h = await harness(proposals);
  for (const file of ["0014_reminder_follow_through.sql", "0015_personal_assistant.sql", "0016_personal_assistant_dispatch.sql", "0022_advance_group_settlement.sql"])
    if (existsSync(`migrations/${file}`)) h.f.sqlite!.sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  h.deps.getReplyPreferences = async () => ({ addressStyle: "sep", customDisplayName: null });
  let turn = 0;
  for (const text of texts) {
    expect(await h.turn(turn, text), JSON.stringify(h.events)).toEqual({ status: "DRAFT_CREATED" });
    const state = (await h.read(turn + 1))!;
    expect(await h.turn(turn + 1, `xác nhận ${state.pendingDecision!.tokenHandle}`)).toEqual({ status: "CONFIRMED" });
    turn += 2;
  }
  const store = new D1CanonicalSeriesStore(h.f.db, h.f.keyring);
  const statuses = async () => (await h.f.db.prepare("SELECT r.status FROM reminder_series_occurrences o JOIN reminders r ON r.id=o.reminder_id ORDER BY o.series_id,o.occurrence_index").all<{ status: string }>()).results.map(r => r.status);
  const count = async (sql: string) => Number(await h.f.db.prepare(sql).first("n"));
  return { h, db: h.f.db, store, statuses, count };
}

it.each([
  { name: "weekly", proposals: [weekly()], texts: [weeklyText()], dates: ["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"] },
  { name: "monthly", proposals: [monthly], texts: ["Nhắc kiểm tra QA mỗi tháng lúc9h từ ngày15/11/2026 trong 3 tháng."], dates: ["2026-11-15", "2026-12-15", "2027-01-15"] },
])("lists a service-created canonical $name series while the legacy reader stays filtered", async c => {
  const { h, store } = await created(c.proposals, c.texts);
  const listed = await store.list(principal, at);
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ revision: 1, state: "ACTIVE", title: "kiểm tra QA", calendar: "GREGORIAN" });
  expect(listed[0].occurrences).toEqual(c.dates.map(localDate => ({ localDate, localTime: "09:00", status: "PENDING" })));
  expect(listed[0].publicId).toMatch(/^[A-Za-z0-9_-]{22}$/u);
  expect(await new D1SeriesStore(h.f.db, h.f.keyring).listWeb(principal, at)).toEqual([]);
});

it("foreign owner, revoked or expired sessions neither read nor mutate", async () => {
  const { db, store, statuses, count } = await created();
  const [{ publicId }] = await store.list(principal, at);
  await db.prepare("INSERT INTO users VALUES('other','other@example.test','Other','Asia/Ho_Chi_Minh',1,1)").run();
  await db.prepare("INSERT INTO sessions VALUES('other-session','other','digest2',?,NULL,1)").bind(now + 1_000_000).run();
  const other = { userId: "other", sessionId: "other-session", expiresAt: now + 1_000_000 };
  expect(await store.list(other, at)).toEqual([]);
  expect(await store.cancel(other, { publicId, expectedRevision: 1 }, at)).toEqual({ result: "NOT_FOUND" });
  // A valid foreign session cannot borrow the owner's user id.
  expect(await store.cancel({ ...other, userId: "owner" }, { publicId, expectedRevision: 1 }, at)).toEqual({ result: "NOT_FOUND" });
  expect(await store.list(principal, now + 2_000_000)).toEqual([]);
  expect(await store.cancel(principal, { publicId, expectedRevision: 1 }, now + 2_000_000)).toEqual({ result: "NOT_FOUND" });
  await db.prepare("UPDATE sessions SET revoked_at=? WHERE id='session'").bind(at).run();
  expect(await store.list(principal, at)).toEqual([]);
  expect(await store.cancel(principal, { publicId, expectedRevision: 1 }, at)).toEqual({ result: "NOT_FOUND" });
  expect(await statuses()).toEqual(["PENDING", "PENDING", "PENDING", "PENDING"]);
  expect(await count("SELECT count(*) n FROM audit_events WHERE action='CANONICAL_REMINDER_SERIES_CANCELLED'")).toBe(0);
});

it("revision CAS, idempotent retry and concurrent cancel produce exactly one audited winner", async () => {
  const { db, store, statuses, count } = await created();
  const [{ publicId }] = await store.list(principal, at);
  expect(await store.cancel(principal, { publicId, expectedRevision: 2 }, at)).toEqual({ result: "CONFLICT" });
  expect(await statuses()).toEqual(["PENDING", "PENDING", "PENDING", "PENDING"]);
  const results = await Promise.all([store.cancel(principal, { publicId, expectedRevision: 1 }, at), store.cancel(principal, { publicId, expectedRevision: 1 }, at)]);
  expect(results.map(r => r.result).sort()).toEqual(["ALREADY_CANCELLED", "CANCELLED"]);
  expect(results.find(r => r.result === "CANCELLED")).toEqual({ result: "CANCELLED", revision: 2, cancelledReminders: 4, cancelledDeliveries: 0, stoppedTasks: 4, preservedUnchanged: 0 });
  expect(await store.cancel(principal, { publicId, expectedRevision: 1 }, at + 1)).toEqual({ result: "ALREADY_CANCELLED", revision: 2 });
  expect(await statuses()).toEqual(["CANCELLED", "CANCELLED", "CANCELLED", "CANCELLED"]);
  expect(await count("SELECT count(*) n FROM audit_events WHERE action='CANONICAL_REMINDER_SERIES_CANCELLED'")).toBe(1);
  expect(await count("SELECT count(*) n FROM reminder_series_proposals WHERE status='CONFIRMED' AND contract_version=2")).toBe(1);
  const [view] = await store.list(principal, at + 2);
  expect(view).toMatchObject({ state: "CANCELLED", revision: 2 });
  expect(await db.prepare("SELECT revision FROM reminder_series").first("revision")).toBe(2);
});

it("cancels unacquired claimed/pending children and preserves acquired or uncertain sends", async () => {
  const { db, store, statuses } = await created();
  const ids = (await db.prepare("SELECT reminder_id id FROM reminder_series_occurrences ORDER BY occurrence_index").all<{ id: string }>()).results.map(r => r.id);
  const delivery = (id: string, reminder: string, status: string) => db.prepare("INSERT INTO reminder_deliveries(id,reminder_id,status,attempt_count,send_started_at,transition_marker,created_at,updated_at) VALUES(?,?,?,1,?,'delivery-owned',?,?)").bind(id, reminder, status, at, at, at).run();
  await db.prepare("UPDATE reminders SET status='CLAIMED',claimed_at=? WHERE id IN (?,?)").bind(at, ids[0], ids[1]).run();
  await delivery("d1", ids[1], "SENDING");
  await db.prepare("UPDATE reminders SET status='UNCERTAIN' WHERE id=?").bind(ids[2]).run();
  await delivery("d2", ids[2], "UNCERTAIN");
  await delivery("d3", ids[3], "PENDING");
  const [{ publicId }] = await store.list(principal, at);
  expect(await store.cancel(principal, { publicId, expectedRevision: 1 }, at)).toEqual({ result: "CANCELLED", revision: 2, cancelledReminders: 2, cancelledDeliveries: 1, stoppedTasks: 4, preservedUnchanged: 2 });
  expect(await statuses()).toEqual(["CANCELLED", "CLAIMED", "UNCERTAIN", "CANCELLED"]);
  expect((await db.prepare("SELECT id,status FROM reminder_deliveries ORDER BY id").all()).results).toEqual([{ id: "d1", status: "SENDING" }, { id: "d2", status: "UNCERTAIN" }, { id: "d3", status: "CANCELLED" }]);
});

it("cancels a current snoozed descendant and stops future follow-ups without touching another series", async () => {
  const { h, db, store, count } = await created([weekly("kiểm tra QA", 9), weekly("kiểm tra QA", 10)], [weeklyText(9), weeklyText(10)]);
  const tasks = new D1FollowThroughService(db, h.f.keyring, { now: () => at });
  const listed = await store.list(principal, at);
  expect(listed).toHaveLength(2);
  const target = listed.find(s => s.occurrences[0].localDate === "2026-11-09")!;
  const items = (await tasks.list({ userId: "owner" })).items;
  const first = items.find(i => i.scheduledAt === Date.parse("2026-11-09T09:00:00+07:00"))!;
  await tasks.act({ userId: "owner" }, { action: "SNOOZE", publicId: first.publicId, expectedRevision: first.revision, idempotencyKey: "snooze-canonical-1", scheduledAt: Date.parse("2026-11-09T12:00:00+07:00") });
  await db.prepare("UPDATE follow_through_items SET follow_up_enabled=1,next_follow_up_at=? WHERE root_reminder_id IN (SELECT reminder_id FROM reminder_series_occurrences o JOIN reminder_series s ON s.id=o.series_id WHERE s.public_id=?)").bind(at + 999, target.publicId).run();
  const snoozedChild = await db.prepare("SELECT current_reminder_id id FROM follow_through_items WHERE current_reminder_id<>root_reminder_id").first<string>("id");
  expect(snoozedChild).toBeTruthy();
  const result = await store.cancel(principal, { publicId: target.publicId, expectedRevision: 1 }, at);
  expect(result).toMatchObject({ result: "CANCELLED", stoppedTasks: 4 });
  expect(await db.prepare("SELECT status FROM reminders WHERE id=?").bind(snoozedChild).first("status")).toBe("CANCELLED");
  expect(await count("SELECT count(*) n FROM follow_through_items WHERE progress='OPEN' OR follow_up_enabled=1 OR next_follow_up_at IS NOT NULL")).toBe(4);
  const other = (await store.list(principal, at)).find(s => s.publicId !== target.publicId)!;
  expect(other).toMatchObject({ state: "ACTIVE", revision: 1 });
  expect(other.occurrences.every(o => o.status === "PENDING")).toBe(true);
});

it("rolls back every mutation when a later batch statement fails", async () => {
  const { h, db, store, statuses, count } = await created();
  const [{ publicId }] = await store.list(principal, at);
  h.f.sqlite!.sqlite.exec("CREATE TRIGGER test_fail_series BEFORE UPDATE ON reminder_series BEGIN SELECT RAISE(ABORT,'TEST_LATE_FAILURE'); END;");
  await expect(store.cancel(principal, { publicId, expectedRevision: 1 }, at)).rejects.toThrow();
  expect(await statuses()).toEqual(["PENDING", "PENDING", "PENDING", "PENDING"]);
  expect(await count("SELECT count(*) n FROM audit_events WHERE action='CANONICAL_REMINDER_SERIES_CANCELLED'")).toBe(0);
  expect(await count("SELECT count(*) n FROM follow_through_items WHERE progress='OPEN'")).toBe(4);
  h.f.sqlite!.sqlite.exec("DROP TRIGGER test_fail_series;");
  expect(await store.cancel(principal, { publicId, expectedRevision: 1 }, at)).toMatchObject({ result: "CANCELLED" });
  expect(await db.prepare("SELECT status FROM reminder_series").first("status")).toBe("CANCELLED");
});

it("fails closed when canonical companion details are missing or bound to another owner", async () => {
  const { db, store } = await created();
  await db.prepare("UPDATE reminder_series_context_details SET encryption_entity_id='forged'").run();
  expect(await store.listPage(principal, at)).toMatchObject({series:[],skipped:1,hasMore:false,nextCursor:null});
  await db.prepare("DELETE FROM reminder_series_context_details").run();
  expect(await store.listPage(principal, at)).toMatchObject({series:[],skipped:1,hasMore:false,nextCursor:null});
});

it("loss of OWNER membership removes canonical read and cancellation authority", async () => {
  const {db,store,statuses}=await created();const [{publicId}]=await store.list(principal,at);
  await db.prepare("DELETE FROM memberships WHERE user_id='owner'").run();
  expect(await store.list(principal,at)).toEqual([]);
  expect(await store.cancel(principal,{publicId,expectedRevision:1},at)).toEqual({result:"NOT_FOUND"});
  expect(await statuses()).toEqual(["PENDING","PENDING","PENDING","PENDING"]);
});
it("a FAILED delivery retains the same cancellation fence as the individual reminder API",async()=>{
  const {db,store}=await created();const [{publicId}]=await store.list(principal,at);
  const root=await db.prepare("SELECT reminder_id FROM reminder_series_occurrences ORDER BY occurrence_index LIMIT 1").first<string>("reminder_id");
  await db.prepare("UPDATE reminders SET status='RETRYABLE' WHERE id=?").bind(root).run();
  await db.prepare("INSERT INTO reminder_deliveries(id,reminder_id,status,attempt_count,created_at,updated_at) VALUES('failed-fence',?,'FAILED',1,?,?)").bind(root,at,at).run();
  await store.cancel(principal,{publicId,expectedRevision:1},at);
  expect(await db.prepare("SELECT status FROM reminders WHERE id=?").bind(root).first("status")).toBe("RETRYABLE");
  expect(await db.prepare("SELECT status FROM reminder_deliveries WHERE id='failed-fence'").first("status")).toBe("FAILED");
});
it("delivery mutations belong only to this cancellation winner, not an earlier cancelled lineage",async()=>{
  const {db,store}=await created();const [{publicId}]=await store.list(principal,at);
  const root=await db.prepare("SELECT reminder_id FROM reminder_series_occurrences ORDER BY occurrence_index LIMIT 1").first<string>("reminder_id");
  await db.prepare("UPDATE reminders SET status='CANCELLED',cancelled_at=?,transition_marker='prior-owner-cancel' WHERE id=?").bind(at-1,root).run();
  await db.prepare("INSERT INTO reminder_deliveries(id,reminder_id,status,attempt_count,created_at,updated_at) VALUES('prior-pending',?,'PENDING',0,?,?)").bind(root,at-1,at-1).run();
  const result=await store.cancel(principal,{publicId,expectedRevision:1},at);
  expect(result).toMatchObject({result:"CANCELLED",cancelledReminders:3,cancelledDeliveries:0});
  expect(await db.prepare("SELECT status FROM reminder_deliveries WHERE id='prior-pending'").first("status")).toBe("PENDING");
});
it("a current snoozed reminder keeps completed roots manageable and visible",async()=>{
 const {h,db,store}=await created();const [{publicId}]=await store.list(principal,at);
 const service=new D1FollowThroughService(db,h.f.keyring,{now:()=>at});const first=(await service.list({userId:'owner'})).items.find(i=>i.scheduledAt===Date.parse('2026-11-09T09:00:00+07:00'))!;
 await service.act({userId:'owner'},{action:'SNOOZE',publicId:first.publicId,expectedRevision:first.revision,idempotencyKey:'visible-snooze-1',scheduledAt:Date.parse('2026-11-09T12:00:00+07:00')});
 await db.prepare("UPDATE reminders SET status='SENT' WHERE status='PENDING' AND id IN (SELECT reminder_id FROM reminder_series_occurrences)").run();
 const view=(await store.list(principal,at)).find(s=>s.publicId===publicId)!;
 expect(view).toMatchObject({state:'ACTIVE',currentReminders:[{localDate:'2026-11-09',localTime:'12:00',status:'PENDING'}]});
 await store.cancel(principal,{publicId,expectedRevision:1},at);
 expect((await store.list(principal,at)).find(s=>s.publicId===publicId)).toMatchObject({state:'CANCELLED',currentReminders:[{status:'CANCELLED'}]});
});
async function untrackedCreated(){
 const h=await harness([weekly()]);expect(await h.turn(0,weeklyText())).toEqual({status:'DRAFT_CREATED'});const state=(await h.read(1))!;expect(await h.turn(1,`xác nhận ${state.pendingDecision!.tokenHandle}`)).toEqual({status:'CONFIRMED'});
 // 0014 deliberately leaves pre-existing canonical reminders untracked.
 h.f.sqlite!.sqlite.exec(readFileSync('migrations/0014_reminder_follow_through.sql','utf8'));
 expect(await h.f.db.prepare('SELECT count(*) n FROM follow_through_items').first('n')).toBe(0);
 return {db:h.f.db,store:new D1CanonicalSeriesStore(h.f.db,h.f.keyring)};
}
it.each([false,true])('settles a retry after canonical cancellation without reacquiring a send (tracked=%s)',async tracked=>{
 const {db,store}=await (tracked?created():untrackedCreated());const [{publicId}]=await store.list(principal,at);
 const root=await db.prepare('SELECT reminder_id FROM reminder_series_occurrences ORDER BY occurrence_index LIMIT 1').first<string>('reminder_id');
 await db.prepare("UPDATE reminders SET status='CLAIMED',claimed_at=? WHERE id=?").bind(at,root).run();
 const delivery=new D1ReminderDeliveryStore(db),snapshot=(await delivery.read(root!))!.followThrough;
 expect((await delivery.acquire(root!,'delivery-cancel-test','send-before-cancel',at,snapshot)).status).toBe('OWNED');
 expect(await store.cancel(principal,{publicId,expectedRevision:1},at+1)).toMatchObject({result:'CANCELLED',preservedUnchanged:1});
 expect(await db.prepare("SELECT status FROM reminder_deliveries WHERE reminder_id=?").bind(root).first('status')).toBe('SENDING');
 await delivery.scheduleRetry(root!,'send-before-cancel',at+100,'quota-after-cancel',at+2);
 expect(await delivery.acquire(root!,'unused-new-delivery','retry-after-cancel',at+100,snapshot)).toEqual({status:'CANCELLED'});
 expect(await db.prepare('SELECT status,attempt_count,retry_not_before FROM reminder_deliveries WHERE reminder_id=?').bind(root).first()).toEqual({status:'CANCELLED',attempt_count:1,retry_not_before:null});
 expect(await db.prepare('SELECT status FROM reminders WHERE id=?').bind(root).first('status')).toBe('CANCELLED');
});
it('preserves successful settlement of an already acquired send after canonical cancellation',async()=>{
 const {db,store}=await untrackedCreated();const [{publicId}]=await store.list(principal,at);const root=await db.prepare('SELECT reminder_id FROM reminder_series_occurrences ORDER BY occurrence_index LIMIT 1').first<string>('reminder_id');
 await db.prepare("UPDATE reminders SET status='CLAIMED',claimed_at=? WHERE id=?").bind(at,root).run();const delivery=new D1ReminderDeliveryStore(db);
 expect((await delivery.acquire(root!,'already-acquired','send-owner',at)).status).toBe('OWNED');await store.cancel(principal,{publicId,expectedRevision:1},at+1);
 await delivery.finalizeSuccess(root!,'send-owner','accepted-receipt','accepted-after-cancel',at+2);expect(await db.prepare('SELECT status FROM reminders WHERE id=?').bind(root).first('status')).toBe('SENT');
});
