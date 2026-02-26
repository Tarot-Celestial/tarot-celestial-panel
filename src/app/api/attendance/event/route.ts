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

// --- TZ helpers (Europe/Madrid) ---
function tzParts(tz: string, d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    wd: get("weekday"),
    off: get("timeZoneName"), // GMT+1 / GMT+2
  };
}

function dowFromShort(wd: string) {
  const map: any = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? null;
}

function offsetToIso(off: string) {
  const s = String(off || "");
  const m = s.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return "+00:00";
  const sign = m[1];
  const hh = String(m[2]).padStart(2, "0");
  const mm = String(m[3] || "00").padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

function addDaysYMD(ymd: string, add: number) {
  const [Y, M, D] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(Y, M - 1, D));
  dt.setUTCDate(dt.getUTCDate() + add);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildUtcFromLocal(dateYMD: string, timeHHMM: string, tz: string) {
  const off = offsetToIso(tzParts(tz).off);
  return new Date(`${dateYMD}T${timeHHMM}:00${off}`);
}

function hhmm(s: any) {
  return String(s || "").slice(0, 5);
}

function parseMinutes(hhmmStr: string) {
  const [h, m] = hhmmStr.split(":").map((x) => Number(x));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

async function isWithinActiveShiftForWorker(admin: any, worker_id: string, tzDefault = "Europe/Madrid") {
  const TZ = tzDefault;
  const nowUtc = new Date();
  const p = tzParts(TZ, nowUtc);
  const dow = dowFromShort(p.wd);
  if (dow == null) return { ok: false, within: false, reason: "BAD_DOW", nowUtc };

  const today = `${p.y}-${p.m}-${p.d}`;

  const GRACE_BEFORE_MIN = 15;
  const GRACE_AFTER_MIN = 10;

  const dowsToCheck = [dow, (dow + 6) % 7];

  const { data: sch, error: es } = await admin
    .from("shift_schedules")
    .select("id, worker_id, day_of_week, start_time, end_time, timezone, active")
    .eq("active", true)
    .eq("worker_id", worker_id)
    .in("day_of_week", dowsToCheck);

  if (es) throw es;

  for (const s of sch || []) {
    const tz = String(s.timezone || TZ);

    const baseDate = Number(s.day_of_week) === dow ? today : addDaysYMD(today, -1);

    const st = hhmm(s.start_time);
    const en = hhmm(s.end_time);

    const stMin = parseMinutes(st);
    const enMin = parseMinutes(en);

    const overnight = enMin <= stMin;

    const startUtc = buildUtcFromLocal(baseDate, st, tz);
    const endUtc = buildUtcFromLocal(overnight ? addDaysYMD(baseDate, 1) : baseDate, en, tz);

    const startGrace = new Date(startUtc.getTime() - GRACE_BEFORE_MIN * 60_000);
    const endGrace = new Date(endUtc.getTime() + GRACE_AFTER_MIN * 60_000);

    if (nowUtc >= startGrace && nowUtc <= endGrace) {
      return {
        ok: true,
        within: true,
        schedule_id: s.id,
        startUtc,
        endUtc,
        nowUtc,
      };
    }
  }

  return { ok: true, within: false, reason: "OUTSIDE_SHIFT", nowUtc };
}

/**
 * BD constraint: event_type IN ('online','offline','heartbeat')
 */
function normalizeToDbEventType(incomingRaw: any, metaRaw: any) {
  const incoming = String(incomingRaw || "").trim();

  if (incoming === "online" || incoming === "offline" || incoming === "heartbeat") {
    return { ok: true as const, incoming, event_type_db: incoming as "online" | "offline" | "heartbeat", meta_patch: {} };
  }

  switch (incoming) {
    case "check_in":
    case "login":
      return { ok: true as const, incoming, event_type_db: "online" as const, meta_patch: { action: "check_in" } };

    case "check_out":
    case "logout":
      return { ok: true as const, incoming, event_type_db: "offline" as const, meta_patch: { action: "check_out" } };

    case "break_start":
      return { ok: true as const, incoming, event_type_db: "online" as const, meta_patch: { action: "break", phase: "start" } };

    case "break_end":
      return { ok: true as const, incoming, event_type_db: "online" as const, meta_patch: { action: "break", phase: "end" } };

    case "bathroom_start":
      return { ok: true as const, incoming, event_type_db: "online" as const, meta_patch: { action: "bathroom", phase: "start" } };

    case "bathroom_end":
      return { ok: true as const, incoming, event_type_db: "online" as const, meta_patch: { action: "bathroom", phase: "end" } };

    // compat: pause/bathroom con phase en meta
    case "pause":
      return {
        ok: true as const,
        incoming,
        event_type_db: "online" as const,
        meta_patch: { action: "break", phase: String(metaRaw?.phase || "start") },
      };

    case "bathroom":
      return {
        ok: true as const,
        incoming,
        event_type_db: "online" as const,
        meta_patch: { action: "bathroom", phase: String(metaRaw?.phase || "start") },
      };

    default:
      return { ok: false as const, incoming, error: "BAD_EVENT" as const };
  }
}

function nextStatusFromMeta(event_type_db: "online" | "offline" | "heartbeat", meta: any, currentStatus: string) {
  if (event_type_db === "offline") return { is_online: false, status: "offline" };

  if (event_type_db === "heartbeat") {
    if (currentStatus === "break" || currentStatus === "bathroom") {
      return { is_online: true, status: currentStatus };
    }
    return { is_online: true, status: "working" };
  }

  // online
  const action = String(meta?.action || "");
  const phase = String(meta?.phase || "");

  if (action === "break") {
    if (phase === "end") return { is_online: true, status: "working" };
    return { is_online: true, status: "break" };
  }

  if (action === "bathroom") {
    if (phase === "end") return { is_online: true, status: "working" };
    return { is_online: true, status: "bathroom" };
  }

  return { is_online: true, status: "working" };
}

// Detecta el error típico de Supabase cuando falta la tabla en el schema cache
function isMissingTableError(err: any, tableName: string) {
  const msg = String(err?.message || "");
  return msg.includes(`Could not find the table 'public.${tableName}'`) || msg.includes(`Could not find the table "${tableName}"`);
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const incoming_event_type = String(body?.event_type || "");
    const metaIn = body?.meta && typeof body.meta === "object" ? body.meta : {};

    const norm = normalizeToDbEventType(incoming_event_type, metaIn);
    if (!norm.ok) return NextResponse.json({ ok: false, error: "BAD_EVENT" }, { status: 400 });

    const event_type_db = norm.event_type_db;
    const meta = { ...metaIn, ...(norm.meta_patch || {}), event_type_in: incoming_event_type };

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();

    if (em) throw em;
    if (!me?.id) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    const worker_id = String(me.id);

    // ✅ Seguimos calculando shift para adjuntar schedule_id (si aplica),
    //    PERO YA NO BLOQUEAMOS FUERA DE TURNO.
    const shiftCheck = await isWithinActiveShiftForWorker(admin, worker_id, "Europe/Madrid");
    if (!shiftCheck.ok) return NextResponse.json({ ok: false, error: "SHIFT_CHECK_FAIL" }, { status: 500 });

    const at = new Date().toISOString();

    // 1) insert event (SIEMPRE)
    const { data: ins, error: ei } = await admin
      .from("attendance_events")
      .insert({
        worker_id,
        event_type: event_type_db,
        at,
        meta: { ...meta, schedule_id: shiftCheck.within ? shiftCheck.schedule_id : null },
      })
      .select("id")
      .maybeSingle();

    if (ei) throw ei;

    // 2) update state (SI EXISTE la tabla)
    let stateUpdated = false;
    let stateSkippedReason: string | null = null;

    try {
      const { data: st0, error: es0 } = await admin
        .from("attendance_state")
        .select("worker_id, is_online, status")
        .eq("worker_id", worker_id)
        .maybeSingle();

      if (es0) throw es0;

      const curStatus = String(st0?.status || "");
      const next = nextStatusFromMeta(event_type_db, meta, curStatus);

      const { error: eus } = await admin
        .from("attendance_state")
        .upsert(
          {
            worker_id,
            is_online: next.is_online,
            status: next.status,
            last_event_at: at,
            updated_at: at,
          },
          { onConflict: "worker_id" }
        );

      if (eus) throw eus;

      stateUpdated = true;
    } catch (err: any) {
      if (isMissingTableError(err, "attendance_state")) {
        stateSkippedReason = "ATTENDANCE_STATE_TABLE_MISSING";
      } else {
        throw err;
      }
    }

    return NextResponse.json({
      ok: true,
      event_id: ins?.id || null,
      worker_id,
      event_type: event_type_db,
      event_type_in: incoming_event_type,
      at,
      within_shift: !!shiftCheck.within,
      schedule_id: shiftCheck.within ? shiftCheck.schedule_id : null,
      meta,
      state_updated: stateUpdated,
      state_skipped_reason: stateSkippedReason,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
