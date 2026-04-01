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

    if (action === "create_schedule") {
      const worker_id = String(body?.worker_id || "");
      const day_of_week = Number(body?.day_of_week);
      const start_time = String(body?.start_time || "");
      const end_time = String(body?.end_time || "");
      const timezone = String(body?.timezone || "Europe/Madrid");
      const active = body?.active === undefined ? true : !!body.active;

      if (!worker_id) {
        return NextResponse.json({ ok: false, error: "WORKER_ID_REQUIRED" }, { status: 400 });
      }

      if (![0, 1, 2, 3, 4, 5, 6].includes(day_of_week)) {
        return NextResponse.json({ ok: false, error: "INVALID_DAY_OF_WEEK" }, { status: 400 });
      }

      if (!start_time || !end_time) {
        return NextResponse.json({ ok: false, error: "TIME_REQUIRED" }, { status: 400 });
      }

      const { data, error } = await admin
        .from("shift_schedules")
        .insert({
          worker_id,
          day_of_week,
          start_time,
          end_time,
          timezone,
          active,
        })
        .select("*")
        .maybeSingle();

      if (error) throw error;

      return NextResponse.json({ ok: true, schedule: data });
    }

    if (action === "update_schedule") {
      const schedule_id = String(body?.schedule_id || "");
      if (!schedule_id) {
        return NextResponse.json({ ok: false, error: "SCHEDULE_ID_REQUIRED" }, { status: 400 });
      }

      const patch: any = {};
      if (body?.day_of_week !== undefined) patch.day_of_week = Number(body.day_of_week);
      if (body?.start_time !== undefined) patch.start_time = String(body.start_time || "");
      if (body?.end_time !== undefined) patch.end_time = String(body.end_time || "");
      if (body?.timezone !== undefined) patch.timezone = String(body.timezone || "Europe/Madrid");
      if (body?.active !== undefined) patch.active = !!body.active;

      const { error } = await admin
        .from("shift_schedules")
        .update(patch)
        .eq("id", schedule_id);

      if (error) throw error;

      return NextResponse.json({ ok: true });
    }

    if (action === "delete_schedule") {
      const schedule_id = String(body?.schedule_id || "");
      if (!schedule_id) {
        return NextResponse.json({ ok: false, error: "SCHEDULE_ID_REQUIRED" }, { status: 400 });
      }

      const { error } = await admin
        .from("shift_schedules")
        .delete()
        .eq("id", schedule_id);

      if (error) throw error;

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
