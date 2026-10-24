type MissionRead = { ok: boolean; payload: any };
type PendingRead = {
  controller: AbortController;
  readers: Set<symbol>;
  settled: boolean;
  result: Promise<MissionRead>;
};

// Share only an in-flight GET for the exact bearer. Completed data is never
// cached, and mutations keep their own requests. No identity is inferred here.
const pendingReads = new Map<string, PendingRead>();
const aborted = () => Object.assign(new Error('La consulta se canceló.'), { name: 'AbortError' });

export function readRecoveryMission(accessToken: string, signal: AbortSignal): Promise<MissionRead> {
  if (signal.aborted) return Promise.reject(aborted());
  let pending = pendingReads.get(accessToken);
  if (!pending || pending.controller.signal.aborted) {
    const controller = new AbortController();
    const entry: PendingRead = {
      controller, readers: new Set(), settled: false,
      result: (async () => {
        const response = await fetch('/api/central/recovery-mission', {
          method: 'GET', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        });
        return { ok: response.ok, payload: await response.json() };
      })(),
    };
    entry.result = entry.result.finally(() => {
      entry.settled = true;
      if (pendingReads.get(accessToken) === entry) pendingReads.delete(accessToken);
    });
    pendingReads.set(accessToken, entry);
    pending = entry;
  }

  const entry = pending;
  return new Promise((resolve, reject) => {
    const reader = Symbol();
    let finished = false;
    entry.readers.add(reader);
    const release = () => {
      finished = true;
      signal.removeEventListener('abort', cancel);
      entry.readers.delete(reader);
      // Unmounting one surface must not cancel the companion's shared read.
      if (!entry.settled && entry.readers.size === 0) {
        if (pendingReads.get(accessToken) === entry) pendingReads.delete(accessToken);
        entry.controller.abort();
      }
    };
    const cancel = () => { if (!finished) { release(); reject(aborted()); } };
    signal.addEventListener('abort', cancel, { once: true });
    entry.result.then(
      result => { if (!finished) { release(); resolve(result); } },
      error => { if (!finished) { release(); reject(error); } },
    );
  });
}
