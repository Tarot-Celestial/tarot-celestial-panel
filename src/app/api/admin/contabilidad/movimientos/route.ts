import { validateEntryInput } from "@/lib/accounting";
import { accountingJson, accountingWriteGuard, requireAccountingAccess } from "@/lib/server/accounting-access";
import { accountingDatabaseError, accountingUnexpectedError, accountingValidationError, isRecord, readAccountingBody } from "@/lib/server/accounting-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const invalidOrigin = accountingWriteGuard(req);
    if (invalidOrigin) return invalidOrigin;
    const access = await requireAccountingAccess(req);
    if (!access.ok) return access.response;
    let entry;
    try { entry = validateEntryInput(await readAccountingBody(req)); }
    catch (error) { return accountingValidationError(error); }
    const { data, error } = await access.admin.rpc("accounting_post_entry", { p_actor: access.authUserId, p_entry: entry });
    if (error) return accountingDatabaseError(error);
    if (!isRecord(data) || !isRecord(data.entry) || data.entry.id !== entry.id) return accountingUnexpectedError();
    return accountingJson({ ok: true, entry: data.entry, replayed: data.replayed === true });
  } catch {
    return accountingUnexpectedError();
  }
}
