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
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id,nombre,apellido,telefono,email,rango_actual,rango_gasto_mes_anterior,rango_compras_mes_anterior")
      .eq("rango_actual", rank)
      .order("rango_gasto_mes_anterior", { ascending: false })
      .order("nombre", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, clientes: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
