import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";

// 🔥 CONFIGURACIÓN GLOBAL
const PUNTOS_POR_EURO = 10;

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

// 🔥 AQUÍ ESTABA EL BUG
function pointsFromAmount(amount: number) {
  return Math.max(0, Math.floor(Number(amount || 0) * PUNTOS_POR_EURO));
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

  const { data } = await sb.auth.getUser(token);
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;

  const admin = adminClient();

  const { data, error } = await admin
    .from("workers")
    .select("id, role, is_active")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data?.is_active === false ? null : data || null;
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);

    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const cliente_id = String(body?.cliente_id || "").trim();
    const importe = Number(body?.importe || 0);
    const moneda = String(body?.moneda || "EUR").trim().toUpperCase() || "EUR";
    const metodo = String(body?.metodo || "paypal_manual").trim() || "paypal_manual";
    const estado = String(body?.estado || "completed").trim() || "completed";
    const notas = String(body?.notas || "").trim();
    const referencia_externa = String(body?.referencia_externa || "").trim();

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "FALTA_CLIENTE_ID" }, { status: 400 });
    }

    if (moneda !== "EUR") return NextResponse.json({ ok: false, error: "Las nuevas compras deben registrarse en EUR." }, { status: 400 });
    if (!Number.isFinite(importe) || importe <= 0) {
      return NextResponse.json({ ok: false, error: "IMPORTE_INVALIDO" }, { status: 400 });
    }

    const admin = adminClient();

    const { data: cliente, error: clienteError } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido")
      .eq("id", cliente_id)
      .maybeSingle();

    if (clienteError) throw clienteError;

    if (!cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_EXISTE" }, { status: 404 });
    }

    const payload: any = {
      cliente_id,
      importe,
      moneda,
      metodo,
      estado,
      notas: notas || null,
      referencia_externa: referencia_externa || null,
      created_by_user_id: worker.id,
      created_by_role: worker.role,
    };

    let pago: any;
    if (estado === "completed") {
      if (!referencia_externa) return NextResponse.json({ ok: false, error: "La referencia del cobro es obligatoria." }, { status: 400 });
      const { data: transaction, error } = await admin.rpc("cliente_confirmar_compra_ruleta_v2", {
        p: { cliente_id, payment_ref: referencia_externa, amount: importe, currency: moneda, metodo,
          free: 0, normal: 0, points: pointsFromAmount(importe), notas,
          created_by_user_id: worker.id, created_by_role: worker.role },
      });
      if (error) throw error;
      pago = transaction.payment;
    } else {
      const { data, error } = await admin.from("crm_cliente_pagos").insert(payload).select("*").single();
      if (error) throw error;
      pago = data;
    }
    const { data: awardedSpin } = await admin.from("cliente_ruleta_giros").select("id,nivel")
      .eq("payment_key", referencia_externa ? "payment_ref:" + referencia_externa : "crm_pago:" + pago.id).maybeSingle();

    let persistedXpEvent: any = null;
    if (String(estado) === "completed") {
      const { data: recentXpEvents } = await admin
        .from("worker_xp_events")
        .select("id,worker_id,action_key,xp_amount,reference_id,reference_label,origin,status,metadata,created_at")
        .eq("worker_id", worker.id)
        .eq("status", "applied")
        .gte("created_at", new Date(Date.now() - 60_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(10);
      persistedXpEvent = (recentXpEvents || []).find((event: any) => {
        const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
        return [event?.reference_id, metadata.payment_id, metadata.pago_id]
          .map((value) => String(value || ""))
          .includes(String(pago.id));
      }) || null;
    }

    return NextResponse.json({
      ok: true,
      pago,
      client_name: [cliente.nombre, cliente.apellido].filter(Boolean).join(" ").trim() || "Clienta",
      xp_event: persistedXpEvent,
      msg: "Pago creado correctamente" + (awardedSpin ? " · +1 giro Nivel " + awardedSpin.nivel + " disponible para el cliente." : ""),
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
