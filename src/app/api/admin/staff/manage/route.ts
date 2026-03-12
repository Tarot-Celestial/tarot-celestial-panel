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

async function requireAdmin(req: Request) {
  const { uid } = await uidFromBearer(req);
  if (!uid) return { ok: false as const, error: "NO_AUTH" as const };

  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: me, error } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!me || me.role !== "admin") return { ok: false as const, error: "FORBIDDEN" as const };

  return { ok: true as const, admin };
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    }

    const { admin } = gate;
    const body = await req.json().catch(() => ({}));

    const action = String(body?.action || "");

    if (action === "create_worker") {
      const display_name = String(body?.display_name || "").trim();
      const role = String(body?.role || "tarotista").trim();
      const team = String(body?.team || "").trim() || null;
      const email = String(body?.email || "").trim() || null;

      if (!display_name) {
        return NextResponse.json({ ok: false, error: "DISPLAY_NAME_REQUIRED" }, { status: 400 });
      }

      if (!["admin", "central", "tarotista"].includes(role)) {
        return NextResponse.json({ ok: false, error: "INVALID_ROLE" }, { status: 400 });
      }

      const { data, error } = await admin
        .from("workers")
        .insert({
          display_name,
          role,
          team,
          email,
          is_active: true,
        })
        .select("*")
        .maybeSingle();

      if (error) throw error;

      return NextResponse.json({ ok: true, worker: data });
    }

    if (action === "update_worker") {
      const worker_id = String(body?.worker_id || "");
      if (!worker_id) {
        return NextResponse.json({ ok: false, error: "WORKER_ID_REQUIRED" }, { status: 400 });
      }

      const patch: any = {};
      if (body?.display_name !== undefined) patch.display_name = String(body.display_name || "").trim();
      if (body?.role !== undefined) patch.role = String(body.role || "").trim();
      if (body?.team !== undefined) patch.team = String(body.team || "").trim() || null;
      if (body?.email !== undefined) patch.email = String(body.email || "").trim() || null;
      if (body?.is_active !== undefined) patch.is_active = !!body.is_active;

      const { error } = await admin
        .from("workers")
        .update(patch)
        .eq("id", worker_id);

      if (error) throw error;

      return NextResponse.json({ ok: true });
    }

    if (action === "disable_worker") {
      const worker_id = String(body?.worker_id || "");
      if (!worker_id) {
        return NextResponse.json({ ok: false, error: "WORKER_ID_REQUIRED" }, { status: 400 });
      }

      const { error: wErr } = await admin
        .from("workers")
        .update({ is_active: false })
        .eq("id", worker_id);

      if (wErr) throw wErr;

      const { error: sErr } = await admin
        .from("shift_schedules")
        .update({ is_active: false })
        .eq("worker_id", worker_id);

      if (sErr) throw sErr;

      return NextResponse.json({ ok: true });
    }

    if (action === "enable_worker") {
      const worker_id = String(body?.worker_id || "");
      if (!worker_id) {
        return NextResponse.json({ ok: false, error: "WORKER_ID_REQUIRED" }, { status: 400 });
      }

      const { error } = await admin
        .from("workers")
        .update({ is_active: true })
        .eq("id", worker_id);

      if (error) throw error;

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
