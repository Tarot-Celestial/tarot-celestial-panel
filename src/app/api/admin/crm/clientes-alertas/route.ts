import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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
  const { data, error } = await admin.from("workers").select("id, role").eq("user_id", uid).maybeSingle();
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
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function normalizeName(v: any) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMoveKey(clienteId: string, amount: number, dateValue: string | null | undefined) {
  const day = dateValue ? String(dateValue).slice(0, 10) : "sin-fecha";
  return `${clienteId}::${amount.toFixed(2)}::${day}`;
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (String(worker.role || "") !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const admin = adminClient();
    const since30Iso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: clientes, error: cliErr }, { data: pagos, error: pagosErr }, { data: rendimiento, error: rendErr }] = await Promise.all([
      admin.from("crm_clientes").select("id, nombre, apellido, telefono, pais, email"),
      admin.from("crm_cliente_pagos").select("cliente_id, importe, estado, created_at").eq("estado", "completed").order("created_at", { ascending: false }),
      admin.from("rendimiento_llamadas").select("cliente_id, cliente_nombre, importe, fecha_hora").gt("importe", 0).order("fecha_hora", { ascending: false }),
    ]);
    if (cliErr) throw cliErr;
    if (pagosErr) throw pagosErr;
    if (rendErr) throw rendErr;

    const clientsById = new Map((clientes || []).map((row: any) => [String(row.id), row]));
    const clientsByName = new Map<string, string>();
    for (const row of clientes || []) {
      const full = [row?.nombre, row?.apellido].filter(Boolean).join(" ").trim();
      const key1 = normalizeName(full);
      const key2 = normalizeName(row?.nombre);
      if (key1) clientsByName.set(key1, String(row.id));
      if (key2 && !clientsByName.has(key2)) clientsByName.set(key2, String(row.id));
    }

    const grouped = new Map<string, any>();
    const seenMoves = new Set<string>();

    function ensure(clienteId: string) {
      if (!grouped.has(clienteId)) {
        grouped.set(clienteId, {
          cliente_id: clienteId,
          total_gastado: 0,
          total_30d: 0,
          completed_payments_count: 0,
          ultimo_pago_at: null,
        });
      }
      return grouped.get(clienteId);
    }

    for (const pago of pagos || []) {
      const clienteId = String(pago?.cliente_id || "").trim();
      const amount = cleanNum(pago?.importe);
      if (!clienteId || !(amount > 0)) continue;
      const key = buildMoveKey(clienteId, amount, pago?.created_at || null);
      if (seenMoves.has(key)) continue;
      seenMoves.add(key);
      const row = ensure(clienteId);
      row.total_gastado += amount;
      if (String(pago?.created_at || "") >= since30Iso) row.total_30d += amount;
      row.completed_payments_count += 1;
      if (!row.ultimo_pago_at || new Date(String(pago?.created_at || 0)).getTime() > new Date(String(row.ultimo_pago_at || 0)).getTime()) {
        row.ultimo_pago_at = pago?.created_at || null;
      }
    }

    for (const mov of rendimiento || []) {
      let clienteId = String(mov?.cliente_id || "").trim();
      const amount = cleanNum(mov?.importe);
      if (!(amount > 0)) continue;
      if (!clienteId) clienteId = clientsByName.get(normalizeName(mov?.cliente_nombre)) || "";
      if (!clienteId) continue;
      const key = buildMoveKey(clienteId, amount, mov?.fecha_hora || null);
      if (seenMoves.has(key)) continue;
      seenMoves.add(key);
      const row = ensure(clienteId);
      row.total_gastado += amount;
      if (String(mov?.fecha_hora || "") >= since30Iso) row.total_30d += amount;
      row.completed_payments_count += 1;
      if (!row.ultimo_pago_at || new Date(String(mov?.fecha_hora || 0)).getTime() > new Date(String(row.ultimo_pago_at || 0)).getTime()) {
        row.ultimo_pago_at = mov?.fecha_hora || null;
      }
    }

    const rows = Array.from(grouped.values())
      .map((base: any) => {
        const cliente = clientsById.get(String(base.cliente_id)) || {};
        const total = cleanNum(base?.total_gastado);
        const total30d = cleanNum(base?.total_30d);
        const ultimo = base?.ultimo_pago_at || null;
        return {
          cliente_id: String(base.cliente_id),
          nombre: String(cliente?.nombre || "").trim(),
          apellido: String(cliente?.apellido || "").trim(),
          telefono: String(cliente?.telefono || "").trim(),
          pais: String(cliente?.pais || "").trim(),
          email: String(cliente?.email || "").trim(),
          total_gastado: Number(total.toFixed(2)),
          total_30d: Number(total30d.toFixed(2)),
          completed_payments_count: cleanNum(base?.completed_payments_count),
          ultimo_pago_at: ultimo,
          dias_sin_pago: daysSince(ultimo),
          bonus_count: Math.floor(total30d / 100),
          vip: total30d >= 1000,
        };
      })
      .sort((a, b) => Number(b.total_30d || 0) - Number(a.total_30d || 0));

    const bonusAlerts = rows.filter((x) => Number(x.total_30d || 0) >= 100);
    const vipAlerts = rows.filter((x) => x.vip);
    const inactivityRed = rows.filter((x) => (x.dias_sin_pago ?? -1) >= 60).sort((a, b) => Number(b.dias_sin_pago || 0) - Number(a.dias_sin_pago || 0));
    const inactivityYellow = rows.filter((x) => {
      const days = x.dias_sin_pago ?? -1;
      return days >= 30 && days < 60;
    }).sort((a, b) => Number(b.dias_sin_pago || 0) - Number(a.dias_sin_pago || 0));

    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      summary: {
        totalClientesConPago: rows.length,
        bonosPendientes: bonusAlerts.reduce((acc, row) => acc + Number(row.bonus_count || 0), 0),
        clientesVip: vipAlerts.length,
        inactivos30: inactivityYellow.length,
        inactivos60: inactivityRed.length,
        facturacionTotal: rows.reduce((acc, row) => acc + cleanNum(row.total_30d), 0),
      },
      bonusAlerts,
      vipAlerts,
      inactivityAlerts: {
        yellow: inactivityYellow,
        red: inactivityRed,
      },
      window_days: 30,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
