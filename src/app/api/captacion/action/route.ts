export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;
  const admin = adminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, user_id, display_name, email, role")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function tryInsertClientNote(admin: ReturnType<typeof adminClient>, payload: any) {
  try {
    await admin.from("crm_client_notes").insert(payload);
  } catch {
    // tabla opcional
  }
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { lead_id, action, note } = await req.json();
    if (!lead_id || !action) {
      return NextResponse.json({ ok: false, error: "MISSING_PARAMS" }, { status: 400 });
    }

    const admin = adminClient();
    const { data: lead, error: leadErr } = await admin
      .from("captacion_leads")
      .select("*")
      .eq("id", lead_id)
      .single();
    if (leadErr) throw leadErr;
    if (!lead) throw new Error("Lead no encontrado");

    const now = new Date();
    const intentoActual = Number(lead.intento_actual || 1);
    let intento = intentoActual;
    let estado = String(lead.estado || "nuevo");
    let nextContactAt: string | null = lead.next_contact_at || null;
    let contactedAt: string | null = lead.contacted_at || null;
    let closedAt: string | null = lead.closed_at || null;
    let lastResult = String(action);

    if (action === "contactado") {
      estado = "contactado";
      contactedAt = now.toISOString();
      closedAt = now.toISOString();
      nextContactAt = null;
    } else if (action === "no_responde") {
      intento = intentoActual + 1;
      if (intento === 2) {
        estado = "reintento_2";
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        nextContactAt = d.toISOString();
      } else if (intento === 3) {
        estado = "reintento_3";
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        nextContactAt = d.toISOString();
      } else {
        estado = "perdido";
        closedAt = now.toISOString();
        nextContactAt = null;
      }
    } else if (action === "no_interesado") {
      estado = "no_interesado";
      closedAt = now.toISOString();
      nextContactAt = null;
    } else if (action === "numero_invalido") {
      estado = "numero_invalido";
      closedAt = now.toISOString();
      nextContactAt = null;
    } else {
      return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
    }

    const updatePayload = {
      estado,
      intento_actual: intento,
      next_contact_at: nextContactAt,
      last_contact_at: now.toISOString(),
      contacted_at: contactedAt,
      closed_at: closedAt,
      last_result: lastResult,
      notas: String(note || "").trim() || lead.notas || null,
      assigned_worker_id: lead.assigned_worker_id || worker.id,
      assigned_role: lead.assigned_role || worker.role,
      updated_at: now.toISOString(),
    };

    const { data: updated, error: updErr } = await admin
      .from("captacion_leads")
      .update(updatePayload)
      .eq("id", lead_id)
      .select("*")
      .single();
    if (updErr) throw updErr;

    let message = "✅ Lead actualizado";

    if (lead.cliente_id) {
      const authorName = String(worker.display_name || worker.email || "Captación").trim() || "Captación";
      let crmLeadStatus = null as string | null;
      let noteText = "";

      if (action === "contactado") {
        crmLeadStatus = "contactado";
        noteText = `✅ Lead contactado el ${now.toLocaleString("es-ES")} por ${authorName}.${String(note || "").trim() ? `\nNota: ${String(note).trim()}` : ""}`;
        message = "✅ Lead marcado como contactado y retirado de captación.";
      } else if (action === "no_responde") {
        crmLeadStatus = estado;
        noteText = `📞 Lead sin respuesta. Programado ${estado === "reintento_2" ? "2º" : estado === "reintento_3" ? "3º" : "último"} intento para ${nextContactAt ? new Date(nextContactAt).toLocaleString("es-ES") : "cierre"}.${String(note || "").trim() ? `\nNota: ${String(note).trim()}` : ""}`;
        message = nextContactAt ? `📅 Siguiente llamada programada para ${new Date(nextContactAt).toLocaleDateString("es-ES")}.` : "⌛ Lead cerrado tras agotar intentos.";
      } else if (action === "no_interesado") {
        crmLeadStatus = "no_interesado";
        noteText = `🙅 El cliente indica que no le interesa continuar.${String(note || "").trim() ? `\nNota: ${String(note).trim()}` : ""}`;
        message = "🙅 Lead cerrado como no interesado y anotado en CRM.";
      } else if (action === "numero_invalido") {
        crmLeadStatus = "numero_invalido";
        noteText = `❌ Número inválido detectado en captación.${String(note || "").trim() ? `\nNota: ${String(note).trim()}` : ""}`;
        message = "❌ Lead cerrado como número inválido y anotado en CRM.";
      }

      try {
        await admin
          .from("crm_clientes")
          .update({
            lead_status: crmLeadStatus,
            lead_contacted_at: action === "contactado" ? now.toISOString() : undefined,
            updated_at: now.toISOString(),
          })
          .eq("id", lead.cliente_id);
      } catch {}

      await tryInsertClientNote(admin, {
        cliente_id: lead.cliente_id,
        texto: noteText,
        author_name: authorName,
        author_email: worker.email || "captacion@tarotcelestial.local",
        is_pinned: false,
      });
    }

    return NextResponse.json({ ok: true, item: updated, message });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "ERR" }, { status: 500 });
  }
}
