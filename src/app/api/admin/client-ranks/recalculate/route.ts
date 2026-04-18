import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calcClientRank, loadRolling30ClientTotals } from "@/lib/server/client-ranks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const sb = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;
  const admin = adminClient();
  const { data, error } = await admin.from("workers").select("id, role, display_name").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function notifyRankChange(admin: any, params: { clienteId: string; clientName: string; rank: string; previousRank?: string | null }) {
  const { clienteId, clientName, rank, previousRank } = params;
  const order: Record<string, number> = { bronce: 1, plata: 2, oro: 3 };
  if (!previousRank) return;
  if ((order[rank] || 0) <= (order[previousRank] || 0)) return;
  await admin.from("notifications").insert({
    type: "rank_upgrade",
    title: "Cliente sube de rango",
    message: `🔥 ${clientName} ha subido a ${rank.toUpperCase()}`,
    cliente_id: clienteId,
    rango: rank,
    read: false,
    created_at: new Date().toISOString(),
  });
}

async function runRecalc() {
  const admin = adminClient();
  const now = new Date();
  const sinceDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const nowIso = now.toISOString();
  const sinceIso = sinceDate.toISOString();

  const { data: clientes, error: cliErr } = await admin
    .from("crm_clientes")
    .select("id, nombre, apellido, rango_actual");
  if (cliErr) throw cliErr;

  const prevRanks = new Map<string, string | null>();
  for (const c of clientes || []) {
    prevRanks.set(String(c.id), c?.rango_actual ? String(c.rango_actual) : null);
  }

  const totals = await loadRolling30ClientTotals(admin, clientes || [], sinceIso, nowIso);

  await admin
    .from("crm_clientes")
    .update({
      rango_actual: null,
      rango_gasto_mes_anterior: 0,
      rango_compras_mes_anterior: 0,
      rango_actual_desde: sinceIso.slice(0, 10),
      rango_actual_hasta: nowIso.slice(0, 10),
      updated_at: nowIso,
    })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  let bronce = 0;
  let plata = 0;
  let oro = 0;
  let updated = 0;
  let gasto30d = 0;
  let compras30d = 0;

  for (const [clienteId, info] of totals.entries()) {
    const rank = calcClientRank(info.total);
    if (!rank) continue;

    if (rank === "bronce") bronce += 1;
    if (rank === "plata") plata += 1;
    if (rank === "oro") oro += 1;
    gasto30d += info.total;
    compras30d += info.compras;

    const roundedTotal = Number(info.total.toFixed(2));
    await admin.from("cliente_rangos_mensuales").upsert(
      {
        cliente_id: clienteId,
        periodo_mes: nowIso.slice(0, 10),
        calculado_desde_mes: sinceIso.slice(0, 10),
        gasto_mes_anterior: roundedTotal,
        compras_mes_anterior: info.compras,
        rango: rank,
        recalculated_at: nowIso,
      },
      { onConflict: "cliente_id,periodo_mes" }
    );

    await admin
      .from("crm_clientes")
      .update({
        rango_actual: rank,
        rango_gasto_mes_anterior: roundedTotal,
        rango_compras_mes_anterior: info.compras,
        rango_actual_desde: sinceIso.slice(0, 10),
        rango_actual_hasta: nowIso.slice(0, 10),
        updated_at: nowIso,
      })
      .eq("id", clienteId);

    const previousRank = prevRanks.get(clienteId) || null;
    if (previousRank !== rank) {
      const clientRow = (clientes || []).find((x: any) => String(x.id) === clienteId);
      const clientName = [clientRow?.nombre, clientRow?.apellido].filter(Boolean).join(" ").trim() || `Cliente ${clienteId}`;
      await notifyRankChange(admin, { clienteId, clientName, rank, previousRank });
    }

    updated += 1;
  }

  return {
    ok: true,
    window_days: 30,
    clientes_actualizados: updated,
    gastoMesAnterior: Number(gasto30d.toFixed(2)),
    comprasMesAnterior: compras30d,
    rangos: { bronce, plata, oro },
  };
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    const result = await runRecalc();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
