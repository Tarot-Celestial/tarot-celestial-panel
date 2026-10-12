export type CompanionPosition = { x: number; y: number };
export const MANUAL_POSITION_PAUSE = 5 * 60_000;
export const DRAG_THRESHOLD = 5;

export function clampCompanionPosition(x: number, y: number, width: number, height: number, petWidth = 136, petHeight = 174): CompanionPosition {
  const maxX = Math.max(8, width - petWidth - 8), maxY = Math.max(8, height - petHeight - 8);
  return { x: Math.max(8, Math.min(maxX, Number.isFinite(x) ? x : maxX)), y: Math.max(8, Math.min(maxY, Number.isFinite(y) ? y : maxY)) };
}

export function positionStorageKey(workerId?: string | null) {
  return workerId ? `tc-companion-position:v1:${workerId}` : null;
}

export function parseSavedPosition(raw: string | null): CompanionPosition | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || !value) return null;
    const { x, y } = value as CompanionPosition;
    return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  } catch { return null; }
}

export function keyboardPosition(key: string, current: CompanionPosition, fast = false): CompanionPosition | null {
  const step = fast ? 40 : 12;
  if (key === 'ArrowLeft') return { x: current.x - step, y: current.y };
  if (key === 'ArrowRight') return { x: current.x + step, y: current.y };
  if (key === 'ArrowUp') return { x: current.x, y: current.y - step };
  if (key === 'ArrowDown') return { x: current.x, y: current.y + step };
  return null;
}
