import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function scheduleForAttempt(createdAt: string, attempt: number) {
  const base = new Date(createdAt || new Date().toISOString());
  const daysOffset = attempt <= 1 ? 0 : attempt - 1;
  base.setDate(base.getDate() + daysOffset);
  return base.toISOString();
}

async function tryInsertNote(admin: ReturnType<typeof adminClient>, payload: any) {
  try {
    await admin.from("crm_client_notes").insert(payload);
  } catch {
    // opcional
  }
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const leadId = String(body?.lead_id || body?.id || "").trim();
    const action = String(body?.action || "").trim();
    const note = String(body?.note || "").trim();

    if (!leadId) return NextResponse.json({ ok: false, error: "FALTA_LEAD_ID" }, { status: 400 });
    if (!action) return NextResponse.json({ ok: false, error: "FALTA_ACTION" }, { status: 400 });

    const admin = adminClient();
    const { data: lead, error: leadError } = await admin
      .from("captacion_leads")
      .select("*")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw leadError;
    if (!lead) return NextResponse.json({ ok: false, error: "LEAD_NO_EXISTE" }, { status: 404 });

    const nowIso = new Date().toISOString();
    const authorName = String(worker.display_name || worker.email || "Equipo").trim() || "Equipo";
    const patch: Record<string, any> = {
      updated_at: nowIso,
      last_contact_at: nowIso,
    };

    let notePrefix = "";

    if (action === "contactado") {
      patch.estado = "contactado";
      patch.contacted_at = nowIso;
      patch.closed_at = nowIso;
      patch.last_result = "contactado";
      notePrefix = "✅ Lead contactado";

      try {
        await admin.from("crm_clientes").update({
          lead_status: "contactado",
          lead_contacted_at: nowIso,
        }).eq("id", lead.cliente_id);
      } catch {
        // columnas opcionales
      }
    } else if (action === "no_responde") {
      const nextAttempt = Number(lead.intento_actual || 1) + 1;
      if (nextAttempt > Number(lead.max_intentos || 3)) {
        patch.estado = "perdido";
        patch.closed_at = nowIso;
        patch.last_result = "no_responde";
        notePrefix = "⌛ Lead sin respuesta tras 3 intentos";
      } else {
        patch.intento_actual = nextAttempt;
        patch.estado = nextAttempt === 2 ? "reintento_2" : "reintento_3";
        patch.next_contact_at = scheduleForAttempt(String(lead.created_at || nowIso), nextAttempt);
        patch.last_result = "no_responde";
        notePrefix = `📞 Lead no responde, programado ${patch.estado}`;
      }
    } else if (action === "no_interesado") {
      patch.estado = "no_interesado";
      patch.closed_at = nowIso;
      patch.last_result = "no_interesado";
      notePrefix = "🙅 Lead marcado como no interesado";
    } else if (action === "numero_invalido") {
      patch.estado = "numero_invalido";
      patch.closed_at = nowIso;
      patch.last_result = "numero_invalido";
      notePrefix = "❌ Lead con número inválido";
    } else {
      return NextResponse.json({ ok: false, error: "ACTION_INVALIDA" }, { status: 400 });
    }

    if (note) {
      patch.notas = [String(lead.notas || "").trim(), `${nowIso} · ${authorName}: ${note}`].filter(Boolean).join("\n");
    }

    const { data: updated, error: updateError } = await admin
      .from("captacion_leads")
      .update(patch)
      .eq("id", leadId)
      .select("*")
      .single();
    if (updateError) throw updateError;

    await tryInsertNote(admin, {
      cliente_id: lead.cliente_id,
      texto: `${notePrefix}${note ? `\n\n${note}` : ""}`,
      author_user_id: worker.user_id || null,
      author_name: authorName,
      author_email: worker.email || null,
      is_pinned: false,
    });

    return NextResponse.json({ ok: true, lead: updated });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}
