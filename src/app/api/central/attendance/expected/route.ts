import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function madridNowParts() {
  const d = new Date();

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(d);

  const get = (t: string) => parts.find((p) => p.type === t)?.value;

  const hh = Number(get("hour") || 0);
  const mm = Number(get("minute") || 0);

  // weekday short en-GB: Mon Tue Wed Thu Fri Sat Sun
  const wd = String(get("weekday") || "Mon");
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const dowMon0 = map[wd] ?? 0;

  return {
    minutes: hh * 60 + mm,
    dowMon0,
  };
}

function isActiveShift(nowMin: number, startMin: number, endMin: number) {
  // normal: 09:00-17:00
  if (startMin <= endMin) return nowMin >= startMin && nowMin < endMin;

  // nocturno: 21:00-05:00  -> activo si (>=21:00) o (<05:00)
  return nowMin >= startMin || nowMin < endMin;
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

function timeToMinutes(t: string) {
  // "21:00:00" | "21:00"
  const s = String(t || "");
  const [hh, mm] = s.split(":");
  return Number(hh || 0) * 60 + Number(mm || 0);
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // validar rol del caller
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

    const { minutes: nowMin, dowMon0 } = madridNowParts();
    const yesterdayDow = (dowMon0 + 6) % 7;

    // Traemos horarios de hoy y ayer (por turnos nocturnos)
    const { data: sched, error: es } = await admin
      .from("shift_schedules")
      .select("worker_id, day_of_week, start_time, end_time, timezone, is_enabled")
      .in("day_of_week", [dowMon0, yesterdayDow])
      .eq("is_enabled", true);

    if (es) throw es;

    const rows = Array.isArray(sched) ? sched : [];

    // Filtramos activos en este instante (Madrid)
    const activeWorkerIds = new Map<string, any>();

    for (const r of rows) {
      const workerId = String(r.worker_id);
      const day = Number(r.day_of_week);
      const startMin = timeToMinutes(r.start_time);
      const endMin = timeToMinutes(r.end_time);

      // Si es turno nocturno, el "día" correcto depende:
      // - si es de hoy y start>end: cubre desde start hasta 23:59
      // - si es de ayer y start>end: cubre desde 00:00 hasta end
      const overnight = startMin > endMin;

      let active = false;
      if (!overnight) {
        // normal: solo cuenta si day == hoy
        if (day === dowMon0) active = isActiveShift(nowMin, startMin, endMin);
      } else {
        // nocturno:
        if (day === dowMon0) {
          // tramo tarde-noche
          active = nowMin >= startMin;
        } else if (day === yesterdayDow) {
          // tramo madrugada
          active = nowMin < endMin;
        }
      }

      if (active) {
        // si hay varios, nos quedamos con 1
        activeWorkerIds.set(workerId, {
          worker_id: workerId,
          start_time: r.start_time,
          end_time: r.end_time,
          timezone: r.timezone || "Europe/Madrid",
        });
      }
    }

    const ids = Array.from(activeWorkerIds.keys());
    if (!ids.length) {
      return NextResponse.json({ ok: true, rows: [] });
    }

    const { data: workers, error: ew } = await admin
      .from("workers")
      .select("id, display_name")
      .in("id", ids);

    if (ew) throw ew;

    const wmap = new Map<string, any>();
    (workers || []).forEach((w: any) => wmap.set(String(w.id), w));

    const out = ids
      .map((id) => {
        const base = activeWorkerIds.get(id);
        const w = wmap.get(id);
        return {
          worker_id: id,
          display_name: w?.display_name || "—",
          start_time: base?.start_time || null,
          end_time: base?.end_time || null,
          timezone: base?.timezone || "Europe/Madrid",
        };
      })
      .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));

    return NextResponse.json({ ok: true, rows: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
