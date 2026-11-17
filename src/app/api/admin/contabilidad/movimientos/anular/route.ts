import { accountingJson, accountingWriteGuard, requireAccountingAccess } from "@/lib/server/accounting-access";
import { AccountingInputError, accountingDatabaseError, accountingUnexpectedError, accountingValidationError, isRecord, readAccountingBody, validUuid } from "@/lib/server/accounting-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const invalidOrigin = accountingWriteGuard(req);
    if (invalidOrigin) return invalidOrigin;
    const access = await requireAccountingAccess(req);
    if (!access.ok) return access.response;
    let id: string;
    let reason: string;
    try {
      const body = await readAccountingBody(req);
      if (!validUuid(body.id)) throw new AccountingInputError("Selecciona un movimiento válido.");
      if (typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 500) {
        throw new AccountingInputError("Indica el motivo de la anulación (entre 3 y 500 caracteres).");
      }
      id = body.id;
      reason = body.reason.trim();
    } catch (error) { return accountingValidationError(error); }
    const { data, error } = await access.admin.rpc("accounting_void_entry", { p_actor: access.authUserId, p_id: id, p_reason: reason });
    if (error) return accountingDatabaseError(error);
    if (!isRecord(data) || !isRecord(data.entry) || data.entry.id !== id || !data.entry.voided_at) return accountingUnexpectedError();
    return accountingJson({ ok: true, entry: data.entry, replayed: data.replayed === true });
  } catch {
    return accountingUnexpectedError();
  }
}
