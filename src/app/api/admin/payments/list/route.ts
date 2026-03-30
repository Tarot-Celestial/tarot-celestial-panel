import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

export async function GET(req: Request) {
  try {
    const { admin } = await requireAdmin(req);
    const u = new URL(req.url);
    const month = u.searchParams.get("month") || monthKeyNow();

    // 🔥 FACTURAS
    const { data: invoices } = await admin
      .from("invoices")
      .select("worker_id, total")
      .eq("month_key", month);

    // 🔥 PAGOS (incluye manuales)
    const { data: payments } = await admin
      .from("worker_payments")
      .select("*")
      .eq("month_key", month);

    // 🔥 IDS DE WORKERS (solo los que tienen worker_id)
    const workerIds = [
      ...new Set(
        (invoices || [])
          .map((i: any) => i.worker_id)
          .filter(Boolean)
      ),
    ];

    // 🔥 TRAER NOMBRES
    const { data: workers } = await admin
      .from("workers")
      .select("id, display_name")
      .in("id", workerIds);

    const workerMap = new Map();
    for (const w of workers || []) {
      workerMap.set(w.id, w.display_name);
    }

    // 🔥 MAP DE PAGOS POR WORKER
    const payMap = new Map();
    for (const p of payments || []) {
      if (p.worker_id) {
        payMap.set(p.worker_id, p);
      }
    }

    // 🔥 FILAS DE TRABAJADORES
    const workerRows = workerIds.map((wid) => {
      const inv = (invoices || []).find((x: any) => x.worker_id === wid);
      const p = payMap.get(wid);

      return {
        worker_id: wid,
        display_name: workerMap.get(wid) || "—",
        amount: p?.amount_eur ?? Number(inv?.total || 0),
        is_paid: !!p?.is_paid,
        is_manual: !!p?.is_manual,
      };
    });

    // 🔥 PAGOS MANUALES SIN WORKER
    const manualRows = (payments || [])
      .filter((p: any) => !p.worker_id)
      .map((p: any) => ({
        worker_id: `manual-${p.id}`,
        display_name: p.concept || "💰 Ajuste manual",
        amount: Number(p.amount_eur || 0),
        is_paid: !!p.is_paid,
        is_manual: true,
      }));

    const rows = [...workerRows, ...manualRows];

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
