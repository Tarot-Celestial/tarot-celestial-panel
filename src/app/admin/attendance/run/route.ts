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
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    wd: get("weekday"),
    off: get("timeZoneName"),
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

function buildUtcFromLocal(dateYMD: string, timeHHMM: string, tz: string) {
  const off = offsetToIso(tzParts(tz).off);
  return new Date(`${dateYMD}T${timeHHMM}:00${off}`);
}

function monthKeyFromYMD(ymd: string) {
  // "2026-02-25" => "2026-02"
  return ymd.slice(0, 7);
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

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me || me.role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const TZ = "Europe/Madrid";
    const tp = tzParts(TZ);
    const dow = dowFromShort(tp.wd);
    if (dow == null) return NextResponse.json({ ok: false, error: "BAD_DOW" }, { status: 500 });

    const today = `${tp.y}-${tp.m}-${tp.d}`;
    const month_key = monthKeyFromYMD(today);
    const nowUtc = new Date();

    // reglas que me diste
    const LATE_MINUTES = 5;
    const LATE_AMOUNT = 1;
    const ABSENCE_AMOUNT = 12;

    const { data: sch, error: es } = await admin
      .from("shift_schedules")
      .select("id, worker_id, day_of_week, start_time, end_time, timezone, active")
      .eq("active", true)
      .eq("day_of_week", dow);
    if (es) throw es;

    let created_late = 0;
    let created_absence = 0;

    for (const s of sch || []) {
      const tz = String(s.timezone || TZ);
      const startUtc = buildUtcFromLocal(today, String(s.start_time).slice(0, 5), tz);
      const endUtc = buildUtcFromLocal(today, String(s.end_time).slice(0, 5), tz);

      const worker_id = String(s.worker_id);
      const schedule_id = String(s.id);

      // buscamos si tuvo algún heartbeat en el rango del turno
      const { data: ev, error: ee } = await admin
        .from("attendance_events")
        .select("id, at")
        .eq("worker_id", worker_id)
        .in("event_type", ["heartbeat", "online"])
        .gte("at", startUtc.toISOString())
        .lte("at", endUtc.toISOString())
        .order("at", { ascending: true })
        .limit(1);
      if (ee) throw ee;

      const firstSeen = ev?.[0]?.at ? new Date(ev[0].at) : null;

      // ---- Retraso: si ya pasó start+5min y la primera conexión fue después
      const lateThreshold = new Date(startUtc.getTime() + LATE_MINUTES * 60_000);

      if (nowUtc >= lateThreshold) {
        const isLate = !firstSeen ? true : firstSeen > lateThreshold;

        if (isLate) {
          // evitar duplicado por día+schedule
          const { data: ex, error: exErr } = await admin
            .from("incidents")
            .select("id")
            .eq("worker_id", worker_id)
            .eq("month_key", month_key)
            .eq("kind", "attendance")
            .contains("meta", { type: "late", schedule_id, date: today })
            .maybeSingle();
          if (exErr) throw exErr;

          if (!ex) {
            const reason = `Asistencia: Retraso (${LATE_MINUTES} min)`;
            const meta = {
              type: "late",
              schedule_id,
              date: today,
              start_utc: startUtc.toISOString(),
              end_utc: endUtc.toISOString(),
              late_minutes: LATE_MINUTES,
            };

            const { error: ei } = await admin.from("incidents").insert({
              worker_id,
              month_key,
              amount: LATE_AMOUNT,
              reason,
              kind: "attendance",
              status: "unjustified", // descuento directo salvo que admin lo justifique
              meta,
            });
            if (ei) throw ei;
            created_late++;
          }
        }
      }

      // ---- Falta: SOLO si ya terminó el turno y no hubo ninguna conexión dentro
      if (nowUtc > endUtc) {
        const absent = !firstSeen;

        if (absent) {
          const { data: ex2, error: ex2Err } = await admin
            .from("incidents")
            .select("id")
            .eq("worker_id", worker_id)
            .eq("month_key", month_key)
            .eq("kind", "attendance")
            .contains("meta", { type: "absence", schedule_id, date: today })
            .maybeSingle();
          if (ex2Err) throw ex2Err;

          if (!ex2) {
            const reason = "Asistencia: Falta (no conectó en el turno)";
            const meta = {
              type: "absence",
              schedule_id,
              date: today,
              start_utc: startUtc.toISOString(),
              end_utc: endUtc.toISOString(),
            };

            const { error: ei2 } = await admin.from("incidents").insert({
              worker_id,
              month_key,
              amount: ABSENCE_AMOUNT,
              reason,
              kind: "attendance",
              status: "unjustified",
              meta,
            });
            if (ei2) throw ei2;
            created_absence++;
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      date: today,
      month_key,
      created: { late: created_late, absence: created_absence },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
