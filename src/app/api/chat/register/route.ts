import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { addClientChatCredits } from "@/lib/server/chat-platform";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const WELCOME_CHAT_CREDITS = 2;
const WELCOME_CHAT_CREDITS_TYPE = "welcome_register";

function normalizePhone(phone: string | null | undefined) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeEmail(email: string | null | undefined) {
  return String(email || "").trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const nombre = String(body?.nombre || "").trim();
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || "");
    const pais = String(body?.pais || "España").trim() || "España";
    const telefono = normalizePhone(body?.telefono);

    if (!nombre) {
      return NextResponse.json({ ok: false, error: "El nombre es obligatorio." }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json({ ok: false, error: "El e-mail es obligatorio." }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ ok: false, error: "La contraseña debe tener al menos 6 caracteres." }, { status: 400 });
    }
    if (!pais) {
      return NextResponse.json({ ok: false, error: "El país es obligatorio." }, { status: 400 });
    }
    if (!telefono) {
      return NextResponse.json({ ok: false, error: "El teléfono es obligatorio." }, { status: 400 });
    }

    const nowIso = new Date().toISOString();

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        nombre,
        pais,
        telefono,
      },
    });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    const { data: existingByPhone, error: phoneErr } = await admin
      .from("crm_clientes")
      .select("id")
      .eq("telefono_normalizado", telefono)
      .maybeSingle();
    if (phoneErr) throw phoneErr;

    const { data: existingByEmail, error: emailErr } = await admin
      .from("crm_clientes")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (emailErr) throw emailErr;

    const clienteId = existingByPhone?.id || existingByEmail?.id || null;

    const payload = {
      nombre,
      email,
      pais,
      telefono,
      telefono_normalizado: telefono,
      origen: "chat_email",
      onboarding_completado: true,
      updated_at: nowIso,
    };

    let crmClienteId = String(clienteId || "").trim();

    if (crmClienteId) {
      const { data: updatedCliente, error: crmErr } = await admin
        .from("crm_clientes")
        .update(payload)
        .eq("id", crmClienteId)
        .select("id")
        .single();

      if (crmErr) throw crmErr;
      crmClienteId = String(updatedCliente?.id || crmClienteId);
    } else {
      const { data: insertedCliente, error: crmErr } = await admin
        .from("crm_clientes")
        .insert(payload)
        .select("id")
        .single();

      if (crmErr) throw crmErr;
      crmClienteId = String(insertedCliente?.id || "").trim();
    }

    if (crmClienteId) {
      const { data: existingWelcomeLedger, error: ledgerErr } = await admin
        .from("cliente_chat_creditos")
        .select("id")
        .eq("cliente_id", crmClienteId)
        .eq("tipo", WELCOME_CHAT_CREDITS_TYPE)
        .limit(1)
        .maybeSingle();

      if (ledgerErr) throw ledgerErr;

      if (!existingWelcomeLedger?.id) {
        await addClientChatCredits(admin, {
          clienteId: crmClienteId,
          amount: WELCOME_CHAT_CREDITS,
          type: WELCOME_CHAT_CREDITS_TYPE,
          notes: "Créditos de bienvenida por registro en el chat.",
          meta: {
            source: "chat_register",
            email,
          },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      user: data.user,
      welcome_chat_credits: WELCOME_CHAT_CREDITS,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "No se pudo crear la cuenta." }, { status: 500 });
  }
}
