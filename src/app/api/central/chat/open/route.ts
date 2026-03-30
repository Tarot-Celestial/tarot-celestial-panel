// src/app/api/central/chat/open/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function bearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export async function POST(req: Request) {
  try {
    const token = bearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    // central/admin
    const { data: me, error: meErr } = await admin
      .from("workers")
      .select("id, role, display_name")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (meErr) throw meErr;
    if (!me?.id) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (me.role !== "central" && me.role !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const tarotist_worker_id = String(body?.tarotist_worker_id || "").trim();
    if (!tarotist_worker_id) return NextResponse.json({ ok: false, error: "MISSING_TAROTIST_WORKER_ID" }, { status: 400 });

    // comprobar tarotista existe
    const { data: tarot, error: te } = await admin
      .from("workers")
      .select("id, role, display_name")
      .eq("id", tarotist_worker_id)
      .maybeSingle();

    if (te) throw te;
    if (!tarot?.id) return NextResponse.json({ ok: false, error: "TAROTIST_NOT_FOUND" }, { status: 404 });
    if (String(tarot.role) !== "tarotista") return NextResponse.json({ ok: false, error: "NOT_TAROTISTA" }, { status: 400 });

    // buscar thread existente
    const { data: existing, error: ee } = await admin
      .from("chat_threads")
      .select("*")
      .eq("tarotist_worker_id", tarot.id)
      .maybeSingle();

    if (ee) throw ee;
    if (existing?.id) return NextResponse.json({ ok: true, thread: existing });

    // crear thread
    const title = tarot.display_name ? `Chat ${tarot.display_name}` : `Chat ${String(tarot.id).slice(0, 6)}`;

    const { data: created, error: ce } = await admin
      .from("chat_threads")
      .insert({
        tarotist_worker_id: tarot.id,
        title,
        status: "open",
      })
      .select("*")
      .single();

    if (ce) throw ce;

    return NextResponse.json({ ok: true, thread: created });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
