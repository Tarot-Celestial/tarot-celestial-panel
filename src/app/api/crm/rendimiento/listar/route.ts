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
    auth: { persistSession: false },
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
    .select("id, role, display_name")
    .eq("user_id", uid)
    .maybeSingle();
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
    const q = String(searchParams.get("q") || "").trim();

    const admin = adminClient();
    let query = admin
      .from("rendimiento_llamadas")
      .select("*")
      .order("fecha_hora", { ascending: false })
      .limit(300);

    if (q) {
      query = query.or([
        `cliente_nombre.ilike.%${q}%`,
        `telefonista_nombre.ilike.%${q}%`,
        `tarotista_nombre.ilike.%${q}%`,
        `tarotista_manual_call.ilike.%${q}%`,
        `resumen_codigo.ilike.%${q}%`,
      ].join(","));
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
