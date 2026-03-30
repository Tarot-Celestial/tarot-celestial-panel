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
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: worker, error: workerError } = await admin
      .from("workers")
      .select("id, role, display_name")
      .eq("user_id", uid)
      .maybeSingle();

    if (workerError) throw workerError;
    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    }

    if (worker.role !== "tarotista") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { data: dispatch, error: dispatchError } = await admin
      .from("crm_dispatches_vivos")
      .select(`
        id,
        cliente_id,
        llamada_ref,
        from_worker_id,
        to_tarotista_worker_id,
        nombre_cliente,
        codigo_dispatch,
        estado,
        created_at,
        seen_at,
        accepted_at,
        closed_at
      `)
      .eq("to_tarotista_worker_id", worker.id)
      .in("estado", ["pending", "seen"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dispatchError) throw dispatchError;

    return NextResponse.json({
      ok: true,
      dispatch: dispatch || null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
