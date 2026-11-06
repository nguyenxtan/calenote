// @vitest-environment node
import {expect,it} from 'vitest';
import {harness} from './service-test-support';
import {isBurstFragment,burstMemberIndexes} from './burst-policy';

async function pending(h:Awaited<ReturnType<typeof harness>>,i:number,text:string){
 const id=h.f.scope(i).sourceInboundId,e=await h.f.keyring.encryptSensitive('inbound-message',id,1,text);
 await h.f.db.prepare("UPDATE inbound_updates SET state='PENDING',transition_marker=NULL,message_ciphertext=?,message_iv=? WHERE id=?")
  .bind(e.ciphertext,e.iv,id).run();
}
it('defers an eligible head without a model/reply, preserving each actual USER receipt for its tail',async()=>{
 const h=await harness([]);await pending(h,1,'mai 8h');
 expect(await h.turn(0,'Nhắc họp QA')).toEqual({status:'DEFERRED'});
 expect(h.inputs).toHaveLength(0);expect(h.replies).toHaveLength(0);
 await h.f.db.prepare("UPDATE inbound_updates SET state='PROCESSING',transition_marker='claim' WHERE id='in-1'").run();
 const next=await h.read(1);
 expect(next?.transcript).toMatchObject([{role:'USER',id:'old',text:'Nhắc họp QA',receivedAt:new Date(h.f.scope().now).toISOString()}]);
 expect(next?.requestId).toBeNull();expect(next?.lifecycle).toBe('NONE');
});
it.each(['có','hủy','xin chào','/help','/memory','trí nhớ việc','xong','hoãn abc','đổi lịch abc 2026-12-01 08:00'])('does not fold across command barrier %s',async text=>{
 const h=await harness([]);await pending(h,1,text);
 expect((await h.turn(0,'Nhắc họp QA')).status).not.toBe('DEFERRED');
 expect(h.inputs).toHaveLength(1);
});
it('rechecks the immediate pending follower in the atomic apply after a late barrier is inserted',async()=>{
 const h=await harness([]);await pending(h,2,'mai 8h');
 await h.f.db.prepare("UPDATE inbound_updates SET state='FAILED' WHERE id='in-1'").run();
 const apply=h.deps.store.apply.bind(h.deps.store);
 h.deps.store.apply=async(...args)=>{
  await h.f.db.prepare("UPDATE inbound_updates SET state='PENDING',transition_marker=NULL WHERE id='in-1'").run();
  return apply(...args);
 };
 expect((await h.turn(0,'Nhắc họp QA')).status).not.toBe('DEFERRED');
 expect(await h.f.db.prepare("SELECT state FROM inbound_updates WHERE id='old'").first('state')).toBe('PROCESSED');
 expect(h.inputs).toHaveLength(1);
});

