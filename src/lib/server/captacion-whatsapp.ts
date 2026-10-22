import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { CAPTACION_BENEFITS_IMAGE, buildCaptacionMessage, captacionWhatsAppPhone } from "@/lib/captacion-whatsapp";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { originMatchesBrand } from "@/lib/server/brand-filter";

export const CAPTACION_WHATSAPP_ORIGIN = "https://clientestarotcelestial.es";
export const CAPTACION_WHATSAPP_CALLBACK_PATH = "/api/webhooks/captacion-whatsapp";
export const CAPTACION_WHATSAPP_IMAGE = `${CAPTACION_WHATSAPP_ORIGIN}${CAPTACION_BENEFITS_IMAGE}`;
export const CAPTACION_WHATSAPP_BODY = buildCaptacionMessage({ id: "template", cliente: { nombre: "{{1}}" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SID = /^HX[0-9a-f]{32}$/i;
const MESSAGE_SID = /^SM[0-9a-f]{32}$/i;
const DELIVERY_FIELDS = "id,status,message_sid,request_id,submission_key,created_at,updated_at";
type Row = Record<string, any>;
export class CaptacionWhatsAppError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}
export function captacionWhatsAppAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
export async function captacionWhatsAppWorker(req: Request, admin: any) {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "")?.[1]?.trim();
  if (!token) throw new CaptacionWhatsAppError("UNAUTHENTICATED", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) throw new CaptacionWhatsAppError("UNAUTHENTICATED", 401);
  const result = await admin.from("workers").select("id,role,is_active")
    .or(`user_id.eq.${data.user.id},auth_user_id.eq.${data.user.id}`).eq("is_active", true).in("role", ["central", "admin"]).limit(1).maybeSingle();
  if (result.error) throw new CaptacionWhatsAppError("UNAVAILABLE");
  if (!result.data?.is_active || !["admin", "central"].includes(result.data.role)) throw new CaptacionWhatsAppError("FORBIDDEN", 403);
  return { ...result.data, user_id: data.user.id };
}
export function captacionWhatsAppConfig() {
  const required = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM", "TWILIO_WHATSAPP_CAPTACION_CONTENT_SID"];
  const missing = required.filter(key => !process.env[key]?.trim());
  const account = process.env.TWILIO_ACCOUNT_SID?.trim() || "";
  const token = process.env.TWILIO_AUTH_TOKEN?.trim() || "";
  const from = process.env.TWILIO_WHATSAPP_FROM?.trim() || "";
  const sid = process.env.TWILIO_WHATSAPP_CAPTACION_CONTENT_SID?.trim() || "";
  let reason: string | null = missing.length ? "NOT_CONFIGURED" : null;
  if (!reason && (!/^AC[0-9a-f]{32}$/i.test(account) || !SID.test(sid) || !/^whatsapp:\+[1-9]\d{7,14}$/.test(from))) reason = "INVALID_CONFIGURATION";
  if (!reason && from === "whatsapp:+14155238886") reason = "SANDBOX_SENDER";
  return { account, token, from, sid, missing, reason, configured: !reason, enabled: process.env.CAPTACION_WHATSAPP_ENABLED === "true", production: process.env.VERCEL_ENV === "production" };
}
function credentials(config: ReturnType<typeof captacionWhatsAppConfig>) {
  return `Basic ${Buffer.from(`${config.account}:${config.token}`).toString("base64")}`;
}
function fixedText(text: unknown) { return String(text || "").replace(/\r\n/g, "\n").trim(); }

export async function captacionWhatsAppTemplate() {
  const config = captacionWhatsAppConfig();
  if (!config.configured) return { config, ready: false, reason: config.reason, template: null };
  try {
    const requests = [`https://content.twilio.com/v1/Content/${config.sid}`, `https://content.twilio.com/v1/Content/${config.sid}/ApprovalRequests`];
    const responses = await Promise.all(requests.map(url => fetch(url, { headers: { Authorization: credentials(config) }, cache: "no-store", signal: AbortSignal.timeout(10000) })));
    if (responses.some(response => !response.ok)) return { config, ready: false, reason: "TEMPLATE_UNAVAILABLE", template: null };
    const [content, approvals] = await Promise.all(responses.map(response => response.json()));
    const media = content?.types?.["twilio/media"];
    const approval = approvals?.whatsapp;
    const status = String(approval?.status || "not_submitted").toLowerCase();
    const matches = content?.sid === config.sid && content?.account_sid === config.account
      && approvals?.sid === config.sid && approvals?.account_sid === config.account
      && fixedText(media?.body) === fixedText(CAPTACION_WHATSAPP_BODY)
      && Array.isArray(media?.media) && media.media.length === 1 && media.media[0] === CAPTACION_WHATSAPP_IMAGE
      && String(approval?.category || "").toUpperCase() === "MARKETING"
      && (!approval?.content_type || approval.content_type === "twilio/media");
    const template = { sid: config.sid, status, name: String(approval?.name || content?.friendly_name || ""), body: CAPTACION_WHATSAPP_BODY, media_url: CAPTACION_WHATSAPP_IMAGE };
    let reason = !matches ? "TEMPLATE_MISMATCH" : status !== "approved" ? "TEMPLATE_NOT_APPROVED" : !config.production ? "PRODUCTION_ONLY" : !config.enabled ? "NOT_ENABLED" : null;
    return { config, ready: !reason, reason, template };
  } catch { return { config, ready: false, reason: "TEMPLATE_UNAVAILABLE", template: null }; }
}

export async function captacionWhatsAppLead(admin: any, worker: Row, leadId: string, brand: string) {
  if (!UUID.test(leadId)) throw new CaptacionWhatsAppError("INVALID_LEAD", 400);
  if (brand !== "celestial") throw new CaptacionWhatsAppError("BRAND_NOT_SUPPORTED", 400);
  const result = await admin.from("captacion_leads").select("id,cliente_id,assigned_worker_id,origen,closed_at,last_contact_at,contacted_at")
    .eq("id", leadId).maybeSingle();
  if (result.error) throw new CaptacionWhatsAppError("UNAVAILABLE");
  const lead = result.data;
  if (!lead || (worker.role !== "admin" && lead.assigned_worker_id && String(lead.assigned_worker_id) !== String(worker.id))) throw new CaptacionWhatsAppError("LEAD_NOT_FOUND", 404);
  const clientResult = await admin.from("crm_clientes").select("id,nombre,apellido,telefono,telefono_normalizado,pais,origen").eq("id", lead.cliente_id).maybeSingle();
  if (clientResult.error) throw new CaptacionWhatsAppError("UNAVAILABLE");
  const client = clientResult.data;
  if (!client || !originMatchesBrand(client.origen || lead.origen, "celestial")) throw new CaptacionWhatsAppError("LEAD_NOT_FOUND", 404);
  const eventResult = await admin.from("meta_lead_events").select("leadgen_id,meta_created_at").eq("captacion_lead_id", lead.id).eq("status", "processed")
    .lte("meta_created_at", new Date().toISOString()).order("meta_created_at", { ascending: false }).order("leadgen_id", { ascending: false }).limit(1).maybeSingle();
  if (eventResult.error) throw new CaptacionWhatsAppError("UNAVAILABLE");
  return { lead, client, submission_key: eventResult.data ? `meta:${eventResult.data.leadgen_id}` : "initial", submitted_at: eventResult.data?.meta_created_at || null };
}
export function captacionWhatsAppRecipient(client: Row) {
  const raw = String(client.telefono_normalizado || client.telefono || "").trim();
  const direct = captacionWhatsAppPhone(raw);
  if (direct) return `+${direct}`;
  if (!/^[\d\s().-]+$/.test(raw)) return null;
  const country = String(client.pais || "").trim().toLocaleLowerCase("es-ES");
  const selected = country && COUNTRY_OPTIONS.find(option => option.code.toLowerCase() === country || option.label.toLocaleLowerCase("es-ES") === country || option.aliases?.some(alias => alias.toLocaleLowerCase("es-ES") === country));
  if (!selected) return null;
  const digits = raw.replace(/\D/g, "");
  const combined = `${selected.dialCode}${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(combined) ? combined : null;
}
export function captacionWhatsAppName(client: Row) {
  return [client.nombre, client.apellido].filter(Boolean).join(" ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "amiga";
}
export function publicCaptacionWhatsAppDelivery(row: Row | null) {
  return row ? { id: row.id, status: row.status, message_id: row.message_sid || null } : null;
}
export async function currentCaptacionWhatsAppDelivery(admin: any, context: Awaited<ReturnType<typeof captacionWhatsAppLead>>) {
  const { data, error } = await admin.from("captacion_whatsapp_deliveries").select(DELIVERY_FIELDS).eq("lead_id", context.lead.id).eq("submission_key", context.submission_key).maybeSingle();
  if (error) throw new CaptacionWhatsAppError("DATABASE_NOT_READY");
  return data;
}
export async function sendCaptacionWhatsApp(admin: any, worker: Row, context: Awaited<ReturnType<typeof captacionWhatsAppLead>>, requestId: string) {
  if (!UUID.test(requestId)) throw new CaptacionWhatsAppError("INVALID_REQUEST_ID", 400);
  const existing = await currentCaptacionWhatsAppDelivery(admin, context);
  if (existing) return { ok: true, status: existing.status, duplicate: true, delivery_id: existing.id, message_id: existing.message_sid || null };
  const settings = await captacionWhatsAppTemplate();
  if (!settings.ready) throw new CaptacionWhatsAppError(settings.reason || "NOT_READY", 409);
  const to = captacionWhatsAppRecipient(context.client);
  if (!to) throw new CaptacionWhatsAppError("INVALID_PHONE", 400);
  if (context.lead.closed_at && (!context.submitted_at || Date.parse(context.lead.closed_at) >= Date.parse(context.submitted_at))) throw new CaptacionWhatsAppError("LEAD_CLOSED", 409);
  const deliveryId = randomUUID(), callbackToken = randomUUID();
  const clientSnapshot = Object.fromEntries(["telefono_normalizado", "telefono", "pais", "nombre", "apellido"].map(key => [key, context.client[key] ?? null]));
  const { data: claim, error: claimError } = await admin.rpc("tc_captacion_whatsapp_claim", {
    p_delivery_id: deliveryId, p_request_id: requestId, p_lead_id: context.lead.id, p_worker_id: worker.id, p_auth_user_id: worker.user_id,
    p_submission_key: context.submission_key, p_content_sid: settings.config.sid, p_from_number: settings.config.from, p_to_number: `whatsapp:${to}`, p_callback_token: callbackToken,
    p_expected_cliente_id: context.client.id, p_client_snapshot: clientSnapshot,
  });
  if (claimError && ["CLIENT_CHANGED", "SUBMISSION_CHANGED", "LEAD_CLOSED"].includes(String(claimError.message || ""))) throw new CaptacionWhatsAppError("LEAD_CHANGED", 409);
  if (claimError || !claim?.delivery) throw new CaptacionWhatsAppError("CLAIM_UNAVAILABLE");
  if (!claim.claimed) return { ok: true, status: claim.delivery.status, duplicate: true, delivery_id: claim.delivery.id, message_id: claim.delivery.message_sid || null };
  const callback = new URL(CAPTACION_WHATSAPP_CALLBACK_PATH, CAPTACION_WHATSAPP_ORIGIN);
  callback.searchParams.set("delivery_id", deliveryId); callback.searchParams.set("token", callbackToken);
  const params = new URLSearchParams({ From: settings.config.from, To: `whatsapp:${to}`, ContentSid: settings.config.sid,
    ContentVariables: JSON.stringify({ "1": captacionWhatsAppName(context.client) }), StatusCallback: callback.toString() });
  let status = "unknown", messageSid: string | null = null, code: string | null = null;
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${settings.config.account}/Messages.json`, {
      method: "POST", headers: { Authorization: credentials(settings.config), "Content-Type": "application/x-www-form-urlencoded" },
      body: params, signal: AbortSignal.timeout(15000),
    });
    const json = await response.json();
    if (response.ok && MESSAGE_SID.test(json?.sid || "")) { status = "accepted"; messageSid = json.sid; }
    else { status = response.status >= 400 && response.status < 500 ? "failed" : "unknown"; code = String(json?.code || response.status).slice(0, 30); }
  } catch { /* The provider might have accepted it. Never resend automatically. */ }
  const saved = await admin.rpc("tc_captacion_whatsapp_record", { p_delivery_id: deliveryId, p_callback_token: callbackToken, p_message_sid: messageSid, p_status: status, p_error_code: code, p_source: "send_response" });
  if (saved.error || !saved.data) return { ok: true, status: "unknown", duplicate: false, delivery_id: deliveryId, message_id: messageSid };
  return { ok: true, status: saved.data.status, duplicate: false, delivery_id: deliveryId, message_id: saved.data.message_sid || null };
}
