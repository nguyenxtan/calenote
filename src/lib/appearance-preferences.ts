import { z } from "zod";

const AppearanceSchema = z.object({
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  textSize: z.enum(["small", "standard", "large"]).default("standard"),
  weekStart: z.enum(["monday", "sunday"]).default("monday"),
  showLunar: z.boolean().default(true),
  startPage: z.enum(["today", "calendar", "inbox", "reminders"]).default("today"),
}).strict();
export type AppearancePreferences = z.infer<typeof AppearanceSchema>;
export const DEFAULT_APPEARANCE: AppearancePreferences = AppearanceSchema.parse({});
export const APPEARANCE_EVENT = "calenote-appearance-changed";
const KEY = "calenote-appearance-v1";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
function browserStorage(): PreferenceStorage | undefined { try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; } }
export function readAppearancePreferences(storage?: PreferenceStorage): AppearancePreferences {
  try {
    const store = storage ?? browserStorage();
    const saved = store?.getItem(KEY);
    if (saved) { const result = AppearanceSchema.safeParse(JSON.parse(saved)); return result.success ? result.data : { ...DEFAULT_APPEARANCE }; }
    return { ...DEFAULT_APPEARANCE, density: store?.getItem("calenote-ui-density") === "compact" ? "compact" : "comfortable" };
  } catch { return { ...DEFAULT_APPEARANCE }; }
}
export function applyAppearancePreferences(value: AppearancePreferences): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = value.density;
  document.documentElement.dataset.textSize = value.textSize;
}
export function saveAppearancePreferences(value: AppearancePreferences, storage?: PreferenceStorage): boolean {
  const next = AppearanceSchema.parse(value);
  let persisted = false;
  try { const store = storage ?? browserStorage(); if (store) { store.setItem(KEY, JSON.stringify(next)); store.setItem("calenote-ui-density", next.density); persisted = true; } } catch { /* The current page may still use this choice. */ }
  applyAppearancePreferences(next);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: next }));
  return persisted;
}
export function getDefaultAppPath(storage?: PreferenceStorage): string {
  return `/app/${readAppearancePreferences(storage).startPage}`;
}
export function parseAppearanceEvent(event: Event): AppearancePreferences | null {
  const parsed = AppearanceSchema.safeParse((event as CustomEvent<unknown>).detail);
  return parsed.success ? parsed.data : null;
}
