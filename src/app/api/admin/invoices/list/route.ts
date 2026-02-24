import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me } = await admin.from("workers").select("role").eq("user_id", uid).maybeSingle();
    if (me?.role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const u = new URL(req.url);
    const month = u.searchParams.get("month") || monthKeyNow();

    // usamos la view v_invoice_full si existe; si no, leemos join directo
    const { data, error } = await admin
      .from("v_invoice_full")
      .select("invoice_id,worker_id,display_name,role,month_key,status,total,updated_at,created_at")
      .eq("month_key", month)
      .order("role", { ascending: true })
      .order("display_name", { ascending: true });

    if (error) {
      // fallback sin la view
      const { data: i2, error: e2 } = await admin
        .from("invoices")
        .select("id, worker_id, month_key, status, total, updated_at, created_at")
        .eq("month_key", month);

      if (e2) throw e2;

      const workerIds = Array.from(new Set((i2 || []).map((x: any) => x.worker_id)));
      const { data: ws, error: ew } = await admin
        .from("workers")
        .select("id, display_name, role")
        .in("id", workerIds);

      if (ew) throw ew;

      const wm = new Map<string, any>();
      for (const w of ws || []) wm.set(w.id, w);

      const merged = (i2 || []).map((x: any) => ({
        invoice_id: x.id,
        worker_id: x.worker_id,
        display_name: wm.get(x.worker_id)?.display_name || "—",
        role: wm.get(x.worker_id)?.role || "—",
        month_key: x.month_key,
        status: x.status,
        total: x.total,
        updated_at: x.updated_at,
        created_at: x.created_at,
      }));

      return NextResponse.json({ ok: true, month, invoices: merged });
    }

    return NextResponse.json({ ok: true, month, invoices: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
