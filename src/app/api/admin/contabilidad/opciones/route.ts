import { validateOptionInput } from "@/lib/accounting";
import { accountingJson, accountingWriteGuard, requireAccountingAccess } from "@/lib/server/accounting-access";
import { accountingDatabaseError, accountingUnexpectedError, accountingValidationError, isRecord, readAccountingBody, validUuid } from "@/lib/server/accounting-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const invalidOrigin = accountingWriteGuard(req);
    if (invalidOrigin) return invalidOrigin;
    const access = await requireAccountingAccess(req);
    if (!access.ok) return access.response;
    let option;
    try { option = validateOptionInput(await readAccountingBody(req)); }
    catch (error) { return accountingValidationError(error); }
    const { data, error } = await access.admin.rpc("accounting_upsert_option", { p_actor: access.authUserId, p_option: option });
    if (error) return accountingDatabaseError(error);
    if (!isRecord(data) || !isRecord(data.option) || !validUuid(data.option.id) || (option.id && data.option.id !== option.id)) return accountingUnexpectedError();
    return accountingJson({ ok: true, option: data.option });
  } catch {
    return accountingUnexpectedError();
  }
}
