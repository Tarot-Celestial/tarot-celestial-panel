import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function adminClient() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function workerFromReq(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const authClient = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userRes, error: userError } = await authClient.auth.getUser();
  if (userError) throw userError;
  const uid = userRes.user?.id;
  if (!uid) return null;

  const admin = adminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, user_id, display_name, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function normalizeRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

function madridDayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    const role = normalizeRole(worker?.role);

    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (role !== "admin" && role !== "central") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const dayKey = madridDayKey();
    const admin = adminClient();

    const { data, count, error } = await admin
      .from("rendimiento_llamadas")
      .select("id, importe, cliente_nombre, telefonista_nombre, fecha_hora, created_at", { count: "exact" })
      .eq("fecha", dayKey)
      .gt("importe", 0)
      .order("fecha_hora", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1);

    if (error) throw error;

    const latest = Array.isArray(data) && data.length ? data[0] : null;

    return NextResponse.json({
      ok: true,
      snapshot: {
        day_key: dayKey,
        count: Number(count || 0),
        latest_payment: latest
          ? {
              id: String(latest.id || ""),
              importe: Number(latest.importe || 0) || 0,
              cliente_nombre: latest.cliente_nombre || null,
              telefonista_nombre: latest.telefonista_nombre || null,
              fecha_hora: latest.fecha_hora || null,
              created_at: latest.created_at || null,
            }
          : null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
