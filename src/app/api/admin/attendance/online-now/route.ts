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

    // ✅ TODOS los workers (sin filtrar role)
    const { data: ws, error: ew } = await admin
      .from("workers")
      .select("id, display_name, role, team")
      .order("display_name", { ascending: true });
    if (ew) throw ew;

    const ids = (ws || []).map((w: any) => String(w.id));
    if (!ids.length) return NextResponse.json({ ok: true, rows: [] });

    const { data: st, error: es } = await admin
      .from("attendance_state")
      .select("worker_id, is_online, status, last_event_at")
      .in("worker_id", ids);
    if (es) throw es;

    const byId = new Map<string, any>();
    for (const r of st || []) byId.set(String(r.worker_id), r);

    // ✅ “Conectadas ahora” = is_online true (control horario)
    const rows = (ws || [])
      .map((w: any) => {
        const s = byId.get(String(w.id)) || null;
        if (!s?.is_online) return null;
        return {
          worker_id: String(w.id),
          display_name: w.display_name || "—",
          role: String(w.role || ""),
          team: w.team || null,
          online: true,
          status: String(s.status || "working"),
          last_event_at: s.last_event_at ? String(s.last_event_at) : null,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
