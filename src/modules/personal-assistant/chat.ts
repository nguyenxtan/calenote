import type { PersonalAssistantEnvelope } from '@/contracts/api/personal-assistant';
import type { FollowThroughChatHandler } from '@/modules/follow-through/chat-adapter';

export interface PersonalMemoryChatService {
  get(ownerId: string): Promise<PersonalAssistantEnvelope>;
}
/** Explicit, read-only lookup. Memory content never enters a model context. */
export function createPersonalMemoryChatHandler(service: PersonalMemoryChatService): FollowThroughChatHandler {
  return async (message, context) => {
    const text = message.text.normalize('NFC').trim().replace(/\s+/gu, ' ');
    const command = /^(?:trí nhớ|\/memory)(?: (.*))?$/iu.exec(text);
    if (!command) return { handled: false };
    try {
      const envelope = await service.get(context.userId);
      const query = (command[1] ?? '').toLocaleLowerCase('vi-VN');
      const matches = envelope.document.memories.filter(memory => !query || `${memory.label} ${memory.value}`.normalize('NFC').toLocaleLowerCase('vi-VN').includes(query)).slice(0, 5);
      const text = matches.length
        ? `Trí nhớ bạn đã lưu:\n${matches.map(memory => `${memory.label}: ${memory.value.slice(0, 240)}${memory.value.length > 240 ? '…' : ''}`).join('\n')}`.slice(0, 1800)
        : 'Không tìm thấy trí nhớ phù hợp. Bạn có thể xem và chỉnh sửa trong Trợ lý cá nhân.';
      return { handled: true, text };
    } catch {
      return { handled: true, text: 'Chưa thể đọc trí nhớ đã lưu. Vui lòng thử lại sau.' };
    }
  };
}
