import { officeAccess, officeDatabaseError, officeError, officeJson } from "@/lib/server/office-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function count(value: unknown): number {
  const numeric = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error("Invalid CRM total");
  }
  return numeric;
}

export async function GET(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;

    const { data, error } = await access.admin.rpc("office_crm_capture_totals", {
      p_actor: access.authUserId,
    });
    if (error) return officeDatabaseError(error);
    const totals = Array.isArray(data) && data.length === 1 ? data[0] : data;
    const totalClients = count(totals?.total_clients);
    const capturedClients = count(totals?.captured_clients);
    if (capturedClients > totalClients) throw new Error("Invalid captured total");

    return officeJson({ ok: true, total_clients: totalClients, captured_clients: capturedClients });
  } catch {
    return officeError("No se pudo consultar el resumen de Captación.", 503);
  }
}
