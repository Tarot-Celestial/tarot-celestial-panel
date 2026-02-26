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
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    wd: get("weekday"),
    hh: get("hour"),
    mm: get("minute"),
  };
}

function dowFromShort(wd: string) {
  const map: any = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? null;
}

function hhmm(s: any) {
  return String(s || "").slice(0, 5);
}

function parseMinutes(hhmmStr: string) {
  const [h, m] = String(hhmmStr || "0:0").split(":").map((x) => Number(x));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function isActiveNow(nowMin: number, startMin: number, endMin: number) {
  // normal
  if (endMin > startMin) return nowMin >= startMin && nowMin < endMin;
  // overnight (21:00 -> 05:00)
  return nowMin >= startMin || nowMin < endMin;
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // Validar role (central o admin)
    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me?.id) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (me.role !== "central" && me.role !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const TZ = "Europe/Madrid";
    const p = tzParts(TZ, new Date());
    const dow = dowFromShort(p.wd);
    if (dow == null) return NextResponse.json({ ok: false, error: "BAD_DOW" }, { status: 500 });

    const nowMin = Number(p.hh) * 60 + Number(p.mm);
    const dowsToCheck = [dow, (dow + 6) % 7]; // hoy y ayer (por turnos nocturnos)

    const { data: sched, error: es } = await admin
      .from("shift_schedules")
      .select("worker_id, day_of_week, start_time, end_time, timezone, active")
      .eq("active", true)
      .in("day_of_week", dowsToCheck);

    if (es) throw es;

    const wantedIds = new Set<string>();

    for (const s of sched || []) {
      const start = parseMinutes(hhmm(s.start_time));
      const end = parseMinutes(hhmm(s.end_time));
      const overnight = end <= start;

      // Si es horario normal -> solo vale si schedule.day_of_week === hoy
      if (!overnight) {
        if (Number(s.day_of_week) !== dow) continue;
        if (isActiveNow(nowMin, start, end)) wantedIds.add(String(s.worker_id));
        continue;
      }

      // Nocturno:
      // - si schedule es de HOY: activo desde start hasta 23:59
      // - si schedule es de AYER: activo desde 00:00 hasta end
      if (Number(s.day_of_week) === dow) {
        if (nowMin >= start) wantedIds.add(String(s.worker_id));
      } else {
        if (nowMin < end) wantedIds.add(String(s.worker_id));
      }
    }

    const ids = Array.from(wantedIds);
    if (!ids.length) return NextResponse.json({ ok: true, rows: [] });

    const { data: ws, error: ew } = await admin
      .from("workers")
      .select("id, display_name, role")
      .in("id", ids)
      .eq("role", "tarotista");

    if (ew) throw ew;

    const rows = (ws || [])
      .map((w: any) => ({
        worker_id: String(w.id),
        display_name: String(w.display_name || "—"),
      }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
