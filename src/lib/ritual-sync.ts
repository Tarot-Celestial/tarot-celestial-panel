// This signal carries no client data and grants no access: listeners refetch their authenticated API.
export const RITUAL_CHANGED = "tc-ritual-changed-v1";
export function announceRitualChange() {
  window.dispatchEvent(new Event(RITUAL_CHANGED));
  try { localStorage.setItem(RITUAL_CHANGED, `${Date.now()}-${Math.random()}`); } catch { /* Polling remains available. */ }
}
