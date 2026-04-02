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
    .select("id, user_id, role, display_name, email")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(req: Request) {
  try {
    const me = await workerFromReq(req);
    if (!me) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!["admin", "central"].includes(String(me.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const admin = adminClient();
    const url = new URL(req.url);
    const mode = String(url.searchParams.get("mode") || "").trim();

    let query = admin
      .from("rendimiento_llamadas")
      .select("*")
      .order("fecha_hora", { ascending: false })
      .limit(250);

    const isCentralView = String(me.role) === "central" || mode === "central";
    if (isCentralView) {
      query = query.eq("telefonista_worker_id", me.id);
    }

    const { data, error } = await query;
    if (error) {
      console.error("❌ ERROR LISTADO RENDIMIENTO:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      data: data || [],
      viewer: {
        role: me.role || null,
        worker_id: me.id || null,
        mode: isCentralView ? "central" : "admin",
      },
    });
  } catch (e: any) {
    console.error("🔥 ERROR GENERAL LISTAR RENDIMIENTO:", e);
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
