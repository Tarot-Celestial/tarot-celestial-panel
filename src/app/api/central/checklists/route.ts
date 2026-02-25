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

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role, team, shift_type")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    if (me.role !== "central" && me.role !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { data: sk, error: esk } = await admin.rpc("current_shift_key", {
      p_shift_type: me.shift_type || "tarde",
    });
    if (esk) throw esk;
    const shift_key = String(sk || "");

    // tarotistas del mismo equipo del central (si admin, devuelve todas)
    let q = admin.from("workers").select("id, display_name, team, role, shift_type").eq("role", "tarotista");
    if (me.role === "central") q = q.eq("team", me.team);

    const { data: tarotists, error: et } = await q.order("display_name", { ascending: true });
    if (et) throw et;

    const ids = (tarotists || []).map((t: any) => t.id);

    // respuestas de checklist tarotista para ese shift
    const { data: resps, error: er } = await admin
      .from("checklist_responses")
      .select("worker_id, completed_at, created_at")
      .eq("template_key", "tarotista")
      .eq("shift_key", shift_key)
      .in("worker_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    if (er) throw er;

    const byWorker: Record<string, any> = {};
    for (const r of resps || []) byWorker[String(r.worker_id)] = r;

    const rows = (tarotists || []).map((t: any) => {
      const r = byWorker[String(t.id)];
      return {
        worker_id: t.id,
        display_name: t.display_name,
        team: t.team,
        status: r?.completed_at ? "completed" : r ? "in_progress" : "not_started",
        completed_at: r?.completed_at || null,
      };
    });

    return NextResponse.json({ ok: true, shift_key, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
