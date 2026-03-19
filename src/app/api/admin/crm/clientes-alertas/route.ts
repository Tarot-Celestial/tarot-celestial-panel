import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await sb.auth.getUser();
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;

  const admin = adminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function cleanNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function daysSince(dateValue?: string | null) {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / 86400000);
}

async function fetchClientsByIds(admin: ReturnType<typeof adminClient>, ids: string[]) {
  if (!ids.length) return new Map<string, any>();

  const candidates = ["crm_clientes", "crm_clients", "clientes"];

  for (const table of candidates) {
    const { data, error } = await admin.from(table).select("*").in("id", ids);
    if (!error && Array.isArray(data)) {
      return new Map((data || []).map((row: any) => [String(row.id), row]));
    }
  }

  return new Map<string, any>();
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (worker.role !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const admin = adminClient();

    const { data: pagos, error: pagosError } = await admin
      .from("crm_cliente_pagos")
      .select("id, cliente_id, importe, estado, created_at")
      .eq("estado", "completed")
      .order("created_at", { ascending: false });

    if (pagosError) throw pagosError;

    const grouped = new Map<string, any>();

    for (const pago of pagos || []) {
      const clienteId = String(pago.cliente_id || "").trim();
      if (!clienteId) continue;

      if (!grouped.has(clienteId)) {
        grouped.set(clienteId, {
          cliente_id: clienteId,
          total_gastado: 0,
          completed_payments_count: 0,
          ultimo_pago_at: null,
        });
      }

      const row = grouped.get(clienteId)!;
      row.total_gastado += cleanNum(pago.importe);
      row.completed_payments_count += 1;

      if (!row.ultimo_pago_at || new Date(String(pago.created_at || 0)).getTime() > new Date(String(row.ultimo_pago_at || 0)).getTime()) {
        row.ultimo_pago_at = pago.created_at || null;
      }
    }

    const clientIds = Array.from(grouped.keys());
    const clientMap = await fetchClientsByIds(admin, clientIds);

    const rows = clientIds
      .map((clienteId) => {
        const base = grouped.get(clienteId);
        const cliente = clientMap.get(clienteId) || {};
        const total = cleanNum(base?.total_gastado);
        const ultimo = base?.ultimo_pago_at || null;
        const dias = daysSince(ultimo);

        return {
          cliente_id: clienteId,
          nombre: String(cliente?.nombre || "").trim(),
          apellido: String(cliente?.apellido || "").trim(),
          telefono: String(cliente?.telefono || "").trim(),
          pais: String(cliente?.pais || "").trim(),
          email: String(cliente?.email || "").trim(),
          total_gastado: Math.round(total * 100) / 100,
          completed_payments_count: cleanNum(base?.completed_payments_count),
          ultimo_pago_at: ultimo,
          dias_sin_pago: dias,
          bonus_count: Math.floor(total / 100),
          vip: total >= 1000,
        };
      })
      .sort((a, b) => Number(b.total_gastado || 0) - Number(a.total_gastado || 0));

    const bonusAlerts = rows
      .filter((x) => x.bonus_count >= 1)
      .sort((a, b) => {
        const byBonus = Number(b.bonus_count || 0) - Number(a.bonus_count || 0);
        if (byBonus !== 0) return byBonus;
        return Number(b.total_gastado || 0) - Number(a.total_gastado || 0);
      });

    const vipAlerts = rows.filter((x) => x.vip);

    const inactivityRed = rows
      .filter((x) => (x.dias_sin_pago ?? -1) >= 60)
      .sort((a, b) => Number(b.dias_sin_pago || 0) - Number(a.dias_sin_pago || 0));

    const inactivityYellow = rows
      .filter((x) => {
        const days = x.dias_sin_pago ?? -1;
        return days >= 30 && days < 60;
      })
      .sort((a, b) => Number(b.dias_sin_pago || 0) - Number(a.dias_sin_pago || 0));

    const summary = {
      totalClientesConPago: rows.length,
      bonosPendientes: bonusAlerts.reduce((acc, row) => acc + Number(row.bonus_count || 0), 0),
      clientesVip: vipAlerts.length,
      inactivos30: inactivityYellow.length,
      inactivos60: inactivityRed.length,
      facturacionTotal: rows.reduce((acc, row) => acc + cleanNum(row.total_gastado), 0),
    };

    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      summary,
      bonusAlerts,
      vipAlerts,
      inactivityAlerts: {
        yellow: inactivityYellow,
        red: inactivityRed,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
