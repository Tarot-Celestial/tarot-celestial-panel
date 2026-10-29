export const CHAT_SOUND_KEY = 'tc_staff_chat_sound';
export const CHAT_DEFAULT_VOLUME = 100;

export function chatVolume(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : CHAT_DEFAULT_VOLUME;
}

export function chatSoundPreferences(raw: string | null) {
  try {
    const value = JSON.parse(raw || '{}');
    return { enabled: value.enabled !== false, volume: value.volume == null ? CHAT_DEFAULT_VOLUME : chatVolume(value.volume) };
  } catch { return { enabled: true, volume: CHAT_DEFAULT_VOLUME }; }
}

export function chatUnreadTotal(threads: { unread_count?: number | null }[]) {
  return threads.reduce((sum, thread) => sum + Math.max(0, Number(thread.unread_count) || 0), 0);
}

export function canReadStaffChat(visible: boolean, focused: boolean, connected: boolean, threadId: string, visibleThreads: Iterable<string>) {
  return visible && focused && connected && Array.from(visibleThreads).includes(threadId);
}
