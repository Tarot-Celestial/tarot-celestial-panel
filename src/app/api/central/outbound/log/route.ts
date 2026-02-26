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

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const item_id = String(body.item_id || "").trim();
    const status = String(body.status || "").trim();
    const note = body.note == null ? null : String(body.note).trim();

    if (!item_id) return NextResponse.json({ ok: false, error: "NO_ITEM_ID" }, { status: 400 });
    if (!status) return NextResponse.json({ ok: false, error: "NO_STATUS" }, { status: 400 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // asegurar central
    const { data: me, error: em } = await db
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me || me.role !== "central") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    // Verificar item existe + traer batch_id (por si quieres checks extra)
    const { data: it0, error: e0 } = await db
      .from("outbound_batch_items")
      .select("id, batch_id")
      .eq("id", item_id)
      .maybeSingle();
    if (e0) throw e0;
    if (!it0?.id) return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });

    const now = new Date().toISOString();

    // 1) Update item (estado + nota + quién llamó + timestamp)
    const { data: updated, error: eu } = await db
      .from("outbound_batch_items")
      .update({
        current_status: status,
        last_note: note,
        last_call_at: now,
        last_called_by_worker_id: me.id,
      })
      .eq("id", item_id)
      .select(`
        id, batch_id, customer_name, phone, priority, position,
        current_status, last_call_at, last_note,
        last_called_by_worker_id
      `)
      .single();
    if (eu) throw eu;

    // 2) Insert log (si tienes esta tabla; es la que usa el panel tarotista para ver histórico)
    //    Si tu tabla se llama distinto, dímelo y lo ajusto.
    const { error: el } = await db.from("outbound_item_logs").insert({
      item_id,
      status,
      note,
      created_by_worker_id: me.id,
      created_at: now,
    });
    if (el) throw el;

    return NextResponse.json({ ok: true, item: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
