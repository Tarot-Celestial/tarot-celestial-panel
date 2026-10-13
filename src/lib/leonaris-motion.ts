export type LeonarisPoint = { x: number; y: number };
export type LeonarisBounds = { width: number; height: number; petWidth: number; petHeight: number };
export const LEONARIS_MARGIN = 8;

export function clampLeonaris(point: LeonarisPoint, bounds: LeonarisBounds): LeonarisPoint {
  const maxX = Math.max(LEONARIS_MARGIN, bounds.width - bounds.petWidth - LEONARIS_MARGIN);
  const maxY = Math.max(LEONARIS_MARGIN, bounds.height - bounds.petHeight - LEONARIS_MARGIN);
  return {
    x: Math.max(LEONARIS_MARGIN, Math.min(maxX, Number.isFinite(point.x) ? point.x : maxX)),
    y: Math.max(LEONARIS_MARGIN, Math.min(maxY, Number.isFinite(point.y) ? point.y : maxY)),
  };
}

export function normalizeLeonaris(point: LeonarisPoint, bounds: LeonarisBounds): LeonarisPoint {
  const clamped = clampLeonaris(point, bounds);
  return {
    x: (clamped.x - LEONARIS_MARGIN) / Math.max(1, bounds.width - bounds.petWidth - LEONARIS_MARGIN * 2),
    y: (clamped.y - LEONARIS_MARGIN) / Math.max(1, bounds.height - bounds.petHeight - LEONARIS_MARGIN * 2),
  };
}

export function restoreLeonaris(value: unknown, bounds: LeonarisBounds): LeonarisPoint | null {
  const point = value as LeonarisPoint | null;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
  return clampLeonaris({
    x: LEONARIS_MARGIN + point.x * Math.max(0, bounds.width - bounds.petWidth - LEONARIS_MARGIN * 2),
    y: LEONARIS_MARGIN + point.y * Math.max(0, bounds.height - bounds.petHeight - LEONARIS_MARGIN * 2),
  }, bounds);
}
