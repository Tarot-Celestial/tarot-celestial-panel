import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) return null;

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await sb.auth.getUser();
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;

  const admin = adminClient();

  const { data, error } = await admin
    .from("workers")
    .select("id, user_id, display_name, role, state")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);

    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (String(worker.role || "") !== "tarotista") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const popup_id = Number(body?.popup_id || 0);
    const consumidos_free =
      Number(String(body?.consumidos_free ?? "0").replace(",", ".")) || 0;
    const consumidos_normales =
      Number(String(body?.consumidos_normales ?? "0").replace(",", ".")) || 0;

    if (!popup_id) {
      return NextResponse.json({ ok: false, error: "FALTA_POPUP_ID" }, { status: 400 });
    }

    if (consumidos_free < 0 || consumidos_normales < 0) {
      return NextResponse.json({ ok: false, error: "MINUTOS_INVALIDOS" }, { status: 400 });
    }

    const admin = adminClient();

    const { data: popup, error: popupError } = await admin
      .from("crm_call_popups")
      .select("*")
      .eq("id", popup_id)
      .maybeSingle();

    if (popupError) throw popupError;

    if (!popup) {
      return NextResponse.json({ ok: false, error: "POPUP_NO_ENCONTRADO" }, { status: 404 });
    }

    if (String(popup.tarotista_worker_id || "") !== String(worker.id || "")) {
      return NextResponse.json({ ok: false, error: "POPUP_NO_PERTENECE_A_TAROTISTA" }, { status: 403 });
    }

    if (!popup.accepted) {
      return NextResponse.json({ ok: false, error: "LLAMADA_NO_ACEPTADA" }, { status: 400 });
    }

    if (popup.closed === true) {
      return NextResponse.json({ ok: false, error: "LLAMADA_YA_CERRADA" }, { status: 400 });
    }

    const enviados_free = Number(popup.minutos_free_pendientes || 0);
    const enviados_normales = Number(popup.minutos_normales_pendientes || 0);

    if (consumidos_free > enviados_free) {
      return NextResponse.json({ ok: false, error: "FREE_SUPERA_ENVIADO" }, { status: 400 });
    }

    if (consumidos_normales > enviados_normales) {
      return NextResponse.json({ ok: false, error: "NORMALES_SUPERA_ENVIADO" }, { status: 400 });
    }

    const restantes_free = Math.max(0, enviados_free - consumidos_free);
    const restantes_normales = Math.max(0, enviados_normales - consumidos_normales);

    const { data: cliente, error: clienteError } = await admin
      .from("crm_clientes")
      .select("id, minutos_free_pendientes, minutos_normales_pendientes")
      .eq("id", popup.cliente_id)
      .maybeSingle();

    if (clienteError) throw clienteError;

    if (!cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const nuevoFree = Number(cliente.minutos_free_pendientes || 0) + restantes_free;
    const nuevoNormales = Number(cliente.minutos_normales_pendientes || 0) + restantes_normales;

    const { error: updateClienteError } = await admin
      .from("crm_clientes")
      .update({
        minutos_free_pendientes: nuevoFree,
        minutos_normales_pendientes: nuevoNormales,
      })
      .eq("id", popup.cliente_id);

    if (updateClienteError) throw updateClienteError;

    const { data: closedPopup, error: closeError } = await admin
      .from("crm_call_popups")
      .update({
        closed: true,
        visible: false,
        minutos_free_consumidos: consumidos_free,
        minutos_normales_consumidos: consumidos_normales,
        closed_at: new Date().toISOString(),
      })
      .eq("id", popup_id)
      .select("*")
      .maybeSingle();

    if (closeError) throw closeError;

    return NextResponse.json({
      ok: true,
      popup: closedPopup,
      restantes_free,
      restantes_normales,
      cliente_actualizado: {
        id: popup.cliente_id,
        minutos_free_pendientes: nuevoFree,
        minutos_normales_pendientes: nuevoNormales,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
