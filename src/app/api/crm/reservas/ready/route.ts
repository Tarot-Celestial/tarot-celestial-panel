import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function db() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

async function getWorker(req: Request, admin: any) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const userClient = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data } = await userClient.auth.getUser();
  const uid = data.user?.id || null;
  if (!uid) return null;
  const { data: me, error } = await admin.from("workers").select("id,role").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  return me;
}

function isOpenEstado(value: any) {
  const s = String(value || "").toLowerCase();
  return !["finalizada", "completada", "cancelada", "anulada"].includes(s);
}

export async function GET(req: Request) {
  try {
    const admin = db();
    const me = await getWorker(req, admin);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(me.role || ""))) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const { data: reservas, error } = await admin
      .from("reservas")
      .select("*")
      .eq("notify_when_tarotista_idle", true)
      .is("ready_notified_at", null)
      .order("created_at", { ascending: true })
      .limit(25);
    if (error) throw error;

    const ready: any[] = [];
    for (const reserva of reservas || []) {
      if (!isOpenEstado(reserva.estado) || !reserva.tarotista_id) continue;
      const { data: ext } = await admin
        .from("pbx_extensions")
        .select("extension,status,active_call_count,registered,worker_id,label")
        .eq("worker_id", reserva.tarotista_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const activeCalls = Number(ext?.active_call_count || 0) || 0;
      const status = String(ext?.status || "").toLowerCase();
      const busy = activeCalls > 0 || ["in_call", "ringing", "calling", "busy"].includes(status);
      if (!busy) ready.push({ ...reserva, tarotista_extension: ext?.extension || null, tarotista_extension_label: ext?.label || null, ready_reason: "tarotista_idle" });
    }

    if (ready.length) {
      const ids = ready.map((r) => r.id).filter(Boolean);
      await admin.from("reservas").update({ ready_notified_at: new Date().toISOString(), estado: "pendiente" }).in("id", ids);
    }

    return NextResponse.json({ ok: true, reservas: ready });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
