import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function getAdminFromToken(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false as const, error: "NO_TOKEN" as const };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id || null;
  const email = u?.user?.email || null;

  if (!uid) return { ok: false as const, error: "BAD_TOKEN" as const };

  const admin = createClient(url, service, { auth: { persistSession: false } });

  let { data: me } = await admin
    .from("workers")
    .select("id, role, email, user_id")
    .eq("user_id", uid)
    .maybeSingle();

  if (!me && email) {
    const r2 = await admin
      .from("workers")
      .select("id, role, email, user_id")
      .eq("email", email)
      .maybeSingle();
    me = r2.data as any;
  }

  if (!me) return { ok: false as const, error: "NO_WORKER" as const };
  if (me.role !== "admin") return { ok: false as const, error: "FORBIDDEN" as const };

  return { ok: true as const, admin, me };
}

export async function POST(req: Request) {
  try {
    const gate = await getAdminFromToken(req);
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
      const tarotista_level = Number(body?.tarotista_level || 1);

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
          tarotista_level: role === "tarotista" ? (tarotista_level === 2 ? 2 : 1) : null,
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

      if (body?.display_name !== undefined) {
        const displayName = String(body.display_name || "").trim();
        if (!displayName) {
          return NextResponse.json({ ok: false, error: "DISPLAY_NAME_REQUIRED" }, { status: 400 });
        }
        patch.display_name = displayName;
      }

      if (body?.role !== undefined) {
        const role = String(body.role || "").trim();
        if (!["admin", "central", "tarotista"].includes(role)) {
          return NextResponse.json({ ok: false, error: "INVALID_ROLE" }, { status: 400 });
        }
        patch.role = role;
        patch.tarotista_level = role === "tarotista" ? (Number(body?.tarotista_level || 1) === 2 ? 2 : 1) : null;
      } else if (body?.tarotista_level !== undefined) {
        const nextLevel = Number(body.tarotista_level || 1);
        patch.tarotista_level = nextLevel === 2 ? 2 : 1;
      }

      if (body?.team !== undefined) patch.team = String(body.team || "").trim() || null;
      if (body?.email !== undefined) patch.email = String(body.email || "").trim() || null;
      if (body?.is_active !== undefined) patch.is_active = !!body.is_active;

      const { data, error } = await admin
        .from("workers")
        .update(patch)
        .eq("id", worker_id)
        .select("id, user_id, display_name, role, team, email, is_active, tarotista_level, created_at")
        .maybeSingle();

      if (error) throw error;

      return NextResponse.json({ ok: true, worker: data });
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

      await admin
        .from("shift_schedules")
        .update({ is_active: false })
        .eq("worker_id", worker_id);

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

    if (action === "change_password") {
      const worker_id = String(body?.worker_id || "");
      const password = String(body?.password || "");
      if (!worker_id) return NextResponse.json({ ok: false, error: "WORKER_ID_REQUIRED" }, { status: 400 });
      if (password.length < 6) return NextResponse.json({ ok: false, error: "PASSWORD_MIN_6" }, { status: 400 });

      const { data: worker, error: wErr } = await admin
        .from("workers")
        .select("id, user_id, email")
        .eq("id", worker_id)
        .maybeSingle();
      if (wErr) throw wErr;
      if (!worker?.user_id) return NextResponse.json({ ok: false, error: "WORKER_WITHOUT_AUTH_USER" }, { status: 400 });

      const { error: authErr } = await admin.auth.admin.updateUserById(String(worker.user_id), { password });
      if (authErr) throw authErr;

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
