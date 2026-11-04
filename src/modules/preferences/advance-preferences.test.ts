import { expect, it } from "vitest";
import { UpdatePreferencesSchema } from "@/contracts/api/preferences";
import { getUserPreferences, saveUserPreferences, type UserPreferences, type UserPreferencesStore } from "./service";

it("persists independent advance defaults and retains them on unrelated preference patches", async () => {
  let row: UserPreferences | null = null;
  const store: UserPreferencesStore = { get: async () => row, save: async v => (row=v) };
  expect(await getUserPreferences("owner",store)).toMatchObject({advanceReminderDays:null,advanceReminderHours:null});
  await saveUserPreferences("owner", {advanceReminderDays:2,advanceReminderHours:3},store,100);
  expect(await saveUserPreferences("owner",{tone:"concise"},store,101)).toMatchObject({advanceReminderDays:2,advanceReminderHours:3});
  expect(await saveUserPreferences("owner",{advanceReminderDays:null},store,102)).toMatchObject({advanceReminderDays:null,advanceReminderHours:3});
});
it.each([{advanceReminderDays:0},{advanceReminderDays:8},{advanceReminderHours:0},{advanceReminderHours:25},{advanceReminderDays:1.5},{advanceReminderHours:"3"}])("rejects invalid advance choices %j at both boundaries",async input=>{
  expect(UpdatePreferencesSchema.safeParse(input).success).toBe(false);
  await expect(saveUserPreferences("owner",input as never,{get:async()=>null,save:async v=>v},100)).rejects.toMatchObject({code:"INVALID_USER_PREFERENCES"});
});
it.each([{advanceReminderDays:1,advanceReminderHours:1},{advanceReminderDays:7,advanceReminderHours:24},{advanceReminderDays:null,advanceReminderHours:null}])("accepts advance boundaries %j",input=>{expect(UpdatePreferencesSchema.safeParse(input).success).toBe(true);});
