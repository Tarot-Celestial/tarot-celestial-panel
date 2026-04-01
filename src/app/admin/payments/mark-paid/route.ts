import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function requireAdmin(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: user } = await admin.auth.getUser(token);
  const uid = user?.user?.id;

  const { data: me } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (!me || me.role !== "admin") throw new Error("FORBIDDEN");

  return { admin };
}

export async function POST(req: Request) {
  try {
    const { admin } = await requireAdmin(req);
    const body = await req.json();

    const { worker_id, month_key, amount } = body;

    const { error } = await admin
      .from("worker_payments")
      .upsert({
        worker_id,
        month_key,
        amount_eur: amount,
        is_paid: true,
        paid_at: new Date().toISOString(),
      });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
