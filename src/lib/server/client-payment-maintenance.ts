import { adminClient } from "@/lib/server/auth-cliente";
import { getClientWebPaymentsEnabled } from "./client-payment-settings";
import { CLIENT_PURCHASE_MAINTENANCE_MESSAGE } from "@/lib/client-purchase-maintenance";
export async function clientPaymentMaintenanceResponse(): Promise<Response | null> {
  try { if (await getClientWebPaymentsEnabled(adminClient())) return null; } catch {}
  return Response.json({ ok: false, code: "WEB_PAYMENTS_MAINTENANCE", error: CLIENT_PURCHASE_MAINTENANCE_MESSAGE }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
