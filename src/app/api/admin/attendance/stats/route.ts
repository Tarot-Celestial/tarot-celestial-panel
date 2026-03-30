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

// ---------- Time helpers ----------
const TZ = "Europe/Madrid";

function fmtYMD(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d); // YYYY-MM-DD
}
function addDaysUTC(d: Date, days: number) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function toHHMM(v: any) {
  const s = String(v ?? "");
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function parseDowAny(v: any): number | null {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 6) return n;            // Sun=0..Sat=6
  if (n >= 1 && n <= 7) return n === 7 ? 0 : n; // Mon=1..Sun=7 -> Sun=0
  return null;
}

function tzNowParts(tz: string, d = new Date()) {
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

function buildUtcFromLocal(dateYMD: string, timeHHMM: string, tz: string) {
  const off = offsetToIso(tzNowParts(tz).off);
  return new Date(`${dateYMD}T${timeHHMM}:00${off}`);
}

function overlapMinutes(a0: Date, a1: Date, b0: Date, b1: Date) {
  const s = Math.max(a0.getTime(), b0.getTime());
  const e = Math.min(a1.getTime(), b1.getTime());
  if (e <= s) return 0;
  return Math.round((e - s) / 60000);
}

function groupKey(d: Date, group: string) {
  const ymd = fmtYMD(d);
  if (group === "day") return ymd;

  if (group === "month") return ymd.slice(0, 7); // YYYY-MM

  // week ISO-like (simple): YYYY-Wxx
  // (suficiente para reporting interno)
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (dt.getUTCDay() + 6) % 7; // Mon=0
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((dt.getTime() - firstThursday.getTime()) / (7 * 86400000));
  const year = dt.getUTCFullYear();
  return `${year}-W${String(week).padStart(2, "0")}`;
}

type Slice = { worked: number; breakm: number; bathm: number; expected: number };

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

    const u = new URL(req.url);
    const worker_id = u.searchParams.get("worker_id") || "";
    const group = (u.searchParams.get("group") || "day").toLowerCase(); // day|week|month
    const from = u.searchParams.get("from"); // YYYY-MM-DD
    const to = u.searchParams.get("to");     // YYYY-MM-DD (inclusive)

    const now = new Date();
    const defaultTo = fmtYMD(now);
    const defaultFrom = fmtYMD(addDaysUTC(now, -6)); // 7 días

    const fromYMD = from || defaultFrom;
    const toYMD = to || defaultTo;

    const rangeStart = new Date(`${fromYMD}T00:00:00Z`);
    const rangeEnd = new Date(`${toYMD}T23:59:59Z`);

    // workers a calcular
    const wQuery = admin.from("workers").select("id, display_name, role, team");
    const { data: workers, error: ew } = worker_id ? await wQuery.eq("id", worker_id) : await wQuery;
    if (ew) throw ew;

    const ids = (workers || []).map((w: any) => String(w.id));
    if (!ids.length) return NextResponse.json({ ok: true, rows: [], meta: { fromYMD, toYMD, group } });

    // Traer eventos (incluye buffer 2 días antes por contexto)
    const bufferStart = new Date(rangeStart.getTime() - 2 * 86400000);

    const { data: ev, error: ee } = await admin
      .from("attendance_events")
      .select("worker_id, event_type, at, meta")
      .in("worker_id", ids)
      .gte("at", bufferStart.toISOString())
      .lte("at", rangeEnd.toISOString())
      .order("worker_id", { ascending: true })
      .order("at", { ascending: true });
    if (ee) throw ee;

    // schedules activos para expected
    const { data: sch, error: es } = await admin
      .from("shift_schedules")
      .select("id, worker_id, day_of_week, start_time, end_time, timezone, active")
      .eq("active", true)
      .in("worker_id", ids);
    if (es) throw es;

    const schByWorker = new Map<string, any[]>();
    for (const s of sch || []) {
      const wid = String(s.worker_id);
      const arr = schByWorker.get(wid) || [];
      arr.push(s);
      schByWorker.set(wid, arr);
    }

    // ---- acumular tiempos reales desde eventos ----
    const acc = new Map<string, Slice>(); // key = `${worker_id}::${groupKey}`
    function bump(wid: string, key: string, add: Partial<Slice>) {
      const k = `${wid}::${key}`;
      const cur = acc.get(k) || { worked: 0, breakm: 0, bathm: 0, expected: 0 };
      acc.set(k, {
        worked: cur.worked + (add.worked || 0),
        breakm: cur.breakm + (add.breakm || 0),
        bathm: cur.bathm + (add.bathm || 0),
        expected: cur.expected + (add.expected || 0),
      });
    }

    // estado por worker mientras recorremos eventos
    const state = new Map<string, { is_online: boolean; status: "working" | "break" | "bathroom" | "offline"; lastAt: Date | null }>();

    // init estado
    for (const wid of ids) state.set(wid, { is_online: false, status: "offline", lastAt: null });

    // interpretador de status
    function applyEvent(cur: any, event_type: string, meta: any) {
      if (event_type === "offline") return { is_online: false, status: "offline" as const };
      if (event_type === "heartbeat") {
        if (cur.status === "break" || cur.status === "bathroom") return { is_online: true, status: cur.status };
        return { is_online: true, status: "working" as const };
      }
      // online
      const action = String(meta?.action || "");
      const phase = String(meta?.phase || "");
      if (action === "break") return { is_online: true, status: phase === "end" ? ("working" as const) : ("break" as const) };
      if (action === "bathroom") return { is_online: true, status: phase === "end" ? ("working" as const) : ("bathroom" as const) };
      return { is_online: true, status: "working" as const };
    }

    // recorrer eventos y generar intervalos
    for (const e of ev || []) {
      const wid = String((e as any).worker_id);
      const at = new Date(String((e as any).at));
      const cur = state.get(wid)!;

      // intervalo desde lastAt hasta at
      if (cur.lastAt) {
        const a0 = cur.lastAt;
        const a1 = at;

        // recortar a rango
        const b0 = rangeStart;
        const b1 = rangeEnd;
        const mins = overlapMinutes(a0, a1, b0, b1);

        if (mins > 0 && cur.is_online) {
          // repartir minutos por día/semana/mes (partiendo por día como granularidad simple)
          // lo hacemos “día a día” para no romper semanas/meses
          let t0 = new Date(Math.max(a0.getTime(), b0.getTime()));
          const tEnd = new Date(Math.min(a1.getTime(), b1.getTime()));

          while (t0 < tEnd) {
            const dayKey = fmtYMD(t0);
            const nextDay = new Date(`${dayKey}T23:59:59.999Z`);
            const chunkEnd = new Date(Math.min(nextDay.getTime(), tEnd.getTime()));
            const chunkMins = Math.round((chunkEnd.getTime() - t0.getTime()) / 60000);

            const gk = groupKey(t0, group);

            if (cur.status === "break") bump(wid, gk, { breakm: chunkMins });
            else if (cur.status === "bathroom") bump(wid, gk, { bathm: chunkMins });
            else bump(wid, gk, { worked: chunkMins });

            t0 = new Date(chunkEnd.getTime());
          }
        }
      }

      // aplicar evento
      const meta = (e as any).meta || {};
      const next = applyEvent(cur, String((e as any).event_type), meta);
      state.set(wid, { ...next, lastAt: at });
    }

    // cerrar intervalo hasta ahora (si rango incluye “hoy”)
    const endClose = rangeEnd;
    for (const wid of ids) {
      const cur = state.get(wid)!;
      if (!cur.lastAt) continue;
      if (!cur.is_online) continue;

      const a0 = cur.lastAt;
      const a1 = endClose;
      const mins = overlapMinutes(a0, a1, rangeStart, rangeEnd);
      if (mins <= 0) continue;

      let t0 = new Date(Math.max(a0.getTime(), rangeStart.getTime()));
      const tEnd = new Date(Math.min(a1.getTime(), rangeEnd.getTime()));
      while (t0 < tEnd) {
        const dayKey = fmtYMD(t0);
        const nextDay = new Date(`${dayKey}T23:59:59.999Z`);
        const chunkEnd = new Date(Math.min(nextDay.getTime(), tEnd.getTime()));
        const chunkMins = Math.round((chunkEnd.getTime() - t0.getTime()) / 60000);
        const gk = groupKey(t0, group);

        if (cur.status === "break") bump(wid, gk, { breakm: chunkMins });
        else if (cur.status === "bathroom") bump(wid, gk, { bathm: chunkMins });
        else bump(wid, gk, { worked: chunkMins });

        t0 = new Date(chunkEnd.getTime());
      }
    }

    // ---- expected (según shift_schedules) ----
    // iteramos día a día y sumamos solapes de horarios
    const days: string[] = [];
    {
      const d0 = new Date(rangeStart.getTime());
      for (let i = 0; i < 370; i++) {
        const ymd = fmtYMD(addDaysUTC(d0, i));
        days.push(ymd);
        if (ymd === toYMD) break;
      }
    }

    for (const wid of ids) {
      const schedules = schByWorker.get(wid) || [];
      if (!schedules.length) continue;

      for (const ymd of days) {
        const mid = new Date(`${ymd}T12:00:00Z`);
        const p = tzNowParts(TZ, mid);
        const dow = dow0FromShort(p.wd);
        if (dow == null) continue;

        for (const s of schedules) {
          const sdow = parseDowAny(s.day_of_week);
          if (sdow == null) continue;
          if (sdow !== dow) continue;

          const tz = String(s.timezone || TZ);
          const st = toHHMM(s.start_time);
          const en = toHHMM(s.end_time);
          if (!st || !en) continue;

          const startUtc = buildUtcFromLocal(ymd, st, tz);
          let endUtc = buildUtcFromLocal(ymd, en, tz);
          if (endUtc <= startUtc) endUtc = new Date(endUtc.getTime() + 24 * 60 * 60 * 1000); // overnight

          // recortar al rango de ese día en UTC
          const dayStart = new Date(`${ymd}T00:00:00Z`);
          const dayEnd = new Date(`${ymd}T23:59:59Z`);
          const mins = overlapMinutes(startUtc, endUtc, dayStart, dayEnd);
          if (mins <= 0) continue;

          const gk = groupKey(dayStart, group);
          bump(wid, gk, { expected: mins });
        }
      }
    }

    // construir salida
    const wBy = new Map<string, any>();
    for (const w of workers || []) wBy.set(String((w as any).id), w);

    const out: any[] = [];
    for (const [k, v] of acc.entries()) {
      const [wid, gk] = k.split("::");
      const w = wBy.get(wid);
      out.push({
        worker_id: wid,
        display_name: w?.display_name || "—",
        role: w?.role || "",
        team: w?.team || null,
        group_key: gk,
        worked_minutes: v.worked,
        break_minutes: v.breakm,
        bathroom_minutes: v.bathm,
        expected_minutes: v.expected,
        diff_minutes: v.worked - v.expected,
      });
    }

    out.sort((a, b) => {
      if (a.group_key !== b.group_key) return String(a.group_key).localeCompare(String(b.group_key));
      return String(a.display_name).localeCompare(String(b.display_name));
    });

    return NextResponse.json({
      ok: true,
      rows: out,
      meta: { fromYMD, toYMD, group },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
