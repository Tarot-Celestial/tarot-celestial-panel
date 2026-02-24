import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnvAny(names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing env var: one of [${names.join(", ")}]`);
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function getMe(req: Request) {
  const supabaseUrl = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
  const anonKey = getEnvAny(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false as const, error: "NO_TOKEN" as const };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  const uid = data?.user?.id || null;
  if (!uid) return { ok: false as const, error: "BAD_TOKEN" as const };

  const url = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
  const service = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: w, error: werr } = await admin
    .from("workers")
    .select("id, role, display_name")
    .eq("user_id", uid)
    .maybeSingle();

  if (werr || !w) return { ok: false as const, error: "NO_WORKER" as const };

  return { ok: true as const, worker: w, admin };
}

export async function POST(req: Request) {
  try {
    const me = await getMe(req);
    if (!me.ok) return NextResponse.json(me, { status: 401 });

    const worker = me.worker; // ✅ TS ya sabe que existe

    if (worker.role !== "central" && worker.role !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const worker_id = String(body.worker_id || "");
    const amount = Number(String(body.amount ?? "0").replace(",", "."));
    const reason = String(body.reason || "").trim();
    const month_key = String(body.month_key || monthKeyNow());

    if (!worker_id) return NextResponse.json({ ok: false, error: "worker_id required" }, { status: 400 });
    if (!reason) return NextResponse.json({ ok: false, error: "reason required" }, { status: 400 });
    if (!isFinite(amount) || amount <= 0)
      return NextResponse.json({ ok: false, error: "amount must be > 0" }, { status: 400 });

    const { error } = await me.admin.from("incidents").insert({
      worker_id,
      month_key,
      amount,
      reason,
      created_by: worker.id,
    });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
