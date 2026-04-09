export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

const CLOSED_STATUSES = new Set(["contactado", "no_interesado", "numero_invalido", "perdido", "cerrado", "finalizado"]);
const OPEN_STATUSES = new Set(["nuevo", "reintento_2", "reintento_3", "pendiente", "pending"]);

type AnyRow = Record<string, any>;

function normalizeState(raw: unknown, item: AnyRow) {
  const estado = String(raw || "").toLowerCase().trim();
  const crmStatus = String(item?.cliente?.lead_status || "").toLowerCase().trim();
  const lastResult = String(item?.last_result || "").toLowerCase().trim();

  if (item?.closed_at || item?.contacted_at) {
    if (["contactado", "no_interesado", "numero_invalido", "perdido"].includes(estado)) return estado;
    if (["contactado", "no_interesado", "numero_invalido", "perdido"].includes(crmStatus)) return crmStatus;
    if (lastResult === "contactado") return "contactado";
    return "perdido";
  }

  if (CLOSED_STATUSES.has(estado) || OPEN_STATUSES.has(estado)) {
    if (estado === "pendiente" || estado === "pending") return "nuevo";
    return estado;
  }

  if (["seguimiento", "sin_respuesta"].includes(crmStatus)) {
    const intento = Number(item?.intento_actual || 1);
    if (intento >= 3) return "reintento_3";
    if (intento >= 2) return "reintento_2";
    return "nuevo";
  }

  if (["contactado", "no_interesado", "numero_invalido", "perdido"].includes(crmStatus)) {
    return crmStatus;
  }

  return "nuevo";
}

function isClosed(item: AnyRow) {
  const estado = String(item?.estado || "").toLowerCase().trim();
  const crmStatus = String(item?.cliente?.lead_status || "").toLowerCase().trim();
  return Boolean(
    item?.closed_at ||
      item?.contacted_at ||
      CLOSED_STATUSES.has(estado) ||
      ["contactado", "no_interesado", "numero_invalido", "sin_respuesta", "perdido", "cerrado", "finalizado"].includes(crmStatus)
  );
}

async function fetchLeadRowsWithClientJoin() {
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
      created_at,
      updated_at,
      cliente:crm_clientes(
        id,
        nombre,
        apellido,
        telefono,
        email,
        origen,
        estado,
        lead_status,
        lead_campaign_name,
        lead_form_name,
        created_at
      )
    `)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchLeadRowsFallback() {
  const { data, error } = await supabase
    .from("captacion_leads")
    .select(
      "id, cliente_id, estado, intento_actual, max_intentos, next_contact_at, last_contact_at, contacted_at, closed_at, last_result, campaign_name, form_name, origen, notas, assigned_worker_id, created_at, updated_at"
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const clienteIds = Array.from(new Set(rows.map((row: AnyRow) => String(row?.cliente_id || "").trim()).filter(Boolean)));
  if (!clienteIds.length) return rows;

  const { data: clientes } = await supabase
    .from("crm_clientes")
    .select("id, nombre, apellido, telefono, email, origen, estado, lead_status, lead_campaign_name, lead_form_name, created_at")
    .in("id", clienteIds);

  const byId = new Map((Array.isArray(clientes) ? clientes : []).map((c: AnyRow) => [String(c.id), c]));
  return rows.map((row: AnyRow) => ({ ...row, cliente: byId.get(String(row?.cliente_id || "")) || null }));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = String(searchParams.get("scope") || "pendientes").trim().toLowerCase();

    let rawItems: AnyRow[] = [];
    try {
      rawItems = await fetchLeadRowsWithClientJoin();
    } catch {
      rawItems = await fetchLeadRowsFallback();
    }

    let items = rawItems.map((item: AnyRow) => ({
      ...item,
      estado: normalizeState(item?.estado, item),
    }));

    if (scope === "pendientes") {
      items = items.filter((item: AnyRow) => !isClosed(item));
    }

    items.sort((a: AnyRow, b: AnyRow) => {
      const now = Date.now();
      const aNext = a?.next_contact_at ? new Date(a.next_contact_at).getTime() : 0;
      const bNext = b?.next_contact_at ? new Date(b.next_contact_at).getTime() : 0;
      const aDue = aNext && aNext <= now ? 1 : 0;
      const bDue = bNext && bNext <= now ? 1 : 0;
      if (aDue !== bDue) return bDue - aDue;
      if (aNext !== bNext) return aNext - bNext;
      const aCreated = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return aCreated - bCreated;
    });

    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "ERR_CAPTACION_LIST" }, { status: 500 });
  }
}
