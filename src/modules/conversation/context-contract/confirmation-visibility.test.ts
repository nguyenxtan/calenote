// @vitest-environment node
import {expect,it} from 'vitest';
import {harness,proposal,complete,completeText} from './service-test-support';
import {now} from './resolution-test-support';
import {createControlProof} from './control-proof';
import {selectControl} from './decisions';
it('rejects a bare approval received before/equal delivery while preserving the exact decision for a later retry',async()=>{
 const h=await harness([proposal(complete)]);h.deps.now=()=>now+1;
 expect(await h.turn(0,completeText)).toEqual({status:'DRAFT_CREATED'});
 const before=(await h.read(1))!,decision=before.pendingDecision!;
 expect(await h.turn(1,'Có.')).toEqual({status:'REJECTED'});
 expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
 const after=(await h.read(2))!;expect(after.pendingDecision).toEqual(decision);expect(after.previewReceipt).toEqual(before.previewReceipt);
 expect(h.replies.at(-1)?.text).toContain('xác nhận lại');
 h.deps.now=()=>now+2;
 expect(await h.turn(2,'Có.')).toEqual({status:'CONFIRMED'});
 expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(1);
 expect(h.inputs).toHaveLength(1);
});
it('accepts an addressed token despite coarse or skewed provider timestamp, and permits cancellation',async()=>{
 const h=await harness([proposal(complete)]);h.deps.now=()=>now+100;
 expect(await h.turn(0,completeText)).toEqual({status:'DRAFT_CREATED'});
 const state=(await h.read(1))!;
 expect(await h.turn(1,`xác nhận ${state.pendingDecision!.tokenHandle}`)).toEqual({status:'CONFIRMED'});
 const cancel=await harness([proposal(complete)]);cancel.deps.now=()=>now+100;
 expect(await cancel.turn(0,completeText)).toEqual({status:'DRAFT_CREATED'});
 expect(await cancel.turn(1,'hủy')).toEqual({status:'CANCELLED'});
});
it('old snapshots without a delivery timestamp require an addressed proof rather than invented timing',async()=>{
 const h=await harness([proposal(complete)]);expect(await h.turn(0,completeText)).toEqual({status:'DRAFT_CREATED'});
 const old=structuredClone((await h.read(1))!);delete (old.pendingDecision as typeof old.pendingDecision&{deliveredAt?:string}).deliveredAt;
 const scope=h.f.scope(1),observed=await h.deps.store.observe(scope);if('failure' in observed)throw Error(observed.failure);
 const authority={kind:'CHAT' as const,scope};
 const bare=selectControl('Có.',old.pendingDecision,authority,{snapshot:old,now:scope.now});if(bare.kind!=='APPROVE')throw Error('approval');
 expect(await createControlProof(old,observed.observation.inbound,'Có.',bare,authority,scope.now)).toBeNull();
 const text=`xác nhận ${old.pendingDecision!.tokenHandle}`,addressed=selectControl(text,old.pendingDecision,authority,{snapshot:old,now:scope.now});if(addressed.kind!=='APPROVE')throw Error('addressed');
 expect(await createControlProof(old,observed.observation.inbound,text,addressed,authority,scope.now)).not.toBeNull();
});

it('rechecks the immutable inbound timestamp at the final SQL confirmation fence',async()=>{
 const h=await harness([proposal(complete)]);expect(await h.turn(0,completeText)).toEqual({status:'DRAFT_CREATED'});
 const state=(await h.read(1))!,scope=h.f.scope(1),observed=await h.deps.store.observe(scope);if('failure' in observed)throw Error(observed.failure);
 const authority={kind:'CHAT' as const,scope},control=selectControl('Có.',state.pendingDecision,authority,{snapshot:state,now:scope.now});
 if(control.kind!=='APPROVE')throw Error('approval');
 const proof=await createControlProof(state,observed.observation.inbound,'Có.',control,authority,scope.now);expect(proof).not.toBeNull();if(!proof)return;
 // Exercise the final boundary independently of the proof constructor.
 await h.f.db.prepare('UPDATE inbound_updates SET received_at=? WHERE id=?').bind(now,scope.sourceInboundId).run();
 expect(await h.deps.store.confirm(authority,proof)).toMatchObject({status:'STALE'});
 expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
 await h.f.db.prepare('UPDATE inbound_updates SET received_at=? WHERE id=?').bind(scope.now,scope.sourceInboundId).run();
 expect(await h.deps.store.confirm(authority,proof)).toMatchObject({status:'COMMITTED'});
});
