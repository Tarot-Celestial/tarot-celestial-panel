export const PANEL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const PANEL_HEARTBEAT_MS = 30_000;

export function isPanelPath(path: string | null) {
  return !!path && ['/admin', '/panel-central', '/panel-tarotista'].some(base => path === base || path.startsWith(`${base}/`));
}

export function attendanceAction(event: unknown, meta?: { action?: unknown; phase?: unknown }) {
  switch (String(event || '')) {
    case 'online': case 'check_in': case 'login':
      if (meta?.action === 'break' && meta?.phase !== 'end') return 'break';
      if (meta?.action === 'bathroom' && meta?.phase !== 'end') return 'bathroom';
      return 'connect';
    case 'break_end': case 'bathroom_end': return 'connect';
    case 'offline': case 'check_out': case 'logout': return 'disconnect';
    case 'break_start': return 'break';
    case 'bathroom_start': return 'bathroom';
    case 'consultation_start': return 'consultation_start';
    case 'consultation_end': return 'consultation_end';
    case 'pause': return meta?.phase === 'end' ? 'connect' : 'break';
    case 'bathroom': return meta?.phase === 'end' ? 'connect' : 'bathroom';
    case 'heartbeat': return 'heartbeat';
    default: return null;
  }
}

/** Fresh server AMI output only. A ringing leg or Dial target is not a call. */
export function confirmedCallStart(raw: string, extensions: string[], now: number): string | null {
  const allowed = new Set(extensions.filter(value => /^\d{2,6}$/.test(value)));
  let earliest: number | null = null;
  const extensionOf = (channel: string) => channel.match(/^(?:PJSIP|SIP|Local)\/(\d{2,6})(?:[-@;]|$)/)?.[1];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/^Output:\s*/i, '').trim();
    const parts = line.split('!');
    if (parts[4]?.toLowerCase() !== 'up') continue;
    const own = extensionOf(parts[0]);
    // Asterisk 18/20/22 main/cli.c emits 14 fields: amaflags at10,
    // duration at11, bridge ID at12. A numeric duration is NOT a bridge.
    // Older 13-field snapshots used a peer channel at11; accept that only
    // when it has the actual channel shape, never an arbitrary nonempty field.
    const modern = parts.length === 14;
    const legacy = parts.length === 13 && /^(?:PJSIP|SIP|Local)\//.test(parts[11]);
    if (!modern && !legacy) continue;
    const bridge = modern ? parts[12] : parts[11];
    if (!bridge || /^(?:<none>|\(none\))$/i.test(bridge)) continue;
    const peer = legacy ? extensionOf(bridge) : null;
    if (!(own && allowed.has(own)) && !(peer && allowed.has(peer))) continue;
    const durationText = parts[modern ? 11 : 10];
    if (!/^\d+$/.test(durationText)) continue;
    const duration = Number(durationText);
    if (!Number.isFinite(duration) || duration < 0 || duration > 86400) continue;
    const started = now - duration * 1000;
    earliest = earliest == null ? started : Math.min(earliest, started);
  }
  return earliest == null ? null : new Date(earliest).toISOString();
}
