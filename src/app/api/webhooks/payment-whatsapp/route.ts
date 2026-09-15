import { validateRequest } from "twilio";
import { adminClient } from "@/lib/server/auth-cliente";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const base = process.env.MOLLIE_PUBLIC_BASE_URL?.replace(/\/$/, "");
  const secret = process.env.TWILIO_AUTH_TOKEN;
  if (!base || !secret) return new Response("Not configured", { status: 503 });
  const url = new URL(req.url);
  const form = await req.formData();
  const params = Object.fromEntries(Array.from(form.entries()).map(([k,v]) => [k, String(v)]));
  if (!validateRequest(secret, req.headers.get("x-twilio-signature") || "", `${base}${url.pathname}${url.search}`, params)) return new Response("Unauthorized", { status: 403 });
  const admin = adminClient();
  const { data: attempt, error } = await admin.from("cliente_payment_attempts").select("id,whatsapp").eq("id", url.searchParams.get("attempt_id") || "").maybeSingle();
  if (error) return new Response("Retry", { status: 500 });
  if (!attempt) return new Response("Not found", { status: 404 });
  const previous = attempt.whatsapp || {};
  if (!previous.delivery_token || previous.delivery_token !== url.searchParams.get("delivery_token")) return new Response("Stale callback", { status: 409 });
  if (previous.sid && previous.sid !== params.MessageSid) return new Response("Conflict", { status: 409 });
  if (!previous.sid && previous.status !== "sending" && previous.status !== "unknown") return new Response("Conflict", { status: 409 });
  const rank: Record<string, number> = { sending: 2, unknown: 0, accepted: 1, queued: 1, sending_provider: 2, sent: 3, failed: 4, undelivered: 4, delivered: 5, read: 6 };
  if (!(params.MessageStatus in rank) || (previous.sid ? rank[previous.status] || 0 : 0) > rank[params.MessageStatus]) return new Response("OK");
  const { error: saveError } = await admin.from("cliente_payment_attempts").update({ whatsapp: { delivery_token: previous.delivery_token, status: params.MessageStatus, sid: params.MessageSid, code: params.ErrorCode || null, updated_at: new Date().toISOString() } }).eq("id", attempt.id).eq("whatsapp", JSON.stringify(previous));
  return new Response(saveError ? "Retry" : "OK", { status: saveError ? 500 : 200 });
}
