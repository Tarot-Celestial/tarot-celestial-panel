import { handlePayPalWebhook } from "@/lib/server/paypal-webhook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  return handlePayPalWebhook(req, "legacy");
}
