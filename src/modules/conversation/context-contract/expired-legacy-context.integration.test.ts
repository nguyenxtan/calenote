// @vitest-environment node
import { expect, it } from 'vitest';
import { harness, proposal, complete, completeText } from './service-test-support';

async function pendingLegacyContext(h: Awaited<ReturnType<typeof harness>>, expiresAt: number) {
  await h.f.db.prepare(`INSERT INTO semantic_contexts
    (id,owner_id,chat_identity_id,source_inbound_id,target_intent,context_ciphertext,context_iv,context_key_version,status,expires_at,created_at,updated_at)
    VALUES('legacy','owner','identity','old','CREATE_REMINDER',zeroblob(16),zeroblob(12),1,'PENDING',?,?,?)`)
    .bind(expiresAt, expiresAt - 1000, expiresAt - 1000).run();
}

it.each([-1, 0])('replies to a greeting when legacy clarification expired %i ms before this turn', async delta => {
  const h = await harness([]), scope = h.f.scope(1);
  await pendingLegacyContext(h, scope.now + delta);
  expect(await h.turn(1, 'xin chào')).toEqual({ status: 'CLARIFICATION_REQUESTED' });
  expect(h.replies).toHaveLength(1);
  expect(h.inputs).toHaveLength(0);
  expect(await h.f.db.prepare("SELECT state FROM inbound_updates WHERE id='in-1'").first('state')).toBe('PROCESSED');
  expect(await h.f.db.prepare("SELECT status FROM semantic_contexts WHERE id='legacy'").first('status')).toBe('EXPIRED');
  expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
});

it('admits one model attempt and returns a preview after expiring legacy clarification', async () => {
  const h = await harness([proposal(complete)]);
  await pendingLegacyContext(h, h.f.scope(1).now - 1);
  expect(await h.turn(1, completeText)).toEqual({ status: 'DRAFT_CREATED' });
  expect(h.inputs).toHaveLength(1);
  expect(h.replies).toHaveLength(1);
  expect(await h.f.db.prepare('SELECT count(*) n FROM semantic_budget_reservations').first('n')).toBe(1);
  expect(await h.f.db.prepare('SELECT count(*) n FROM reminders').first('n')).toBe(0);
});

it('keeps an unexpired legacy clarification fenced from a successor model attempt', async () => {
  const h = await harness([proposal(complete)]);
  await pendingLegacyContext(h, h.f.scope(1).now + 1);
  expect(await h.turn(1, completeText)).toEqual({ status: 'SUPERSEDED' });
  expect(await h.f.db.prepare("SELECT status FROM semantic_contexts WHERE id='legacy'").first('status')).toBe('PENDING');
  expect(await h.f.db.prepare('SELECT count(*) n FROM semantic_budget_reservations').first('n')).toBe(0);
});

it.each([{ ownerId: 'other' }, { chatIdentityId: 'other' }, { claimMarker: 'other' }])('does not expire legacy state for an unauthorized scope %j', async override => {
  const h = await harness([]);
  await pendingLegacyContext(h, h.f.scope(1).now - 1);
  expect(await h.f.store.observe({ ...h.f.scope(1), ...override })).toEqual({ failure: 'UNAUTHORIZED' });
  expect(await h.f.db.prepare("SELECT status FROM semantic_contexts WHERE id='legacy'").first('status')).toBe('PENDING');
});

it('expires only the authenticated chat and retains the encrypted legacy payload', async () => {
  const h = await harness([]), scope = h.f.scope(1);
  await pendingLegacyContext(h, scope.now - 1);
  await h.f.db.prepare(`INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at)
    VALUES('other-connection','owner','telegram','other-public','other-bot','Test',zeroblob(16),zeroblob(12),'other-fingerprint',1,'ACTIVE_BOUND',1,1)`).run();
  await h.f.db.prepare("INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('other-chat','other-connection','other-user','other-private-chat',1)").run();
  await h.f.db.prepare(`INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at)
    VALUES('other-source','other-connection','telegram','other-source','other-user','other-private-chat',zeroblob(16),zeroblob(12),1,'PROCESSED',?)`).bind(scope.now - 2).run();
  await h.f.db.prepare(`INSERT INTO semantic_contexts
    (id,owner_id,chat_identity_id,source_inbound_id,target_intent,context_ciphertext,context_iv,context_key_version,status,expires_at,created_at,updated_at)
    VALUES('other-legacy','owner','other-chat','other-source','CREATE_REMINDER',zeroblob(16),zeroblob(12),1,'PENDING',?,?,?)`)
    .bind(scope.now - 1, scope.now - 1000, scope.now - 1000).run();
  expect(await h.turn(1, 'xin chào')).toEqual({ status: 'CLARIFICATION_REQUESTED' });
  expect(await h.f.db.prepare("SELECT status FROM semantic_contexts WHERE id='other-legacy'").first('status')).toBe('PENDING');
  expect(await h.f.db.prepare("SELECT status,length(context_ciphertext) ciphertext_bytes,length(context_iv) iv_bytes,resolution_inbound_id FROM semantic_contexts WHERE id='legacy'").first())
    .toEqual({ status: 'EXPIRED', ciphertext_bytes: 16, iv_bytes: 12, resolution_inbound_id: null });
});
