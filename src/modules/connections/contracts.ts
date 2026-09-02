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

export interface ProviderRequest {
  provider: BotProvider;
  hostname: "bot-api.zaloplatforms.com" | "api.telegram.org";
  path: string;
  operation: "getMe";
}

export type ProviderRequester = (input: ProviderRequest) => Promise<unknown>;

export interface BotProviderAdapter {
  verifyToken(token: string, requester?: ProviderRequester): Promise<BotProfile>;
}
