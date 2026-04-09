import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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

async function requireAdmin(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new Error("NO_AUTH");

  const admin = adminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError) throw userError;

  const uid = userData.user?.id;
  if (!uid) throw new Error("NO_AUTH");

  const { data: worker, error: workerError } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();
  if (workerError) throw workerError;
  if (!worker || !["admin", "central"].includes(String(worker.role || ""))) throw new Error("FORBIDDEN");

  return admin;
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const { data: rows, error } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, ultimo_acceso_at, ultima_actividad_at, total_accesos, created_at")
      .order("ultima_actividad_at", { ascending: false, nullsFirst: false })
      .limit(5000);
    if (error) throw error;

    const now = Date.now();
    const minuteMs = 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    const onlineNow = (rows || []).filter((row: any) => {
      const ts = row?.ultima_actividad_at ? new Date(row.ultima_actividad_at).getTime() : 0;
      return ts && now - ts <= 3 * minuteMs;
    }).length;

    const activeToday = (rows || []).filter((row: any) => {
      const ts = row?.ultimo_acceso_at ? new Date(row.ultimo_acceso_at).getTime() : 0;
      return ts && now - ts <= dayMs;
    }).length;

    const inactive7d = (rows || []).filter((row: any) => {
      const ts = row?.ultimo_acceso_at ? new Date(row.ultimo_acceso_at).getTime() : 0;
      return !ts || now - ts > 7 * dayMs;
    }).length;

    return NextResponse.json({
      ok: true,
      totals: {
        total_clientes: (rows || []).length,
        online_now: onlineNow,
        active_today: activeToday,
        inactive_7d: inactive7d,
        total_accesses: (rows || []).reduce((acc: number, row: any) => acc + Math.max(0, Number(row?.total_accesos || 0)), 0),
      },
      latest: (rows || []).slice(0, 8),
    });
  } catch (e: any) {
    const msg = e?.message || "ERR_ADMIN_CLIENT_ACCESS";
    const code = msg === "FORBIDDEN" ? 403 : msg === "NO_AUTH" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}
