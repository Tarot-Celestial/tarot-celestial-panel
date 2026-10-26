import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { normalizeWhatsAppDraftPhone, normalizeWhatsAppDraftSlots, WHATSAPP_DRAFT_UUID } from "@/lib/whatsapp-campaign-drafts";
import { readWhatsAppDraftBody } from "@/lib/server/whatsapp-draft-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const capabilities = { send: false, official_connection: false };
const forbidden = () => reply({ ok: false, code: "FORBIDDEN", error: "Acceso reservado a un administrador activo con su cuenta vinculada." }, 403);

function rpcFailure(error: any, saving = false) {
  const message = String(error?.message || "");
  if (/\bFORBIDDEN\b/.test(message)) return forbidden();
  if (/\b(VERSION_CONFLICT|OPERATION_CONFLICT)\b/.test(message)) return reply({ ok: false, code: message.includes("VERSION_CONFLICT") ? "VERSION_CONFLICT" : "OPERATION_CONFLICT", error: "El borrador cambió o este intento pertenece a otros datos. Recarga antes de guardar otra versión." }, 409);
  if (/\b(INVALID_DRAFT|INVALID_DOCUMENT|INVALID_PHONE|INVALID_REQUEST|INVALID_REQUEST_ID|INVALID_VERSION|INVALID_PLACEHOLDER|INVALID_IMAGE_URL|DUPLICATE_SENDER|DUPLICATE_CONTACT|DUPLICATE_PHONE|TOO_MANY_CONTACTS|INVALID_CONSENT|CONSENT_NOTE_REQUIRED|INVALID_CONTACT|INVALID_IMAGE)\b/.test(message)) return reply({ ok: false, code: "INVALID_DRAFT", error: "Revisa los contactos, las dos listas y los datos del borrador." }, 400);
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error?.code)) return reply({ ok: false, code: "SETUP_REQUIRED", error: "El almacenamiento de borradores todavía no está disponible. No se ha enviado ningún mensaje." }, 503);
  return reply({ ok: false, code: saving ? "SAVE_UNCONFIRMED" : "UNAVAILABLE", uncertain: saving, error: saving ? "No se pudo confirmar el guardado. Reintenta con el mismo identificador y los mismos datos." : "No se pudo consultar el borrador. Reintenta." }, 503);
}

function verifiedGate(gate: Awaited<ReturnType<typeof requireAdmin>>) {
  return gate.ok && WHATSAPP_DRAFT_UUID.test(gate.authUserId) && gate.me.user_id === gate.authUserId && gate.me.is_active === true;
}

function checkedDraft(data: any) {
  if (!data || !Number.isSafeInteger(data.version) || data.version < 0 || (data.updated_at !== null && !Number.isFinite(Date.parse(data.updated_at)))) throw new Error("INVALID_RESPONSE");
  return { version: data.version, updated_at: data.updated_at, slots: normalizeWhatsAppDraftSlots(data.slots, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL }) };
}

async function boundedJson(req: Request) {
  const bytes = await readWhatsAppDraftBody(req, 650_000);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok || !verifiedGate(gate)) return forbidden();
    const result = await gate.admin.rpc("tc_admin_whatsapp_draft_get", { p_actor_user_id: gate.authUserId });
    if (result.error) return rpcFailure(result.error);
    return reply({ ok: true, draft: checkedDraft(result.data), capabilities });
  } catch { return rpcFailure(null); }
}

export async function POST(req: Request) {
  let saving = false;
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok || !verifiedGate(gate)) return forbidden();
    let body: any;
    try { body = await boundedJson(req); } catch (error: any) { return reply({ ok: false, code: "INVALID_BODY", error: "El contenido del borrador no es válido o supera el tamaño permitido." }, error?.message === "BODY_TOO_LARGE" ? 413 : 400); }
    if (body?.action === "resolve") {
      let phones: string[];
      try {
        if (!Array.isArray(body.phones) || !body.phones.length || body.phones.length > 300) throw new Error();
        phones = Array.from(new Set<string>(body.phones.map(normalizeWhatsAppDraftPhone)));
      } catch { return reply({ ok: false, code: "INVALID_PHONES", error: "Introduce de 1 a 300 teléfonos con prefijo internacional." }, 400); }
      const result = await gate.admin.rpc("tc_admin_whatsapp_draft_resolve", { p_actor_user_id: gate.authUserId, p_phones: phones });
      if (result.error) return rpcFailure(result.error);
      if (!Array.isArray(result.data) || result.data.length !== phones.length || new Set(result.data.map((row: any) => row.phone)).size !== phones.length || result.data.some((row: any) => !phones.includes(row.phone) || !["unique", "none", "ambiguous", "blocked"].includes(row.match) || typeof row.name !== "string")) return rpcFailure(null);
      return reply({ ok: true, contacts: result.data.map((row: any) => ({ phone: row.phone, match: row.match, name: row.match === "unique" ? row.name.slice(0, 160) : "" })) });
    }
    if (body?.action !== "save") return reply({ ok: false, code: "INVALID_ACTION", error: "Este apartado permite preparar y guardar borradores. No envía mensajes." }, 400);
    let slots;
    try {
      if (typeof body.request_id !== "string" || !WHATSAPP_DRAFT_UUID.test(body.request_id) || !Number.isSafeInteger(body.expected_version) || body.expected_version < 0) throw new Error("El identificador o la versión del borrador no son válidos.");
      slots = normalizeWhatsAppDraftSlots(body.slots, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });
    } catch (error: any) { return reply({ ok: false, code: "INVALID_DRAFT", error: error.message }, 400); }
    saving = true;
    const result = await gate.admin.rpc("tc_admin_whatsapp_draft_save", { p_actor_user_id: gate.authUserId, p_request_id: body.request_id.toLowerCase(), p_expected_version: body.expected_version, p_document: { slots } });
    if (result.error) return rpcFailure(result.error, true);
    return reply({ ok: true, draft: checkedDraft(result.data), capabilities });
  } catch { return rpcFailure(null, saving); }
}
