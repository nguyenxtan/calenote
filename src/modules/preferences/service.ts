export const ADDRESS_STYLES = ["ban", "anh_chi", "ong_tui", "minh", "sep", "custom"] as const;
export type AddressStyle = (typeof ADDRESS_STYLES)[number];

export const TONES = ["concise", "friendly", "professional", "playful"] as const;
export type Tone = (typeof TONES)[number];

export interface UserPreferences {
  userId: string;
  addressStyle: AddressStyle;
  customDisplayName: string | null;
  tone: Tone;
  updatedAt: number;
}

export interface UserPreferencesInput {
  addressStyle?: AddressStyle;
  customDisplayName?: string | null;
  tone?: Tone;
}

export interface UserPreferencesStore {
  get(userId: string): Promise<UserPreferences | null>;
  save(preferences: UserPreferences): Promise<UserPreferences>;
}

export const DEFAULT_USER_PREFERENCES = {
  addressStyle: "ban",
  customDisplayName: null,
  tone: "friendly",
} as const satisfies Omit<UserPreferences, "userId" | "updatedAt">;

export class InvalidUserPreferencesError extends Error {
  readonly code = "INVALID_USER_PREFERENCES";

  constructor(message: string) {
    super(message);
    this.name = "InvalidUserPreferencesError";
  }
}

function isAddressStyle(value: unknown): value is AddressStyle {
  return typeof value === "string" && (ADDRESS_STYLES as readonly string[]).includes(value);
}

function isTone(value: unknown): value is Tone {
  return typeof value === "string" && (TONES as readonly string[]).includes(value);
}

function normalizeInput(input: UserPreferencesInput): UserPreferencesInput {
  if (input.addressStyle !== undefined && !isAddressStyle(input.addressStyle)) {
    throw new InvalidUserPreferencesError("addressStyle is not supported");
  }
  if (input.tone !== undefined && !isTone(input.tone)) {
    throw new InvalidUserPreferencesError("tone is not supported");
  }

  const customDisplayName = input.customDisplayName === undefined || input.customDisplayName === null
    ? input.customDisplayName
    : input.customDisplayName.trim();
  if (customDisplayName !== undefined && customDisplayName !== null && customDisplayName.length === 0) {
    throw new InvalidUserPreferencesError("customDisplayName cannot be empty");
  }
  if (input.addressStyle === "custom" && !customDisplayName) {
    throw new InvalidUserPreferencesError("customDisplayName is required for custom addressStyle");
  }
  if (input.addressStyle !== undefined && input.addressStyle !== "custom" && customDisplayName) {
    throw new InvalidUserPreferencesError("customDisplayName is only valid for custom addressStyle");
  }
  return { ...input, customDisplayName };
}

export async function getUserPreferences(
  userId: string,
  store: UserPreferencesStore,
): Promise<UserPreferences> {
  if (userId.trim().length === 0) throw new InvalidUserPreferencesError("userId is required");
  return (await store.get(userId)) ?? { ...DEFAULT_USER_PREFERENCES, userId, updatedAt: 0 };
}

export async function saveUserPreferences(
  userId: string,
  input: UserPreferencesInput,
  store: UserPreferencesStore,
  updatedAt: number,
): Promise<UserPreferences> {
  if (userId.trim().length === 0) throw new InvalidUserPreferencesError("userId is required");
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    throw new InvalidUserPreferencesError("updatedAt must be a non-negative safe integer");
  }
  const current = await getUserPreferences(userId, store);
  const normalized = normalizeInput(input);
  const result: UserPreferences = {
    ...current,
    ...normalized,
    userId,
    updatedAt,
  };
  if (result.addressStyle === "custom" && !result.customDisplayName) {
    throw new InvalidUserPreferencesError("customDisplayName is required for custom addressStyle");
  }
  if (result.addressStyle !== "custom") result.customDisplayName = null;
  return store.save(result);
}
