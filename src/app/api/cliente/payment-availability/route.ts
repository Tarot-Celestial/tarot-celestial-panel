import { adminClient } from "@/lib/server/auth-cliente";
import { getClientWebPaymentsEnabled } from "@/lib/server/client-payment-settings";
export const dynamic = "force-dynamic";
export async function GET() {
  let enabled = false;
  try { enabled = await getClientWebPaymentsEnabled(adminClient()); } catch {
    console.error("[client-payment-settings] Availability unavailable", {
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
  }
  return Response.json({ web_payments_enabled: enabled }, { headers: { "Cache-Control": "no-store" } });
}
