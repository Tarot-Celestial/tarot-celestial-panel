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
  if (!token) return { uid: null as string | null, token: null as string | null };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null, token };
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  // GET: devuelve MI factura del mes (tarotista/central/admin si quiere ver la suya)
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const u = new URL(req.url);
    const month = u.searchParams.get("month") || monthKeyNow();

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role, display_name")
      .eq("user_id", uid)
      .maybeSingle();

    if (em) throw em;
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    const { data: inv, error: ei } = await admin
      .from("invoices")
      .select("id, month_key, status, total, updated_at")
      .eq("worker_id", me.id)
      .eq("month_key", month)
      .maybeSingle();

    if (ei) throw ei;

    if (!inv) return NextResponse.json({ ok: true, month, invoice: null, lines: [], worker: me });

    const { data: lines, error: el } = await admin
      .from("invoice_lines")
      .select("id, kind, label, amount, meta, created_at")
      .eq("invoice_id", inv.id)
      .order("created_at", { ascending: true });

    if (el) throw el;

    return NextResponse.json({ ok: true, month, invoice: inv, lines: lines || [], worker: me });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // POST: genera facturas del mes (SOLO ADMIN)
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();

    if (em) throw em;
    if (!me || me.role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const month = String(body?.month || monthKeyNow());

    // Llama a la función SQL
    const { data, error } = await admin.rpc("generate_invoices_for_month", { p_month: month });
    if (error) throw error;

    return NextResponse.json({ ok: true, result: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
