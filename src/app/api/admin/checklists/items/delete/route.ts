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

async function requireAdmin(admin: any, uid: string) {
  const { data: me, error } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!me) return { ok: false, error: "NO_WORKER" } as const;
  if (me.role !== "admin") return { ok: false, error: "FORBIDDEN" } as const;
  return { ok: true } as const;
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const check = await requireAdmin(admin, uid);
    if (!check.ok) return NextResponse.json(check, { status: check.error === "FORBIDDEN" ? 403 : 403 });

    const body = await req.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    // Para evitar problemas de FK: borramos primero marks de respuestas.
    // (Si tienes ON DELETE CASCADE, esto no haría falta, pero así va seguro.)
    const { error: e1 } = await admin.from("checklist_response_items").delete().eq("item_id", id);
    if (e1) throw e1;

    const { error: e2 } = await admin.from("checklist_template_items").delete().eq("id", id);
    if (e2) throw e2;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
