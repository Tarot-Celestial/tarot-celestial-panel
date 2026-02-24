import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type SeedUser = {
  email: string;
  password: string;
  display_name: string;
  role: "admin" | "central" | "tarotista";
  team: "fuego" | "agua" | null;
  shift_start_hour: number | null;
  shift_length_hours: number | null;
  salary_base: number;
};

const USERS: SeedUser[] = [
  // Admins
  { email: "rickycaudet@gmail.com", password: "Nosotrostarot1.", display_name: "Ricky", role: "admin", team: null, shift_start_hour: null, shift_length_hours: null, salary_base: 0 },
  { email: "leonarisignis@gmail.com", password: "Nosotrostarot1.", display_name: "Alex", role: "admin", team: null, shift_start_hour: null, shift_length_hours: null, salary_base: 0 },

  // Centrales
  { email: "yambacc1604@hotmail.com", password: "BANDY1311", display_name: "Yami", role: "central", team: "fuego", shift_start_hour: 13, shift_length_hours: 8, salary_base: 400 },
  { email: "emperatriz82rivera@gmail.com", password: "Celestial1.", display_name: "Maria", role: "central", team: "agua", shift_start_hour: 21, shift_length_hours: 8, salary_base: 400 },
  { email: "mullomichael7@gmail.com", password: "Celestial1.", display_name: "Michael", role: "central", team: "agua", shift_start_hour: 21, shift_length_hours: 8, salary_base: 280 },

  // Tarotistas (tarde = fuego)
  { email: "mariabolivar1097@gmail.com", password: "Celestial1.", display_name: "Azul", role: "tarotista", team: "fuego", shift_start_hour: 13, shift_length_hours: 8, salary_base: 0 },
  { email: "minanieto871@gmail.com", password: "Celestial1.", display_name: "Estefania", role: "tarotista", team: "fuego", shift_start_hour: 13, shift_length_hours: 8, salary_base: 0 },
  { email: "caneonecane@gmail.com", password: "Celestial1.", display_name: "Jesus", role: "tarotista", team: "fuego", shift_start_hour: 13, shift_length_hours: 8, salary_base: 0 },
  { email: "marynadaza1989@gmail.com", password: "Celestial1.", display_name: "Carmenlina", role: "tarotista", team: "fuego", shift_start_hour: 13, shift_length_hours: 8, salary_base: 0 },

  // Tarotistas (noche = agua)
  { email: "roxanalopez3331@hotmail.com", password: "Celestial1.", display_name: "Adriana", role: "tarotista", team: "agua", shift_start_hour: 21, shift_length_hours: 8, salary_base: 0 },
  { email: "lissethlarrealbarranco@gmail.com", password: "Celestial1.", display_name: "Luna", role: "tarotista", team: "agua", shift_start_hour: 21, shift_length_hours: 8, salary_base: 0 },
  { email: "thalianapalma2613@gmail.com", password: "Celestial1.", display_name: "Nela", role: "tarotista", team: "agua", shift_start_hour: 21, shift_length_hours: 8, salary_base: 0 },
  { email: "cali12151@hotmail.com", password: "Celestial1.", display_name: "Sol", role: "tarotista", team: "agua", shift_start_hour: 21, shift_length_hours: 8, salary_base: 0 },
  { email: "aguadoruizkaren@gmail.com", password: "Celestial1.", display_name: "Valeria", role: "tarotista", team: "agua", shift_start_hour: 21, shift_length_hours: 8, salary_base: 0 },
];

async function doSeed(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Seguridad: requiere SEED_KEY (en Vercel env). Si no existe, bloqueamos.
  const seedKey = process.env.SEED_KEY || "";
  if (!seedKey) {
    return NextResponse.json(
      { ok: false, error: "Missing SEED_KEY env var in Vercel (add it first)." },
      { status: 500 }
    );
  }

  // Aceptamos key por header o querystring
  const u = new URL(req.url);
  const gotHeader = req.headers.get("x-seed-key") || "";
  const gotQuery = u.searchParams.get("key") || "";
  const got = gotHeader || gotQuery;

  if (got !== seedKey) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN (bad key)" }, { status: 403 });
  }

  const results: any[] = [];
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (list.error) throw list.error;

  for (const u of USERS) {
    // 1) Crear usuario Auth si no existe
    const existing = list.data.users.find((x) => (x.email || "").toLowerCase() === u.email.toLowerCase());

    let userId: string | null = existing?.id || null;

    if (!userId) {
      const created = await admin.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
      });
      if (created.error) throw created.error;
      userId = created.data.user?.id || null;
    }

    if (!userId) throw new Error(`No userId for ${u.email}`);

    // 2) Upsert workers
    const { error: ew } = await admin.from("workers").upsert(
      {
        user_id: userId,
        email: u.email,
        display_name: u.display_name,
        role: u.role,
        team: u.team,
        shift_start_hour: u.shift_start_hour,
        shift_length_hours: u.shift_length_hours,
        salary_base: u.salary_base,
        is_active: true,
      },
      { onConflict: "email" }
    );
    if (ew) throw ew;

    results.push({ email: u.email, ok: true });
  }

  return NextResponse.json({ ok: true, seeded: results.length, results });
}

export async function GET(req: Request) {
  // Si no pasas key, solo muestra instrucciones (para que no dé 405)
  const u = new URL(req.url);
  const key = u.searchParams.get("key") || "";
  if (!key) {
    return NextResponse.json({
      ok: true,
      hint:
        "To seed users, call this endpoint with ?key=YOUR_SEED_KEY (or POST with header x-seed-key). Example: /api/admin/seed-users?key=....",
    });
  }
  return doSeed(req);
}

export async function POST(req: Request) {
  return doSeed(req);
}
