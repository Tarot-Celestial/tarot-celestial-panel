import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function noteForAction(action: string, who: string, nowIso: string) {
  const when = new Date(nowIso).toLocaleString("es-ES");
  if (action === "contactado") return `✅ Lead contactado el ${when} por ${who}.`;
  if (action === "no_responde") return `📞 Lead sin respuesta el ${when}. Se programa nuevo intento automático.`;
  if (action === "no_interesado") return `🙅 El cliente indica que no le interesa (${when}).`;
  if (action === "numero_invalido") return `❌ Número inválido detectado en captación (${when}).`;
  return `ℹ️ Acción de captación: ${action} (${when}).`;
}

export async function POST(req: Request) {
  try {
    const admin = adminClient();
    const worker = await workerFromReq(req).catch(() => null);
    const who = String(worker?.display_name || worker?.email || "Captación").trim() || "Captación";

    const body = await req.json().catch(() => ({}));
    const leadId = String(body?.lead_id || "").trim();
    const action = String(body?.action || "").trim();
    if (!leadId || !action) {
      return NextResponse.json({ ok: false, error: "FALTAN_DATOS" }, { status: 400 });
    }

    const { data: lead, error: leadErr } = await admin
      .from("captacion_leads")
      .select("id, cliente_id, estado, intento_actual, next_contact_at, contacted_at, closed_at")
      .eq("id", leadId)
      .single();
    if (leadErr || !lead) throw leadErr || new Error("Lead no encontrado");

    const nowIso = new Date().toISOString();
    const intentoActual = Number(lead.intento_actual || 1);
    let intento = intentoActual;
    let estado = String(lead.estado || "nuevo");
    let nextContactAt: string = String(lead.next_contact_at || nowIso);
    let contactedAt: string | null = lead.contacted_at || null;
    let closedAt: string | null = lead.closed_at || null;
    let leadStatus: string | null = null;
    let message = "Lead actualizado";

    if (action === "contactado") {
      estado = "contactado";
      contactedAt = nowIso;
      closedAt = nowIso;
      nextContactAt = nowIso;
      leadStatus = "contactado";
      message = "✅ Lead marcado como contactado y retirado de pendientes.";
    } else if (action === "no_responde") {
      intento = intentoActual + 1;
      const next = new Date();
      if (intento >= 3) {
        estado = "reintento_3";
        next.setDate(next.getDate() + 1);
      } else {
        estado = "reintento_2";
        next.setDate(next.getDate() + 1);
      }
      nextContactAt = next.toISOString();
      closedAt = null;
      leadStatus = "seguimiento";
      message = `📞 Reintento programado para ${new Date(nextContactAt).toLocaleString("es-ES")}.`;
    } else if (action === "no_interesado") {
      estado = "no_interesado";
      closedAt = nowIso;
      nextContactAt = nowIso;
      leadStatus = "no_interesado";
      message = "🙅 Lead cerrado como no interesado.";
    } else if (action === "numero_invalido") {
      estado = "numero_invalido";
      closedAt = nowIso;
      nextContactAt = nowIso;
      leadStatus = "numero_invalido";
      message = "❌ Lead cerrado por número inválido.";
    } else {
      return NextResponse.json({ ok: false, error: "ACCION_INVALIDA" }, { status: 400 });
    }

    const { error: updErr } = await admin
      .from("captacion_leads")
      .update({
        estado,
        intento_actual: intento,
        next_contact_at: nextContactAt,
        last_contact_at: nowIso,
        contacted_at: contactedAt,
        closed_at: closedAt,
        last_result: action,
        updated_at: nowIso,
      })
      .eq("id", leadId);
    if (updErr) throw updErr;

    const clienteId = String(lead.cliente_id || "").trim();
    if (clienteId) {
      try {
        const crmPayload: Record<string, any> = { updated_at: nowIso };
        if (leadStatus) crmPayload.lead_status = leadStatus;
        if (action === "contactado") crmPayload.lead_contacted_at = nowIso;
        const { error: crmErr } = await admin.from("crm_clientes").update(crmPayload).eq("id", clienteId);
        if (crmErr) throw crmErr;
      } catch {}

      try {
        const noteText = noteForAction(action, who, nowIso);
        const notePayload: any = {
          cliente_id: clienteId,
          texto: noteText,
          author_user_id: worker?.user_id || null,
          author_name: who,
          author_email: worker?.email || null,
          is_pinned: false,
        };
        const { error: noteErr } = await admin.from("crm_client_notes").insert(notePayload);
        if (noteErr) throw noteErr;
      } catch {
        try {
          const { data: row } = await admin.from("crm_clientes").select("notas_generales").eq("id", clienteId).maybeSingle();
          const prev = String(row?.notas_generales || "").trim();
          const text = noteForAction(action, who, nowIso);
          const merged = prev ? `${prev}
${text}` : text;
          await admin.from("crm_clientes").update({ notas_generales: merged, updated_at: nowIso }).eq("id", clienteId);
        } catch {}
      }
    }

    return NextResponse.json({ ok: true, message, estado, intento_actual: intento, next_contact_at: nextContactAt });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}
