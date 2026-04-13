import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function normalizeName(v: any) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calcRank(total: number) {
  if (total >= 500) return "oro";
  if (total >= 100) return "plata";
  if (total > 0) return "bronce";
  return null;
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const rank = String(searchParams.get("rank") || "").trim().toLowerCase();
    if (!["bronce", "plata", "oro"].includes(rank)) {
      return NextResponse.json({ ok: false, error: "INVALID_RANK" }, { status: 400 });
    }

    const admin = adminClient();
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: clientes, error: cliErr }, { data: rows, error: rowsErr }] = await Promise.all([
      admin.from("crm_clientes").select("id,nombre,apellido,telefono,email"),
      admin.from("rendimiento_llamadas").select("cliente_id,cliente_nombre,importe,fecha_hora").gte("fecha_hora", since),
    ]);
    if (cliErr) throw cliErr;
    if (rowsErr) throw rowsErr;

    const byName = new Map<string, string>();
    for (const c of clientes || []) {
      const full = [c?.nombre, c?.apellido].filter(Boolean).join(" ").trim();
      const key1 = normalizeName(full);
      const key2 = normalizeName(c?.nombre);
      if (key1) byName.set(key1, String(c.id));
      if (key2 && !byName.has(key2)) byName.set(key2, String(c.id));
    }

    const totals = new Map<string, { total: number; compras: number }>();
    for (const row of rows || []) {
      const amount = Number(row?.importe || 0);
      if (!(amount > 0)) continue;
      let clienteId = String(row?.cliente_id || "").trim();
      if (!clienteId) clienteId = byName.get(normalizeName(row?.cliente_nombre)) || "";
      if (!clienteId) continue;
      const prev = totals.get(clienteId) || { total: 0, compras: 0 };
      prev.total += amount;
      prev.compras += 1;
      totals.set(clienteId, prev);
    }

    const byId = new Map((clientes || []).map((c: any) => [String(c.id), c]));
    const output = Array.from(totals.entries())
      .map(([clienteId, info]) => {
        const row = byId.get(clienteId);
        if (!row) return null;
        const liveRank = calcRank(info.total);
        if (liveRank !== rank) return null;
        return {
          id: clienteId,
          nombre: row?.nombre || null,
          apellido: row?.apellido || null,
          telefono: row?.telefono || null,
          email: row?.email || null,
          rango_actual: liveRank,
          rango_gasto_mes_anterior: Number(info.total.toFixed(2)),
          rango_compras_mes_anterior: info.compras,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => Number(b?.rango_gasto_mes_anterior || 0) - Number(a?.rango_gasto_mes_anterior || 0));

    return NextResponse.json({ ok: true, window_days: 30, clientes: output });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
