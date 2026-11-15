import { accountingJson, requireAccountingAccess } from "@/lib/server/accounting-access";
import { accountingDatabaseError, accountingUnexpectedError, isRecord } from "@/lib/server/accounting-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const access = await requireAccountingAccess(req);
    if (!access.ok) return access.response;
    // A single database snapshot keeps account balances and both sides of every
    // transfer consistent. No PostgREST row cap or cached/stale totals.
    const { data, error } = await access.admin.rpc("accounting_snapshot", { p_actor: access.authUserId });
    if (error) return accountingDatabaseError(error);
    if (!isRecord(data) || !Array.isArray(data.entries) || !Array.isArray(data.categories) || !Array.isArray(data.methods)) {
      return accountingUnexpectedError();
    }
    return accountingJson({ ok: true, entries: data.entries, categories: data.categories, methods: data.methods, updatedAt: new Date().toISOString() });
  } catch {
    return accountingUnexpectedError();
  }
}
