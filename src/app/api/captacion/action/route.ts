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

function norm(value: unknown) {
  return String(value || "").trim().toLowerCase();
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

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function noteForAction(action: string, who: string, nowIso: string, extra?: Record<string, any>) {
  const when = new Date(nowIso).toLocaleString("es-ES");
  const next = extra?.next_contact_at ? new Date(String(extra.next_contact_at)).toLocaleString("es-ES") : null;
  const intento = Number(extra?.intento_actual || 0);

  if (action === "no_contesta") {
    return `📞 No contesta. Gestión realizada por ${who} el ${when}. Intento ${intento}/3.${next ? ` Próximo contacto: ${next}.` : ""}`;
  }
  if (action === "pendiente_free") {
    return `🕯️ Cliente atendido y pendiente de hacer la consulta free. Gestión realizada por ${who} el ${when}.`;
  }
  if (action === "hizo_free") {
    return `🔮 Cliente hizo la free pero no compró. Gestión realizada por ${who} el ${when}.${next ? ` Recontacto programado para ${next}.` : ""}`;
  }
  if (action === "captado") {
    return `💰 Cliente captado tras la gestión de ${who} el ${when}.`;
  }
  if (action === "no_interesado") {
    return `🙅 Cliente cerrado como no interesado por ${who} el ${when}.`;
  }
  if (action === "reabrir") {
    return `♻️ Lead reabierto por ${who} el ${when}.`;
  }
  return `ℹ️ Acción de captación: ${action} (${when}).`;
}

async function appendCrmNote(admin: ReturnType<typeof adminClient>, clienteId: string, notePayload: Record<string, any>) {
  try {
    const { error } = await admin.from("crm_client_notes").insert(notePayload);
    if (error) throw error;
  } catch {
    try {
      const { data: row } = await admin.from("crm_clientes").select("notas_generales").eq("id", clienteId).maybeSingle();
      const prev = String(row?.notas_generales || "").trim();
      const merged = prev ? `${prev}\n${notePayload.texto}` : notePayload.texto;
      await admin.from("crm_clientes").update({ notas_generales: merged, updated_at: new Date().toISOString() }).eq("id", clienteId);
    } catch {}
  }
}

export async function POST(req: Request) {
  try {
    const admin = adminClient();
    const worker = await workerFromReq(req).catch(() => null);
    const who = String(worker?.display_name || worker?.email || "Captación").trim() || "Captación";

    const body = await req.json().catch(() => ({}));
    const leadId = String(body?.lead_id || "").trim();
    const action = norm(body?.action || "");
    if (!leadId || !action) {
      return NextResponse.json({ ok: false, error: "FALTAN_DATOS" }, { status: 400 });
    }

    const { data: lead, error: leadErr } = await admin
      .from("captacion_leads")
      .select("id, cliente_id, estado, intento_actual, max_intentos, next_contact_at, last_contact_at, contacted_at, closed_at, last_result")
      .eq("id", leadId)
      .single();
    if (leadErr || !lead) throw leadErr || new Error("Lead no encontrado");

    const nowIso = new Date().toISOString();
    const currentAttempt = Math.max(1, Number(lead.intento_actual || 1));
    const maxAttempts = Math.max(3, Number(lead.max_intentos || 3));

    let patch: Record<string, any> = {
      updated_at: nowIso,
      last_contact_at: nowIso,
      last_result: action,
    };

    let crmPatch: Record<string, any> = { updated_at: nowIso };
    let message = "Lead actualizado";

    if (action === "no_contesta") {
      const nextAttempt = currentAttempt + 1;
      const shouldClose = nextAttempt > maxAttempts;
      patch.intento_actual = shouldClose ? maxAttempts : nextAttempt;
      patch.estado = shouldClose ? "no_interesado" : "no_contesta";
      patch.next_contact_at = shouldClose ? nowIso : addDays(1);
      patch.closed_at = shouldClose ? nowIso : null;
      patch.contacted_at = null;
      crmPatch.lead_status = shouldClose ? "no_interesado" : "no_contesta";
      message = shouldClose
        ? "🙅 Lead cerrado tras 3 intentos sin respuesta."
        : `📞 Marcado como no contesta. Próximo intento listo para ${new Date(String(patch.next_contact_at)).toLocaleString("es-ES")}.`;
    } else if (action === "pendiente_free") {
      patch.estado = "pendiente_free";
      patch.contacted_at = nowIso;
      patch.closed_at = null;
      patch.next_contact_at = addDays(1);
      crmPatch.lead_status = "pendiente_free";
      crmPatch.lead_contacted_at = nowIso;
      message = "🕯️ Lead pasado a pendiente de free.";
    } else if (action === "hizo_free") {
      patch.estado = "hizo_free";
      patch.contacted_at = nowIso;
      patch.closed_at = null;
      patch.intento_actual = 1;
      patch.max_intentos = 3;
      patch.next_contact_at = addDays(7);
      crmPatch.lead_status = "hizo_free";
      crmPatch.lead_contacted_at = nowIso;
      message = "🔮 Cliente marcado como hizo free. Recontacto semanal programado.";
    } else if (action === "recontacto") {
      const nextAttempt = currentAttempt + 1;
      const shouldClose = nextAttempt > maxAttempts;
      patch.intento_actual = shouldClose ? maxAttempts : nextAttempt;
      patch.estado = shouldClose ? "no_interesado" : "recontacto";
      patch.contacted_at = nowIso;
      patch.closed_at = shouldClose ? nowIso : null;
      patch.next_contact_at = shouldClose ? nowIso : addDays(7);
      crmPatch.lead_status = shouldClose ? "no_interesado" : "recontacto";
      crmPatch.lead_contacted_at = nowIso;
      message = shouldClose
        ? "🙅 Seguimiento post-free agotado. Lead cerrado como no interesado."
        : "📆 Recontacto semanal registrado.";
    } else if (action === "captado") {
      patch.estado = "captado";
      patch.contacted_at = nowIso;
      patch.closed_at = nowIso;
      patch.next_contact_at = nowIso;
      crmPatch.lead_status = "captado";
      crmPatch.lead_contacted_at = nowIso;
      message = "💰 Cliente marcado como captado.";
    } else if (action === "no_interesado") {
      patch.estado = "no_interesado";
      patch.closed_at = nowIso;
      patch.next_contact_at = nowIso;
      crmPatch.lead_status = "no_interesado";
      message = "🙅 Lead cerrado como no interesado.";
    } else if (action === "reabrir") {
      patch.estado = "nuevo";
      patch.closed_at = null;
      patch.contacted_at = null;
      patch.intento_actual = 1;
      patch.max_intentos = 3;
      patch.next_contact_at = nowIso;
      crmPatch.lead_status = "nuevo";
      message = "♻️ Lead reabierto y devuelto a nuevos.";
    } else {
      return NextResponse.json({ ok: false, error: "ACCION_INVALIDA" }, { status: 400 });
    }

    const { error: updErr } = await admin.from("captacion_leads").update(patch).eq("id", leadId);
    if (updErr) throw updErr;

    const clienteId = String(lead.cliente_id || "").trim();
    if (clienteId) {
      try {
        const { error: crmErr } = await admin.from("crm_clientes").update(crmPatch).eq("id", clienteId);
        if (crmErr) throw crmErr;
      } catch {}

      const noteText = noteForAction(action, who, nowIso, {
        intento_actual: patch.intento_actual ?? currentAttempt,
        next_contact_at: patch.next_contact_at,
      });

      await appendCrmNote(admin, clienteId, {
        cliente_id: clienteId,
        texto: noteText,
        author_user_id: worker?.user_id || null,
        author_name: who,
        author_email: worker?.email || null,
        is_pinned: false,
      });
    }

    const finalState = String(patch.estado || lead.estado || "nuevo");
    return NextResponse.json({
      ok: true,
      message,
      estado: finalState,
      intento_actual: patch.intento_actual ?? currentAttempt,
      next_contact_at: patch.next_contact_at ?? lead.next_contact_at,
      closed: ["captado", "no_interesado", "numero_invalido", "perdido"].includes(finalState),
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}
