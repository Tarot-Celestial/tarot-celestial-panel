export const RUNE_TITLE_LIMIT = 100;
export const RUNE_BENEFIT_LIMIT = 2000;
export const isRuneUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export class RuneInputError extends Error {}

export function parseRuneUpdate(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuneInputError("Solicitud no válida.");
  const b = value as Record<string, unknown>;
  if (!isRuneUuid(b.cliente_id) || !isRuneUuid(b.operation_id)) throw new RuneInputError("Selecciona una ficha válida y vuelve a guardar.");
  if (typeof b.enabled !== "boolean") throw new RuneInputError("Indica si la runa está activada.");
  if (typeof b.title !== "string" || !b.title.trim() || b.title.trim().length > RUNE_TITLE_LIMIT) throw new RuneInputError("Escribe un nombre de hasta 100 caracteres.");
  if (typeof b.benefit !== "string" || b.benefit.trim().length > RUNE_BENEFIT_LIMIT || (b.enabled && !b.benefit.trim())) throw new RuneInputError("Para activar la runa, escribe su ventaja (máximo 2.000 caracteres).");
  if (b.expected_updated_at !== null && (typeof b.expected_updated_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(b.expected_updated_at) || !Number.isFinite(Date.parse(b.expected_updated_at)))) throw new RuneInputError("Actualiza la ficha antes de guardar.");
  return { cliente_id: b.cliente_id, operation_id: b.operation_id, enabled: b.enabled, title: b.title.trim(), benefit: b.benefit.trim(), expected_updated_at: b.expected_updated_at as string | null };
}

export function runeFailureCode(error: unknown) {
  const code = String((error as { message?: unknown })?.message || "");
  if (code.includes("RUNE_CONFLICT") || code.includes("RUNE_OPERATION_REUSED")) return { status: 409, error: "La ficha ha cambiado. Actualízala y revisa la runa antes de guardar." };
  if (code.includes("RUNE_FORBIDDEN")) return { status: 403, error: "No tienes permiso para configurar runas." };
  if (code.includes("RUNE_CLIENT_NOT_FOUND")) return { status: 404, error: "La ficha ya no está disponible." };
  return { status: 500, error: "No se pudo confirmar el cambio. Actualiza la ficha para comprobar su estado antes de repetirlo." };
}
