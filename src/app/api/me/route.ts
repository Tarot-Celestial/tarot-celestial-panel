import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null, email: null as string | null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error) throw error;
  return { uid: data.user?.id || null, email: data.user?.email || null };
}

export async function GET(req: Request) {
  try {
    const { uid, email } = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: worker, error } = await admin
      .from("workers")
      .select("id, display_name, role, team, email, user_id")
      .eq("user_id", uid)
      .maybeSingle();

    if (error) throw error;
    if (!worker?.id) {
      return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      id: worker.id,
      role: worker.role || "",
      display_name: worker.display_name || "Usuario",
      team: worker.team || "",
      email: worker.email || email || "",
      month_key: monthKeyNow(),
      worker,
      user: { id: uid, email: email || worker.email || "" },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
