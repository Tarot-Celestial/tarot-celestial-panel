import { processMolliePayment } from "@/lib/server/mollie-payment-processing";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const json = req.headers.get("content-type")?.includes("application/json");
  const body = json ? await req.json().catch(() => null) : await req.formData().catch(() => null);
  const id = String(json ? body?.id || "" : body?.get("id") || "").trim();
  return processMolliePayment(id);
}
