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
    hh: get("hour"),
    mm: get("minute"),
    ss: get("second"),
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
  // ymd: YYYY-MM-DD
  const [Y, M, D] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(Y, M - 1, D));
  dt.setUTCDate(dt.getUTCDate() + add);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildUtcFromLocal(dateYMD: string, timeHHMM: string, tz: string) {
  // Usamos offset ACTUAL del TZ (vale para Madrid la inmensa mayoría de casos)
  const off = offsetToIso(tzParts(tz).off);
  return new Date(`${dateYMD}T${timeHHMM}:00${off}`);
}

function hhmm(s: any) {
  return String(s || "").slice(0, 5); // "21:00"
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

  // margen para permitir check-in un poco antes / después
  const GRACE_BEFORE_MIN = 15; // puedes bajarlo a 5 si quieres
  const GRACE_AFTER_MIN = 10;

  // IMPORTANTÍSIMO:
  // Para turnos nocturnos 21:00-05:00, el "end" es al día siguiente.
  // Además, a las 02:00 del lunes, el turno "de domingo noche" sigue activo:
  // hay que mirar también el día anterior.
  const dowsToCheck = [dow, (dow + 6) % 7]; // hoy y ayer

  const { data: sch, error: es } = await admin
    .from("shift_schedules")
    .select("id, worker_id, day_of_week, start_time, end_time, timezone, active")
    .eq("active", true)
    .eq("worker_id", worker_id)
    .in("day_of_week", dowsToCheck);

  if (es) throw es;

  for (const s of sch || []) {
    const tz = String(s.timezone || TZ);

    // fecha base depende si el schedule es de hoy o de ayer
    const baseDate = Number(s.day_of_week) === dow ? today : addDaysYMD(today, -1);

    const st = hhmm(s.start_time);
    const en = hhmm(s.end_time);

    const stMin = parseMinutes(st);
    const enMin = parseMinutes(en);

    const overnight = enMin <= stMin; // 21:00 -> 05:00

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

function statusFromEvent(event_type: string) {
  if (event_type === "check_out") return { is_online: false, status: "offline" };
  if (event_type === "break_start") return { is_online: true, status: "break" };
  if (event_type === "bathroom_start") return { is_online: true, status: "bathroom" };
  if (event_type === "break_end") return { is_online: true, status: "working" };
  if (event_type === "bathroom_end") return { is_online: true, status: "working" };
  if (event_type === "check_in") return { is_online: true, status: "working" };
  if (event_type === "heartbeat") return { is_online: true, status: "working" }; // si estaba en break/baño, NO cambiamos
  return { is_online: true, status: "working" };
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const event_type = String(body?.event_type || "");
    const meta = body?.meta && typeof body.meta === "object" ? body.meta : {};

    const allowed = new Set([
      "check_in",
      "check_out",
      "break_start",
      "break_end",
      "bathroom_start",
      "bathroom_end",
      "heartbeat",
    ]);

    if (!allowed.has(event_type)) {
      return NextResponse.json({ ok: false, error: "BAD_EVENT" }, { status: 400 });
    }

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

    // ✅ GATING: solo se permite marcar “online real” si está en turno.
    // - check_in: si fuera de turno => bloqueamos (para que NO se ponga online por defecto).
    // - heartbeat: si fuera de turno => lo ignoramos (NO actualiza estado).
    // - break/bathroom: si fuera de turno => bloqueamos.
    const shiftCheck = await isWithinActiveShiftForWorker(admin, worker_id, "Europe/Madrid");

    if (!shiftCheck.ok) {
      return NextResponse.json({ ok: false, error: "SHIFT_CHECK_FAIL" }, { status: 500 });
    }

    const mustBeInShift = event_type !== "check_out"; // check_out lo dejamos siempre
    if (mustBeInShift && !shiftCheck.within) {
      // heartbeat fuera de turno se ignora “en silencio”
      if (event_type === "heartbeat") {
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "OUTSIDE_SHIFT",
          now_utc: shiftCheck.nowUtc?.toISOString?.() || new Date().toISOString(),
        });
      }

      return NextResponse.json({ ok: false, error: "OUTSIDE_SHIFT" }, { status: 403 });
    }

    // Insert event
    const at = new Date().toISOString();

    const { data: ins, error: ei } = await admin
      .from("attendance_events")
      .insert({
        worker_id,
        event_type,
        at,
        meta: { ...meta, schedule_id: shiftCheck.within ? shiftCheck.schedule_id : null },
      })
      .select("id")
      .maybeSingle();

    if (ei) throw ei;

    // Update attendance_state (solo si NO fue heartbeat ignorado)
    // Heartbeat: no forzamos status=working si estaba en break/baño
    const { data: st0 } = await admin
      .from("attendance_state")
      .select("worker_id, is_online, status")
      .eq("worker_id", worker_id)
      .maybeSingle();

    let next = statusFromEvent(event_type);
    if (event_type === "heartbeat") {
      const curStatus = String(st0?.status || "");
      if (curStatus === "break" || curStatus === "bathroom") {
        next = { is_online: true, status: curStatus };
      }
    }

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

    return NextResponse.json({
      ok: true,
      event_id: ins?.id || null,
      worker_id,
      event_type,
      at,
      within_shift: !!shiftCheck.within,
      schedule_id: shiftCheck.within ? shiftCheck.schedule_id : null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
