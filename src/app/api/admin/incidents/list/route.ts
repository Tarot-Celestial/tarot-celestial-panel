import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = new URL(req.url);
    const month = url.searchParams.get("month") || "";
    const kind = url.searchParams.get("kind") || "";

    const sbUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(sbUrl, service, { auth: { persistSession: false } });

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me || me.role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    let q = admin
      .from("incidents")
      .select("id, worker_id, month_key, amount, reason, kind, status, meta, evidence_note, decided_at, created_at")
      .order("created_at", { ascending: false });

    if (month) q = q.eq("month_key", month);
    if (kind) q = q.eq("kind", kind);

    const { data: inc, error: ei } = await q;
    if (ei) throw ei;

    const ids = [...new Set((inc || []).map((x: any) => String(x.worker_id)))];
    const byW: Record<string, any> = {};
    if (ids.length) {
      const { data: ws, error: ew } = await admin
        .from("workers")
        .select("id, display_name")
        .in("id", ids);
      if (ew) throw ew;
      for (const w of ws || []) byW[String(w.id)] = w;
    }

    const incidents = (inc || []).map((x: any) => ({
      ...x,
      display_name: byW[String(x.worker_id)]?.display_name || "",
    }));

    return NextResponse.json({ ok: true, incidents });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
