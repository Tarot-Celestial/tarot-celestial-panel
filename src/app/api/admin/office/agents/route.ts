import { officeAccess, officeDatabaseError, officeError, officeJson } from "@/lib/server/office-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const { data, error } = await access.admin.rpc("office_agent_activity", { p_actor: access.authUserId });
    if (error) return officeDatabaseError(error);
    return officeJson({ ok: true, checked_at: data.checked_at, handoffs: data.handoffs });
  } catch { return officeError("No se pudo consultar la actividad interna de la Oficina.", 503); }
}
