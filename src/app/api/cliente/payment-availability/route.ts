import { adminClient } from "@/lib/server/auth-cliente";
import { getClientWebPaymentsEnabled } from "@/lib/server/client-payment-settings";
export const dynamic = "force-dynamic";
export async function GET() {
  let enabled = false;
  try { enabled = await getClientWebPaymentsEnabled(adminClient()); } catch {}
  return Response.json({ web_payments_enabled: enabled }, { headers: { "Cache-Control": "no-store" } });
}
