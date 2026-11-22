import { officeAccess, officeDatabaseError, officeError, officeJson } from "@/lib/server/office-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const year = new URL(req.url).searchParams.get("year") ?? "";
    if (!/^[1-9]\d{3}$/.test(year)) return officeError("Selecciona un año válido.", 400);
    const result = await access.admin.rpc("office_crm_first_purchase_year", { p_actor: access.authUserId, p_year: Number(year) });
    if (result.error) return officeDatabaseError(result.error);
    return officeJson({ ok: true, months: result.data });
  } catch { return officeError("No se pudo consultar el histórico de primeras compras.", 503); }
}
