import type { BotProvider } from "./contracts";

const tokenPatterns: Record<BotProvider, RegExp> = {
  // Zalo currently documents a numeric bot id followed by a secret, separated by a colon.
  zalo: /^\d{4,32}:[A-Za-z0-9._-]{3,448}$/,
  // Telegram tokens use a numeric bot id and a URL-safe secret.
  telegram: /^\d{4,32}:[A-Za-z0-9_-]{8,448}$/,
};

export function isSafeProviderToken(provider: BotProvider, token: string): boolean {
  return token.length <= 512 && tokenPatterns[provider].test(token);
}
