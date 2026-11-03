"use client";

import { useEffect, useState } from "react";
import { APPEARANCE_EVENT, DEFAULT_APPEARANCE, parseAppearanceEvent, readAppearancePreferences } from "./appearance-preferences";

export function useAppearancePreferences() {
  // The initial render must match static HTML; local choices load after hydration.
  const [value, setValue] = useState(DEFAULT_APPEARANCE);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setValue(readAppearancePreferences()); });
    const changed = (event: Event) => setValue(parseAppearanceEvent(event) ?? readAppearancePreferences());
    window.addEventListener(APPEARANCE_EVENT, changed);
    window.addEventListener("storage", changed);
    return () => { active = false; window.removeEventListener(APPEARANCE_EVENT, changed); window.removeEventListener("storage", changed); };
  }, []);
  return value;
}
