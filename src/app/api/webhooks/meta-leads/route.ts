import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function text(v: any) {
  const s = String(v ?? "").trim();
  return s || null;
}

function normalizePhonePretty(v: any) {
  return String(v ?? "").replace(/\s+/g, " ").trim() || null;
}

function normalizePhoneDigits(v: any) {
  const digits = String(v ?? "").replace(/\D/g, "").trim();
  if (!digits) return null;
  if (digits.length === 9) return `34${digits}`;
  return digits;
}

function splitName(fullName: string | null) {
  const value = String(fullName || "").trim();
  if (!value) return { nombre: "Lead Facebook", apellido: null as string | null };
  const parts = value.split(/\s+/).filter(Boolean);
  return {
    nombre: parts[0] || "Lead Facebook",
    apellido: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

async function findExistingClient(admin: ReturnType<typeof supabaseAdmin>, args: { telefonoDigits?: string | null; email?: string | null; }) {
  if (args.telefonoDigits) {
    const { data } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, telefono_normalizado, email, origen")
      .eq("telefono_normalizado", args.telefonoDigits)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }

  if (args.email) {
    const { data } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, telefono_normalizado, email, origen")
      .ilike("email", args.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }

  return null;
}

async function insertLeadNotifications(admin: ReturnType<typeof supabaseAdmin>, clienteId: string, fullName: string, phone: string | null) {
  const { data: workers } = await admin
    .from("workers")
    .select("user_id, role")
    .in("role", ["admin", "central"]);

  const targets = (workers || []).filter((x: any) => x?.user_id);
  if (!targets.length) return;

  const rows = targets.map((worker: any) => ({
    user_id: worker.user_id,
    title: "🔥 Nuevo lead de Facebook",
    message: [fullName, phone].filter(Boolean).join(" · ") || "Ha entrado un lead nuevo en captación.",
    read: false,
    client_id: clienteId,
    kind: "lead",
  }));

  try {
    const { error } = await admin.from("notifications").insert(rows);
    if (error) throw error;
  } catch {
    const fallback = rows.map(({ user_id, title, message, read }: any) => ({ user_id, title, message, read }));
    await admin.from("notifications").insert(fallback);
  }
}

async function tryInsertClientNote(admin: ReturnType<typeof supabaseAdmin>, payload: any) {
  try {
    await admin.from("crm_client_notes").insert(payload);
  } catch {
    // tabla opcional
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge || "OK", { status: 200 });
  }

  return NextResponse.json({ ok: false, error: "VERIFY_FAILED" }, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    const admin = supabaseAdmin();
    const body = await req.json().catch(() => ({}));

    const fullName = text(body?.nombre) || text(body?.full_name) || text(body?.name) || "Lead Facebook";
    const { nombre, apellido } = splitName(fullName);
    const telefono = normalizePhonePretty(body?.telefono || body?.phone || body?.phone_number || null);
    const telefonoDigits = normalizePhoneDigits(telefono);
    const email = text(body?.email);
    const origen = text(body?.origen) || "facebook_ads";
    const campaignName = text(body?.campaign_name) || null;
    const formName = text(body?.form_name) || null;

    if (!telefono && !email) {
      return NextResponse.json({ ok: false, error: "Lead sin teléfono ni email" }, { status: 400 });
    }

    const existing = await findExistingClient(admin, { telefonoDigits, email });

    const clientPayload: Record<string, any> = {
      nombre,
      apellido,
      telefono: telefono || existing?.telefono || "sin_telefono",
      telefono_normalizado: telefonoDigits || existing?.telefono_normalizado || `sin_telefono_${Date.now()}`,
      email: email || existing?.email || null,
      origen,
    };

    let cliente: any = null;

    if (existing?.id) {
      const { data, error } = await admin
        .from("crm_clientes")
        .update(clientPayload)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      cliente = data;
    } else {
      const insertPayload = {
        ...clientPayload,
        pais: null,
        notas: null,
        deuda_pendiente: 0,
        minutos_free_pendientes: 0,
        minutos_normales_pendientes: 0,
      };
      const { data, error } = await admin
        .from("crm_clientes")
        .insert(insertPayload)
        .select("*")
        .single();
      if (error) throw error;
      cliente = data;
    }

    // Intentamos dejar también el CRM en modo lead nuevo, pero sin romper si esas columnas no existen.
    try {
      await admin
        .from("crm_clientes")
        .update({
          lead_status: "nuevo",
          lead_contacted_at: null,
          lead_campaign_name: campaignName,
          lead_form_name: formName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cliente.id);
    } catch {}

    await tryInsertClientNote(admin, {
      cliente_id: cliente.id,
      texto: [
        "🔥 Nuevo lead recibido automáticamente.",
        `• Nombre: ${fullName}`,
        telefono ? `• Teléfono: ${telefono}` : null,
        email ? `• Email: ${email}` : null,
        campaignName ? `• Campaña: ${campaignName}` : null,
        formName ? `• Formulario: ${formName}` : null,
      ].filter(Boolean).join("\n"),
      author_name: "Sistema · Captación",
      author_email: "no-reply@tarotcelestial.local",
      is_pinned: true,
    });

    const { data: openLead } = await admin
      .from("captacion_leads")
      .select("id")
      .eq("cliente_id", cliente.id)
      .in("estado", ["nuevo", "no_contesta", "pendiente_free", "hizo_free", "recontacto"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openLead?.id) {
      await admin
        .from("captacion_leads")
        .update({
          estado: "nuevo",
          intento_actual: 1,
          max_intentos: 3,
          next_contact_at: new Date().toISOString(),
          contacted_at: null,
          last_contact_at: null,
          last_result: null,
          closed_at: null,
          campaign_name: campaignName,
          form_name: formName,
          origen,
          updated_at: new Date().toISOString(),
        })
        .eq("id", openLead.id);
    } else {
      await admin.from("captacion_leads").insert({
        cliente_id: cliente.id,
        estado: "nuevo",
        intento_actual: 1,
        max_intentos: 3,
        next_contact_at: new Date().toISOString(),
        contacted_at: null,
        last_contact_at: null,
        last_result: null,
        closed_at: null,
        campaign_name: campaignName,
        form_name: formName,
        origen,
      });
    }

    await insertLeadNotifications(admin, String(cliente.id), fullName, telefono);

    return NextResponse.json({ ok: true, cliente_id: cliente.id });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ ok: false, error: err?.message || "ERR" }, { status: 500 });
  }
}
