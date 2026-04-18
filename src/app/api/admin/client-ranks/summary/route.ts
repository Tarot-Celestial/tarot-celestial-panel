import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calcClientRank, loadRolling30ClientTotals } from "@/lib/server/client-ranks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const sb = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
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
  const { data, error } = await admin.from("workers").select("id, role").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const admin = adminClient();
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: clientes, error: cliErr } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido");

    if (cliErr) throw cliErr;

    const totals = await loadRolling30ClientTotals(admin, clientes || [], since, now.toISOString());

    const counts = { bronce: 0, plata: 0, oro: 0 };
    let compras30d = 0;
    let gasto30d = 0;

    for (const info of totals.values()) {
      const rank = calcClientRank(info.total);
      if (!rank) continue;
      counts[rank as keyof typeof counts] += 1;
      compras30d += info.compras;
      gasto30d += info.total;
    }

    return NextResponse.json({
      ok: true,
      window_days: 30,
      source: "crm_cliente_pagos+rendimento_llamadas",
      summary: {
        totalConRango: counts.bronce + counts.plata + counts.oro,
        bronce: counts.bronce,
        plata: counts.plata,
        oro: counts.oro,
        gastoMesAnterior: Number(gasto30d.toFixed(2)),
        comprasMesAnterior: compras30d,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
