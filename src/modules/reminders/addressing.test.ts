// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { processBoundChatMessage, type ProcessBoundChatDependencies } from './command-service';
const message = { id: 'id', connectionId: 'connection', providerUserId: 'provider', privateChatId: 'chat', text: 'có', receivedAt: 1, claimMarker: 'claim' };
it('refreshes authenticated preferences and falls back safely when lookup fails', async () => {
  const reply = vi.fn<(text: string) => Promise<void>>(async () => {});
  const getReplyPreferences = vi.fn().mockResolvedValueOnce({ addressStyle: 'sep' }).mockResolvedValueOnce({ addressStyle: 'custom', customDisplayName: 'Bạn muốn mình' }).mockRejectedValueOnce(new Error('secret'));
  const deps = { now: () => 1, reply, getReplyPreferences, store: { findBoundContext: async () => ({ userId: 'owner', chatIdentityId: 'identity' }), findPendingDraft: async () => null, rejectMessage: async () => true } } as unknown as ProcessBoundChatDependencies;
  await processBoundChatMessage(message, deps);
  expect(reply).toHaveBeenLastCalledWith('Sếp, Không còn lời nhắc nào đang chờ xác nhận.');
  await processBoundChatMessage(message, deps);
  expect(reply).toHaveBeenLastCalledWith('Bạn muốn mình, Không còn lời nhắc nào đang chờ xác nhận.');
  await processBoundChatMessage(message, deps);
  expect(reply).toHaveBeenLastCalledWith('Không còn lời nhắc nào đang chờ xác nhận.');
  expect(getReplyPreferences).toHaveBeenCalledWith('owner');
});
it('preserves title bytes and confirmation tokens in personalized legacy previews', async () => {
  const reply = vi.fn<(text: string) => Promise<void>>(async () => {});
  const title = 'Bạn muốn mình';
  const now = Date.parse('2026-10-19T03:00:00Z');
  const deps = { now: () => now, reply, getReplyPreferences: async () => ({ addressStyle: 'custom', customDisplayName: 'Lan' }), keyring: { encryptSensitive: async () => ({}) }, store: { findBoundContext: async () => ({ userId: 'owner', chatIdentityId: 'identity', timezone: 'Asia/Ho_Chi_Minh' }), createDraft: async () => 'COMMITTED' } } as unknown as ProcessBoundChatDependencies;
  await processBoundChatMessage({ ...message, receivedAt: now, text: `mai 8h nhắc tôi ${title}` }, deps);
  expect(reply.mock.calls[0][0]).toBe('Lan, Calenote hiểu: 08:00 20/10/2026 — Bạn muốn mình. Gửi “có” để xác nhận hoặc “hủy” để bỏ.');
});
it('never fetches owner preferences before binding or rewrites delegated replies', async () => {
  const reply = vi.fn<(text: string) => Promise<void>>(async () => {});
  const getReplyPreferences = vi.fn(async () => ({ addressStyle: 'sep' }));
  const deps = { now: () => 1, reply, getReplyPreferences, store: { findBoundContext: vi.fn(async () => null), findPendingDraft: async () => null, rejectMessage: async () => true } } as unknown as ProcessBoundChatDependencies;
  await processBoundChatMessage(message, deps);
  expect(getReplyPreferences).not.toHaveBeenCalled();
  const delegated = vi.fn(async () => { await reply('Bạn muốn mình'); return { status: 'REJECTED' as const }; });
  deps.store.findBoundContext = async () => ({ userId: 'owner', chatIdentityId: 'identity', workspaceId: 'workspace', timezone: 'Asia/Ho_Chi_Minh', inboundRowId: 1 });
  deps.conversation = { handle: delegated };
  await processBoundChatMessage({ ...message, text: '/memory' }, deps);
  expect(reply).toHaveBeenLastCalledWith('Bạn muốn mình');
  expect(getReplyPreferences).not.toHaveBeenCalled();
});
it('falls back without truncating a maximum-length title when addressing exceeds provider limit', async () => {
  const reply = vi.fn<(text: string) => Promise<void>>(async () => {});
  const title = 'a'.repeat(1800);
  const now = Date.parse('2026-10-19T03:00:00Z');
  const deps = { now: () => now, reply, getReplyPreferences: async () => ({ addressStyle: 'custom', customDisplayName: '😀'.repeat(80) }), keyring: { encryptSensitive: async () => ({}) }, store: { findBoundContext: async () => ({ userId: 'owner', chatIdentityId: 'identity', timezone: 'Asia/Ho_Chi_Minh' }), createDraft: async () => 'COMMITTED' } } as unknown as ProcessBoundChatDependencies;
  await processBoundChatMessage({ ...message, receivedAt: now, text: `mai 8h nhắc tôi ${title}` }, deps);
  expect(reply).toHaveBeenCalledTimes(1);
  expect(reply.mock.calls[0][0].length).toBeLessThanOrEqual(2000);
  expect(reply.mock.calls[0][0]).toContain(title);
  expect(reply.mock.calls[0][0]).toContain('Gửi “có” để xác nhận hoặc “hủy” để bỏ.');
});