it('uses one model call and one preview for a two-fragment request without combining source texts',async()=>{
 const h=await harness([input=>({schemaVersion:'calenote-context-3',intent:'CREATE_REMINDER',requestTarget:{kind:'NEW',evidence:[{kind:'USER_QUOTE',turn:0,quote:'Nhắc họp QA',occurrence:1}]},
  changes:[{field:'title',value:'họp QA',operation:'SET',evidence:[{kind:'USER_QUOTE',turn:0,quote:'họp QA',occurrence:1}]},
   {field:'reminderDate',value:{kind:'RELATIVE_DAY',offsetDays:1},operation:'SET',evidence:[{kind:'USER_QUOTE',turn:input.currentTurn,quote:'mai',occurrence:1}]},
   {field:'reminderTime',value:{hour:8,minute:0,qualifier:'H24'},operation:'SET',evidence:[{kind:'USER_QUOTE',turn:input.currentTurn,quote:'8h',occurrence:1}]}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null})]);
 await pending(h,1,'mai 8h');expect(await h.turn(0,'Nhắc họp QA')).toEqual({status:'DEFERRED'});
 await h.f.db.prepare("UPDATE inbound_updates SET state='PROCESSING',transition_marker='claim' WHERE id='in-1'").run();
 expect(await h.turn(1,'mai 8h')).toEqual({status:'DRAFT_CREATED'});
 expect(h.inputs).toHaveLength(1);expect(h.replies).toHaveLength(1);
 expect(h.inputs[0]).toMatchObject({currentBurstTurns:[0,1],turns:[{role:'USER',text:'Nhắc họp QA'},{role:'USER',text:'mai 8h'}]});
});

it('enforces the source span/turn bound and excludes addressed controls as fragments',async()=>{
 const h=await harness([]);await pending(h,1,'mai 8h');await h.turn(0,'Nhắc họp QA');
 await h.f.db.prepare("UPDATE inbound_updates SET state='PROCESSING',transition_marker='claim' WHERE id='in-1'").run();
 const snapshot=await h.read(1);if(!snapshot)throw Error('missing deferred receipt');
 const first=snapshot.transcript[0];
 expect(burstMemberIndexes(snapshot,[first,{...first,id:'b',receivedAt:new Date(Date.parse(first.receivedAt)+10000).toISOString()}])).toEqual([0,1]);
 expect(burstMemberIndexes(snapshot,[first,{...first,id:'b',receivedAt:new Date(Date.parse(first.receivedAt)+10001).toISOString()}])).toBeUndefined();
 expect(burstMemberIndexes(snapshot,[first,first,first,first])).toBeUndefined();
 expect(isBurstFragment('/confirm token')).toBe(false);
 expect(isBurstFragment('xác nhận abcdefghijkl')).toBe(false);
});

it('folds at most three receipts, with a fourth pending fragment left for the next turn',async()=>{
 const h=await harness([]);await pending(h,1,'mai');await pending(h,2,'8h');await pending(h,3,'ở Quang Trung');
 expect(await h.turn(0,'Nhắc họp QA')).toEqual({status:'DEFERRED'});
 await h.f.db.prepare("UPDATE inbound_updates SET state='PROCESSING',transition_marker='claim' WHERE id='in-1'").run();
 expect(await h.turn(1,'mai')).toEqual({status:'DEFERRED'});
 await h.f.db.prepare("UPDATE inbound_updates SET state='PROCESSING',transition_marker='claim' WHERE id='in-2'").run();
 expect((await h.turn(2,'8h')).status).not.toBe('DEFERRED');
 expect(h.inputs).toHaveLength(1);expect(h.inputs[0].currentBurstTurns).toEqual([0,1,2]);
 expect(h.inputs[0].turns.map(t=>t.text)).toEqual(['Nhắc họp QA','mai','8h']);
 expect(await h.f.db.prepare("SELECT state FROM inbound_updates WHERE id='in-3'").first('state')).toBe('PENDING');
});
it('does not skip a corrupt follower or consult a foreign scope',async()=>{
 const h=await harness([]),runtime=h.deps.runtimeStore;
 await pending(h,2,'mai 8h');await h.f.db.prepare("UPDATE inbound_updates SET state='PENDING',transition_marker=NULL WHERE id='in-1'").run();
 expect(await runtime.nextBurstFragment!(h.f.scope())).toBeNull();
 expect(await runtime.nextBurstFragment!({...h.f.scope(),ownerId:'foreign'})).toBeNull();
 expect(await runtime.nextBurstFragment!({...h.f.scope(),claimMarker:'stale'})).toBeNull();
 await h.f.db.prepare("UPDATE inbound_updates SET private_chat_id='foreign-chat' WHERE id='in-1'").run();
 expect(await runtime.nextBurstFragment!(h.f.scope())).toMatchObject({id:'in-2'});
});
it('does not defer when the next eligible receipt is outside the bounded burst span',async()=>{
 const h=await harness([]);await pending(h,1,'mai 8h');
 await h.f.db.prepare("UPDATE inbound_updates SET received_at=? WHERE id='in-1'").bind(h.f.scope().now+10001).run();
 expect((await h.turn(0,'Nhắc họp QA')).status).not.toBe('DEFERRED');expect(h.inputs).toHaveLength(1);
});
