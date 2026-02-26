import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function tzNowParts(tz: string) {
  const d = new Date();
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
    da: get("day"),
    wd: get("weekday"),
    hh: get("hour"),
    mm: get("minute"),
    ss: get("second"),
    off: get("timeZoneName"),
  };
}

function dow0FromShort(wd: string) {
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

function addDaysYMD(ymd: string, deltaDays: number) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function buildUtcFromLocal(dateYMD: string, timeHHMM: string, tz: string) {
  const off = offsetToIso(tzNowParts(tz).off);
  return new Date(`${dateYMD}T${timeHHMM}:00${off}`);
}

function toHHMM(v: any) {
  const s = String(v ?? "");
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function parseDowAny(v: any): number | null {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return null;

  if (n >= 0 && n <= 6) return n;

  // Mon=1..Sun=7 -> Sun=0..Sat=6
  if (n >= 1 && n <= 7) return n === 7 ? 0 : n;

  return null;
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

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // ✅ asegurar central (o admin)
    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me || (me.role !== "central" && me.role !== "admin")) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const TZ = "Europe/Madrid";
    const p = tzNowParts(TZ);

    const dowToday0 = dow0FromShort(p.wd);
    if (dowToday0 == null) return NextResponse.json({ ok: false, error: "BAD_DOW" }, { status: 500 });
    const dowYesterday0 = (dowToday0 + 6) % 7;

    const todayYMD = `${p.y}-${p.m}-${p.da}`;
    const yesterdayYMD = addDaysYMD(todayYMD, -1);

    const nowUtc = new Date();

    // Traemos todos los horarios activos
    const { data: sch, error: es } = await admin
      .from("shift_schedules")
      .select("id, worker_id, day_of_week, start_time, end_time, timezone, active")
      .eq("active", true);
    if (es) throw es;

    const schedules = sch || [];
    const activeNow: any[] = [];

    for (const s of schedules) {
      const tz = String(s.timezone || TZ);
      const startHHMM = toHHMM(s.start_time);
      const endHHMM = toHHMM(s.end_time);
      const dow0 = parseDowAny(s.day_of_week);

      if (dow0 == null || !startHHMM || !endHHMM) continue;

      let baseYMD = "";
      if (dow0 === dowToday0) baseYMD = todayYMD;
      else if (dow0 === dowYesterday0) baseYMD = yesterdayYMD;
      else continue;

      const startUtc = buildUtcFromLocal(baseYMD, startHHMM, tz);
      let endUtc = buildUtcFromLocal(baseYMD, endHHMM, tz);

      // cruza medianoche
      if (endUtc <= startUtc) endUtc = new Date(endUtc.getTime() + 24 * 60 * 60 * 1000);

      if (nowUtc >= startUtc && nowUtc <= endUtc) {
        activeNow.push({
          schedule_id: s.id,
          worker_id: s.worker_id,
          start_time: startHHMM,
          end_time: endHHMM,
          timezone: tz,
          start_utc: startUtc.toISOString(),
          end_utc: endUtc.toISOString(),
        });
      }
    }

    const ids = [...new Set(activeNow.map((x) => String(x.worker_id)))];
    if (ids.length === 0) {
      return NextResponse.json({
        ok: true,
        rows: [],
        now_utc: nowUtc.toISOString(),
      });
    }

    // Traemos workers (solo tarotistas)
    const { data: workers, error: ew } = await admin
      .from("workers")
      .select("id, display_name, role")
      .in("id", ids);
    if (ew) throw ew;

    const byW: Record<string, any> = {};
    for (const w of workers || []) byW[String(w.id)] = w;

    // Estado actual
    const { data: st, error: est } = await admin
      .from("attendance_state")
      .select("worker_id, is_online, status, last_event_at, updated_at")
      .in("worker_id", ids);
    if (est) throw est;

    const bySt: Record<string, any> = {};
    for (const s of st || []) bySt[String(s.worker_id)] = s;

    // Heartbeat reciente
    const since = new Date(Date.now() - 90_000).toISOString();
    const { data: hb, error: ehb } = await admin
      .from("attendance_events")
      .select("worker_id, at")
      .in("worker_id", ids)
      .eq("event_type", "heartbeat")
      .gte("at", since)
      .order("at", { ascending: false });
    if (ehb) throw ehb;

    const hbLatest: Record<string, string> = {};
    for (const x of hb || []) {
      const wid = String((x as any).worker_id);
      if (!hbLatest[wid]) hbLatest[wid] = String((x as any).at);
    }

    // Construimos rows (solo tarotistas)
    const rows = activeNow
      .map((x) => {
        const w = byW[String(x.worker_id)];
        if (!w) return null;
        if (String(w.role) !== "tarotista") return null;

        const stx = bySt[String(x.worker_id)];
        const hasRecentHb = !!hbLatest[String(x.worker_id)];
        const realOnline = hasRecentHb && (stx?.is_online !== false);
        const status = realOnline ? String(stx?.status || "working") : "offline";

        return {
          worker_id: String(x.worker_id),
          display_name: String(w.display_name || "—"),
          schedule_id: String(x.schedule_id),
          start_time: String(x.start_time || ""),
          end_time: String(x.end_time || ""),
          timezone: String(x.timezone || TZ),
          online: realOnline,
          status,
        };
      })
      .filter(Boolean);

    rows.sort((a: any, b: any) => String(a.display_name).localeCompare(String(b.display_name)));

    return NextResponse.json({
      ok: true,
      rows,
      now_utc: nowUtc.toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
