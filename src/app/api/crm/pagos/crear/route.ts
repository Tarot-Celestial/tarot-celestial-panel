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

    if (!["admin", "central"].includes(worker.role)) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const cliente_id = String(body?.cliente_id || "").trim();
    const importe = Number(body?.importe || 0);
    const moneda = String(body?.moneda || "EUR");
    const metodo = String(body?.metodo || "paypal_manual");
    const estado = String(body?.estado || "completed");
    const notas = String(body?.notas || "");

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "FALTA_CLIENTE_ID" }, { status: 400 });
    }

    if (!importe || importe <= 0) {
      return NextResponse.json({ ok: false, error: "IMPORTE_INVALIDO" }, { status: 400 });
    }

    const admin = adminClient();

    const { data, error } = await admin
      .from("crm_cliente_pagos")
      .insert({
        cliente_id,
        importe,
        moneda,
        metodo,
        estado,
        notas,
        created_by_user_id: worker.id,
        created_by_role: worker.role,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      pago: data,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
