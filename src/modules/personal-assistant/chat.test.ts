import { expect, it, vi } from 'vitest';
import { initialPersonalAssistantDocument } from '@/contracts/api/personal-assistant';
import { createPersonalMemoryChatHandler } from './chat';
const context = { userId: 'authenticated-owner', chatIdentityId: 'identity', workspaceId: 'personal', timezone: 'Asia/Ho_Chi_Minh', inboundRowId: 1 };
const message = (text: string) => ({ id: 'inbound', connectionId: 'connection', providerUserId: 'untrusted-provider-name', privateChatId: 'chat', text, receivedAt: 1, claimMarker: 'claim' });
function harness() {
  const document = initialPersonalAssistantDocument();
  document.memories = [{ id: 'one', label: 'Gia đình', value: 'Mẹ thích hoa sen' }, { id: 'two', label: 'Ăn uống', value: 'Không ăn cay' }];
  const get = vi.fn(async (ownerId: string) => { if (!ownerId) throw new Error('Missing owner'); return { revision: 1, document }; });
  return { document, get, handle: createPersonalMemoryChatHandler({ get }) };
}
it('looks up only explicitly requested memory using authenticated account identity', async () => {
  const h = harness();
  const result = await h.handle(message('trí nhớ HOA SEN'), context);
  expect(h.get).toHaveBeenCalledExactlyOnceWith('authenticated-owner');
  expect(result.handled && result.text).toContain('Mẹ thích hoa sen');
  expect(result.handled && result.text).not.toContain('Không ăn cay');
  const other = await h.handle(message('/memory ăn uống'), { ...context, userId: 'another-owner' });
  expect(other.handled).toBe(true); expect(h.get).toHaveBeenLastCalledWith('another-owner');
});
it('ignores ordinary messages and prefixes without fetching private data', async () => {
  const h = harness();
  for (const text of ['nhớ gọi mẹ', 'trí nhớx', '/memorywrite secret', 'hãy xem trí nhớ']) expect(await h.handle(message(text), context)).toEqual({ handled: false });
  expect(h.get).not.toHaveBeenCalled();
});
it('lists at most five records with bounded values and total response', async () => {
  const h = harness();
  h.document.memories = Array.from({ length: 9 }, (_, i) => ({ id: `id-${i}`, label: `label-${i}-${'A'.repeat(90)}`, value: `${i}${'ệ'.repeat(1999)}` }));
  const result = await h.handle(message('trí nhớ'), context);
  expect(result.handled).toBe(true);
  if (!result.handled) throw new Error('Expected handled memory command');
  expect(result.text.length).toBeLessThanOrEqual(1800);
  expect(result.text).not.toContain('label-5');
  expect(result.text).not.toContain('ệ'.repeat(241));
  expect(result.text).toContain('label-4');
});
it('returns bounded no-match guidance and safely handles storage failures', async () => {
  const h = harness();
  const result = await h.handle(message('/memory missing'), context);
  expect(result.handled && result.text).toContain('Không tìm thấy');
  h.get.mockRejectedValueOnce(new Error('SECRET ciphertext database location'));
  const failure = await h.handle(message('trí nhớ'), context);
  expect(failure.handled && failure.text).toContain('Chưa thể đọc');
  expect(JSON.stringify(failure)).not.toContain('SECRET');
});
