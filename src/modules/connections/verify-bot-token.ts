import type { BotProfile, BotProvider } from "./contracts";
import { verifyTelegramBotToken } from "./providers/telegram";
import { verifyZaloBotToken } from "./providers/zalo";

export function verifyBotToken(provider: BotProvider, token: string): Promise<BotProfile> {
  return provider === "zalo"
    ? verifyZaloBotToken(token)
    : verifyTelegramBotToken(token);
}
