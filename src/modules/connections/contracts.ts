export const botProviders = ["zalo", "telegram"] as const;

export type BotProvider = (typeof botProviders)[number];

export interface BotProfile {
  provider: BotProvider;
  providerBotId: string;
  displayName: string;
  handle: string | null;
  accountType: string | null;
  canJoinGroups: boolean | null;
}

export type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface BotProviderAdapter {
  verifyToken(token: string, fetcher?: ProviderFetch): Promise<BotProfile>;
}
