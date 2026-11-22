import { accountingJson, requireAccountingAccess } from "@/lib/server/accounting-access";
import { accountingDatabaseError, accountingUnexpectedError, isRecord } from "@/lib/server/accounting-api";
import { accountingToday } from "@/lib/accounting";
import { officeAccountingReport } from "@/features/office/office-accounting-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const access = await requireAccountingAccess(req);
    if (!access.ok) return access.response;
    const now = new Date();
    const month = new URL(req.url).searchParams.get("mes") || "";
    if (!/^(?:19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month) || month > accountingToday(now).slice(0, 7)) {
      return accountingJson({ ok: false, error: "Selecciona un mes válido hasta el mes actual." }, 400);
    }
    const { data, error } = await access.admin.rpc("accounting_snapshot", { p_actor: access.authUserId });
    if (error) return accountingDatabaseError(error);
    if (!isRecord(data) || !Array.isArray(data.entries) || !Array.isArray(data.categories)) return accountingUnexpectedError();
    if (Date.parse(access.expiresAt) <= Date.now()) {
      return accountingJson({ ok: false, code: "ACCOUNTING_LOCKED", error: "La sesión de Contabilidad ha caducado." }, 423);
    }
    return accountingJson({ ok: true, expiresAt: access.expiresAt, report: officeAccountingReport(data.entries, data.categories, month, now) });
  } catch {
    return accountingUnexpectedError();
  }
}
