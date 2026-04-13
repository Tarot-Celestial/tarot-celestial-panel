import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) {
    console.error("❌ ENV FALTANTE:", name);
    throw new Error(`Missing env var: ${name}`);
  }
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
  try {
    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) {
      console.error("❌ SIN TOKEN");
      return null;
    }

    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data, error } = await sb.auth.getUser();

    if (error) {
      console.error("❌ ERROR AUTH:", error);
      return null;
    }

    return data.user?.id || null;
  } catch (e) {
    console.error("❌ uidFromBearer ERROR:", e);
    return null;
  }
}

async function workerFromReq(req: Request) {
  try {
    const uid = await uidFromBearer(req);
    if (!uid) return null;

    const admin = adminClient();

    const { data, error } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();

    if (error) {
      console.error("❌ ERROR WORKER:", error);
      throw error;
    }

    return data || null;
  } catch (e) {
    console.error("❌ workerFromReq ERROR:", e);
    throw e;
  }
}

export async function GET(req: Request) {
  try {
    console.log("🚀 CRM API HIT");

    const worker = await workerFromReq(req);

    if (!worker) {
      console.log("❌ NO WORKER");
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    if (!["admin", "central"].includes(String(worker.role))) {
      console.log("❌ NO PERMISOS");
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const admin = adminClient();

    const { data, error } = await admin
      .from("crm_clientes")
      .select("*")
      .limit(10);

    if (error) {
      console.error("❌ SUPABASE ERROR:", error);
      throw error;
    }

    console.log("✅ CLIENTES OK:", data?.length);

    return NextResponse.json({
      ok: true,
      clientes: data || [],
    });

  } catch (e: any) {
    console.error("🔥 ERROR REAL:", e);

    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
