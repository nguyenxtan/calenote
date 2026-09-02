import type { BotProvider } from "./contracts";

// Provider docs show examples, not a stable token grammar. Reject only bytes that
// can escape or split the fixed API path; let getMe decide whether a token is valid.
const unsafePathTokenCharacter = /[\u0000-\u0020\u007f/\\?#%]/u;

export function isSafeProviderToken(provider: BotProvider, token: string): boolean {
  void provider;
  return token.length > 0 && token.length <= 512 && !unsafePathTokenCharacter.test(token);
}
