// Refresh only: this signal carries no customer data and grants no access.
export const CLIENT_RUNES_CHANGED = "tc-client-runes-changed-v1";

export function announceClientRunesChange() {
  window.dispatchEvent(new Event(CLIENT_RUNES_CHANGED));
  try {
    localStorage.setItem(CLIENT_RUNES_CHANGED, `${Date.now()}-${Math.random()}`);
  } catch { /* Authenticated polling remains available. */ }
}
