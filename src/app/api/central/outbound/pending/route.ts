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

const ALLOWED_STATUSES = new Set([
  "calling",
  "answered",
  "no_answer",
  "busy",
  "wrong_number",
  "callback",
  "done",
]);

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const item_id = String(body?.item_id || "").trim();
    const status = String(body?.status || "").trim();
    const note = body?.note != null ? String(body.note) : null;
    const duration_seconds =
      body?.duration_seconds == null ? null : Number(body.duration_seconds);

    if (!item_id) {
      return NextResponse.json({ ok: false, error: "MISSING_ITEM_ID" }, { status: 400 });
    }
    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ ok: false, error: "INVALID_STATUS" }, { status: 400 });
    }
    if (duration_seconds != null && (!Number.isFinite(duration_seconds) || duration_seconds < 0)) {
      return NextResponse.json({ ok: false, error: "INVALID_DURATION" }, { status: 400 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // asegurar central y obtener worker_id del central
    const { data: me, error: em } = await db
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me || me.role !== "central") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    // (Opcional pero recomendable) comprobar que el item existe
    const { data: item, error: ei } = await db
      .from("outbound_batch_items")
      .select("id, batch_id, current_status")
      .eq("id", item_id)
      .maybeSingle();
    if (ei) throw ei;
    if (!item) return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });

    // insertar log (trigger actualiza el item)
    const { data: log, error: el } = await db
      .from("outbound_call_logs")
      .insert({
        item_id,
        called_by_worker_id: me.id,
        status,
        note,
        duration_seconds,
      })
      .select("id, item_id, called_by_worker_id, status, note, created_at, duration_seconds")
      .single();
    if (el) throw el;

    // devolver también el item ya actualizado (para refresco inmediato del panel central)
    const { data: updated, error: eu } = await db
      .from("outbound_batch_items")
      .select(
        "id, batch_id, customer_name, phone, priority, position, current_status, last_call_at, last_note, last_called_by_worker_id"
      )
      .eq("id", item_id)
      .single();
    if (eu) throw eu;

    return NextResponse.json({ ok: true, log, item: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
