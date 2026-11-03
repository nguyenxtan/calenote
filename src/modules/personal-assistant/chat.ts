import { addressProse, botSalutation, type BotReplyPreferences } from "@/modules/preferences/wording";
import type { PersonalAssistantEnvelope } from '@/contracts/api/personal-assistant';
import type { FollowThroughChatHandler } from '@/modules/follow-through/chat-adapter';

export interface PersonalMemoryChatService {
  get(ownerId: string): Promise<PersonalAssistantEnvelope>;
}
/** Explicit, read-only lookup. Memory content never enters a model context. */
export function createPersonalMemoryChatHandler(service: PersonalMemoryChatService, getReplyPreferences?: (ownerId: string) => Promise<BotReplyPreferences>): FollowThroughChatHandler {
  return async (message, context) => {
    const text = message.text.normalize('NFC').trim().replace(/\s+/gu, ' ');
    const command = /^(?:trí nhớ|\/memory)(?: (.*))?$/iu.exec(text);
    if (!command) return { handled: false };
    let preferences: BotReplyPreferences | undefined;
    try { preferences = await getReplyPreferences?.(context.userId); } catch { /* Presentation lookup is best effort. */ }
    try {
      const envelope = await service.get(context.userId);
      const query = (command[1] ?? '').toLocaleLowerCase('vi-VN');
      const matches = envelope.document.memories.filter(memory => !query || `${memory.label} ${memory.value}`.normalize('NFC').toLocaleLowerCase('vi-VN').includes(query)).slice(0, 5);
      const rows = matches.map(memory => `${memory.label}: ${memory.value.slice(0, 240)}${memory.value.length > 240 ? '…' : ''}`).join('\n');
      const baseline = `Trí nhớ bạn đã lưu:\n${rows}`.slice(0, 1800);
      const personalized = `${botSalutation(preferences)}${addressProse("Trí nhớ bạn đã lưu:", preferences)}\n${baseline.split('\n').slice(1).join('\n')}`;
      // Addressing must never consume the existing allowance for saved memory content.
      const text = matches.length
        ? personalized.length <= 1800 ? personalized : baseline
        : botSalutation(preferences) + addressProse('Không tìm thấy trí nhớ phù hợp. Bạn có thể xem và chỉnh sửa trong Trợ lý cá nhân.', preferences);
      return { handled: true, text };
    } catch {
      return { handled: true, text: botSalutation(preferences) + addressProse('Chưa thể đọc trí nhớ đã lưu. Vui lòng thử lại sau.', preferences) };
    }
  };
}
