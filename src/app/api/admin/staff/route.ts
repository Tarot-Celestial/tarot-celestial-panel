import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";
const LIVE_WINDOW_MS = 3 * 60 * 1000;

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
    auth: { persistSession: false },
  });

  const { data } = getAuthUserFromRequest(req);
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
  if (!me || me.role !== "admin") {
    return { ok: false as const, error: "FORBIDDEN" as const };
  }

  return { ok: true as const, admin };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    }

    const { admin } = gate;

    const { data: workers, error: workersErr } = await admin
      .from("workers")
      .select("id, user_id, display_name, role, team, email, is_active, tarotista_level, created_at")
      .order("display_name", { ascending: true });

    if (workersErr) throw workersErr;

    const workerIds = Array.from(new Set((workers || []).map((w: any) => w.id))).filter(Boolean);

    let schedules: any[] = [];
    let attendanceStates: any[] = [];
    if (workerIds.length > 0) {
      const [scheduleResult, attendanceResult] = await Promise.all([
        admin
          .from("shift_schedules")
          .select("id, worker_id, day_of_week, start_time, end_time, timezone, active, created_at")
          .in("worker_id", workerIds)
          .order("day_of_week", { ascending: true })
          .order("start_time", { ascending: true }),
        admin
          .from("attendance_state")
          .select("worker_id, is_online, status, last_event_at, updated_at")
          .in("worker_id", workerIds),
      ]);

      if (scheduleResult.error) throw scheduleResult.error;
      if (attendanceResult.error) throw attendanceResult.error;

      schedules = (scheduleResult.data || []).map((s: any) => ({
        ...s,
        is_active: !!s.active, // compat con tu frontend actual
      }));
      attendanceStates = attendanceResult.data || [];
    }

    const attendanceByWorker = new Map(attendanceStates.map((state: any) => [String(state.worker_id), state]));
    const workersWithStatus = (workers || []).map((worker: any) => {
      const state: any = attendanceByWorker.get(String(worker.id));
      const signalAt = state?.last_event_at || state?.updated_at || null;
      const timestamp = new Date(String(signalAt || "")).getTime();
      const recent = Number.isFinite(timestamp) && Date.now() - timestamp <= LIVE_WINDOW_MS;
      const isActive = worker.is_active !== false;
      const isOnline = isActive && state?.is_online === true && recent;
      const rawStatus = String(state?.status || "offline").toLowerCase();
      const presenceStatus = !isOnline
        ? "disconnected"
        : rawStatus === "bathroom"
          ? "bathroom"
          : ["break", "pause"].includes(rawStatus)
            ? "break"
            : "connected";

      return {
        ...worker,
        is_active: isActive,
        auth_linked: Boolean(worker.user_id),
        presence_status: presenceStatus,
        presence_source_status: rawStatus,
        presence_updated_at: signalAt,
      };
    });

    return NextResponse.json({
      ok: true,
      workers: workersWithStatus,
      schedules,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
