import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

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
  const y = get("year");
  const m = get("month");
  const da = get("day");
  const hh = get("hour");
  const mm = get("minute");
  const ss = get("second");
  const wd = get("weekday"); // Mon Tue...
  const off = get("timeZoneName"); // GMT+1, GMT+2
  return { y, m, da, hh, mm, ss, wd, off };
}

function dowFromShort(wd: string) {
  // en-CA short: Sun Mon Tue Wed Thu Fri Sat
  const map: any = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? null;
}

function offsetToIso(off: string) {
  // "GMT+1" "GMT+02:00" etc.
  const s = String(off || "");
  const m = s.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return "+00:00";
  const sign = m[1];
  const hh = String(m[2]).padStart(2, "0");
  const mm = String(m[3] || "00").padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

function buildUtcFromLocal(dateYMD: string, timeHHMM: string, tz: string) {
  // aproximación correcta la inmensa mayoría de días: usa offset actual del TZ
  const off = offsetToIso(tzParts(tz).off);
  return new Date(`${dateYMD}T${timeHHMM}:00${off}`);
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

    // asegurar admin
    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me || me.role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const TZ = "Europe/Madrid";
    const p = tzParts(TZ);
    const dow = dowFromShort(p.wd);
    if (dow == null) return NextResponse.json({ ok: false, error: "BAD_DOW" }, { status: 500 });

    const today = `${p.y}-${p.m}-${p.da}`;
    const nowUtc = new Date();

    const { data: sch, error: es } = await admin
      .from("shift_schedules")
      .select("id, worker_id, day_of_week, start_time, end_time, timezone, active")
      .eq("active", true)
      .eq("day_of_week", dow);
    if (es) throw es;

    const activeNow: any[] = [];
    for (const s of sch || []) {
      const tz = String(s.timezone || TZ);
      const startUtc = buildUtcFromLocal(today, String(s.start_time).slice(0, 5), tz);
      const endUtc = buildUtcFromLocal(today, String(s.end_time).slice(0, 5), tz);

      if (nowUtc >= startUtc && nowUtc <= endUtc) {
        activeNow.push({
          schedule_id: s.id,
          worker_id: s.worker_id,
          start_utc: startUtc.toISOString(),
          end_utc: endUtc.toISOString(),
          start_time: String(s.start_time).slice(0, 5),
          end_time: String(s.end_time).slice(0, 5),
          timezone: tz,
        });
      }
    }

    const ids = [...new Set(activeNow.map((x) => String(x.worker_id)))];
    if (ids.length === 0) return NextResponse.json({ ok: true, expected: [], now_utc: nowUtc.toISOString() });

    const { data: workers, error: ew } = await admin
      .from("workers")
      .select("id, display_name, role, team, shift_type")
      .in("id", ids);
    if (ew) throw ew;

    const byW: Record<string, any> = {};
    for (const w of workers || []) byW[String(w.id)] = w;

    const expected = activeNow.map((x) => ({
      ...x,
      worker: byW[String(x.worker_id)] || null,
    }));

    return NextResponse.json({ ok: true, expected, now_utc: nowUtc.toISOString() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
