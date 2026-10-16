// Persist only an opaque pending intent. A request payload never enters storage.
// Account namespaces prevent another signed-in user from inheriting this intent.
export async function manualReminderIntent(email: string): Promise<{ id: string; existing: boolean; complete: () => void }> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.toLowerCase()));
  const owner = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const key = `calenote:manual-intent:v1:${owner}`;
  const stored = localStorage.getItem(key);
  const id = stored && /^[A-Za-z0-9_-]{16,80}$/u.test(stored) ? stored : crypto.randomUUID();
  // Fail before sending if durable browser storage is unavailable.
  localStorage.setItem(key, id);
  return { id, existing: stored === id, complete: () => { if (localStorage.getItem(key) === id) localStorage.removeItem(key); } };
}
