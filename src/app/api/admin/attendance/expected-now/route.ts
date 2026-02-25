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

// ---------- TZ helpers ----------
const TZ = "Europe/Madrid";

function partsInTz(d: Date, timeZone = TZ) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const p: any = {};
  for (const x of fmt.formatToParts(d)) {
    if (x.type !== "literal") p[x.type] = x.value;
  }

  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    dow: weekdayMap[p.weekday] || 0, // 1..7 (Mon..Sun)
  };
}

function isoWeekNumberInTz(d: Date) {
  const t = partsInTz(d);
  const utc = new Date(Date.UTC(t.year, t.month - 1, t.day));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return weekNo;
}

function minsSinceMidnightInTz(d: Date) {
  const t = partsInTz(d);
  return t.hour * 60 + t.minute;
}

function hmToMin(hm: string) {
  const [h, m] = hm.split(":").map((x) => Number(x));
  return (h || 0) * 60 + (m || 0);
}

function isNowInShift(nowMin: number, startMin: number, endMin: number) {
  if (startMin === endMin) return false;

  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // cruza medianoche
  return nowMin >= startMin || nowMin < endMin;
}

function isWeekend(dow: number) {
  return dow === 6 || dow === 7;
}

// alternos: semanas ISO
function yamiWeekendActive(weekNo: number) {
  return weekNo % 2 === 0;
}
function mariaWeekendActive(weekNo: number) {
  return weekNo % 2 === 1;
}

type ShiftSpec = { start: string; end: string };

function expectedShiftForName(displayName: string, now: Date): ShiftSpec | null {
  const nm = String(displayName || "").trim().toLowerCase();
  const t = partsInTz(now);
  const weekend = isWeekend(t.dow);
  const weekNo = isoWeekNumberInTz(now);

  // Centrales
  // Yami: L-V 13-21, finde alterno 13-21
  if (nm.includes("yami")) {
    if (!weekend) return { start: "13:00", end: "21:00" };
    return yamiWeekendActive(weekNo) ? { start: "13:00", end: "21:00" } : null;
  }

  // Maria: L-V 21-05, finde alterno 13-21
  if (nm.includes("maria")) {
    if (!weekend) return { start: "21:00", end: "05:00" };
    return mariaWeekendActive(weekNo) ? { start: "13:00", end: "21:00" } : null;
  }

  // Michael: S-D 21-05
  if (nm.includes("michael")) {
    return weekend ? { start: "21:00", end: "05:00" } : null;
  }

  // Tarotistas
  // 13-21: Azul, Estefania, Jesus, Carmenlina
  if (
    nm.includes("azul") ||
    nm.includes("estefania") ||
    nm.includes("jesus") ||
    nm.includes("carmenlina") ||
    nm.includes("carmelina")
  ) {
    return { start: "13:00", end: "21:00" };
  }

  // 21-05: Luna, Adriana, Nela, Sol, Valeria
  if (
    nm.includes("luna") ||
    nm.includes("adriana") ||
    nm.includes("nela") ||
    nm.includes("sol") ||
    nm.includes("valeria")
  ) {
    return { start: "21:00", end: "05:00" };
  }

  return null;
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

    const now = new Date();
    const nowUtc = now.toISOString();

    // sacamos workers centrales + tarotistas
    const { data: workers, error: ew } = await admin
      .from("workers")
      .select("id, display_name, role, team, shift_type")
      .in("role", ["central", "tarotista"]);
    if (ew) throw ew;

    const nowMin = minsSinceMidnightInTz(now);

    const expected = (workers || [])
      .map((w: any) => {
        const sh = expectedShiftForName(w.display_name, now);
        if (!sh) return null;

        const startMin = hmToMin(sh.start);
        const endMin = hmToMin(sh.end);

        if (!isNowInShift(nowMin, startMin, endMin)) return null;

        return {
          worker_id: w.id,
          start_time: sh.start,
          end_time: sh.end,
          timezone: TZ,
          worker: w,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ ok: true, expected, now_utc: nowUtc });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
