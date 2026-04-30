export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

type AnyRow = Record<string, any>;

type LeadItem = AnyRow & {
  workflow_state: string;
  is_closed: boolean;
  next_contact_at?: string | null;
  created_at?: string | null;
};

const CLOSED_STATES = new Set(["captado", "no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"]);

function norm(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function computeWorkflowState(item: AnyRow) {
  const estado = norm(item?.estado);

  if (estado === "pendiente_free") return "pendiente_free";
  if (estado === "hizo_free" || estado === "recontacto") return "hizo_free";
  if (estado === "no_contesta") return "no_contesta";
  if (estado === "captado") return "captado";

  if (["no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"].includes(estado)) {
    return "cerrado";
  }

  return "nuevo";
}

function isClosed(item: AnyRow) {
  const estado = norm(item?.estado);
  return Boolean(
    item?.closed_at ||
    ["captado", "no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"].includes(estado)
  );
}

async function fetchWithJoin() {
  const { data, error } = await supabase
    .from("captacion_leads")
    .select(`
      id,
      cliente_id,
      estado,
      intento_actual,
      max_intentos,
      next_contact_at,
      last_contact_at,
      contacted_at,
      closed_at,
      last_result,
      campaign_name,
      form_name,
      origen,
      notas,
      assigned_worker_id,
      assigned_role,
      created_at,
      updated_at,
      cliente:crm_clientes(
        id,
        nombre,
        apellido,
        telefono,
        email,
        origen,
        lead_status,
        lead_contacted_at,
        lead_campaign_name,
        lead_form_name,
        created_at
      )
    `)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchFallback() {
  const { data, error } = await supabase
    .from("captacion_leads")
    .select("id, cliente_id, estado, intento_actual, max_intentos, next_contact_at, last_contact_at, contacted_at, closed_at, last_result, campaign_name, form_name, origen, notas, assigned_worker_id, assigned_role, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  const clienteIds = Array.from(
    new Set(rows.map((x: AnyRow) => String(x?.cliente_id || "").trim()).filter(Boolean))
  );

  if (!clienteIds.length) return rows;

  const { data: clientes, error: clientesErr } = await supabase
    .from("crm_clientes")
    .select("id, nombre, apellido, telefono, email, origen, lead_status, lead_contacted_at, lead_campaign_name, lead_form_name, created_at")
    .in("id", clienteIds);

  if (clientesErr) throw clientesErr;

  const byId = new Map((clientes || []).map((c: AnyRow) => [String(c.id), c]));

  return rows.map((row: AnyRow) => ({
    ...row,
    cliente: byId.get(String(row?.cliente_id || "")) || null,
  }));
}


function cleanNum(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function paymentMoveKey(clienteId: string, amount: number, dateValue: string | null | undefined) {
  const day = dateValue ? String(dateValue).slice(0, 10) : "sin-fecha";
  return clienteId + "::" + amount.toFixed(2) + "::" + day;
}

async function enrichWithRevenue(rows: AnyRow[]) {
  const clienteIds = Array.from(
    new Set(rows.map((x: AnyRow) => String(x?.cliente_id || x?.cliente?.id || "").trim()).filter(Boolean))
  );

  if (!clienteIds.length) return rows;

  const since30Iso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: pagos }, { data: rendimiento }] = await Promise.all([
    supabase
      .from("crm_cliente_pagos")
      .select("cliente_id, importe, estado, created_at")
      .in("cliente_id", clienteIds)
      .eq("estado", "completed")
      .order("created_at", { ascending: true }),
    supabase
      .from("rendimiento_llamadas")
      .select("cliente_id, importe, fecha_hora")
      .in("cliente_id", clienteIds)
      .gt("importe", 0)
      .order("fecha_hora", { ascending: true }),
  ]);

  const byCliente = new Map<string, any>();
  const seen = new Set<string>();

  function ensure(clienteId: string) {
    if (!byCliente.has(clienteId)) {
      byCliente.set(clienteId, {
        cliente_revenue_total: 0,
        cliente_revenue_30d: 0,
        cliente_completed_payments_count: 0,
        cliente_first_payment_at: null,
        cliente_last_payment_at: null,
        converted_first_payment: false,
      });
    }
    return byCliente.get(clienteId);
  }

  function addMove(clienteIdRaw: any, amountRaw: any, dateRaw: any) {
    const clienteId = String(clienteIdRaw || "").trim();
    const amount = cleanNum(amountRaw);
    const dateValue = dateRaw ? String(dateRaw) : null;
    if (!clienteId || !(amount > 0)) return;

    const key = paymentMoveKey(clienteId, amount, dateValue);
    if (seen.has(key)) return;
    seen.add(key);

    const row = ensure(clienteId);
    row.cliente_revenue_total += amount;
    if (dateValue && dateValue >= since30Iso) row.cliente_revenue_30d += amount;
    row.cliente_completed_payments_count += 1;
    row.converted_first_payment = true;

    if (!row.cliente_first_payment_at || new Date(dateValue || 0).getTime() < new Date(row.cliente_first_payment_at || 0).getTime()) {
      row.cliente_first_payment_at = dateValue;
    }
    if (!row.cliente_last_payment_at || new Date(dateValue || 0).getTime() > new Date(row.cliente_last_payment_at || 0).getTime()) {
      row.cliente_last_payment_at = dateValue;
    }
  }

  for (const pago of pagos || []) addMove((pago as any)?.cliente_id, (pago as any)?.importe, (pago as any)?.created_at);
  for (const row of rendimiento || []) addMove((row as any)?.cliente_id, (row as any)?.importe, (row as any)?.fecha_hora);

  return rows.map((row: AnyRow) => {
    const clienteId = String(row?.cliente_id || row?.cliente?.id || "").trim();
    const revenue = byCliente.get(clienteId);
    if (!revenue) {
      return {
        ...row,
        cliente_revenue_total: 0,
        cliente_revenue_30d: 0,
        cliente_completed_payments_count: 0,
        cliente_first_payment_at: null,
        cliente_last_payment_at: null,
        converted_first_payment: false,
      };
    }

    return {
      ...row,
      cliente_revenue_total: Number(cleanNum(revenue.cliente_revenue_total).toFixed(2)),
      cliente_revenue_30d: Number(cleanNum(revenue.cliente_revenue_30d).toFixed(2)),
      cliente_completed_payments_count: cleanNum(revenue.cliente_completed_payments_count),
      cliente_first_payment_at: revenue.cliente_first_payment_at,
      cliente_last_payment_at: revenue.cliente_last_payment_at,
      converted_first_payment: Boolean(revenue.converted_first_payment),
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = norm(searchParams.get("scope") || "pendientes");

    let raw: AnyRow[] = [];

    try {
      raw = await fetchWithJoin();
    } catch {
      raw = await fetchFallback();
    }

    raw = await enrichWithRevenue(raw);

    let items: LeadItem[] = raw.map((item) => ({
      ...item,
      workflow_state: computeWorkflowState(item),
      is_closed: isClosed(item),
    }));

    if (scope === "pendientes") {
      items = items.filter((item) => !item.is_closed);
    } else if (scope === "cerrados") {
      items = items.filter((item) => item.is_closed);
    }

    items.sort((a, b) => {
      const aNext = a.next_contact_at ? new Date(a.next_contact_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bNext = b.next_contact_at ? new Date(b.next_contact_at).getTime() : Number.MAX_SAFE_INTEGER;

      const aDue = Number.isFinite(aNext) && aNext <= Date.now() ? 0 : 1;
      const bDue = Number.isFinite(bNext) && bNext <= Date.now() ? 0 : 1;

      if (aDue !== bDue) return aDue - bDue;
      if (aNext !== bNext) return aNext - bNext;

      const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;

      return bCreated - aCreated;
    });

    return new NextResponse(JSON.stringify({ ok: true, items }), {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });

  } catch (err: any) {
    return new NextResponse(
      JSON.stringify({ ok: false, error: err?.message || "ERR_CAPTACION_LIST" }),
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
