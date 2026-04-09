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

function pointsFromAmount(amount: number) {
  return Math.max(0, Math.floor(Number(amount || 0)));
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
    .select("id, role")
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

    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const cliente_id = String(body?.cliente_id || "").trim();
    const importe = Number(body?.importe || 0);
    const moneda = String(body?.moneda || "EUR").trim() || "EUR";
    const metodo = String(body?.metodo || "paypal_manual").trim() || "paypal_manual";
    const estado = String(body?.estado || "completed").trim() || "completed";
    const notas = String(body?.notas || "").trim();
    const referencia_externa = String(body?.referencia_externa || "").trim();

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "FALTA_CLIENTE_ID" }, { status: 400 });
    }

    if (!importe || importe <= 0) {
      return NextResponse.json({ ok: false, error: "IMPORTE_INVALIDO" }, { status: 400 });
    }

    const admin = adminClient();

    const { data: cliente, error: clienteError } = await admin
      .from("crm_clientes")
      .select("id")
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

    const { data: pago, error } = await admin
      .from("crm_cliente_pagos")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    if (String(estado) === "completed") {
      const puntosGanados = pointsFromAmount(importe);
      if (puntosGanados > 0) {
        const { data: clienteActual } = await admin
          .from("crm_clientes")
          .select("id, puntos")
          .eq("id", cliente_id)
          .maybeSingle();

        const puntosActuales = Number(clienteActual?.puntos || 0);
        await admin
          .from("crm_clientes")
          .update({
            puntos: puntosActuales + puntosGanados,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cliente_id);

        await admin.from("cliente_puntos_historial").insert({
          cliente_id,
          tipo: "ganado",
          puntos: puntosGanados,
          descripcion: `Compra registrada por ${importe.toFixed(2)} € vía ${metodo}.`,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      pago,
      msg: "Pago creado correctamente",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
