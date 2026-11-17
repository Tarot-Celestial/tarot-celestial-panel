import { accountingJson } from "@/lib/server/accounting-access";

const MAX_BODY_BYTES = 16_384;

export class AccountingInputError extends Error {}

/** Never accept an unbounded body (or coerce arrays/primitives into money entries). */
export async function readAccountingBody(req: Request): Promise<Record<string, unknown>> {
  const claimedLength = Number(req.headers.get("content-length") || 0);
  if (claimedLength > MAX_BODY_BYTES) throw new AccountingInputError("El formulario es demasiado grande.");
  const reader = req.body?.getReader();
  if (!reader) throw new AccountingInputError("El formulario está vacío.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new AccountingInputError("El formulario es demasiado grande.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AccountingInputError("El formulario no tiene un formato válido."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AccountingInputError("El formulario no tiene un formato válido.");
  }
  return value as Record<string, unknown>;
}

export function accountingValidationError(error: unknown) {
  return accountingJson({ ok: false, code: "INVALID_INPUT", error: error instanceof Error ? error.message : "Revisa los datos del formulario." }, 400);
}

/** Only return known business errors, never raw SQL/schema, tokens, or customer data. */
export function accountingDatabaseError(error: unknown) {
  const problem = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
  const message = String(problem.message || "");
  const rules: Array<[RegExp, number, string, string]> = [
    [/FORBIDDEN|NOT_ADMIN|UNAUTHORIZED/, 403, "FORBIDDEN", "No tienes permiso para consultar esta contabilidad."],
    [/OPERATION_CONFLICT|IDEMPOTENCY_CONFLICT|ENTRY_CONFLICT/, 409, "OPERATION_CONFLICT", "Este identificador ya corresponde a otro movimiento. Actualiza la página antes de continuar."],
    [/INSUFFICIENT_VAULT|NEGATIVE_VAULT|VAULT_BALANCE|VAULT_UNDERFLOW/, 409, "INSUFFICIENT_VAULT", "La operación dejaría la bóveda sin fondos suficientes. Revisa los movimientos y sus fechas."],
    [/INSUFFICIENT_AVAILABLE|INSUFFICIENT_FUNDS|INSUFFICIENT_OPERATING/, 409, "INSUFFICIENT_AVAILABLE", "No hay saldo disponible suficiente para apartar ese importe en la bóveda."],
    [/OPENING_EXISTS/, 409, "OPENING_EXISTS", "Esta cuenta ya tiene un saldo inicial en esa moneda. Anula el anterior antes de corregirlo."],
    [/OPENING_DATE/, 409, "OPENING_DATE", "El saldo inicial debe tener una fecha anterior o igual al primer movimiento de esta cuenta."],
    [/FUTURE_DATE/, 400, "FUTURE_DATE", "Registra solo dinero ya recibido o pagado. No se permiten fechas futuras."],
    [/IMMUTABLE_ENTRY/, 409, "IMMUTABLE_ENTRY", "El movimiento no puede modificarse. Utiliza la anulación para conservar su historial."],
    [/ENTRY_NOT_FOUND|OPTION_NOT_FOUND|NOT_FOUND/, 404, "NOT_FOUND", "No se encontró el movimiento o la categoría. Actualiza los datos."],
    [/OPTION_IN_USE|INACTIVE_CATEGORY|INACTIVE_METHOD|CATEGORY_INACTIVE|METHOD_INACTIVE/, 409, "OPTION_UNAVAILABLE", "La categoría o el método ya no está disponible. Selecciona otro."],
    [/INVALID_|CATEGORY_KIND|CATEGORY_REQUIRED|METHOD_REQUIRED|RECIPIENT_REQUIRED/, 400, "INVALID_INPUT", "Revisa el importe, la fecha, la cuenta, la categoría y el método del movimiento."],
    [/DUPLICATE_OPTION|OPTION_EXISTS/, 409, "OPTION_EXISTS", "Ya existe una categoría o método con ese nombre."],
  ];
  for (const [pattern, status, code, text] of rules) {
    if (pattern.test(message)) return accountingJson({ ok: false, code, error: text }, status);
  }
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(String(problem.code))) {
    return accountingJson({ ok: false, code: "ACCOUNTING_NOT_READY", error: "La contabilidad todavía no está configurada en el servidor." }, 503);
  }
  if (problem.code === "23505") return accountingJson({ ok: false, code: "CONFLICT", error: "Ese registro ya existe. Actualiza los datos antes de continuar." }, 409);
  // Keep observability useful without logging financial payloads or raw provider errors.
  console.error("[accounting] database request failed", { code: String(problem.code || "UNKNOWN").slice(0, 24) });
  return accountingJson({ ok: false, code: "ACCOUNTING_UNAVAILABLE", error: "No se pudo confirmar la operación. Actualiza los datos antes de volver a intentarlo." }, 503);
}

export function accountingUnexpectedError() {
  return accountingJson({ ok: false, code: "ACCOUNTING_UNAVAILABLE", error: "No se pudo verificar la contabilidad. Vuelve a intentarlo." }, 503);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
