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

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role, display_name")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    if (me.role !== "admin" && me.role !== "central") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const worker_id = String(body?.worker_id || "");
    const month_key = String(body?.month_key || monthKeyNow());
    const title = String(body?.title || "").trim();
    const amount = Number(body?.amount || 0);

    if (!worker_id) return NextResponse.json({ ok: false, error: "MISSING_WORKER_ID" }, { status: 400 });
    if (!title) return NextResponse.json({ ok: false, error: "MISSING_TITLE" }, { status: 400 });

    // solo pueden poner incidencias a tarotistas (de momento)
    const { data: target, error: et } = await admin
      .from("workers")
      .select("id, role, display_name")
      .eq("id", worker_id)
      .maybeSingle();
    if (et) throw et;
    if (!target) return NextResponse.json({ ok: false, error: "TARGET_NOT_FOUND" }, { status: 404 });

    const { error } = await admin.from("incidents").insert({
      worker_id,
      month_key,
      title,
      amount: Math.abs(amount), // incidencias siempre restan, guardamos positivo
      created_by: me.id,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
