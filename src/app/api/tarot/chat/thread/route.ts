// src/app/api/tarot/chat/thread/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!; // asegúrate de tenerla

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function bearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export async function GET(req: Request) {
  try {
    const token = bearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    // 1) worker actual
    const { data: worker, error: wErr } = await admin
      .from("workers")
      .select("id, display_name, role")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (wErr) throw wErr;
    if (!worker?.id) return NextResponse.json({ ok: false, error: "WORKER_NOT_FOUND" }, { status: 404 });
    if (worker.role !== "tarotista") return NextResponse.json({ ok: false, error: "NOT_TAROTISTA" }, { status: 403 });

    // 2) thread existente
    const { data: existing, error: tErr } = await admin
      .from("chat_threads")
      .select("*")
      .eq("tarotist_worker_id", worker.id)
      .maybeSingle();

    if (tErr) throw tErr;

    if (existing?.id) {
      return NextResponse.json({ ok: true, thread: existing });
    }

    // 3) crear thread si no existe
    const title = worker.display_name ? `Chat ${worker.display_name}` : `Chat ${worker.id.slice(0, 6)}`;

    const { data: created, error: cErr } = await admin
      .from("chat_threads")
      .insert({
        tarotist_worker_id: worker.id,
        title,
      })
      .select("*")
      .single();

    if (cErr) throw cErr;

    return NextResponse.json({ ok: true, thread: created });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
