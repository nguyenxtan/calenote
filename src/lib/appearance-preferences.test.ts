import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE, readAppearancePreferences, saveAppearancePreferences, getDefaultAppPath } from "./appearance-preferences";

afterEach(() => vi.unstubAllGlobals());
function storage(values: Record<string,string>={}) { return {getItem:(key:string)=>values[key]??null,setItem:(key:string,value:string)=>{values[key]=value;}}; }
describe("device appearance preferences",()=>{
 it("migrates the legacy compact preference without changing calendar defaults",()=>{
  expect(readAppearancePreferences(storage({'calenote-ui-density':'compact'}))).toEqual({...DEFAULT_APPEARANCE,density:'compact'});
 });
 it("rejects malformed and arbitrary default-page destinations",()=>{
  const broken=storage({'calenote-appearance-v1':'{"startPage":"https://evil.test"}'});
  expect(readAppearancePreferences(broken)).toEqual(DEFAULT_APPEARANCE);
  expect(getDefaultAppPath(broken)).toBe('/app/today');
  expect(readAppearancePreferences(storage({'calenote-appearance-v1':'not json'}))).toEqual(DEFAULT_APPEARANCE);
 });
 it("persists all device choices together and applies layout immediately",()=>{
  const store=storage();const next={...DEFAULT_APPEARANCE,density:'compact' as const,textSize:'large' as const,weekStart:'sunday' as const,showLunar:false,startPage:'calendar' as const};
  expect(saveAppearancePreferences(next,store)).toBe(true);
  expect(readAppearancePreferences(store)).toEqual(next);
  expect(getDefaultAppPath(store)).toBe('/app/calendar');
  expect(document.documentElement.dataset.density).toBe('compact');
  expect(document.documentElement.dataset.textSize).toBe('large');
 });
 it("survives denied storage and still applies a temporary presentation",()=>{
  const denied={getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('denied')}};
  expect(readAppearancePreferences(denied)).toEqual(DEFAULT_APPEARANCE);
  expect(saveAppearancePreferences({...DEFAULT_APPEARANCE,density:'compact'},denied)).toBe(false);
  expect(document.documentElement.dataset.density).toBe('compact');
 });
});
